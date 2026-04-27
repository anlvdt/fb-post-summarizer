(function () {
  "use strict";
  // FeedWriter — Content script
  // https://github.com/anlvdt/fb-post-summarizer
  // Author: Le An (anlvdt)

  let MIN_LEN = 400;
  let scanTimer = null;
  const injected = new WeakSet();
  const summaryCache = new Map();

  chrome.storage.sync.get("minLength", (d) => { if (d.minLength) MIN_LEN = d.minLength; });

  function isContextValid() {
    try { return !!chrome.runtime?.id; } catch (e) { return false; }
  }

  function hashText(text) {
    let h = 0;
    for (let i = 0; i < text.length; i++) h = ((h << 5) - h + text.charCodeAt(i)) | 0;
    return h.toString(36);
  }

  const SITE = location.hostname.includes("facebook") ? "facebook"
    : location.hostname.includes("threads") ? "threads"
      : location.hostname.includes("x.com") || location.hostname.includes("twitter") ? "x"
        : location.hostname.includes("linkedin") ? "linkedin"
          : location.hostname.includes("reddit") ? "reddit" : "other";

  const SEE_MORE_KEYWORDS = {
    facebook: ["xem thêm", "see more", "voir plus", "mehr anzeigen", "もっと見る", "더 보기", "ver más", "ver mais"],
    threads: ["more", "xem thêm"],
    x: ["show more"],
    linkedin: ["see more", "xem thêm", "...more"],
    reddit: [],
    other: ["see more", "xem thêm"],
  };
  const SEE_MORE = SEE_MORE_KEYWORDS[SITE] || SEE_MORE_KEYWORDS.other;

  // === THEME ===
  let currentTheme = "light";
  function detectTheme() {
    const bg = getComputedStyle(document.body).backgroundColor;
    if (!bg || bg === "rgba(0, 0, 0, 0)") return "dark";
    const m = bg.match(/\d+/g);
    if (!m) return "dark";
    return ((+m[0] + +m[1] + +m[2]) / 3) > 128 ? "light" : "dark";
  }
  function applyTheme() {
    currentTheme = detectTheme();
    document.querySelectorAll(".fbs-wrap, .fbs-panel, .fbs-backdrop").forEach(el => {
      el.setAttribute("data-fbs-theme", currentTheme);
    });
  }
  let themeTimer = null;
  function throttledApplyTheme() {
    if (themeTimer) return;
    themeTimer = setTimeout(() => { themeTimer = null; applyTheme(); }, 500);
  }
  setTimeout(applyTheme, 1000);
  new MutationObserver(throttledApplyTheme).observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });

  // === SCAN LOGIC ===
  function findNewSeeMoreElements() {
    const results = [];
    const root = document.querySelector('div[role="main"]')
      || document.querySelector('div[id^="mount_0_0"]')
      || document.querySelector("main") || document.body;
    // Use more specific selector to reduce DOM traversal
    const els = root.querySelectorAll('div[role="button"], span[role="button"], span[dir="auto"], div[dir="auto"]');
    for (const el of els) {
      if (el.dataset.fbsScanned) continue;
      if (el.children.length > 3) continue;
      const t = (el.textContent || "").trim().toLowerCase();
      if (t.length > 30 || t.length < 4) continue;
      if (SEE_MORE.some(kw => t === kw || t === "..." + kw)) {
        el.dataset.fbsScanned = "1";
        if (isInNonPostArea(el)) continue;
        results.push(el);
      }
    }
    return results;
  }

  function isInNonPostArea(el) {
    let p = el;
    for (let i = 0; i < 20; i++) {
      p = p.parentElement;
      if (!p || p === document.body) return false;
      const role = p.getAttribute("role") || "";
      if (["navigation", "banner", "dialog", "complementary"].includes(role)) return true;
      // Skip comment areas on Facebook — comments use role="article" nested inside another role="article" (the post)
      if (SITE === "facebook" && role === "article") {
        let ancestor = p.parentElement;
        for (let j = 0; j < 10; j++) {
          if (!ancestor || ancestor === document.body) break;
          if (ancestor.getAttribute("role") === "article") return true; // nested article = comment
          ancestor = ancestor.parentElement;
        }
      }
      // Only check computed style for elements that might be fixed/sticky (cheaper than always calling getComputedStyle)
      if (p.style.position === "fixed" || p.style.position === "sticky") return true;
      if (p.classList.contains("fixed") || p.classList.contains("sticky")) return true;
    }
    return false;
  }

  function findClickable(el) {
    let p = el;
    for (let i = 0; i < 5; i++) {
      if (!p) return el;
      if (p.getAttribute("role") === "button" || p.tagName === "A" || p.tagName === "BUTTON") return p;
      p = p.parentElement;
    }
    return el;
  }

  function findTextContainer(seeMoreEl) {
    let el = seeMoreEl, best = null;
    for (let i = 0; i < 12; i++) {
      el = el.parentElement;
      if (!el || el === document.body) break;
      const len = (el.innerText || "").length;
      if (len >= 100 && len < 10000) best = el;
      if (len >= 10000) break;
    }
    return best;
  }

  function findInjectTarget(textContainer) {
    let el = textContainer;
    for (let i = 0; i < 3; i++) {
      if (!el.parentElement || el.parentElement === document.body) break;
      el = el.parentElement;
    }
    return el;
  }

  // === IMPROVED TEXT EXTRACTION ===
  // Based on readability heuristics and Vietnamese content patterns

  function extractMainContent(element) {
    if (!element) return "";

    // Clone to avoid modifying DOM
    const clone = element.cloneNode(true);

    // Remove unwanted elements (only structural noise, not content)
    const unwanted = clone.querySelectorAll(
      'script, style, nav, footer, aside, ' +
      '[role="navigation"], [role="banner"], [role="complementary"], ' +
      '.related-posts, .recommended, .recommendation'
    );
    unwanted.forEach(el => el.remove());

    // Get text content
    let text = clone.innerText || clone.textContent || "";

    // Clean up whitespace
    text = text.replace(/\s+/g, " ").trim();

    return text;
  }

  function cleanText(text) {
    // Only remove SEE_MORE patterns at the end of text
    const patterns = [...SEE_MORE];
    let cleaned = text;
    for (const p of patterns) {
      const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      cleaned = cleaned.replace(new RegExp("\\s*" + escaped + "\\s*$", "gi"), "");
    }
    return cleaned.replace(/\s+/g, " ").trim();
  }

  const ICON_BASE64 = 'data:image/png;base64,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';

  // === OVERLAY (panel, backdrop, streaming) ===
  let backdrop = null, panel = null, panelBody = null;
  let isSummarizing = false, currentPort = null;

  function ensureOverlay() {
    if (panel && panel.isConnected) return;
    backdrop = document.createElement("div");
    backdrop.className = "fbs-backdrop";
    document.body.appendChild(backdrop);
    backdrop.addEventListener("click", closeOverlay);

    panel = document.createElement("div");
    panel.className = "fbs-panel";
    panel.innerHTML =
      '<div class="fbs-panel-head"><span><img src="' + ICON_BASE64 + '" width="16" height="16" style="vertical-align:-3px"> <span class="fbs-title-text">Tóm tắt AI</span></span>' +
      '<div class="fbs-close" role="button" tabindex="0">&#10005;</div></div>' +
      '<div class="fbs-panel-body"></div>' +
      '<div class="fbs-panel-footer">' +
      '<button class="fbs-edit-btn" title="Chỉnh sửa trước khi copy"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg> Sửa</button>' +
      '<button class="fbs-stop-btn">Dừng</button>' +
      '<button class="fbs-regen-btn" title="Viết lại"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M21 13a9 9 0 1 1-3-7.7L21 8"/></svg></button>' +
      '<button class="fbs-copy-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy</button>' +
      '<button class="fbs-post-status-btn" title="Đăng lên Facebook"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg> Đăng</button>' +
      '</div>';
    document.body.appendChild(panel);
    panelBody = panel.querySelector(".fbs-panel-body");
    panel.querySelector(".fbs-close").addEventListener("click", closeOverlay);
    panel.querySelector(".fbs-copy-btn").addEventListener("click", copyResult);
    panel.querySelector(".fbs-post-status-btn").addEventListener("click", handlePostStatus);
    panel.querySelector(".fbs-stop-btn").addEventListener("click", stopSummarize);
    panel.querySelector(".fbs-regen-btn").addEventListener("click", regenerate);
    panel.querySelector(".fbs-edit-btn").addEventListener("click", toggleEdit);
  }

  let lastSummarizeParams = null;

  function toggleEdit() {
    if (!panelBody) return;
    const editBtn = panel.querySelector(".fbs-edit-btn");
    const existingTextarea = panelBody.querySelector(".fbs-edit-textarea");

    if (existingTextarea) {
      // Save edits and switch back to display mode
      const editedText = existingTextarea.value;
      // Store edited text for copy
      panelBody.dataset.editedText = editedText;
      panelBody.innerHTML = '<div class="fbs-result">' + fmt(editedText) + '</div>';
      editBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg> Sửa';
    } else {
      // Switch to edit mode
      const currentText = panelBody.dataset.editedText || panelBody.innerText || "";
      panelBody.innerHTML = '<textarea class="fbs-edit-textarea">' + esc(currentText) + '</textarea>';
      const textarea = panelBody.querySelector(".fbs-edit-textarea");
      textarea.focus();
      textarea.setSelectionRange(0, 0);
      editBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Xong';
    }
  }

  function regenerate() {
    if (!lastSummarizeParams) return;
    const { text, type } = lastSummarizeParams;
    // Clear all cache entries for this text+type (any settings combo)
    const prefix = hashText(text) + "_" + type;
    for (const k of summaryCache.keys()) {
      if (k.startsWith(prefix)) summaryCache.delete(k);
    }
    summarizeText(text, type);
  }

  function openOverlay(html, streaming, type = "summary") {
    ensureOverlay();
    const titleText = panel.querySelector(".fbs-title-text");
    if (titleText) {
      if (type === "affiliate") titleText.textContent = "Chế bài Affiliate";
      else if (type === "status_share") titleText.textContent = "Viết Status";
      else titleText.textContent = "Tóm tắt nội dung";
    }
    panelBody.innerHTML = html;
    // Clear edited text cache when new content loads
    delete panelBody.dataset.editedText;
    backdrop.classList.add("fbs-visible");
    panel.classList.add("fbs-visible");
    const footer = panel.querySelector(".fbs-panel-footer");
    const hasContent = html.includes("fbs-result") || html.includes("fbs-loading") || streaming;
    footer.style.display = hasContent ? "flex" : "none";
    panel.querySelector(".fbs-stop-btn").style.display = (isSummarizing || streaming) ? "inline-flex" : "none";
    panel.querySelector(".fbs-copy-btn").style.display = (!isSummarizing && !streaming) ? "inline-flex" : "none";
    panel.querySelector(".fbs-post-status-btn").style.display = (!isSummarizing && !streaming && html.includes("fbs-result") && SITE === "facebook" && type !== "affiliate") ? "inline-flex" : "none";
    panel.querySelector(".fbs-regen-btn").style.display = (!isSummarizing && !streaming) ? "inline-flex" : "none";
    panel.querySelector(".fbs-edit-btn").style.display = (!isSummarizing && !streaming && html.includes("fbs-result")) ? "inline-flex" : "none";
    if (streaming && panelBody.scrollHeight - panelBody.scrollTop < 500) panelBody.scrollTop = panelBody.scrollHeight;
  }

  function closeOverlay() {
    stopSummarize();
    if (speechSynthesis.speaking) speechSynthesis.cancel();
    if (panel) {
      panel.classList.remove("fbs-visible");
      panel.classList.remove("fbs-panel-left");
    }
    if (backdrop) backdrop.classList.remove("fbs-visible");
  }

  function stopSummarize() {
    if (!isSummarizing) return;
    isSummarizing = false;
    if (currentPort) { try { currentPort.disconnect(); } catch (_) { } currentPort = null; }
    if (panelBody) {
      openOverlay(panelBody.innerHTML.replace(/<span class="fbs-cursor"><\/span>/g, "") +
        '<div class="fbs-error">Đã dừng.</div>', false);
    }
  }

  function copyResult() {
    // If in edit mode, get text from textarea; otherwise use edited cache or display text
    const textarea = panelBody?.querySelector(".fbs-edit-textarea");
    const text = textarea ? textarea.value : (panelBody?.dataset?.editedText || panelBody?.innerText || "");
    navigator.clipboard.writeText(text).then(() => {
      const btn = panel.querySelector(".fbs-copy-btn");
      const orig = btn.innerHTML;
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied';
      setTimeout(() => { btn.innerHTML = orig; }, 1500);
    });
  }

  // === ĐĂNG STATUS ===

  async function handlePostStatus() {
    // Không cần check lastSummarizeParams — lấy text trực tiếp từ panel
    if (isSummarizing || !panelBody) return;

    try {
      // Lấy text từ panel — ưu tiên edited text, rồi fbs-result element (tránh lấy text nút bấm)
      const textarea = panelBody.querySelector(".fbs-edit-textarea");
      const resultEl = panelBody.querySelector(".fbs-result");
      let text = "";
      if (textarea) {
        text = textarea.value;
      } else if (panelBody.dataset.editedText) {
        text = panelBody.dataset.editedText;
      } else if (resultEl) {
        text = resultEl.innerText;
      }
      text = text.trim();
      if (!text) return;

      // Lấy metadata từ DOM element (nếu có)
      const _element = lastSummarizeParams?._element || null;
      const rawUrl = _element ? extractPostPermalink(_element) : location.href;
      const author = _element ? extractPostAuthor(_element) : "";
      const source = _element ? extractPostSource(_element) : "";
      const imageUrl = _element ? extractPostImage(_element) : "";

      // Append nguồn nếu chưa có — dùng template từ settings
      if (!text.includes("Nguồn:") && !text.includes("nguồn:") && !text.includes("Credit:")) {
        const authorText = author || "không rõ";
        const platform = SITE === "facebook" ? "FB" : SITE === "x" ? "X" : SITE === "linkedin" ? "LinkedIn" : SITE === "threads" ? "Threads" : SITE === "reddit" ? "Reddit" : "";
        let settings;
        try { settings = await new Promise(r => chrome.storage.sync.get("sourceTemplate", r)); } catch (_) { settings = {}; }
        const template = settings.sourceTemplate || "Nguồn: {platform} {author} (Link full dưới cmt)";
        const sourceLine = template
          .replace(/\{author\}/g, authorText)
          .replace(/\{platform\}/g, platform)
          .replace(/\{source\}/g, source || "");
        text += "\n\n" + sourceLine.replace(/\s+/g, " ").trim();
      }

      // Normalize link (strip tracking params, clean Facebook URL)
      let cleanUrl = rawUrl;
      if (rawUrl && rawUrl !== location.href) {
        try {
          const u = new URL(rawUrl);
          if (u.hostname.includes("facebook.com")) {
            const mp = u.searchParams.get("multi_permalinks");
            if (mp && u.pathname.includes("/groups/")) {
              cleanUrl = u.origin + u.pathname.replace(/\/$/, "") + "/posts/" + mp + "/";
            } else {
              const sfid = u.searchParams.get("story_fbid");
              const uid = u.searchParams.get("id");
              if (sfid && uid) {
                cleanUrl = u.origin + "/" + uid + "/posts/" + sfid + "/";
              } else {
                cleanUrl = u.origin + u.pathname;
              }
            }
          } else {
            // Strip tracking params
            for (const k of [...u.searchParams.keys()]) {
              if (k.startsWith("utm_") || k.startsWith("__") || ["fbclid","gclid","ref"].includes(k)) u.searchParams.delete(k);
            }
            cleanUrl = u.toString().replace(/\?$/, "");
          }
        } catch (_) {}
      }

      // Dịch panel sang phải, ẩn backdrop
      panel.classList.add("fbs-panel-left");
      if (backdrop) backdrop.classList.remove("fbs-visible");
      openFacebookComposer(text, cleanUrl, imageUrl);
    } catch (_) {
      // Fallback
      const resultEl = panelBody?.querySelector(".fbs-result");
      const text = resultEl ? resultEl.innerText : (panelBody?.innerText || "");
      panel.classList.add("fbs-panel-left");
      if (backdrop) backdrop.classList.remove("fbs-visible");
      openFacebookComposer(text.trim(), "", "");
    }
  }

  function openFacebookComposer(text, sourceUrl, imageUrl) {
    const pasteKey = navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl';

    const preview = document.createElement("div");
    preview.className = "fbs-status-preview";

    // Ảnh preview (nếu có)
    const imgHtml = imageUrl
      ? '<div class="fbs-sp-image"><img src="' + esc(imageUrl) + '" crossorigin="anonymous" onerror="this.parentElement.style.display=\'none\'"><button class="fbs-sp-copy-img">Copy ảnh</button></div>'
      : '';

    preview.innerHTML =
      '<div class="fbs-sp-header">Preview Status <span class="fbs-sp-charcount">' + text.length + ' ký tự</span></div>' +
      imgHtml +
      '<div class="fbs-sp-text">' + esc(text).replace(/\n/g, "<br>") + '</div>' +
      '<div class="fbs-sp-link-input">' +
      '<input type="text" class="fbs-sp-link-field" placeholder="Click phải vào thời gian bài viết > Copy link > Paste vào đây" value="' + esc(sourceUrl || "") + '">' +
      '<button class="fbs-sp-shorten-btn">Làm sạch</button>' +
      '</div>' +
      '<div class="fbs-sp-comment" style="display:none">' +
      '<div class="fbs-sp-comment-label">Comment đầu tiên:</div>' +
      '<div class="fbs-sp-comment-text"></div>' +
      '<button class="fbs-sp-copy-comment">Copy comment</button>' +
      '</div>' +
      '<div class="fbs-sp-actions">' +
      '<button class="fbs-sp-copy-text">Copy text</button>' +
      '<button class="fbs-sp-open-fb">Đăng status</button>' +
      '</div>';

    panelBody.appendChild(preview);
    panelBody.scrollTop = panelBody.scrollHeight;

    const footer = panel.querySelector(".fbs-panel-footer");
    if (footer) footer.style.display = "none";

    const linkField = preview.querySelector(".fbs-sp-link-field");
    const commentSection = preview.querySelector(".fbs-sp-comment");
    const commentText = preview.querySelector(".fbs-sp-comment-text");

    // Generate comment content từ link
    function updateComment(url) {
      if (!url) {
        commentSection.style.display = "none";
        return;
      }
      commentSection.style.display = "block";
      commentText.textContent = "Link bài gốc: " + url;
    }

    // Nếu đã có link sẵn
    if (sourceUrl) updateComment(sourceUrl);

    // Normalize Facebook URL
    function normalizeFbUrl(raw) {
      try {
        const u = new URL(raw);
        if (u.hostname.includes("facebook.com")) {
          const mp = u.searchParams.get("multi_permalinks");
          if (mp && u.pathname.includes("/groups/")) {
            return u.origin + u.pathname.replace(/\/$/, "") + "/posts/" + mp + "/";
          }
          const sfid = u.searchParams.get("story_fbid");
          const uid = u.searchParams.get("id");
          if (sfid && uid) {
            return u.origin + "/" + uid + "/posts/" + sfid + "/";
          }
          return u.origin + u.pathname;
        }
        // Non-FB: strip tracking
        for (const k of [...u.searchParams.keys()]) {
          if (k.startsWith("utm_") || k.startsWith("__") || ["fbclid","gclid","ref"].includes(k)) u.searchParams.delete(k);
        }
        return u.toString().replace(/\?$/, "");
      } catch (_) { return raw; }
    }

    // Auto-normalize khi paste link
    linkField.addEventListener("paste", () => {
      setTimeout(() => {
        const url = linkField.value.trim();
        if (!url) return;
        const clean = normalizeFbUrl(url);
        linkField.value = clean;
        updateComment(clean);
      }, 50);
    });

    // Cũng update khi user gõ tay
    linkField.addEventListener("input", () => {
      const url = linkField.value.trim();
      updateComment(url);
    });

    // Copy text
    preview.querySelector(".fbs-sp-copy-text").addEventListener("click", async () => {
      const btn = preview.querySelector(".fbs-sp-copy-text");
      await navigator.clipboard.writeText(text);
      btn.textContent = "Đã copy! " + pasteKey + "+V";
      setTimeout(() => { btn.textContent = "Copy text"; }, 2500);
    });

    // Làm sạch link
    preview.querySelector(".fbs-sp-shorten-btn").addEventListener("click", () => {
      const btn = preview.querySelector(".fbs-sp-shorten-btn");
      const url = linkField.value.trim();
      if (!url) return;
      const clean = normalizeFbUrl(url);
      linkField.value = clean;
      updateComment(clean);
      btn.textContent = "OK!";
      setTimeout(() => { btn.textContent = "Làm sạch"; }, 2000);
    });

    // Copy comment (link bài gốc)
    preview.querySelector(".fbs-sp-copy-comment").addEventListener("click", async () => {
      const btn = preview.querySelector(".fbs-sp-copy-comment");
      const content = commentText.textContent;
      if (!content) return;
      await navigator.clipboard.writeText(content);
      btn.textContent = "Đã copy! Paste vào comment";
      setTimeout(() => { btn.textContent = "Copy comment"; }, 2500);
    });

    // Copy ảnh
    const copyImgBtn = preview.querySelector(".fbs-sp-copy-img");
    if (copyImgBtn) {
      copyImgBtn.addEventListener("click", async () => {
        try {
          copyImgBtn.textContent = "...";
          const imgEl = preview.querySelector(".fbs-sp-image img");
          const canvas = document.createElement("canvas");
          canvas.width = imgEl.naturalWidth;
          canvas.height = imgEl.naturalHeight;
          canvas.getContext("2d").drawImage(imgEl, 0, 0);
          const blob = await new Promise(r => canvas.toBlob(r, "image/png"));
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          copyImgBtn.textContent = "Đã copy!";
          setTimeout(() => { copyImgBtn.textContent = "Copy ảnh"; }, 2500);
        } catch (_) {
          window.open(imageUrl, "_blank");
          copyImgBtn.textContent = "Mở tab mới";
          setTimeout(() => { copyImgBtn.textContent = "Copy ảnh"; }, 2000);
        }
      });
    }

    // Đăng status — auto-copy text + mở Facebook composer
    preview.querySelector(".fbs-sp-open-fb").addEventListener("click", async () => {
      const btn = preview.querySelector(".fbs-sp-open-fb");
      await navigator.clipboard.writeText(text);
      btn.textContent = "Đã copy! Đang mở...";
      if (SITE === "facebook") {
        setTimeout(() => {
          const allButtons = document.querySelectorAll('div[role="main"] div[role="button"]');
          for (const b of allButtons) {
            const t = (b.textContent || "").toLowerCase();
            if (t.includes("bạn đang nghĩ gì") || t.includes("what's on your mind") || t.includes("write something")) {
              b.click();
              btn.textContent = "Đăng status";
              return;
            }
          }
          window.scrollTo({ top: 0, behavior: "smooth" });
          btn.textContent = "Đăng status";
        }, 200);
      }
    });
  }

  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeOverlay(); });

  // === HELPERS ===
  function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
  function fmt(t) {
    return esc(t)
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/^[-•]\s*/gm, "• ")
      .replace(/\n{2,}/g, "<br>")  // nhiều dòng trống -> 1 br
      .replace(/\n/g, "<br>");      // 1 dòng -> 1 br
  }

  // === BUTTONS ===
  function createBtn() {
    const d = document.createElement("div");
    d.className = "fbs-btn";
    d.setAttribute("role", "button");
    d.setAttribute("tabindex", "0");
    d.innerHTML =
      '<img src="' + ICON_BASE64 + '" width="12" height="12" style="vertical-align:-2px"><span title="Tóm tắt nội dung"> Tóm tắt</span>';
    return d;
  }

  function createInlineBtn() {
    const d = document.createElement("span");
    d.className = "fbs-btn-inline";
    d.setAttribute("role", "button");
    d.setAttribute("tabindex", "0");
    d.style.cssText = "cursor:pointer;font-size:inherit;font-family:inherit;background:none;border:none;padding:0;margin:0;display:inline;line-height:inherit;vertical-align:baseline;";
    d.innerHTML = ' · <span title="Tóm tắt nội dung" style="cursor:pointer;display:inline-flex;align-items:center;gap:3px;vertical-align:baseline;color:#4fc3f7;font-weight:600;font-size:0.92em;background:rgba(79,195,247,0.13);padding:0px 6px 1px;border-radius:8px;transition:background 0.15s"><img src="' + ICON_BASE64 + '" style="width:11px;height:11px;vertical-align:-1px;flex-shrink:0">Tóm tắt</span>';
    const pill = d.querySelector("span");
    d.addEventListener("mouseenter", () => { pill.style.background = "rgba(79,195,247,0.28)"; });
    d.addEventListener("mouseleave", () => { pill.style.background = "rgba(79,195,247,0.13)"; });
    return d;
  }

  // === POST METADATA EXTRACTION ===
  function extractPostPermalink(element) {
    // Nếu đang xem bài đơn lẻ (URL chứa /posts/, /permalink/, story_fbid) → dùng URL trang
    const url = location.href;
    if (SITE === "facebook") {
      if (/\/posts\/|\/permalink\/|story_fbid|multi_permalinks/.test(url)) return url;
      return ""; // Đang ở newsfeed → không biết link bài nào → để user paste
    }
    // Non-Facebook: thử tìm trong DOM
    if (!element) return url;
    let postContainer = element;
    for (let i = 0; i < 20; i++) {
      if (!postContainer.parentElement || postContainer.parentElement === document.body) break;
      postContainer = postContainer.parentElement;
      if (postContainer.getAttribute("role") === "article") break;
    }
    const platformLinks = {
      threads: 'a[href*="/post/"]',
      x: 'a[href*="/status/"]',
      linkedin: 'a[href*="/feed/update/"]',
      reddit: 'a[href*="/comments/"]',
    };
    const selector = platformLinks[SITE];
    if (selector) {
      const link = postContainer.querySelector(selector);
      if (link && link.href) {
        try { return new URL(link.href).origin + new URL(link.href).pathname; } catch (_) { }
      }
    }
    return url;
  }

  function extractPostImage(element) {
    if (!element) return "";

    // Walk up to post container
    let postContainer = element;
    for (let i = 0; i < 20; i++) {
      if (!postContainer.parentElement || postContainer.parentElement === document.body) break;
      postContainer = postContainer.parentElement;
      if (postContainer.getAttribute("role") === "article") break;
    }

    if (SITE === "facebook") {
      // Strategy: Facebook post images are inside specific containers
      // They are NOT inside the header area (which contains avatar + author name)
      // Post images are typically in a sibling/descendant of the text content area

      // 1. Look for images inside photo/video link containers
      const photoLinks = postContainer.querySelectorAll(
        'a[href*="/photo"], a[href*="/photos/"], a[href*="fbid="], a[href*="/reel/"], a[href*="/videos/"]'
      );
      for (const link of photoLinks) {
        const img = link.querySelector("img");
        if (img && img.src && !img.src.startsWith("data:")) {
          const w = img.naturalWidth || img.width || 0;
          if (w >= 100) return img.src;
        }
      }

      // 2. Look for large images (>300px wide) that are NOT circular (avatar)
      const allImgs = postContainer.querySelectorAll("img");
      for (const img of allImgs) {
        const src = img.src || "";
        if (!src || src.startsWith("data:")) continue;
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        // Must be large enough to be a content image
        if (w < 300 && h < 300) continue;
        // Skip circular (avatar)
        try {
          const style = getComputedStyle(img);
          if (style.borderRadius === "50%") continue;
        } catch (_) {}
        // Skip if inside a link to user profile
        const parentLink = img.closest("a");
        if (parentLink) {
          const href = parentLink.href || "";
          if (href && !href.includes("/photo") && !href.includes("/video") && !href.includes("fbid")) {
            // Link doesn't point to photo/video — likely avatar or other UI element
            if (w < 500) continue;
          }
        }
        return src;
      }
    } else {
      // Non-Facebook: original logic
      const images = postContainer.querySelectorAll("img");
      for (const img of images) {
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        const src = img.src || "";
        if (!src || src.startsWith("data:")) continue;
        if (w < 200 && h < 200) continue;
        if (src.includes("emoji") || src.includes("static")) continue;
        if (src.includes("profile") || src.includes("avatar")) continue;
        try {
          if (getComputedStyle(img).borderRadius === "50%") continue;
        } catch (_) {}
        return src;
      }
    }

    // Fallback: og:image
    const ogImage = document.querySelector('meta[property="og:image"]');
    if (ogImage && ogImage.content) return ogImage.content;

    return "";
  }

  function extractPostAuthor(element) {
    if (!element) return "";

    let postContainer = element;
    for (let i = 0; i < 20; i++) {
      if (!postContainer.parentElement || postContainer.parentElement === document.body) break;
      postContainer = postContainer.parentElement;
      if (postContainer.getAttribute("role") === "article") break;
    }

    if (SITE === "facebook") {
      // Facebook: author is the FIRST <a> inside h2/h3/h4 (header area)
      // This is always the author name, not group/page name
      const headers = postContainer.querySelectorAll("h2, h3, h4");
      for (const h of headers) {
        const firstLink = h.querySelector("a");
        if (firstLink) {
          const name = (firstLink.textContent || "").trim();
          if (name.length >= 2 && name.length < 80 && !SEE_MORE.includes(name.toLowerCase())) {
            return name;
          }
        }
      }
      // Fallback: strong > a (but only first one)
      const strongLink = postContainer.querySelector("strong a");
      if (strongLink) {
        const name = (strongLink.textContent || "").trim();
        if (name.length >= 2 && name.length < 80) return name;
      }
    }

    // X/Threads
    const nameEl = postContainer.querySelector('[data-testid="User-Name"], [data-testid="tweetAuthorName"]');
    if (nameEl) return (nameEl.textContent || "").split("@")[0].trim();

    // LinkedIn
    const liAuthor = postContainer.querySelector(".feed-shared-actor__name, .update-components-actor__name");
    if (liAuthor) return (liAuthor.textContent || "").trim();

    // Reddit
    const redditAuthor = postContainer.querySelector('[data-testid="post_author_link"], a[href*="/user/"]');
    if (redditAuthor) return (redditAuthor.textContent || "").trim();

    return "";
  }

  function extractPostSource(element) {
    if (!element) return "";

    let postContainer = element;
    for (let i = 0; i < 20; i++) {
      if (!postContainer.parentElement || postContainer.parentElement === document.body) break;
      postContainer = postContainer.parentElement;
      if (postContainer.getAttribute("role") === "article") break;
    }

    if (SITE === "facebook") {
      // Chỉ trả về group name nếu thực sự đang xem trong group
      // Kiểm tra URL trang hoặc pattern "Author › Group" trong header
      const isInGroup = location.href.includes("/groups/");
      if (isInGroup) {
        // Tìm group name: thường là link thứ 2 trong header (sau author)
        const headers = postContainer.querySelectorAll("h2, h3, h4");
        for (const h of headers) {
          const links = h.querySelectorAll("a");
          if (links.length >= 2) {
            const name = (links[1].textContent || "").trim();
            if (name.length >= 3 && name.length < 100) return name;
          }
        }
        // Fallback: lấy từ group link
        const groupLink = postContainer.querySelector('a[href*="/groups/"]');
        if (groupLink) {
          const name = (groupLink.textContent || "").trim();
          if (name.length >= 3 && name.length < 100) return name;
        }
      }
    }

    return "";
  }

  function extractPostTitle(element) {
    if (!element) return "";

    // Walk up to post container
    let postContainer = element;
    for (let i = 0; i < 20; i++) {
      if (!postContainer.parentElement || postContainer.parentElement === document.body) break;
      postContainer = postContainer.parentElement;
      if (postContainer.getAttribute("role") === "article") break;
    }

    // Reddit has explicit title
    const redditTitle = postContainer.querySelector('[data-testid="post-title"], h1, h3[slot="title"]');
    if (redditTitle) return (redditTitle.textContent || "").trim();

    // LinkedIn shared articles
    const liTitle = postContainer.querySelector(".feed-shared-article__title, .update-components-article__title");
    if (liTitle) return (liTitle.textContent || "").trim();

    // og:title for single post pages
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle && ogTitle.content) return ogTitle.content;

    // Fallback: empty — AI will generate title from summary
    return "";
  }

  // === STREAMING SUMMARIZE ===
  async function wakeServiceWorker() {
    try { await chrome.runtime.sendMessage({ action: "ping" }); } catch (_) { }
  }

  async function summarizeText(text, type = "summary", contextElement = null) {
    if (!text || text.length < 50) {
      openOverlay('<div class="fbs-error">Text quá ngắn để tóm tắt.</div>', false);
      return;
    }

    if (!isContextValid()) {
      openOverlay('<div class="fbs-error">Extension đã cập nhật. Vui lòng F5.</div>', false, type);
      return;
    }

    // Smart cache key includes settings that affect output
    let settings;
    try {
      settings = await new Promise(r => chrome.storage.sync.get(["summaryLength", "promptStyle"], r));
    } catch (_) {
      openOverlay('<div class="fbs-error">Extension đã cập nhật. Vui lòng F5.</div>', false, type);
      return;
    }
    const cacheKey = hashText(text) + "_" + type + "_" + (settings.summaryLength || "medium") + "_" + (settings.promptStyle || "default");

    if (summaryCache.has(cacheKey)) {
      openOverlay('<div class="fbs-result">' + fmt(summaryCache.get(cacheKey)) + '</div>', false, type);
      return;
    }

    lastSummarizeParams = { text, type, _element: contextElement };
    isSummarizing = true;
    const title = type === "affiliate" ? "Đang viết bài Affiliate..." : type === "status_share" ? "Đang viết Status..." : "Đang tóm tắt...";
    openOverlay('<div class="fbs-loading"><div class="fbs-spinner"></div><span>' + title + '</span></div>', false, type);

    // Wake SW before connecting port (MV3 SW dies after ~30s idle)
    await wakeServiceWorker();
    if (!isContextValid()) {
      openOverlay('<div class="fbs-error">Extension đã cập nhật. Vui lòng F5.</div>', false, type);
      return;
    }
    currentPort = chrome.runtime.connect({ name: "summarize-stream" });
    // Extract post metadata for enriched history
    const _el = lastSummarizeParams._element;
    const _sourceUrl = extractPostPermalink(_el);
    const _imageUrl = extractPostImage(_el);
    const _author = extractPostAuthor(_el);
    const _title = extractPostTitle(_el);
    const _source = extractPostSource(_el);
    currentPort.postMessage({ action: "summarize", text, site: SITE, type, sourceUrl: _sourceUrl, imageUrl: _imageUrl, author: _author, postTitle: _title, postSource: _source });

    let first = true;
    currentPort.onMessage.addListener((msg) => {
      if (msg.action === "chunk") {
        if (first) { first = false; }
        openOverlay('<div class="fbs-result">' + fmt(msg.full) + '<span class="fbs-cursor"></span></div>', true);
      } else if (msg.action === "done") {
        isSummarizing = false;
        summaryCache.set(cacheKey, msg.full);
        // Show quality warnings from post-processing guardrails
        let qualityHtml = "";
        if (msg.issues && msg.issues.length > 0) {
          const issueClass = msg.quality === "warn" ? "fbs-quality-warn" : "fbs-quality-info";
          qualityHtml = '<div class="' + issueClass + '">' + msg.issues.map(i => esc(i)).join("<br>") + '</div>';
        }
        openOverlay('<div class="fbs-result">' + fmt(msg.full) + '</div>' + qualityHtml, false, type);
        try { currentPort.disconnect(); } catch (_) { } currentPort = null;
      } else if (msg.action === "error") {
        isSummarizing = false;
        openOverlay('<div class="fbs-error">' + esc(msg.error) + '</div>', false);
        try { currentPort.disconnect(); } catch (_) { } currentPort = null;
      }
    });

    currentPort.onDisconnect.addListener(() => {
      if (isSummarizing) {
        isSummarizing = false;
        if (panelBody && !panelBody.innerHTML.includes("fbs-result")) {
          openOverlay('<div class="fbs-error">Kết nối bị ngắt.</div>', false, type);
        } else if (panelBody) {
          openOverlay(panelBody.innerHTML.replace(/<span class="fbs-cursor"><\/span>/g, ""), false, type);
        }
      }
    });
  }

  // === MESSAGES (CONTEXT MENU, SHORTCUTS & UNSHORTEN) ===
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "summarize-selection" && msg.text) {
      summarizeText(msg.text, msg.type);
    }
    if (msg.action === "shortcut-summarize-shortcut") {
      const text = window.getSelection().toString();
      if (text) summarizeText(text, "summary");
      else openOverlay('<div class="fbs-error">Vui lòng bôi đen đoạn văn bản trước khi bấm Hotkey!</div>', false);
    }
    if (msg.action === "shortcut-affiliate-shortcut") {
      const text = window.getSelection().toString();
      if (text) summarizeText(text, "affiliate");
      else openOverlay('<div class="fbs-error">Vui lòng bôi đen đoạn văn bản trước khi bấm Hotkey!</div>', false);
    }
    if (msg.action === "unshorten-result") {
      if (msg.error) {
        openOverlay('<div class="fbs-error">' + esc(msg.error) + '</div>', false);
      } else if (msg.text) {
        navigator.clipboard.writeText(msg.text)
          .catch(() => openOverlay('<div class="fbs-error">Lỗi ghi clipboard. Link gốc là:<br><code>' + esc(msg.text) + '</code></div>', false));
      }
    }
  });


  // === INJECT BUTTON ===
  function inject(target, seeMoreClickable, textContainer, seeMoreOriginal) {
    if (injected.has(target)) return;
    injected.add(target);

    const isInline = !!(seeMoreOriginal && seeMoreOriginal.parentElement);
    const wrap = document.createElement("span");
    if (isInline) {
      wrap.style.cssText = "display:inline;position:relative;vertical-align:baseline;";
    } else {
      wrap.className = "fbs-wrap";
    }
    wrap.appendChild(isInline ? createInlineBtn() : createBtn());

    let inserted = false;

    // 1) Insert after "Xem thêm" text element (don't wrap/move it)
    if (!inserted && seeMoreOriginal && seeMoreOriginal.parentElement) {
      try {
        seeMoreOriginal.parentElement.insertBefore(wrap, seeMoreOriginal.nextSibling);
        inserted = true;
      } catch (e) { }
    }

    // 2) Insert after clickable
    if (!inserted && seeMoreClickable && seeMoreClickable.parentElement) {
      try {
        seeMoreClickable.parentElement.insertBefore(wrap, seeMoreClickable.nextSibling);
        inserted = true;
      } catch (e) { }
    }

    // 3) Append to text container
    if (!inserted && textContainer) {
      try { textContainer.appendChild(wrap); inserted = true; } catch (e) { }
    }

    // 4) Fallback absolute
    if (!inserted) {
      wrap.className = "fbs-wrap";
      const pos = getComputedStyle(target).position;
      if (pos === "static" || pos === "") target.style.position = "relative";
      target.appendChild(wrap);
    }

    const btnEl = wrap.querySelector(".fbs-btn") || wrap.querySelector(".fbs-btn-inline");
    btnEl.addEventListener("click", async (e) => {
      e.stopPropagation();
      const type = "summary";
      const title = "Đang tóm tắt...";
      openOverlay('<div class="fbs-loading"><div class="fbs-spinner"></div><span>' + title + '</span></div>', false, type);

      // Expand to get full text
      if (seeMoreClickable) {
        try { seeMoreClickable.click(); } catch (_) { }
        await new Promise(r => setTimeout(r, 1200));
      }

      const text = cleanText(extractMainContent(textContainer || target) || (textContainer || target).innerText || "");

      // Collapse back: Facebook no longer has "Ẩn bớt" button.
      // Re-click the same "Xem thêm" element to toggle back.
      if (seeMoreClickable) {
        try { seeMoreClickable.click(); } catch (_) { }
      }

      await summarizeText(text, type, textContainer || target);
    });
  }

  function processSeeMore(sm) {
    const textContainer = findTextContainer(sm);
    if (!textContainer) return;
    if ((textContainer.innerText || "").trim().length < MIN_LEN / 2) return;
    const target = findInjectTarget(textContainer);
    if (injected.has(target) || target.querySelector(".fbs-wrap") || target.querySelector(".fbs-btn-inline")) return;
    inject(target, findClickable(sm), textContainer, sm);
  }

  // === FLOATING TOOLBAR ===
  let floatingToolbar = null;
  function createFloatingToolbar() {
    if (floatingToolbar) return;
    floatingToolbar = document.createElement("div");
    floatingToolbar.className = "fbs-floating-toolbar";
    floatingToolbar.innerHTML = '<button class="fbs-floating-btn fbs-btn-highlight" data-action="summary"><img src="' + ICON_BASE64 + '" width="13" height="13" style="vertical-align:-2px"> Tóm tắt</button>' +
      '<button class="fbs-floating-btn" data-action="affiliate"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg> Affiliate</button>';
    document.body.appendChild(floatingToolbar);

    floatingToolbar.addEventListener("mousedown", (e) => e.preventDefault());
    floatingToolbar.addEventListener("click", (e) => {
      e.preventDefault();
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.getAttribute("data-action");
      const sel = window.getSelection();
      const text = sel.toString().trim();
      if (text) {
        floatingToolbar.classList.remove("fbs-visible");
        const anchor = sel.rangeCount > 0 ? sel.getRangeAt(0).startContainer.parentElement : null;
        summarizeText(text, action, anchor);
      }
    });

    document.addEventListener("scroll", () => {
      if (floatingToolbar.classList.contains("fbs-visible")) floatingToolbar.classList.remove("fbs-visible");
    }, { capture: true, passive: true });
  }

  function handleSelection() {
    createFloatingToolbar();
    setTimeout(() => {
      const selection = window.getSelection();
      const text = selection.toString().trim();
      if (text.length < 15 || selection.rangeCount === 0) {
        floatingToolbar.classList.remove("fbs-visible");
        return;
      }
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        floatingToolbar.classList.remove("fbs-visible");
        return;
      }
      const top = rect.top + window.scrollY - 44;
      const left = rect.left + window.scrollX + (rect.width / 2) - 80;
      floatingToolbar.style.top = top + "px";
      floatingToolbar.style.left = left + "px";
      floatingToolbar.classList.add("fbs-visible");
    }, 0);
  }

  document.addEventListener("mouseup", (e) => {
    if (floatingToolbar && floatingToolbar.contains(e.target)) return;
    handleSelection();
  });

  document.addEventListener("mousedown", (e) => {
    if (floatingToolbar && !floatingToolbar.contains(e.target)) {
      floatingToolbar.classList.remove("fbs-visible");
    }
  });

  // === REDDIT ===
  function scanRedditPosts() {
    const posts = document.querySelectorAll('shreddit-post, div[data-testid="post-container"]');
    for (const post of posts) {
      if (post.dataset.fbsScanned) continue;
      post.dataset.fbsScanned = "1";
      const textEl = post.querySelector('[data-testid="post-content"], .md, [slot="text-body"]');
      if (!textEl) continue;
      if ((textEl.innerText || "").trim().length < MIN_LEN) continue;
      inject(post, null, textEl);
    }
  }

  // === MAIN SCAN ===
  function scanShopeeLinks() {
    const links = document.querySelectorAll('a[href*="shope.ee/"]');
    for (const a of links) {
      if (a.dataset.fbsUnshorten) continue;
      a.dataset.fbsUnshorten = "1";
      const btn = document.createElement("span");
      btn.innerHTML = ' <span title="Bóc Link Không Cookie" style="cursor:pointer;display:inline-flex;align-items:center;gap:4px;padding:0px 6px 1px;border-radius:6px;background:rgba(255,107,107,0.15);color:#ff6b6b;font-size:0.85em;font-weight:bold;margin-left:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>Bóc Link</span>';
      btn.querySelector("span").addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        chrome.runtime.sendMessage({ action: "unshorten-shopee-inline", url: a.href }).catch(() => { });
      });
      a.insertAdjacentElement("afterend", btn);
    }
  }

  function scan() {
    if (!isContextValid()) return;
    if (SITE === "reddit") scanRedditPosts();
    findNewSeeMoreElements().forEach(processSeeMore);
    scanShopeeLinks();
  }

  function debouncedScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 200);
  }

  scan();
  setTimeout(scan, 500);
  setTimeout(scan, 1500);
  new MutationObserver(() => debouncedScan()).observe(document.body, { childList: true, subtree: true });
  setInterval(scan, 5000);
})();
