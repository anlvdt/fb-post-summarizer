(function () {
  "use strict";
  // FeedWriter — Content script
  // https://github.com/anlvdt/fb-post-summarizer
  // Author: Le An (anlvdt)

  let MIN_LEN = 400;
  let isBlocked = false;
  let scanTimer = null;
  const injected = new WeakSet();
  const summaryCache = new LRUCache(50);
  const observers = []; // Store observers for cleanup
  const listeners = []; // Store event listeners for cleanup

  // Cleanup function
  function cleanup() {
    observers.forEach(obs => obs.disconnect());
    observers.length = 0;
    listeners.forEach(({ element, event, handler, options }) => {
      element.removeEventListener(event, handler, options);
    });
    listeners.length = 0;
    if (scanTimer) {
      clearInterval(scanTimer);
      scanTimer = null;
    }
  }

  // Cleanup on extension reload or page unload
  if (chrome.runtime?.onConnect) {
    chrome.runtime.onConnect.addListener(() => cleanup());
  }
  window.addEventListener("beforeunload", cleanup, { once: true });

  chrome.storage.sync.get(["minLength", "blockedDomains"], (d) => {
    if (d.minLength) MIN_LEN = d.minLength;
    if (d.blockedDomains) {
      const href = location.href;
      const blocked = d.blockedDomains.split("\n").map(s => s.trim()).filter(Boolean);
      if (blocked.some(pattern => href.includes(pattern))) isBlocked = true;
    }
  });

  function hashText(text) {
    let h = 0;
    for (let i = 0; i < text.length; i++)
      h = ((h << 5) - h + text.charCodeAt(i)) | 0;
    return h.toString(36);
  }

  const SITE = location.hostname.includes("facebook")
    ? "facebook"
    : location.hostname.includes("threads")
      ? "threads"
      : location.hostname.includes("x.com") ||
          location.hostname.includes("twitter")
        ? "x"
        : location.hostname.includes("linkedin")
          ? "linkedin"
          : location.hostname.includes("reddit")
            ? "reddit"
            : "other";

  const SEE_MORE_KEYWORDS = {
    facebook: [
      "xem thêm",
      "see more",
      "voir plus",
      "mehr anzeigen",
      "もっと見る",
      "더 보기",
      "ver más",
      "ver mais",
    ],
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
    return (+m[0] + +m[1] + +m[2]) / 3 > 128 ? "light" : "dark";
  }
  function applyTheme() {
    currentTheme = detectTheme();
    document
      .querySelectorAll(".fbs-wrap, .fbs-panel, .fbs-backdrop")
      .forEach((el) => {
        el.setAttribute("data-fbs-theme", currentTheme);
      });
  }
  let themeTimer = null;
  function throttledApplyTheme() {
    if (themeTimer) return;
    themeTimer = setTimeout(() => {
      themeTimer = null;
      applyTheme();
    }, 500);
  }
  setTimeout(applyTheme, 1000);
  const themeObserver = new MutationObserver(throttledApplyTheme);
  themeObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ["class", "style"],
  });
  observers.push(themeObserver);

  // === SCAN LOGIC ===
  function findNewSeeMoreElements() {
    const results = [];
    const roots = (typeof visiblePosts !== "undefined" && visiblePosts.size > 0) ? Array.from(visiblePosts) : [
      document.querySelector('div[role="main"]') ||
      document.querySelector('div[id^="mount_0_0"]') ||
      document.querySelector("main") ||
      document.body
    ];
    for (const root of roots) {
      const els = root.querySelectorAll(
        'div[role="button"], span[role="button"], span[dir="auto"], div[dir="auto"]',
      );
      for (const el of els) {
        if (el.dataset.fbsScanned) continue;
        if (el.children.length > 6) continue;
        const t = (el.innerText || el.textContent || "").trim().toLowerCase();
        if (t.length > 30 || t.length < 4) continue;
        if (SEE_MORE.some((kw) => t === kw || t === "..." + kw || t.startsWith(kw))) {
          el.dataset.fbsScanned = "1";
          if (isInNonPostArea(el)) continue;
          if (isSponsored(el)) continue;
          results.push(el);
        }
      }
    }
    return results;
  }

  const SPONSORED_KEYWORDS = [
    // Vietnamese
    "được tài trợ", "quảng cáo", "tài trợ", "nội dung được tài trợ",
    // English
    "sponsored", "paid partnership", "promoted", "paid ad",
    // Other languages
    "publicité", "gesponsert", "gesponsord", "sponsorisé",
    "patrocinado", "sponsorizzato", "rekommenderat",
    "реклама", "рекламная запись", "広告", "スポンサー",
    "光告", "赞助内容", "贊助", "광고", "협찬",
  ];

  // Non-organic feed labels (short text in post header, similar to "Sponsored")
  const CLUTTER_LABELS = [
    // Vietnamese — gợi ý / đề xuất
    "gợi ý cho bạn", "video gợi ý", "reels gợi ý", "nhóm gợi ý",
    "trang gợi ý", "sự kiện gợi ý", "bài viết gợi ý", "có thể bạn quan tâm",
    "khám phá thêm", "người bạn có thể biết", "tin tức gợi ý",
    "dành cho bạn", "được đề xuất", "nội dung liên quan",
    "được xem nhiều", "xu hướng", "trending",
    // Vietnamese — reel / memory noise
    "kỷ niệm", "memories", "trong ngày này",
    // English — suggested / recommended
    "suggested for you", "suggested reels", "suggested groups",
    "suggested events", "pages you might like", "videos you might like",
    "people you may know", "you might also like", "suggested",
    "recommended", "recommended for you", "on this day",
    "reels and short videos", "friend suggestions",
    // French/German/Spanish
    "suggéré pour vous", "vorgeschlagen", "sugerido para ti",
    "recommandé pour vous", "empfohlen", "recomendado",
  ];

  // Find the closest ancestor article[role="article"] of an element (legacy helper)
  function findPostArticle(el) {
    let p = el;
    for (let i = 0; i < 25; i++) {
      p = p.parentElement;
      if (!p || p === document.body) return null;
      if (p.getAttribute("role") === "article") return p;
    }
    return null;
  }

  // ── Feed wrapper finder ──────────────────────────────────────────────────
  // Walk UP from any element inside a post to find the individual post wrapper.
  // Stops at div[role="feed"] child or data-virtualized — does NOT stop at
  // div[role="main"] which would match the entire newsfeed column.
  const CLUTTER_STOP_ROLES = new Set(["complementary", "banner", "navigation", "dialog"]);

  function findFeedWrapper(el) {
    let cur = el;
    for (let i = 0; i < 30; i++) {
      const parent = cur.parentElement;
      if (!parent || parent === document.body) return null;
      const role = parent.getAttribute("role") || "";
      if (CLUTTER_STOP_ROLES.has(role)) return null; // sidebar/nav — wrong area
      // data-virtualized = Facebook's virtual-scroll individual post wrapper
      if (parent.hasAttribute("data-virtualized")) return parent;
      // div[role="feed"] → cur is a single feed item
      if (role === "feed") return cur;
      // Legacy: article[role="article"] whose parent is feed/article
      if (role === "article") {
        const pRole = (parent.parentElement?.getAttribute("role")) || "";
        if (pRole === "feed" || pRole === "article") return parent;
      }
      cur = parent;
    }
    return null; // could not find a reliable individual post boundary — don't hide
  }

  // isSponsored: used by findNewSeeMoreElements to skip injecting button on ad posts.
  // Finds the feed wrapper for el, then scans it for any sponsored signal.
  // isSponsored: used by findNewSeeMoreElements to skip injecting button on ad posts.
  // Finds the feed wrapper for el, then scans it for any sponsored signal.
  function isSponsored(el) {
    if (SITE !== "facebook") return false;
    // Get the containing post (wrapper or article)
    const container = findFeedWrapper(el) ||
      (el.getAttribute && el.getAttribute("role") === "article" ? el : findPostArticle(el));
    if (!container) return false;

    // 1. href to Facebook ads about page (strong signal)
    if (container.querySelector(
      'a[href*="/ads/about"], a[href*="about_ads"], a[href*="adchoices"], a[href*="/ads/preferences"]'
    )) return true;

    // 2. "Why am I seeing this?" / "Tại sao tôi thấy" link (FB ad disclosure)
    if (container.querySelector(
      'a[aria-label*="Why am I seeing"], a[aria-label*="Tại sao tôi"], a[aria-label*="Vì sao"], span[aria-label*="Why am I"]'
    )) return true;

    // 3. Portal-based detection
    const SPONSORED_NORM = SPONSORED_KEYWORDS.map(kw => kw.replace(/\s+/g, "").toLowerCase());
    const ariaRefs = container.querySelectorAll("[aria-describedby],[aria-labelledby]");
    for (const ref of ariaRefs) {
      const ids = ((ref.getAttribute("aria-describedby") || "") + " " + (ref.getAttribute("aria-labelledby") || "")).trim().split(/\s+/);
      for (const id of ids) {
        if (!id) continue;
        const portal = document.getElementById(id);
        if (!portal) continue;
        const tcNorm = (portal.textContent || "").replace(/\s+/g, "").toLowerCase();
        if (SPONSORED_NORM.some(kw => tcNorm === kw || tcNorm.startsWith(kw))) return true;
      }
    }

    // 4. aria-label substring scan (for buttons/spans with sponsored label)
    const ariaLabelEls = container.querySelectorAll("[aria-label]");
    for (const el of ariaLabelEls) {
      const lbl = (el.getAttribute("aria-label") || "").replace(/\s+/g, "").toLowerCase();
      if (lbl.length < 3 || lbl.length > 120) continue;
      if (SPONSORED_NORM.some(kw => lbl.includes(kw))) return true;
    }

    // 5. text scan fallback (non-portal / other structures)
    const candidates = container.querySelectorAll('a, span, div[dir="auto"]');
    for (const node of candidates) {
      const tc = node.textContent || "";
      const tcNorm = tc.replace(/\s+/g, "").toLowerCase();
      if (tcNorm.length < 2 || tcNorm.length > 40) continue;
      if (SPONSORED_NORM.some(kw => tcNorm === kw || tcNorm.startsWith(kw))) return true;
    }
    return false;
  }

  function isInNonPostArea(el) {
    let p = el;
    for (let i = 0; i < 20; i++) {
      p = p.parentElement;
      if (!p || p === document.body) return false;
      const role = p.getAttribute("role") || "";
      if (["navigation", "banner", "dialog", "complementary"].includes(role))
        return true;
      // Skip comment areas on Facebook.
      // Old FB structure: post=article, comment=article inside post (1 ancestor article = comment).
      // New FB structure: feed=article, post=article inside feed, comment=article inside post.
      // Now need 2+ ancestor articles to be a comment (post has 1 ancestor article = feed container).
      if (SITE === "facebook" && role === "article") {
        let articleAncestors = 0;
        let ancestor = p.parentElement;
        for (let j = 0; j < 15; j++) {
          if (!ancestor || ancestor === document.body) break;
          if (ancestor.getAttribute("role") === "article") articleAncestors++;
          ancestor = ancestor.parentElement;
        }
        if (articleAncestors >= 2) return true; // deeply nested = comment/reply
      }
      // Only check computed style for elements that might be fixed/sticky (cheaper than always calling getComputedStyle)
      if (p.style.position === "fixed" || p.style.position === "sticky")
        return true;
      if (p.classList.contains("fixed") || p.classList.contains("sticky"))
        return true;
    }
    return false;
  }

  function findClickable(el) {
    let p = el;
    for (let i = 0; i < 5; i++) {
      if (!p) return el;
      if (
        p.getAttribute("role") === "button" ||
        p.tagName === "A" ||
        p.tagName === "BUTTON"
      )
        return p;
      p = p.parentElement;
    }
    return el;
  }

  function findTextContainer(seeMoreEl) {
    let el = seeMoreEl,
      best = null;
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

    // Remove unwanted elements (structural noise + potentially dangerous embeds)
    const unwanted = clone.querySelectorAll(
      "script, style, nav, footer, aside, iframe, object, embed, " +
        "noscript, template, svg[aria-hidden], " +
        '[role="navigation"], [role="banner"], [role="complementary"], ' +
        ".related-posts, .recommended, .recommendation",
    );
    unwanted.forEach((el) => el.remove());

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
      cleaned = cleaned.replace(
        new RegExp("\\s*" + escaped + "\\s*$", "gi"),
        "",
      );
    }
    return cleaned.replace(/\s+/g, " ").trim();
  }

  const ICON_BASE64 =
    "data:image/png;base64,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";

  // === OVERLAY (panel, backdrop, streaming) ===
  let backdrop = null,
    panel = null,
    panelBody = null;

  // Module-level: store the most recently extracted image list for callers
  // that need multi-image support. Populated by extractPostImage() and read
  // by extractPostImages() helper exposed on window.
  let _lastExtractedImages = [];
  let isSummarizing = false,
    currentPort = null;

  function ensureOverlay() {
    if (panel && panel.isConnected) return;
    backdrop = document.createElement("div");
    backdrop.className = "fbs-backdrop";
    document.body.appendChild(backdrop);
    backdrop.addEventListener("click", closeOverlay);

    panel = document.createElement("div");
    panel.className = "fbs-panel";
    panel.innerHTML =
      '<div class="fbs-panel-head"><span><img src="' +
      ICON_BASE64 +
      '" width="16" height="16" style="vertical-align:-3px"> <span class="fbs-title-text">Tóm tắt AI</span></span>' +
      '<div class="fbs-close" role="button" tabindex="0">&#10005;</div></div>' +
      '<div class="fbs-panel-body"></div>' +
      '<div class="fbs-tone-row">' +
      '<span class="fbs-tone-label">Tone:</span>' +
      '<button class="fbs-tone-btn" data-tone="short">Ngắn hơn</button>' +
      '<button class="fbs-tone-btn" data-tone="academic">Học thuật</button>' +
      '<button class="fbs-tone-btn" data-tone="viral">Viral</button>' +
      '<button class="fbs-tone-btn" data-tone="bullet">Bullet points</button>' +
      "</div>" +
      '<div class="fbs-panel-footer">' +
      '<button class="fbs-edit-btn" title="Chỉnh sửa trước khi copy"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg> Sửa</button>' +
      '<button class="fbs-stop-btn">Dừng</button>' +
      '<select class="fbs-model-select" title="Chọn provider cho Viết lại">' +
      '<option value="">Auto</option>' +
      '<option value="groq">Groq</option>' +
      '<option value="gemini">Gemini</option>' +
      '<option value="cerebras">Cerebras</option>' +
      '<option value="sambanova">SambaNova</option>' +
      '<option value="openrouter">OpenRouter</option>' +
      "</select>" +
      '<button class="fbs-regen-btn" title="Viết lại"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M21 13a9 9 0 1 1-3-7.7L21 8"/></svg></button>' +
      '<button class="fbs-copy-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy</button>' +
      '<button class="fbs-post-status-btn" title="Đăng lên Facebook"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg> Đăng</button>' +
      "</div>";
    document.body.appendChild(panel);
    panelBody = panel.querySelector(".fbs-panel-body");
    panel.querySelector(".fbs-close").addEventListener("click", closeOverlay);
    panel.querySelector(".fbs-copy-btn").addEventListener("click", copyResult);
    panel
      .querySelector(".fbs-post-status-btn")
      .addEventListener("click", handlePostStatus);
    panel
      .querySelector(".fbs-stop-btn")
      .addEventListener("click", stopSummarize);
    panel.querySelector(".fbs-regen-btn").addEventListener("click", regenerate);
    panel.querySelector(".fbs-edit-btn").addEventListener("click", toggleEdit);
    panel.querySelectorAll(".fbs-tone-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!lastSummarizeParams) return;
        const tone = btn.dataset.tone;
        panel.querySelectorAll(".fbs-tone-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const { text, type, _element } = lastSummarizeParams;
        summarizeText(text, type, _element, tone);
      });
    });
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
      panelBody.innerHTML =
        '<div class="fbs-result">' + fmt(editedText) + "</div>";
      editBtn.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg> Sửa';
    } else {
      // Switch to edit mode
      const currentText =
        panelBody.dataset.editedText || panelBody.innerText || "";
      panelBody.innerHTML =
        '<textarea class="fbs-edit-textarea">' +
        esc(currentText) +
        "</textarea>";
      const textarea = panelBody.querySelector(".fbs-edit-textarea");
      textarea.focus();
      textarea.setSelectionRange(0, 0);
      editBtn.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Xong';
    }
  }

  function regenerate() {
    if (!lastSummarizeParams) return;
    const { text, type, _element, tone } = lastSummarizeParams;
    const prefix = hashText(text) + "_" + type;
    for (const k of summaryCache.keys()) {
      if (k.startsWith(prefix)) summaryCache.delete(k);
    }
    summarizeText(text, type, _element, tone);
  }

  function openOverlay(html, streaming, type = "summary") {
    ensureOverlay();
    const titleText = panel.querySelector(".fbs-title-text");
    if (titleText) {
      if (type === "affiliate") titleText.textContent = "Chế bài Affiliate";
      else if (type === "status_share") titleText.textContent = "Viết Status";
      else titleText.textContent = "Tóm tắt nội dung";
    }

    // Streaming: chỉ update nội dung result, không rebuild toàn bộ DOM
    if (streaming) {
      const existingResult = panelBody.querySelector(".fbs-result");
      if (existingResult) {
        // Extract nội dung mới từ html
        const temp = document.createElement("div");
        temp.innerHTML = html;
        const newResult = temp.querySelector(".fbs-result");
        if (newResult) {
          existingResult.innerHTML = newResult.innerHTML;
        }
      } else {
        panelBody.innerHTML = html;
      }

      // Streaming progress indicator — hiển thị số ký tự đã nhận
      const resultEl = panelBody.querySelector(".fbs-result");
      if (resultEl) {
        const chars = (resultEl.textContent || "").length;
        let progressEl = panel.querySelector(".fbs-stream-progress");
        if (!progressEl) {
          progressEl = document.createElement("span");
          progressEl.className = "fbs-stream-progress";
          const headSpan = panel.querySelector(".fbs-panel-head span");
          if (headSpan) headSpan.appendChild(progressEl);
        }
        progressEl.textContent = chars > 0 ? `(${chars} ký tự)` : "";
      }
    } else {
      panelBody.innerHTML = html;
      // Remove progress indicator when streaming ends
      const progressEl = panel.querySelector(".fbs-stream-progress");
      if (progressEl) progressEl.remove();
    }

    // Clear edited text cache when new content loads
    delete panelBody.dataset.editedText;
    backdrop.classList.add("fbs-visible");
    panel.classList.add("fbs-visible");
    const footer = panel.querySelector(".fbs-panel-footer");
    const hasContent =
      html.includes("fbs-result") || html.includes("fbs-loading") || streaming;
    footer.style.display = hasContent ? "flex" : "none";
    panel.querySelector(".fbs-stop-btn").style.display =
      isSummarizing || streaming ? "inline-flex" : "none";
    panel.querySelector(".fbs-copy-btn").style.display =
      !isSummarizing && !streaming ? "inline-flex" : "none";
    panel.querySelector(".fbs-post-status-btn").style.display =
      !isSummarizing &&
      !streaming &&
      html.includes("fbs-result") &&
      SITE === "facebook" &&
      type !== "affiliate"
        ? "inline-flex"
        : "none";
    panel.querySelector(".fbs-regen-btn").style.display =
      !isSummarizing && !streaming ? "inline-flex" : "none";
    panel.querySelector(".fbs-edit-btn").style.display =
      !isSummarizing && !streaming && html.includes("fbs-result")
        ? "inline-flex"
        : "none";
    panel.querySelector(".fbs-model-select").style.display =
      !isSummarizing && !streaming ? "inline-block" : "none";
    const toneRow = panel.querySelector(".fbs-tone-row");
    const showTone = !isSummarizing && !streaming && html.includes("fbs-result") && type === "summary";
    toneRow.classList.toggle("fbs-tone-visible", showTone);
    if (!showTone) panel.querySelectorAll(".fbs-tone-btn").forEach((b) => b.classList.remove("active"));
    if (streaming && panelBody.scrollHeight - panelBody.scrollTop < 500)
      panelBody.scrollTop = panelBody.scrollHeight;
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
    if (currentPort) {
      try {
        currentPort.disconnect();
      } catch (_) {}
      currentPort = null;
    }
    if (panelBody) {
      openOverlay(
        panelBody.innerHTML + '<div class="fbs-error">Đã dừng.</div>',
        false,
      );
    }
  }

  function copyResult() {
    // If in edit mode, get text from textarea; otherwise use edited cache or display text
    const textarea = panelBody?.querySelector(".fbs-edit-textarea");
    const text = textarea
      ? textarea.value
      : panelBody?.dataset?.editedText || panelBody?.innerText || "";
    navigator.clipboard.writeText(text).then(() => {
      const btn = panel.querySelector(".fbs-copy-btn");
      const orig = btn.innerHTML;
      btn.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied';
      setTimeout(() => {
        btn.innerHTML = orig;
      }, 1500);
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
      // Lấy TẤT CẢ ảnh để user có thể chọn paste multi-image
      const allImages = _element && typeof window.fbsExtractImages === "function"
        ? window.fbsExtractImages(_element)
        : (imageUrl ? [imageUrl] : []);

      // Không append nguồn vào text — nguồn sẽ ghi ở comment đầu tiên

      // Normalize link (strip tracking params, clean Facebook URL)
      let cleanUrl = rawUrl;
      if (rawUrl && rawUrl !== location.href) {
        try {
          const u = new URL(rawUrl);
          if (u.hostname.includes("facebook.com")) {
            const mp = u.searchParams.get("multi_permalinks");
            if (mp && u.pathname.includes("/groups/")) {
              cleanUrl =
                u.origin + u.pathname.replace(/\/$/, "") + "/posts/" + mp + "/";
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
              if (
                k.startsWith("utm_") ||
                k.startsWith("__") ||
                ["fbclid", "gclid", "ref"].includes(k)
              )
                u.searchParams.delete(k);
            }
            cleanUrl = u.toString().replace(/\?$/, "");
          }
        } catch (_) {}
      }

      // Dịch panel sang phải, ẩn backdrop
      panel.classList.add("fbs-panel-left");
      if (backdrop) backdrop.classList.remove("fbs-visible");
      openFacebookComposer(text, cleanUrl, imageUrl, author, source, allImages);
    } catch (_) {
      // Fallback
      const resultEl = panelBody?.querySelector(".fbs-result");
      const text = resultEl ? resultEl.innerText : panelBody?.innerText || "";
      panel.classList.add("fbs-panel-left");
      if (backdrop) backdrop.classList.remove("fbs-visible");
      openFacebookComposer(text.trim(), "", "", "", "", []);
    }
  }

  function openFacebookComposer(text, sourceUrl, imageUrl, author, source, allImages) {
    const preview = document.createElement("div");
    preview.className = "fbs-status-preview";

    // Normalize allImages: ensure it's an array with primary imageUrl first
    const imageList = Array.isArray(allImages) && allImages.length > 0
      ? allImages.slice(0, 10)
      : (imageUrl ? [imageUrl] : []);
    // Ensure primary imageUrl luôn ở đầu để backward compat với old code
    if (imageUrl && !imageList.includes(imageUrl)) imageList.unshift(imageUrl);

    // Validate author/source — bỏ nếu chứa ký tự rác (FB anti-scraping)
    const isValidName = (n) =>
      n &&
      n.length >= 2 &&
      n.length < 80 &&
      !/[a-f0-9]{10,}/i.test(n) &&
      !/\d{8,}/.test(n) &&
      n.split(/\s+/).length <= 10;
    const cleanAuthor = isValidName(author) ? author : "";
    const cleanSource = isValidName(source) ? source : "";

    // Ảnh preview: nếu có nhiều ảnh → gallery lưới; nếu 1 ảnh → single preview
    let imgHtml = "";
    if (imageList.length > 1) {
      // Multi-image gallery — tất cả ảnh checked by default, user có thể uncheck
      const thumbsHtml = imageList.map((url, i) =>
        '<label class="fbs-sp-thumb"><input type="checkbox" class="fbs-sp-thumb-cb" data-url="' +
        esc(url) + '" checked><img src="' + esc(url) + '" loading="lazy" onerror="this.parentElement.style.display=\'none\'"></label>'
      ).join("");
      imgHtml =
        '<div class="fbs-sp-image fbs-sp-multi">' +
        '<div class="fbs-sp-multi-header">' + imageList.length + ' ảnh — bỏ tick ảnh không muốn đăng</div>' +
        '<div class="fbs-sp-thumbs">' + thumbsHtml + '</div>' +
        '</div>';
    } else if (imageList.length === 1) {
      imgHtml = '<div class="fbs-sp-image"><img src="' +
        esc(imageList[0]) +
        '" crossorigin="anonymous" onerror="this.parentElement.style.display=\'none\'"><button class="fbs-sp-copy-img"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> Copy ảnh</button></div>';
    }

    preview.innerHTML =
      '<div class="fbs-sp-header"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Preview Status <span class="fbs-sp-charcount">' +
      text.length +
      " ký tự</span></div>" +
      imgHtml +
      '<div class="fbs-sp-text">' +
      esc(text).replace(/\n/g, "<br>") +
      "</div>" +
      '<div class="fbs-sp-link-input">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;opacity:0.5"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>' +
      '<input type="text" class="fbs-sp-link-field" placeholder="Paste link bài gốc (ghi nguồn ở comment đầu)" value="' +
      esc(sourceUrl || "") +
      '">' +
      "</div>" +
      (cleanAuthor
        ? '<div class="fbs-sp-detected-source"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> ' +
          esc(cleanAuthor) +
          (cleanSource && cleanSource !== cleanAuthor
            ? ' <span class="fbs-sp-source-group">(' +
              esc(cleanSource) +
              ")</span>"
            : "") +
          "</div>"
        : "") +
      '<div class="fbs-sp-comment" style="display:none">' +
      '<div class="fbs-sp-comment-label">Comment đầu tiên (ghi nguồn):</div>' +
      '<div class="fbs-sp-comment-text"></div>' +
      '<button class="fbs-sp-copy-comment"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy nguồn</button>' +
      "</div>" +
      '<div class="fbs-sp-actions">' +
      '<button class="fbs-sp-open-fb"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg> Đăng status</button>' +
      "</div>";

    panelBody.appendChild(preview);
    panelBody.scrollTop = panelBody.scrollHeight;

    const footer = panel.querySelector(".fbs-panel-footer");
    if (footer) footer.style.display = "none";

    const linkField = preview.querySelector(".fbs-sp-link-field");
    const commentSection = preview.querySelector(".fbs-sp-comment");
    const commentText = preview.querySelector(".fbs-sp-comment-text");

    // Generate comment content từ link — ghi nguồn kèm tên tác giả nếu có
    // LUÔN hiển thị section comment (kể cả khi chưa có URL) để user biết
    // cần paste link. Nếu thiếu link mà có author/source → vẫn show "Nguồn: X"
    function updateComment(url) {
      // Luôn hiện section comment — giúp user thấy rõ cần ghi nguồn
      commentSection.style.display = "block";
      // Build source line: "Nguồn: Tên tác giả — link" hoặc "Nguồn: link"
      let sourceLine = "Nguồn: ";
      if (cleanAuthor) {
        sourceLine += cleanAuthor;
        if (cleanSource && cleanSource !== cleanAuthor)
          sourceLine += " (" + cleanSource + ")";
        if (url) sourceLine += "\n" + url;
      } else if (cleanSource) {
        sourceLine += cleanSource;
        if (url) sourceLine += "\n" + url;
      } else if (url) {
        sourceLine += url;
      } else {
        // Không có gì cả → hint user paste link
        sourceLine = "Nguồn: (chưa có — paste link vào ô phía trên)";
      }
      commentText.textContent = sourceLine;
    }

    // LUÔN render section comment ngay khi mở composer — kể cả khi chưa có link
    updateComment(sourceUrl || "");

    // Normalize Facebook URL
    function normalizeFbUrl(raw) {
      try {
        const u = new URL(raw);
        if (u.hostname.includes("facebook.com")) {
          const mp = u.searchParams.get("multi_permalinks");
          if (mp && u.pathname.includes("/groups/")) {
            return (
              u.origin + u.pathname.replace(/\/$/, "") + "/posts/" + mp + "/"
            );
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
          if (
            k.startsWith("utm_") ||
            k.startsWith("__") ||
            ["fbclid", "gclid", "ref"].includes(k)
          )
            u.searchParams.delete(k);
        }
        return u.toString().replace(/\?$/, "");
      } catch (_) {
        return raw;
      }
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

    function autoPasteToLexical(element, text, file = null) {
      element.focus();
      const dataTransfer = new DataTransfer();
      dataTransfer.setData("text/plain", text);
      if (file) dataTransfer.items.add(file);
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: dataTransfer,
          bubbles: true,
          cancelable: true,
        }),
      );
    }

    // Copy comment (ghi nguồn)
    preview
      .querySelector(".fbs-sp-copy-comment")
      .addEventListener("click", async () => {
        const btn = preview.querySelector(".fbs-sp-copy-comment");
        const content = commentText.textContent;
        if (!content) return;
        await navigator.clipboard.writeText(content);

        btn.innerHTML =
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> ...';

        let posted = false;
        if (SITE === "facebook") {
          const commentBoxes = Array.from(
            document.querySelectorAll(
              'div[role="textbox"][contenteditable="true"]',
            ),
          ).filter((el) => {
            const label = (el.getAttribute("aria-label") || "").toLowerCase();
            return (
              label.includes("viết bình luận") ||
              label.includes("comment") ||
              label.includes("trả lời")
            );
          });

          let targetBox = commentBoxes[0];
          if (lastSummarizeParams && lastSummarizeParams._element) {
            const postEl =
              lastSummarizeParams._element.closest('[role="article"]');
            if (postEl) {
              const boxInPost = postEl.querySelector(
                'div[role="textbox"][contenteditable="true"]',
              );
              if (boxInPost) targetBox = boxInPost;
            }
          }

          if (targetBox) {
            autoPasteToLexical(targetBox, content);
            setTimeout(() => {
              targetBox.dispatchEvent(
                new KeyboardEvent("keydown", {
                  key: "Enter",
                  code: "Enter",
                  keyCode: 13,
                  which: 13,
                  bubbles: true,
                }),
              );
            }, 500);
            posted = true;
          }
        }

        if (posted) {
          btn.innerHTML =
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Đã tự cmt!';
        } else {
          btn.innerHTML =
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Đã copy!';
        }
        setTimeout(() => {
          btn.innerHTML =
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy nguồn';
        }, 2500);
      });

    // Copy ảnh
    const copyImgBtn = preview.querySelector(".fbs-sp-copy-img");
    if (copyImgBtn) {
      copyImgBtn.addEventListener("click", async () => {
        try {
          copyImgBtn.innerHTML =
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> ...';
          const imgEl = preview.querySelector(".fbs-sp-image img");
          const canvas = document.createElement("canvas");
          canvas.width = imgEl.naturalWidth;
          canvas.height = imgEl.naturalHeight;
          canvas.getContext("2d").drawImage(imgEl, 0, 0);
          const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
          await navigator.clipboard.write([
            new ClipboardItem({ "image/png": blob }),
          ]);
          copyImgBtn.innerHTML =
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Đã copy!';
          setTimeout(() => {
            copyImgBtn.innerHTML =
              '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> Copy ảnh';
          }, 2500);
        } catch (_) {
          window.open(imageUrl, "_blank");
          copyImgBtn.innerHTML =
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg> Mở tab mới';
          setTimeout(() => {
            copyImgBtn.innerHTML =
              '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> Copy ảnh';
          }, 2000);
        }
      });
    }

    // Đăng status — chỉ tự động hóa: mở composer + paste text + paste ảnh.
    // User tự click "Đăng" và tự comment nguồn (đã copy sẵn vào clipboard).
    preview
      .querySelector(".fbs-sp-open-fb")
      .addEventListener("click", async () => {
        const btn = preview.querySelector(".fbs-sp-open-fb");
        if (SITE !== "facebook") {
          await navigator.clipboard.writeText(text);
          btn.innerHTML =
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied (FB only supported)';
          return;
        }

        btn.disabled = true;
        btn.innerHTML =
          '<div class="fbs-spinner" style="width:14px;height:14px;border-width:2px"></div> Mở Composer...';

        const setStatus = (msg) => {
          btn.innerHTML = '<div class="fbs-spinner" style="width:14px;height:14px;border-width:2px"></div> ' + msg;
        };
        const setDone = (msg) => {
          btn.disabled = false;
          btn.innerHTML =
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> ' + msg;
        };
        const setFail = (msg) => {
          btn.disabled = false;
          btn.innerHTML =
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> ' + msg;
        };

        try {
          // Prep comment text để copy vào clipboard (user tự paste khi cmt)
          let sourceLine = "Nguồn: ";
          if (cleanAuthor) {
            sourceLine += cleanAuthor;
            if (cleanSource && cleanSource !== cleanAuthor) sourceLine += " (" + cleanSource + ")";
            if (sourceUrl) sourceLine += "\n" + sourceUrl;
          } else if (cleanSource) {
            sourceLine += cleanSource;
            if (sourceUrl) sourceLine += "\n" + sourceUrl;
          } else if (sourceUrl) {
            sourceLine += sourceUrl;
          } else {
            sourceLine = "";
          }

          // Bước 1: Xác định ảnh user muốn đăng
          let selectedUrls = [];
          const thumbCheckboxes = preview.querySelectorAll(".fbs-sp-thumb-cb");
          if (thumbCheckboxes.length > 0) {
            selectedUrls = Array.from(thumbCheckboxes)
              .filter(cb => cb.checked)
              .map(cb => cb.dataset.url)
              .filter(Boolean);
          } else if (imageList.length > 0) {
            selectedUrls = imageList;
          }

          // Bước 2: Tìm và click nút "Bạn đang nghĩ gì?"
          const allButtons = document.querySelectorAll('div[role="main"] div[role="button"]');
          let composerBtn = null;
          for (const b of allButtons) {
            const t = (b.textContent || "").toLowerCase();
            if (t.includes("bạn đang nghĩ gì") ||
                t.includes("what's on your mind") ||
                t.includes("write something") ||
                t.includes("viết gì đó")) {
              composerBtn = b;
              break;
            }
          }
          if (!composerBtn) {
            window.scrollTo({ top: 0, behavior: "smooth" });
            setFail("Không thấy ô 'Bạn đang nghĩ gì?' — cuộn lên đầu feed rồi thử lại");
            return;
          }
          composerBtn.click();

          // Bước 3: Chờ editor xuất hiện
          setStatus("Chờ dialog mở...");
          let editor = null;
          for (let i = 0; i < 25 && !editor; i++) {
            editor = document.querySelector(
              'div[role="dialog"] div[role="textbox"][contenteditable="true"]'
            );
            if (!editor) await new Promise(r => setTimeout(r, 200));
          }
          if (!editor) {
            setFail("Không tìm thấy editor");
            return;
          }
          editor.click();
          editor.focus();
          await new Promise(r => setTimeout(r, 600));

          // Bước 4: Fetch ảnh parallel
          let imgFiles = [];
          if (selectedUrls.length > 0) {
            setStatus("Tải " + selectedUrls.length + " ảnh...");
            imgFiles = await fetchImageBlobs(selectedUrls, 10);
            console.log("[Manual Post] Fetched", imgFiles.length, "/", selectedUrls.length, "images");
          }

          // Bước 5: Paste text + ảnh
          setStatus("Dán nội dung...");
          const cleanedText = text.replace(
            /\s*(?:[—-]\s*\n\s*)?Nguồn\s+dưới\s+cmt\s+đầu\s*$/gi,
            ""
          ).trim();
          const textWithFooter = cleanedText + "\n\n—\nNguồn dưới cmt đầu";
          pasteToLexical(editor, textWithFooter, imgFiles.length > 0 ? imgFiles : null);

          // Chờ upload hoàn tất (để user thấy ảnh đã render trước khi bấm Đăng)
          const uploadWait = imgFiles.length > 1 ? 1500 + imgFiles.length * 1000 :
                            imgFiles.length === 1 ? 2000 : 800;
          await new Promise(r => setTimeout(r, uploadWait));

          // Bước 6: Copy câu "Nguồn:" vào clipboard để user paste khi comment
          // User TỰ bấm "Đăng" và TỰ comment.
          if (sourceLine) {
            try {
              await navigator.clipboard.writeText(sourceLine);
              setDone("Sẵn sàng — bấm Đăng, rồi Ctrl+V ở cmt");
            } catch (_) {
              setDone("Sẵn sàng — bấm Đăng (Copy nguồn thủ công)");
            }
          } else {
            setDone("Sẵn sàng — bấm Đăng");
          }
        } catch (err) {
          console.error("[Manual Post] Error:", err);
          setFail("Lỗi: " + (err.message || err));
        }
      });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeOverlay();
  });

  // ============================================================
  // AGENT POST API — Bypasses UI, called directly by auto-pilot
  // ============================================================
  function cleanSourceUrl(rawUrl) {
    if (!rawUrl) return "";
    try {
      const u = new URL(rawUrl);
      if (u.hostname.includes("facebook.com")) {
        const mp = u.searchParams.get("multi_permalinks");
        if (mp && u.pathname.includes("/groups/"))
          return (
            u.origin + u.pathname.replace(/\/$/, "") + "/posts/" + mp + "/"
          );
        const sfid = u.searchParams.get("story_fbid");
        const uid = u.searchParams.get("id");
        if (sfid && uid) return u.origin + "/" + uid + "/posts/" + sfid + "/";
        return u.origin + u.pathname;
      }
      for (const k of [...u.searchParams.keys()]) {
        if (
          k.startsWith("utm_") ||
          k.startsWith("__") ||
          ["fbclid", "gclid", "ref", "comment_id", "reply_comment_id"].includes(
            k,
          )
        )
          u.searchParams.delete(k);
      }
      return u.toString().replace(/\?$/, "");
    } catch (_) {
      return rawUrl;
    }
  }

  async function fetchImageBlob(imgSrc, filename = "image.png") {
    if (!imgSrc) return null;

    // Attempt 1: Via Canvas (fastest but fails on cross-origin taint)
    // Tìm img element theo src OR currentSrc OR srcset (srcset có thể là URL chúng ta lấy)
    let imgEl = null;
    try {
      imgEl = document.querySelector(`img[src="${CSS.escape(imgSrc)}"]`);
      if (!imgEl) {
        // Fallback: scan tất cả img để tìm element có currentSrc match hoặc srcset chứa url
        const allImgs = document.querySelectorAll("img");
        for (const img of allImgs) {
          if (img.currentSrc === imgSrc || img.src === imgSrc) {
            imgEl = img; break;
          }
          const srcset = img.srcset || "";
          if (srcset && srcset.includes(imgSrc)) {
            imgEl = img; break;
          }
        }
      }
    } catch (_) {}

    if (imgEl && imgEl.naturalWidth > 0) {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = imgEl.naturalWidth;
        canvas.height = imgEl.naturalHeight;
        canvas.getContext("2d").drawImage(imgEl, 0, 0);
        const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
        if (blob) return new File([blob], filename, { type: "image/png" });
      } catch (_) {
        // Cross-origin taint — fall through to network fetch
      }
    }

    // Attempt 2: Via Background.js fetch (bypasses CORS)
    try {
      const resp = await new Promise((resolve) =>
        chrome.runtime.sendMessage(
          { action: "fetch-image", url: imgSrc },
          resolve,
        ),
      );
      if (resp && resp.base64) {
        const fetchResp = await fetch(resp.base64);
        const blob = await fetchResp.blob();
        if (blob) {
          const ext = blob.type.includes("jpeg") ? "jpg" :
                     blob.type.includes("webp") ? "webp" :
                     blob.type.includes("png") ? "png" : "jpg";
          return new File([blob], filename.replace(/\.\w+$/, "." + ext), { type: blob.type || "image/jpeg" });
        }
      }
    } catch (_) {}

    return null;
  }

  // Parallel fetch nhiều ảnh cùng lúc, returns array of File (null entries filtered out)
  // Max parallel: 5, timeout per image handled by background.js (30s)
  async function fetchImageBlobs(imgSrcs, maxCount = 10) {
    if (!imgSrcs || imgSrcs.length === 0) return [];
    // Facebook limit 10 ảnh/post; giới hạn maxCount
    const targets = imgSrcs.slice(0, maxCount);
    const results = await Promise.all(
      targets.map((src, i) => fetchImageBlob(src, `image_${i + 1}.png`))
    );
    return results.filter(f => f !== null);
  }

  function pasteToLexical(element, text, file = null) {
    element.focus();
    // Paste text trước (không kèm file — Facebook sẽ bỏ text nếu có file)
    if (text) {
      const dtText = new DataTransfer();
      dtText.setData("text/plain", text);
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: dtText,
          bubbles: true,
          cancelable: true,
        }),
      );
    }
    // Paste file riêng sau (nếu có). Hỗ trợ cả single file và array of files.
    if (file) {
      const files = Array.isArray(file) ? file : [file];
      if (files.length === 0) return;
      setTimeout(() => {
        element.focus();
        const dtFile = new DataTransfer();
        for (const f of files) {
          if (f) dtFile.items.add(f);
        }
        if (dtFile.files.length === 0) return;
        element.dispatchEvent(
          new ClipboardEvent("paste", {
            clipboardData: dtFile,
            bubbles: true,
            cancelable: true,
          }),
        );
      }, 500);
    }
  }

  function buildCommentText(cleanUrl, author, source) {
    let line = "Nguồn: ";
    const isValidName = (n) =>
      n &&
      n.length >= 2 &&
      n.length < 80 &&
      !/[a-f0-9]{10,}/i.test(n) &&
      !/\d{8,}/.test(n);
    const a = isValidName(author) ? author : "";
    const s = isValidName(source) ? source : "";
    if (a) {
      line += a;
      if (s && s !== a) line += " (" + s + ")";
      line += "\n" + cleanUrl;
    } else if (s) {
      line += s + "\n" + cleanUrl;
    } else {
      line += cleanUrl;
    }
    return line;
  }

  window.fbsAgentPost = async function (summaryText, imageUrl, rawSourceUrl, postElement) {
    if (SITE !== "facebook") return { ok: false, reason: "not_facebook" };

    const cleanUrl = cleanSourceUrl(rawSourceUrl);
    // Lấy author + source (group/page name) từ DOM
    const postAuthor =
      postElement && typeof window.fbsExtractAuthor === "function"
        ? window.fbsExtractAuthor(postElement)
        : "";
    const postSource =
      postElement && typeof extractPostSource === "function"
        ? extractPostSource(postElement)
        : "";

    // LUÔN tạo commentText — bắt buộc comment nguồn
    let commentText = "";
    // URL hữu ích: phải có permalink pattern (không chỉ là homepage FB hoặc URL ngắn)
    // Giảm threshold từ 30 → 25 để bắt được group URL có slug ngắn
    const hasPostPattern = cleanUrl && (
      cleanUrl.includes("/posts/") ||
      cleanUrl.includes("/permalink") ||
      cleanUrl.includes("story_fbid") ||
      cleanUrl.includes("pfbid") ||
      cleanUrl.includes("multi_permalinks") ||
      cleanUrl.includes("/videos/") ||
      cleanUrl.includes("/photos/")
    );
    const isUsefulUrl = cleanUrl &&
      cleanUrl !== "https://www.facebook.com" &&
      cleanUrl !== "https://www.facebook.com/" &&
      (hasPostPattern || cleanUrl.length > 30);

    if (isUsefulUrl) {
      // Có link chính xác → dùng link + tên tác giả
      commentText = buildCommentText(cleanUrl, postAuthor, postSource);
    } else {
      // Không có link chính xác → build comment từ thông tin có sẵn
      // Sử dụng buildCommentText để format nhất quán
      let fallbackUrl = "";
      if (cleanUrl && cleanUrl.length > 20) {
        fallbackUrl = cleanUrl;
      } else {
        // Dùng URL trang hiện tại nếu có ý nghĩa (group/page/profile)
        const pageUrl = location.href;
        if (pageUrl.includes("/groups/") || pageUrl.includes("/pages/") || pageUrl.match(/facebook\.com\/[^\/?]+\/?$/)) {
          fallbackUrl = pageUrl.split("?")[0];
        }
      }

      if (fallbackUrl) {
        commentText = buildCommentText(fallbackUrl, postAuthor, postSource);
      } else {
        // Không có URL nào → vẫn build comment với author/source (không link)
        const isValidName = (n) => n && n.length >= 2 && n.length < 80 && !/[a-f0-9]{10,}/i.test(n) && !/\d{8,}/.test(n);
        const a = isValidName(postAuthor) ? postAuthor : "";
        const s = isValidName(postSource) ? postSource : "";
        if (a) {
          commentText = "Nguồn: " + a + (s && s !== a ? " (" + s + ")" : "");
        } else if (s) {
          commentText = "Nguồn: " + s;
        } else {
          commentText = "Nguồn: Facebook";
        }
      }
    }
    console.log("[Agent] Comment text prepared:", commentText);
    console.log("[Agent] Author:", postAuthor || "(unknown)", "| Source:", postSource || "(unknown)", "| URL:", cleanUrl || "(none)");

    // Build final post text
    // AI thường đã include "—\nNguồn dưới cmt đầu" theo prompt yêu cầu.
    // Strip mọi instance có sẵn (nhiều format) rồi append đúng 1 lần.
    let postText = summaryText.trim();
    // Regex: match "—\nNguồn dưới cmt đầu" hoặc "-\nNguồn dưới cmt đầu" hoặc
    // chỉ "Nguồn dưới cmt đầu" ở cuối (có thể có/không dấu gạch), case-insensitive
    postText = postText.replace(
      /\s*(?:[—-]\s*\n\s*)?Nguồn\s+dưới\s+cmt\s+đầu\s*$/gi,
      ""
    ).trim();
    // Append đúng 1 lần footer chuẩn
    postText += "\n\n—\nNguồn dưới cmt đầu";

    console.log("[Agent] fbsAgentPost called:", {
      textLength: postText.length,
      textPreview: postText.substring(0, 80),
      hasImage: !!imageUrl,
      sourceUrl: cleanUrl || "(none)",
      hasComment: !!commentText,
    });

    // Step 1: Mở FB Composer (click "Bạn đang nghĩ gì?")
    const mainArea = document.querySelector('div[role="main"]');
    if (!mainArea) return { ok: false, reason: "no_main_area" };

    const allButtons = mainArea.querySelectorAll('div[role="button"]');
    let composerBtn = null;
    for (const b of allButtons) {
      const t = (b.textContent || "").toLowerCase();
      if (
        t.includes("bạn đang nghĩ gì") ||
        t.includes("what's on your mind") ||
        t.includes("write something") ||
        t.includes("viết gì đó") ||
        t.includes("chia sẻ điều gì") ||
        t.includes("say something")
      ) {
        composerBtn = b;
        break;
      }
    }
    if (!composerBtn) return { ok: false, reason: "no_composer_btn" };
    composerBtn.click();

    // Step 2: Chờ dialog mở, tìm editor (poll trong 5s)
    let editor = null;
    for (let i = 0; i < 25; i++) {
      editor = document.querySelector(
        'div[role="dialog"] div[role="textbox"][contenteditable="true"]',
      );
      if (editor) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!editor) {
      console.error("[Agent] Không tìm thấy Editor TextBox.");
      return { ok: false, reason: "no_editor" };
    }

    // Kích hoạt Lexical bằng cách click & focus trước khi paste
    editor.click();
    editor.focus();
    await new Promise((r) => setTimeout(r, 1000));

    // Step 3: Fetch image blobs — agent cố lấy TẤT CẢ ảnh từ bài gốc
    // để post giống bài gốc nhất có thể. Fetch song song để tiết kiệm thời gian.
    let imgFiles = [];
    try {
      // Lấy danh sách tất cả ảnh từ postElement (bao gồm bài share gốc)
      let allImages = [];
      if (postElement && typeof window.fbsExtractImages === "function") {
        allImages = window.fbsExtractImages(postElement);
      } else if (imageUrl) {
        allImages = [imageUrl];
      }
      // Ensure imageUrl (primary) là ảnh đầu tiên nếu có
      if (imageUrl && !allImages.includes(imageUrl)) {
        allImages.unshift(imageUrl);
      }
      if (allImages.length > 0) {
        console.log("[Agent] Fetching", allImages.length, "image(s) in parallel...");
        imgFiles = await fetchImageBlobs(allImages, 10);
        console.log("[Agent] Fetched", imgFiles.length, "image file(s) successfully");
      }
    } catch (imgErr) {
      console.warn("[Agent] Multi-image fetch failed, fallback to single:", imgErr.message);
      const singleFile = await fetchImageBlob(imageUrl);
      if (singleFile) imgFiles = [singleFile];
    }

    // Step 4: Paste text (+ images) — giả lập gõ chậm
    console.log("[Agent] Pasting text...", { length: postText.length, images: imgFiles.length });
    pasteToLexical(editor, postText, imgFiles.length > 0 ? imgFiles : null);
    // Chờ text render + image upload (multi-image cần nhiều thời gian hơn)
    const uploadWaitMs = imgFiles.length > 1 ? 3000 + imgFiles.length * 1500 :
                        imgFiles.length === 1 ? 5000 : 3000;
    await new Promise((r) => setTimeout(r, uploadWaitMs));

    // Step 5: Chờ nút Tiếp hoặc Đăng native không bị disabled (đợi upload ảnh)
    let fbPostBtn = null;
    let isNextBtn = false;
    for (let i = 0; i < 20; i++) {
      fbPostBtn = document.querySelector(
        'div[aria-label="Tiếp"][role="button"], div[aria-label="Next"][role="button"], div[aria-label="Đăng"][role="button"], div[aria-label="Post"][role="button"]',
      );
      if (fbPostBtn && fbPostBtn.getAttribute("aria-disabled") !== "true") {
        const label = fbPostBtn.getAttribute("aria-label");
        isNextBtn = label === "Tiếp" || label === "Next";
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!fbPostBtn) {
      console.error("[Agent] Không tìm thấy nút Đăng/Tiếp.");
      return { ok: false, reason: "no_post_btn" };
    }
    // Giả lập review trước khi đăng (2-4s)
    await new Promise((r) => setTimeout(r, 2000 + Math.random() * 2000));
    console.log("[Agent] Clicking post button...");
    fbPostBtn.click();

    // Nếu phải qua bước "Tiếp" (Next), chờ màn hình tiếp theo và bấm "Đăng"
    if (isNextBtn) {
      await new Promise((r) => setTimeout(r, 1000 + Math.random() * 500));
      let finalPostBtn = null;
      for (let i = 0; i < 15; i++) {
        finalPostBtn = document.querySelector(
          'div[aria-label="Đăng"][role="button"], div[aria-label="Post"][role="button"]',
        );
        if (
          finalPostBtn &&
          finalPostBtn.getAttribute("aria-disabled") !== "true"
        )
          break;
        await new Promise((r) => setTimeout(r, 500));
      }
      if (finalPostBtn) {
        finalPostBtn.click();
      } else {
        console.error(
          "[Agent] Mắc kẹt sau khi bấm Tiếp, không tìm thấy nút Đăng.",
        );
        return { ok: false, reason: "no_final_post_btn" };
      }
    }

    // Step 6: Chờ post xuất hiện trên Feed
    console.log("[Agent] === STEP 6: Bài đã đăng, chờ feed refresh ===");
    console.log("[Agent] commentText:", commentText.substring(0, 80));
    await new Promise((r) => setTimeout(r, 10000));

    // Step 7: Comment nguồn — bài vừa đăng nằm ngay đầu feed
    {
      try {
        console.log("[Agent] === STEP 7: Comment nguồn ===");

        // Tìm nút "Viết bình luận" trực tiếp bằng aria-label (chính xác nhất)
        let commentBtn = null;
        let commentBox = null;

        // Tăng thời gian poll lên 20s (40 * 500ms) — bài vừa đăng có thể cần
        // thời gian để render xong trong feed, đặc biệt khi có ảnh
        for (let poll = 0; poll < 40 && !commentBtn && !commentBox; poll++) {
          // Ưu tiên: tìm aria-label="Viết bình luận" hoặc "Write a comment"
          commentBtn = document.querySelector('[aria-label="Viết bình luận"][role="button"]') ||
                       document.querySelector('[aria-label="Write a comment"][role="button"]') ||
                       document.querySelector('[aria-label="Comment"][role="button"]') ||
                       // Variant: "Bình luận" only (không có "Viết")
                       document.querySelector('[aria-label="Bình luận"][role="button"]:not([aria-label*="Xem"])');
          // Hoặc comment box đã mở sẵn
          if (!commentBtn) {
            commentBox = document.querySelector('div[role="textbox"][contenteditable="true"][aria-label*="bình luận"]') ||
                         document.querySelector('div[role="textbox"][contenteditable="true"][aria-label*="comment"]') ||
                         document.querySelector('div[role="textbox"][contenteditable="true"][aria-label*="Bình luận"]');
          }
          if (!commentBtn && !commentBox) await new Promise((r) => setTimeout(r, 500));
        }

        if (commentBox) {
          console.log("[Agent] Comment box already open!");
        } else if (commentBtn) {
          console.log("[Agent] Found 'Viết bình luận' button, clicking...");
          commentBtn.scrollIntoView({ behavior: "smooth", block: "center" });
          await new Promise((r) => setTimeout(r, 1000));
          commentBtn.click();
          await new Promise((r) => setTimeout(r, 3000));

          // Poll tìm comment textbox sau khi click (có thể trong dialog) — 15s
          for (let poll = 0; poll < 30 && !commentBox; poll++) {
            // Chính xác nhất: data-lexical-editor textbox
            commentBox = document.querySelector('[data-lexical-editor="true"][role="textbox"][contenteditable="true"]');
            // Fallback: aria-label chứa "Bình luận dưới tên"
            if (!commentBox) {
              commentBox = document.querySelector('[aria-label*="Bình luận dưới tên"][contenteditable="true"]') ||
                           document.querySelector('[aria-label*="Comment as"][contenteditable="true"]');
            }
            // Fallback: bất kỳ textbox contenteditable trong dialog
            if (!commentBox) {
              commentBox = document.querySelector('div[role="dialog"] div[contenteditable="true"][role="textbox"]');
            }
            // Fallback cuối: textbox cuối cùng trong document (thường là comment box mới mở)
            if (!commentBox) {
              const allBoxes = document.querySelectorAll('div[contenteditable="true"][role="textbox"]');
              if (allBoxes.length > 0) commentBox = allBoxes[allBoxes.length - 1];
            }
            if (!commentBox) await new Promise((r) => setTimeout(r, 500));
          }
        } else {
          console.warn("[Agent] ✗ Không tìm thấy nút 'Viết bình luận' sau 20s");
          console.warn("[Agent] ✗ Comment NGUỒN KHÔNG ĐƯỢC ĐĂNG — copy thủ công:", commentText);
          // Copy comment text vào clipboard để user có thể paste thủ công
          try {
            await navigator.clipboard.writeText(commentText);
            console.log("[Agent] Đã copy commentText vào clipboard để user paste thủ công");
          } catch (_) {}
        }

        if (commentBox) {
          console.log("[Agent] ✓ Comment box found! Pasting...");
          commentBox.click();
          commentBox.focus();
          await new Promise((r) => setTimeout(r, 1000));
          pasteToLexical(commentBox, commentText);
          await new Promise((r) => setTimeout(r, 2500));

          // Verify paste thành công — nếu commentBox rỗng thì retry 1 lần
          const pastedText = (commentBox.innerText || commentBox.textContent || "").trim();
          if (pastedText.length < 5) {
            console.warn("[Agent] Paste lần 1 thất bại, retry...");
            commentBox.click();
            commentBox.focus();
            await new Promise((r) => setTimeout(r, 500));
            pasteToLexical(commentBox, commentText);
            await new Promise((r) => setTimeout(r, 2000));
          }

          // Verify lần cuối — chỉ gửi Enter nếu có text
          const finalText = (commentBox.innerText || commentBox.textContent || "").trim();
          if (finalText.length >= 5) {
            // Gửi bằng Enter
            commentBox.dispatchEvent(
              new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }),
            );
            await new Promise((r) => setTimeout(r, 2000));
            console.log("[Agent] ✓ Comment nguồn đã gửi!");
          } else {
            console.error("[Agent] ✗ Paste commentText failed sau 2 lần retry");
            console.error("[Agent] ✗ Comment NGUỒN KHÔNG ĐƯỢC ĐĂNG — copy thủ công:", commentText);
            try { await navigator.clipboard.writeText(commentText); } catch (_) {}
          }
        } else {
          console.warn("[Agent] ✗ Không tìm thấy ô comment");
        }
      } catch (commentErr) {
        console.error("[Agent] Lỗi khi comment:", commentErr.message);
      }
    }

    // Step 8: Đóng modal "Bài viết" mà Facebook mở sau khi đăng/comment
    // Facebook tự mở post dialog sau khi đăng — agent cần đóng để tiếp tục scroll feed.
    {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        // Ưu tiên: nút Đóng trong dialog (aria-label tiếng Việt và tiếng Anh)
        const closeBtn =
          document.querySelector('div[role="dialog"] [aria-label="Đóng"][role="button"]') ||
          document.querySelector('div[role="dialog"] [aria-label="Close"][role="button"]') ||
          document.querySelector('[aria-label="Đóng"][role="button"]') ||
          document.querySelector('[aria-label="Close"][role="button"]');
        if (closeBtn) {
          console.log("[Agent] Step 8: Đóng modal FB post");
          closeBtn.click();
          await new Promise((r) => setTimeout(r, 800));
        } else {
          // Fallback: Escape key
          document.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }),
          );
          await new Promise((r) => setTimeout(r, 500));
        }
      } catch (_) {}
    }

    // Notify background → browser notification
    try {
      chrome.runtime.sendMessage({
        action: "agent-posted",
        preview: summaryText.substring(0, 100),
      });
    } catch (_) {}

    return { ok: true };
  };

  // Expose DOM extractors for auto-pilot
  window.fbsExtractImage = extractPostImage;
  // Plural: returns ALL images from the post (main + shared inner, deduped & sorted)
  // Must be called AFTER extractPostImage() for the same element since extractPostImage
  // populates the internal _lastExtractedImages cache.
  window.fbsExtractImages = function (element) {
    // Always re-run extraction to get fresh data for this element
    extractPostImage(element);
    return _lastExtractedImages.slice();
  };
  window.fbsExtractPermalink = extractPostPermalink;
  window.fbsExtractAuthor = extractPostAuthor;

  // Async version: lấy permalink (sử dụng nút Share để copy link chính xác tuyệt đối, fallback sang DOM)
  // Nếu post là BÀI SHARE → ưu tiên tìm link bài GỐC trong nested article trước
  window.fbsExtractPermalinkAsync = async function (element) {
    try {
      if (SITE === "facebook" && element) {
        const postContainer = _findPostContainer(element);

        // === ƯU TIÊN 1: Nếu là bài share → tìm link bài GỐC trong DOM trước ===
        // Tránh phải click nút Share (slow + xâm lấn) nếu đã có link gốc trong DOM
        const sharedInner = _findSharedPostArticle(postContainer);
        if (sharedInner) {
          const innerPermalink = _findPermalinkInContainer(sharedInner);
          if (innerPermalink) return innerPermalink;
        }

        const shareBtn = Array.from(postContainer.querySelectorAll('div[role="button"]')).find(b => {
          const label = (b.getAttribute("aria-label") || "").toLowerCase();
          return label.includes("chia sẻ") || label.includes("share") || label.includes("gửi cho bạn bè") || label.includes("send this to friends");
        });

        if (shareBtn) {
          const oldClip = await navigator.clipboard.readText().catch(() => "");
          shareBtn.click();
          await new Promise(r => setTimeout(r, 800));

          const dialog = document.querySelector('div[role="dialog"]');
          if (dialog) {
             let copyBtn = null;
             const spans = Array.from(dialog.querySelectorAll('span[dir="auto"], div[dir="auto"]'));
             for (const el of spans) {
                const t = (el.textContent || "").toLowerCase().trim();
                if (("sao chép liên kết copy link").includes(t) && t.length > 5) {
                   copyBtn = el.closest('[role="button"], [role="menuitem"], div[tabindex="0"], div.x1i10hfl');
                   if (copyBtn) break;
                }
             }

             if (copyBtn) {
               copyBtn.click();
               await new Promise(r => setTimeout(r, 1200));
               
               const newClip = await navigator.clipboard.readText().catch(() => "");
               if (newClip && newClip.includes("facebook.com") && newClip !== oldClip) {
                 try {
                   const closeBtn = document.querySelector('div[role="dialog"] [aria-label="Đóng"][role="button"], div[role="dialog"] [aria-label="Close"][role="button"]');
                   if (closeBtn) closeBtn.click();
                 } catch (_) {}

                 // Clean URL — loại bỏ tracking params nhưng giữ fbid
                 return _cleanFbUrl(newClip);
               }
             }
             
             try {
               const closeBtn = document.querySelector('div[role="dialog"] [aria-label="Đóng"][role="button"], div[role="dialog"] [aria-label="Close"][role="button"]');
               if (closeBtn) closeBtn.click();
               else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true }));
             } catch (_) {}
          }
        }
      }
    } catch (_) {}

    return extractPostPermalink(element) || "";
  };

  // === HELPERS ===
  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }
  function fmt(t) {
    // Normalize *** (old prompt artifact) to ** before escaping
    const cleaned = t.replace(/^\*{3}\s*/gm, "**");
    return esc(cleaned)
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/^[-•·]\s*/gm, "· ") // normalize all bullet styles to ·
      .replace(/\n{2,}/g, "<br><br>") // blank line = paragraph break
      .replace(/\n/g, "<br>");
  }

  // === READ TIME ===
  function calcReadTime(el) {
    if (!el) return null;
    const words = (el.innerText || "").trim().split(/\s+/).filter(Boolean).length;
    if (words < 80) return null;
    return { words, mins: Math.max(1, Math.round(words / 200)) };
  }

  // === BUTTONS ===
  function createBtn(stats) {
    const d = document.createElement("div");
    d.className = "fbs-btn";
    d.setAttribute("role", "button");
    d.setAttribute("tabindex", "0");
    const statsHtml = stats
      ? '<span class="fbs-btn-stats"> · ~' + stats.mins + " phút · " + stats.words.toLocaleString("vi-VN") + " từ</span>"
      : "";
    d.innerHTML =
      '<img src="' +
      ICON_BASE64 +
      '" width="12" height="12" style="vertical-align:-2px"><span title="Tóm tắt nội dung"> Tóm tắt' +
      statsHtml +
      "</span>";
    return d;
  }

  function createInlineBtn(stats) {
    const d = document.createElement("span");
    d.className = "fbs-btn-inline";
    d.setAttribute("role", "button");
    d.setAttribute("tabindex", "0");
    d.style.cssText =
      "cursor:pointer;font-size:inherit;font-family:inherit;background:none;border:none;padding:0;margin:0;display:inline;line-height:inherit;vertical-align:baseline;";
    const statsHtml = stats
      ? '<span class="fbs-btn-inline-stats"> · ~' + stats.mins + " phút</span>"
      : "";
    d.innerHTML =
      ' · <span title="Tóm tắt nội dung" style="cursor:pointer;display:inline-flex;align-items:center;gap:3px;vertical-align:baseline;color:#4fc3f7;font-weight:600;font-size:0.92em;background:rgba(79,195,247,0.13);padding:0px 6px 1px;border-radius:8px;transition:background 0.15s"><img src="' +
      ICON_BASE64 +
      '" style="width:11px;height:11px;vertical-align:-1px;flex-shrink:0">Tóm tắt' +
      statsHtml +
      "</span>";
    const pill = d.querySelector("span");
    d.addEventListener("mouseenter", () => {
      pill.style.background = "rgba(79,195,247,0.28)";
    });
    d.addEventListener("mouseleave", () => {
      pill.style.background = "rgba(79,195,247,0.13)";
    });
    return d;
  }

  // === POST METADATA EXTRACTION ===

  // Shared helper: walk up to the nearest post-level container.
  // Stops at role="article" (old FB) OR data-virtualized (new FB virtualised scroll).
  // Never goes above role="feed", role="main", or document.body.
  function _findPostContainer(element) {
    if (!element) return null;
    let el = element;
    for (let i = 0; i < 30; i++) {
      const p = el.parentElement;
      if (!p || p === document.body) break;
      el = p;
      const role = el.getAttribute("role");
      if (role === "article") return el;
      if (el.hasAttribute("data-virtualized")) return el;
      if (role === "feed" || role === "main") break;
    }
    // Fallback: return the element itself (avoids whole-page queries)
    return element;
  }

  // Helper: tìm nested/shared post article bên trong post container.
  // Khi ai đó share bài của người khác, Facebook render nested article.
  // Returns the inner (original) post article, or null if this is not a share.
  function _findSharedPostArticle(postContainer) {
    if (!postContainer) return null;
    const nestedArticles = postContainer.querySelectorAll('[role="article"]');
    for (const nested of nestedArticles) {
      if (nested === postContainer) continue;
      // Phải là nested article trực tiếp (không phải comment hay reply sâu hơn)
      const parentArticle = nested.parentElement?.closest('[role="article"]');
      if (parentArticle && parentArticle !== postContainer) continue;
      // Bỏ qua comment (dùng _fbIsCommentArticle nếu có, nếu không có thì check form)
      if (nested.closest("form")) continue;
      let el = nested.parentElement;
      let isInList = false;
      for (let i = 0; i < 10 && el && el !== postContainer; i++) {
        const role = (el.getAttribute("role") || "").toLowerCase();
        if (role === "list" || role === "listitem" || el.tagName === "UL") { isInList = true; break; }
        el = el.parentElement;
      }
      if (isInList) continue;
      // Nested article phải có header riêng (h2/h3/h4 with a link) — mới coi là shared post
      const headers = nested.querySelectorAll("h2, h3, h4");
      for (const h of headers) {
        if (h.closest('[role="article"]') !== nested) continue;
        if (h.querySelector("a[href]")) return nested;
      }
    }
    return null;
  }

  // Helper: parse URL và clean tracking params — shared utility
  function _cleanFbUrl(rawUrl) {
    if (!rawUrl) return "";
    try {
      const u = new URL(rawUrl);
      const TRACKING_PARAMS = ["fbclid", "ref", "comment_id", "reply_comment_id",
        "notif_id", "notif_t", "mibextid", "_rdr", "_rdc", "rdid", "share_scenario",
        "hoisted_section_header_type"];
      for (const k of [...u.searchParams.keys()]) {
        if (k.startsWith("__") || k.startsWith("utm_") || TRACKING_PARAMS.includes(k)) {
          u.searchParams.delete(k);
        }
      }
      const clean = u.searchParams.toString()
        ? u.origin + u.pathname + "?" + u.searchParams.toString()
        : u.origin + u.pathname;
      return clean.replace(/\/$/, "");
    } catch (_) {
      return rawUrl;
    }
  }

  // Helper: resolve l.facebook.com/l.php redirect URL to actual target.
  // Facebook wraps external links như l.facebook.com/l.php?u=<ENCODED_URL>
  function _resolveFbRedirect(rawUrl) {
    if (!rawUrl) return "";
    try {
      if (rawUrl.includes("l.facebook.com/l.php") || rawUrl.includes("lm.facebook.com/l.php")) {
        const u = new URL(rawUrl);
        const target = u.searchParams.get("u");
        if (target) return decodeURIComponent(target);
      }
    } catch (_) {}
    return rawUrl;
  }

  function extractPostPermalink(element) {
    const url = location.href;
    if (SITE === "facebook") {
      // Nếu đang xem bài đơn lẻ → dùng URL trang
      if (/\/posts\/|\/permalink\/|story_fbid|multi_permalinks|pfbid/.test(url))
        return _cleanFbUrl(url);

      // Đang ở newsfeed → tìm permalink trong article
      if (!element) return "";

      // Tìm post container (supports both old role="article" and new data-virtualized)
      const postContainer = _findPostContainer(element);

      // === ƯU TIÊN 1: Nếu là BÀI SHARE → lấy link bài GỐC ===
      // Khi ai đó share bài, ta muốn link đến bài gốc (của người được share),
      // không phải link đến bài share. Bài gốc nằm trong nested article.
      const sharedInner = _findSharedPostArticle(postContainer);
      if (sharedInner) {
        // Tìm permalink bên trong nested article
        const innerPermalink = _findPermalinkInContainer(sharedInner);
        if (innerPermalink) return innerPermalink;
      }

      // === ƯU TIÊN 2: Tìm permalink trong post container (bài thường) ===
      const directPermalink = _findPermalinkInContainer(postContainer);
      if (directPermalink) return directPermalink;

      return "";
    }

    // Non-Facebook platforms
    if (!element) return url;
    const postContainer = _findPostContainer(element);
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
        try {
          return new URL(link.href).origin + new URL(link.href).pathname;
        } catch (_) {}
      }
    }
    return url;
  }

  // Helper tìm permalink trong 1 container (post hoặc nested shared post).
  // Được tách ra để tái sử dụng cho cả bài thường và bài share.
  function _findPermalinkInContainer(container) {
    if (!container) return "";
    const allLinks = container.querySelectorAll("a[href]");
    const candidates = [];

    for (const link of allLinks) {
      let href = link.href || "";
      if (!href) continue;

      // Resolve l.facebook.com redirects
      href = _resolveFbRedirect(href);

      // Bỏ qua link rõ ràng không phải permalink
      if (href.includes("/photo") || href.includes("/reel/") || href.includes("/hashtag/") ||
          href.includes("/events/") || href.includes("/marketplace/") ||
          href.includes("facebook.com/policies") || href.includes("facebook.com/help") ||
          href.includes("/groups/") && !href.includes("/posts/") && !href.includes("pfbid") && !href.includes("/permalink") ||
          href.includes("/share") ||
          href === "https://www.facebook.com/" || href === "https://www.facebook.com") continue;

      const isPermalink =
        href.includes("/posts/") ||
        href.includes("/permalink") ||
        href.includes("story_fbid") ||
        href.includes("pfbid") ||
        href.includes("multi_permalinks");

      if (isPermalink) {
        candidates.push({ href, priority: 1, reason: "permalink_pattern" });
        continue;
      }

      // Link có text ngắn giống timestamp
      const text = (link.textContent || "").trim();
      const ariaLabel = (link.getAttribute("aria-label") || "").trim();
      const isTimestamp =
        /^\d+\s*(giờ|phút|ngày|giây|tháng|năm|h|m|d|w|s|hr|min|tuần|week)/i.test(text) ||
        /^(hôm qua|yesterday|just now|vừa xong|hôm kia)/i.test(text) ||
        /\d+\s*(giờ|phút|ngày|hour|minute|day|month|year)/i.test(ariaLabel);

      if (isTimestamp && text.length < 30 && href.includes("facebook.com")) {
        candidates.push({ href, priority: 2, reason: "timestamp:" + text });
        continue;
      }

      // Link ngắn trỏ đến user profile + post (dạng /username/posts/ hoặc /username/pfbid)
      try {
        const u = new URL(href);
        if (u.hostname.includes("facebook.com") && u.pathname.length > 5) {
          const parts = u.pathname.split("/").filter(Boolean);
          // Pattern: /username/posts/id hoặc /username/pfbidXXX
          if (parts.length >= 2 && (parts[1] === "posts" || parts[1].startsWith("pfbid"))) {
            candidates.push({ href, priority: 1, reason: "path_pattern:" + u.pathname });
          }
        }
      } catch (_) {}
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => a.priority - b.priority);
      return _cleanFbUrl(candidates[0].href);
    }

    // === FALLBACK: Bài trong Group — tìm group permalink ===
    let groupUrl = "";
    let groupId = "";
    for (const link of allLinks) {
      const href = link.href || "";
      const match = href.match(/facebook\.com\/groups\/([^\/?]+)/);
      if (match) {
        groupId = match[1];
        groupUrl = "https://www.facebook.com/groups/" + groupId;
        break;
      }
    }

    if (groupUrl) {
      // Tìm post ID từ data-ft (Facebook legacy data attribute)
      const dataFtEl = container.querySelector("[data-ft]");
      if (dataFtEl) {
        try {
          const ft = JSON.parse(dataFtEl.getAttribute("data-ft"));
          if (ft.top_level_post_id) {
            return groupUrl + "/posts/" + ft.top_level_post_id;
          }
          if (ft.mf_story_key) {
            return groupUrl + "/posts/" + ft.mf_story_key;
          }
        } catch (_) {}
      }

      // Tìm post ID từ aria attributes, id, hoặc data-*
      const idSources = [
        container.getAttribute("aria-describedby"),
        container.getAttribute("aria-labelledby"),
        container.id,
        container.getAttribute("data-story-id"),
        container.getAttribute("data-post-id"),
      ].filter(Boolean).join(" ");
      const idMatch = idSources.match(/(\d{10,})/);
      if (idMatch) {
        return groupUrl + "/posts/" + idMatch[1];
      }

      // Tìm hidden inputs có post ID
      const hiddenInputs = container.querySelectorAll(
        "input[type='hidden'], [data-story-id], [data-post-id], [data-testid*='post']"
      );
      for (const el of hiddenInputs) {
        const val = el.value ||
          el.getAttribute("data-story-id") ||
          el.getAttribute("data-post-id") ||
          el.getAttribute("data-testid") || "";
        const vMatch = val.match(/(\d{10,})/);
        if (vMatch) {
          return groupUrl + "/posts/" + vMatch[1];
        }
      }

      // Fallback: chỉ trả về group URL
      return groupUrl;
    }

    // === FALLBACK: Bài trên Page — tìm page URL ===
    // Page posts thường có link về page, dạng /pageusername hoặc /pages/Name/ID
    for (const link of allLinks) {
      const href = link.href || "";
      // Pattern page: /pages/Name/12345 hoặc /pagename (single path)
      const pageMatch = href.match(/facebook\.com\/pages\/[^\/]+\/(\d+)/);
      if (pageMatch) {
        // Thử tìm post ID trong container
        const idSources = [
          container.getAttribute("aria-describedby") || "",
          container.getAttribute("aria-labelledby") || "",
          container.id || "",
        ].join(" ");
        const postIdMatch = idSources.match(/(\d{10,})/);
        if (postIdMatch) {
          return "https://www.facebook.com/" + pageMatch[1] + "/posts/" + postIdMatch[1];
        }
        return "https://www.facebook.com/pages/" + pageMatch[0].split("/pages/")[1];
      }
    }

    // === FALLBACK CUỐI: Link profile tác giả ===
    for (const link of allLinks) {
      const href = link.href || "";
      if (href.includes("facebook.com") && (href.includes("/user/") || href.includes("/profile.php"))) {
        return _cleanFbUrl(href);
      }
    }

    return "";
  }

  function extractPostImage(element) {
    if (!element) return "";

    const postContainer = _findPostContainer(element);

    // Helper: get best src from img element (handles lazy-loaded srcset/data-src)
    function _imgSrc(img) {
      // Ưu tiên srcset (responsive) → dùng URL cuối (thường là highest res)
      const srcset = img.getAttribute("srcset") || img.getAttribute("data-srcset") || "";
      if (srcset) {
        const parts = srcset.split(",").map(s => s.trim().split(/\s+/)).filter(p => p[0]);
        if (parts.length > 0) {
          // Lấy URL có descriptor lớn nhất (w, x) hoặc cuối cùng
          let best = parts[parts.length - 1];
          let bestW = 0;
          for (const p of parts) {
            const w = parseInt(p[1] || "0");
            if (w > bestW) { bestW = w; best = p; }
          }
          if (best[0]) return best[0];
        }
      }
      return img.getAttribute("data-src") || img.currentSrc || img.src || "";
    }

    // Helper: is this img likely an avatar/icon (circular or tiny)?
    function _isAvatar(img) {
      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      if (w > 0 && w === h && w <= 60) return true;
      try { if (getComputedStyle(img).borderRadius === "50%") return true; } catch (_) {}
      // Avatar thường trong link profile
      const parentLink = img.closest("a");
      if (parentLink) {
        const href = parentLink.href || "";
        // Profile pattern: /username hoặc /profile.php?id=
        if (href.includes("/profile.php") ||
            (href.includes("facebook.com") && /facebook\.com\/[^/?]+\/?$/.test(href) &&
             !href.includes("/posts/") && !href.includes("/photo") && !href.includes("/pages/"))) {
          return true;
        }
      }
      return false;
    }

    // Helper: is this img inside the post header (avatar row)?
    function _isHeaderImg(img, container) {
      const headerEl = container.querySelector(
        "h2, h3, h4, [data-testid='story-subtitle'], [data-testid='post-header']"
      );
      if (headerEl && headerEl.contains(img)) return true;
      // Also skip profile-href links near top of post
      const parentLink = img.closest("a");
      if (parentLink) {
        const href = parentLink.href || "";
        if (href.includes("/user/") || href.includes("/profile.php") ||
            (href.includes("facebook.com") && /facebook\.com\/[^/?]+$/.test(href) &&
             !href.includes("/posts/") && !href.includes("/photo") && !href.includes("/reel"))) {
          return true;
        }
      }
      return false;
    }

    // Helper: extract ALL images from a specific container, sorted by area desc.
    // Returns an array of unique image URLs (highest quality variant each).
    function _extractAllImagesFromContainer(container) {
      const collected = []; // { src, area, priority }
      const seenSrcs = new Set();

      // Dedup helper: 2 URL là cùng 1 ảnh nếu sau khi strip size params chúng giống nhau
      // Facebook URL pattern: scontent-*.fbcdn.net/v/t1.../IMG_HASH_n.jpg?...
      function _normalizeSrc(src) {
        try {
          const u = new URL(src);
          // Giữ origin + pathname, bỏ query params (thường chứa thumbnail size)
          return u.origin + u.pathname;
        } catch (_) {
          return src;
        }
      }

      function _addIfUnique(src, area, priority) {
        if (!src || src.startsWith("data:")) return;
        if (src.includes("/rsrc.php/") || src.includes("emoji")) return;
        const key = _normalizeSrc(src);
        if (seenSrcs.has(key)) return;
        seenSrcs.add(key);
        collected.push({ src, area, priority });
      }

      // Strategy 1 (priority 1): images inside explicit photo/video link containers
      const photoLinks = container.querySelectorAll(
        'a[href*="/photo"], a[href*="/photos/"], a[href*="fbid="], a[href*="/reel/"], a[href*="/videos/"]',
      );
      for (const link of photoLinks) {
        const img = link.querySelector("img");
        if (!img) continue;
        const src = _imgSrc(img);
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        if (w > 0 && w < 80) continue; // skip rất nhỏ
        _addIfUnique(src, w * h, 1);
      }

      // Strategy 2 (priority 2): background-image trong inline style
      const bgElements = container.querySelectorAll('[style*="background-image"]');
      for (const bgEl of bgElements) {
        const rect = bgEl.getBoundingClientRect();
        if (rect.width < 150 || rect.height < 150) continue;
        try {
          if (getComputedStyle(bgEl).borderRadius === "50%") continue;
        } catch (_) {}
        const style = bgEl.getAttribute("style") || "";
        const match = style.match(/background-image:\s*url\(["']?([^"')]+)["']?\)/);
        if (match && match[1]) {
          _addIfUnique(match[1], rect.width * rect.height, 2);
        }
      }

      // Strategy 3 (priority 3): large images not in avatar/header position
      const allImgs = container.querySelectorAll("img");
      for (const img of allImgs) {
        const src = _imgSrc(img);
        if (!src || src.startsWith("data:")) continue;
        if (_isAvatar(img)) continue;
        if (_isHeaderImg(img, container)) continue;
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        if (w > 0 && w < 200 && h < 200) continue;
        _addIfUnique(src, w * h, 3);
      }

      // Sort: priority asc (1 = best), then area desc (larger first)
      collected.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return b.area - a.area;
      });

      return collected.map(c => c.src);
    }

    // Internal helper returning array of URLs. extractPostImage() wraps this
    // and returns only the first for backward compat. extractPostImages() (plural)
    // is exposed for callers that need multi-image support.
    function _collectImages() {
      if (SITE === "facebook") {
        const results = [];
        const seen = new Set();
        const push = (arr) => {
          for (const url of arr) {
            try {
              const key = new URL(url).origin + new URL(url).pathname;
              if (!seen.has(key)) { seen.add(key); results.push(url); }
            } catch (_) {
              if (!seen.has(url)) { seen.add(url); results.push(url); }
            }
          }
        };
        // ƯU TIÊN 1: Bài share → ảnh bài gốc (nested article)
        const sharedInner = _findSharedPostArticle(postContainer);
        if (sharedInner) push(_extractAllImagesFromContainer(sharedInner));
        // ƯU TIÊN 2: Lấy tất cả ảnh từ post container chính
        push(_extractAllImagesFromContainer(postContainer));
        return results;
      } else {
        // Non-Facebook: original logic (single best)
        const results = [];
        const images = postContainer.querySelectorAll("img");
        for (const img of images) {
          const src = _imgSrc(img);
          if (!src || src.startsWith("data:")) continue;
          const w = img.naturalWidth || img.width || 0;
          const h = img.naturalHeight || img.height || 0;
          if (w < 200 && h < 200) continue;
          if (src.includes("emoji") || src.includes("static")) continue;
          if (src.includes("profile") || src.includes("avatar")) continue;
          try { if (getComputedStyle(img).borderRadius === "50%") continue; } catch (_) {}
          results.push(src);
        }
        return results;
      }
    }

    const allImages = _collectImages();
    if (allImages.length > 0) {
      // Attach to the function's returned string as expando for callers that can use it
      const primary = allImages[0];
      // Primary as return value (string) — backward compat
      // Expose all via a module-level variable for the same call
      _lastExtractedImages = allImages;
      return primary;
    }
    _lastExtractedImages = [];

    // Fallback: og:image
    const ogImage = document.querySelector('meta[property="og:image"]');
    if (ogImage && ogImage.content) return ogImage.content;

    return "";
  }

  // === FACEBOOK AUTHOR HELPERS ===

  // Extract a valid author name from the first <a> inside a header element.
  function _fbNameFromHeader(header) {
    const link = header.querySelector("a");
    if (!link) return "";
    // Ưu tiên aria-label (Facebook thường set đúng tên ở đây)
    const ariaLabel = (link.getAttribute("aria-label") || "").trim();
    if (ariaLabel.length >= 2 && ariaLabel.length < 80) return ariaLabel;
    // Fallback: innerText (tránh textContent vì FB chèn ký tự rác anti-scraping)
    const name = (link.innerText || link.textContent || "").trim();
    // Validate: tên hợp lệ không chứa quá nhiều số/ký tự lạ
    if (
      name.length >= 2 &&
      name.length < 80 &&
      !SEE_MORE.includes(name.toLowerCase()) &&
      !/[\d]{8,}/.test(name) &&
      !/[a-f0-9]{10,}/i.test(name)
    )
      return name;
    return "";
  }

  // Check if a DOM element sits inside the comment section of a post.
  // Facebook comments live inside a form (comment composer area) or after
  // a "comment" / "bình luận" section. We detect this by checking if the
  // element is preceded by the main post text content — shared-post articles
  // appear BEFORE the text or embedded within it, while comments appear AFTER.
  //
  // Heuristic: a nested article is a COMMENT if:
  //   (a) it does NOT contain a profile-link header (h2/h3/h4 with <a>), OR
  //   (b) it sits inside a container whose role is "list" or that has
  //       ul/[role="list"] ancestor (Facebook wraps comments in list roles), OR
  //   (c) it is a sibling/descendant of a form element (comment input area).
  function _fbIsCommentArticle(nested, postContainer) {
    // (b) Inside a list-like container → comment
    let el = nested.parentElement;
    for (let i = 0; i < 10 && el && el !== postContainer; i++) {
      const role = (el.getAttribute("role") || "").toLowerCase();
      if (role === "list" || role === "listitem" || el.tagName === "UL")
        return true;
      el = el.parentElement;
    }
    // (c) Inside or adjacent to a form → comment
    if (nested.closest("form")) return true;
    el = nested.parentElement;
    for (let i = 0; i < 5 && el && el !== postContainer; i++) {
      if (el.querySelector(":scope > form")) return true;
      el = el.parentElement;
    }
    return false;
  }

  // Find the original author of a shared post.
  // Returns "" if the post is NOT a shared post.
  //
  // Facebook DOM for shared posts (all 3 cases):
  //   1. Personal share:  [article sharer] > ... > [article original-author]
  //   2. Group share:     [article sharer] > ... > [article original-author]
  //   3. Page share:      [article page]   > ... > [article original-author]
  //
  // The inner article of a shared post:
  //   - Has its own h2/h3/h4 header with a profile <a> link
  //   - Is NOT inside a comment list/form area
  //   - Is a direct child article of the post (not nested deeper in comment replies)
  function _fbFindOriginalAuthor(postContainer) {
    const nestedArticles = postContainer.querySelectorAll('[role="article"]');
    for (const nested of nestedArticles) {
      if (nested === postContainer) continue;

      // Must be a direct child article of postContainer (not nested inside another nested article)
      const parentArticle = nested.parentElement?.closest('[role="article"]');
      if (parentArticle && parentArticle !== postContainer) continue;

      // Skip comment articles
      if (_fbIsCommentArticle(nested, postContainer)) continue;

      // Must have its own header with a profile link — this is the shared post's author
      const headers = nested.querySelectorAll("h2, h3, h4");
      for (const h of headers) {
        // Header must belong to THIS nested article, not a deeper one
        if (h.closest('[role="article"]') !== nested) continue;
        const name = _fbNameFromHeader(h);
        if (name) return name;
      }

      // Fallback: strong > a directly inside this nested article (some shared post layouts)
      const strongs = nested.querySelectorAll("strong a");
      for (const s of strongs) {
        if (s.closest('[role="article"]') !== nested) continue;
        const name = (s.innerText || s.textContent || "").trim();
        if (
          name.length >= 2 &&
          name.length < 80 &&
          !/[a-f0-9]{10,}/i.test(name)
        )
          return name;
      }
    }
    return "";
  }

  // Extract author from a non-shared post container (the simple case).
  function _fbExtractAuthorFromContainer(container) {
    const headers = container.querySelectorAll("h2, h3, h4");
    for (const h of headers) {
      if (h.closest('[role="article"]') !== container) continue;
      const name = _fbNameFromHeader(h);
      if (name) return name;
    }
    // Fallback: strong > a
    const strongs = container.querySelectorAll("strong a");
    for (const s of strongs) {
      if (s.closest('[role="article"]') !== container) continue;
      const name = (s.innerText || s.textContent || "").trim();
      if (name.length >= 2 && name.length < 80 && !/[a-f0-9]{10,}/i.test(name))
        return name;
    }
    return "";
  }

  function extractPostAuthor(element) {
    if (!element) return "";

    // Walk up to the outermost post article
    let postContainer = element;
    for (let i = 0; i < 20; i++) {
      if (
        !postContainer.parentElement ||
        postContainer.parentElement === document.body
      )
        break;
      postContainer = postContainer.parentElement;
      if (postContainer.getAttribute("role") === "article") break;
    }

    if (SITE === "facebook") {
      // 1. Try to find original author from a shared/embedded post inside this article.
      //    This handles: personal share, group share, page share — all cases where
      //    someone shares another person's post. The outer header = sharer, inner = author.
      const originalAuthor = _fbFindOriginalAuthor(postContainer);
      if (originalAuthor) return originalAuthor;

      // 2. Not a shared post → author is in this article's own header.
      //    This handles: personal post, page post, group post (original, not shared).
      return _fbExtractAuthorFromContainer(postContainer);
    }

    // X/Threads
    const nameEl = postContainer.querySelector(
      '[data-testid="User-Name"], [data-testid="tweetAuthorName"]',
    );
    if (nameEl) return (nameEl.textContent || "").split("@")[0].trim();

    // LinkedIn
    const liAuthor = postContainer.querySelector(
      ".feed-shared-actor__name, .update-components-actor__name",
    );
    if (liAuthor) return (liAuthor.textContent || "").trim();

    // Reddit
    const redditAuthor = postContainer.querySelector(
      '[data-testid="post_author_link"], a[href*="/user/"]',
    );
    if (redditAuthor) return (redditAuthor.textContent || "").trim();

    return "";
  }

  function extractPostSource(element) {
    if (!element) return "";

    const postContainer = _findPostContainer(element);

    if (SITE === "facebook") {
      // 1. Nếu post là BÀI SHARE → source là nguồn bài gốc (group/page được share)
      const sharedInner = _findSharedPostArticle(postContainer);
      const containers = sharedInner ? [sharedInner, postContainer] : [postContainer];

      for (const container of containers) {
        // 2. Tìm pattern "Author › Group" hoặc "Author in Group"
        // trong header: nếu có ≥2 link trong h2/h3/h4 thì link thứ 2 thường là group/page
        const headers = container.querySelectorAll("h2, h3, h4");
        for (const h of headers) {
          // Header phải thuộc container này
          if (h.closest('[role="article"]') && h.closest('[role="article"]') !== container && container.getAttribute("role") === "article") continue;
          const links = h.querySelectorAll("a[href]");
          if (links.length >= 2) {
            for (let i = 1; i < links.length; i++) {
              const link = links[i];
              const href = link.href || "";
              const name = (link.innerText || link.textContent || "").trim();
              if (name.length < 3 || name.length > 100) continue;
              // Chỉ lấy nếu link trỏ đến group hoặc page
              if (href.includes("/groups/") || href.match(/facebook\.com\/[^/?]+\/?$/)) {
                return name;
              }
            }
          }
        }

        // 3. Tìm direct group link trong container (trừ link avatar/author)
        const groupLinks = container.querySelectorAll('a[href*="/groups/"]');
        for (const link of groupLinks) {
          // Bỏ qua link rỗng / chỉ có ảnh
          const name = (link.innerText || link.textContent || "").trim();
          if (name.length >= 3 && name.length < 100 && !/^\d+$/.test(name)) {
            return name;
          }
        }
      }

      // 4. Fallback: nếu URL trang là group → lấy từ page title
      if (location.href.includes("/groups/")) {
        const ogTitle = document.querySelector('meta[property="og:title"]');
        if (ogTitle && ogTitle.content) return ogTitle.content.trim();
      }
    }

    return "";
  }

  function extractPostTitle(element) {
    if (!element) return "";

    // Walk up to post container
    let postContainer = element;
    for (let i = 0; i < 20; i++) {
      if (
        !postContainer.parentElement ||
        postContainer.parentElement === document.body
      )
        break;
      postContainer = postContainer.parentElement;
      if (postContainer.getAttribute("role") === "article") break;
    }

    // Reddit has explicit title
    const redditTitle = postContainer.querySelector(
      '[data-testid="post-title"], h1, h3[slot="title"]',
    );
    if (redditTitle) return (redditTitle.textContent || "").trim();

    // LinkedIn shared articles
    const liTitle = postContainer.querySelector(
      ".feed-shared-article__title, .update-components-article__title",
    );
    if (liTitle) return (liTitle.textContent || "").trim();

    // og:title for single post pages
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle && ogTitle.content) return ogTitle.content;

    // Fallback: empty — AI will generate title from summary
    return "";
  }

  // === STREAMING SUMMARIZE ===
  async function wakeServiceWorker() {
    try {
      await chrome.runtime.sendMessage({ action: "ping" });
    } catch (_) {}
  }

  async function summarizeText(text, type = "summary", contextElement = null, tone = null) {
    if (!text || text.length < 50) {
      openOverlay(
        '<div class="fbs-error">Text quá ngắn để tóm tắt.</div>',
        false,
      );
      return;
    }

    if (!isContextValid()) {
      openOverlay(
        '<div class="fbs-error">Extension đã cập nhật. Vui lòng F5.</div>',
        false,
        type,
      );
      return;
    }

    // Smart cache key includes settings that affect output
    let settings;
    try {
      settings = await new Promise((r) =>
        chrome.storage.sync.get(["summaryLength", "promptStyle"], r),
      );
    } catch (_) {
      openOverlay(
        '<div class="fbs-error">Extension đã cập nhật. Vui lòng F5.</div>',
        false,
        type,
      );
      return;
    }
    const cacheKey =
      hashText(text) +
      "_" +
      type +
      "_" +
      (settings.summaryLength || "medium") +
      "_" +
      (settings.promptStyle || "default") +
      (tone ? "_" + tone : "");

    if (summaryCache.has(cacheKey)) {
      openOverlay(
        '<div class="fbs-result">' + fmt(summaryCache.get(cacheKey)) + "</div>",
        false,
        type,
      );
      return;
    }

    lastSummarizeParams = { text, type, _element: contextElement, tone };
    isSummarizing = true;
    const title =
      type === "affiliate"
        ? "Đang viết bài Affiliate..."
        : type === "status_share"
          ? "Đang viết Status..."
          : "Đang tóm tắt...";
    openOverlay(
      '<div class="fbs-loading"><div class="fbs-spinner"></div><span>' +
        title +
        "</span></div>",
      false,
      type,
    );

    // Wake SW before connecting port (MV3 SW dies after ~30s idle)
    await wakeServiceWorker();
    if (!isContextValid()) {
      openOverlay(
        '<div class="fbs-error">Extension đã cập nhật. Vui lòng F5.</div>',
        false,
        type,
      );
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
    const _modelSelect = panel && panel.querySelector(".fbs-model-select");
    const _preferredProvider = _modelSelect ? _modelSelect.value : "";
    currentPort.postMessage({
      action: "summarize",
      text,
      site: SITE,
      type,
      tone: tone || null,
      preferredProvider: _preferredProvider || null,
      sourceUrl: _sourceUrl,
      imageUrl: _imageUrl,
      author: _author,
      postTitle: _title,
      postSource: _source,
      agentMode: !!window._fbsAgentMode,
    });

    let first = true;
    let streamBuffer = "";
    let streamRafId = null;

    function renderStream() {
      streamRafId = null;
      const existingResult = panelBody.querySelector(".fbs-result");
      if (existingResult) {
        existingResult.innerHTML = fmt(streamBuffer);
      } else {
        openOverlay(
          '<div class="fbs-result">' + fmt(streamBuffer) + "</div>",
          true,
        );
      }
      if (panelBody.scrollHeight - panelBody.scrollTop < 500)
        panelBody.scrollTop = panelBody.scrollHeight;
    }

    currentPort.onMessage.addListener((msg) => {
      if (msg.action === "chunk") {
        if (first) {
          first = false;
          openOverlay('<div class="fbs-result"></div>', true);
        }
        streamBuffer = msg.full;
        // Throttle DOM updates to 1 per animation frame
        if (!streamRafId) {
          streamRafId = requestAnimationFrame(renderStream);
        }
      } else if (msg.action === "done") {
        if (streamRafId) {
          cancelAnimationFrame(streamRafId);
          streamRafId = null;
        }
        isSummarizing = false;
        summaryCache.set(cacheKey, msg.full);
        // Show quality warnings from post-processing guardrails
        let qualityHtml = "";
        if (msg.issues && msg.issues.length > 0) {
          const issueClass =
            msg.quality === "warn" ? "fbs-quality-warn" : "fbs-quality-info";
          qualityHtml =
            '<div class="' +
            issueClass +
            '">' +
            msg.issues.map((i) => esc(i)).join("<br>") +
            "</div>";
        }
        openOverlay(
          '<div class="fbs-result">' + fmt(msg.full) + "</div>" + qualityHtml,
          false,
          type,
        );
        // Agent mode: score đã được tính trong cùng lần gọi AI → gửi decision ngay, không cần eval riêng
        if (window._fbsAgentMode && typeof msg.agentScore === "number") {
          window.dispatchEvent(
            new CustomEvent("fbs_agent_decision", {
              detail: { score: msg.agentScore },
            }),
          );
        }
        try {
          currentPort.disconnect();
        } catch (_) {}
        currentPort = null;
      } else if (msg.action === "error") {
        isSummarizing = false;
        openOverlay(
          '<div class="fbs-error">' + esc(msg.error) + "</div>",
          false,
        );
        try {
          currentPort.disconnect();
        } catch (_) {}
        currentPort = null;
      }
    });

    currentPort.onDisconnect.addListener(() => {
      if (isSummarizing) {
        isSummarizing = false;
        if (panelBody && !panelBody.innerHTML.includes("fbs-result")) {
          openOverlay(
            '<div class="fbs-error">Kết nối bị ngắt.</div>',
            false,
            type,
          );
        } else if (panelBody) {
          openOverlay(panelBody.innerHTML, false, type);
        }
      }
    });
  }

  // === MESSAGES (CONTEXT MENU, SHORTCUTS & UNSHORTEN) ===
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "clear-cache") {
      summaryCache.clear();
      logger.info("Cache cleared via test mode");
      return;
    }
    if (msg.action === "summarize-selection" && msg.text) {
      summarizeText(msg.text, msg.type);
    }
    if (msg.action === "shortcut-summarize-shortcut") {
      const text = window.getSelection().toString();
      if (text) summarizeText(text, "summary");
      else
        openOverlay(
          '<div class="fbs-error">Vui lòng bôi đen đoạn văn bản trước khi bấm Hotkey!</div>',
          false,
        );
    }
    if (msg.action === "shortcut-affiliate-shortcut") {
      const text = window.getSelection().toString();
      if (text) summarizeText(text, "affiliate");
      else
        openOverlay(
          '<div class="fbs-error">Vui lòng bôi đen đoạn văn bản trước khi bấm Hotkey!</div>',
          false,
        );
    }
    if (msg.action === "unshorten-result") {
      if (msg.error) {
        openOverlay(
          '<div class="fbs-error">' + esc(msg.error) + "</div>",
          false,
        );
      } else if (msg.text) {
        navigator.clipboard
          .writeText(msg.text)
          .catch(() =>
            openOverlay(
              '<div class="fbs-error">Lỗi ghi clipboard. Link gốc là:<br><code>' +
                esc(msg.text) +
                "</code></div>",
              false,
            ),
          );
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
      wrap.style.cssText =
        "display:inline;position:relative;vertical-align:baseline;";
    } else {
      wrap.className = "fbs-wrap";
    }
    const readStats = calcReadTime(textContainer || target);
    wrap.appendChild(isInline ? createInlineBtn(readStats) : createBtn(readStats));

    let inserted = false;

    // 1) Insert after "Xem thêm" text element (don't wrap/move it)
    if (!inserted && seeMoreOriginal && seeMoreOriginal.parentElement) {
      try {
        seeMoreOriginal.parentElement.insertBefore(
          wrap,
          seeMoreOriginal.nextSibling,
        );
        inserted = true;
      } catch (e) {}
    }

    // 2) Insert after clickable
    if (!inserted && seeMoreClickable && seeMoreClickable.parentElement) {
      try {
        seeMoreClickable.parentElement.insertBefore(
          wrap,
          seeMoreClickable.nextSibling,
        );
        inserted = true;
      } catch (e) {}
    }

    // 3) Append to text container
    if (!inserted && textContainer) {
      try {
        textContainer.appendChild(wrap);
        inserted = true;
      } catch (e) {}
    }

    // 4) Fallback absolute
    if (!inserted) {
      wrap.className = "fbs-wrap";
      const pos = getComputedStyle(target).position;
      if (pos === "static" || pos === "") target.style.position = "relative";
      target.appendChild(wrap);
    }

    const btnEl =
      wrap.querySelector(".fbs-btn") || wrap.querySelector(".fbs-btn-inline");
    btnEl.addEventListener("click", async (e) => {
      e.stopPropagation();
      const type = "summary";
      const title = "Đang tóm tắt...";
      openOverlay(
        '<div class="fbs-loading"><div class="fbs-spinner"></div><span>' +
          title +
          "</span></div>",
        false,
        type,
      );

      // Expand to get full text
      if (seeMoreClickable) {
        try {
          seeMoreClickable.click();
        } catch (_) {}
        await new Promise((r) => setTimeout(r, 1200));
      }

      const text = cleanText(
        extractMainContent(textContainer || target) ||
          (textContainer || target).innerText ||
          "",
      );

      // Collapse back: try "Ẩn bớt" button first (FB re-added it), fallback to toggle click
      const collapseBtn = findCollapseBtn(textContainer || target);
      if (collapseBtn) {
        try {
          collapseBtn.click();
        } catch (_) {}
      } else if (seeMoreClickable) {
        try {
          seeMoreClickable.click();
        } catch (_) {}
      }

      await summarizeText(text, type, textContainer || target);
    });
  }

  const COLLAPSE_KEYWORDS = ["ẩn bớt", "hide", "show less", "voir moins", "weniger anzeigen", "접기"];

  function findCollapseBtn(container) {
    if (!container) return null;
    const els = container.querySelectorAll(
      'div[role="button"], span[role="button"], span[dir="auto"], div[dir="auto"]',
    );
    for (const el of els) {
      const t = (el.innerText || el.textContent || "").trim().toLowerCase();
      if (t.length > 20 || t.length < 3) continue;
      if (COLLAPSE_KEYWORDS.some((kw) => t === kw || t.startsWith(kw))) return el;
    }
    return null;
  }

  function processSeeMore(sm) {
    const textContainer = findTextContainer(sm);
    if (!textContainer) return;
    if ((textContainer.innerText || "").trim().length < MIN_LEN / 2) return;
    const target = findInjectTarget(textContainer);
    if (
      injected.has(target) ||
      target.querySelector(".fbs-wrap") ||
      target.querySelector(".fbs-btn-inline")
    )
      return;
    inject(target, findClickable(sm), textContainer, sm);
  }

  // === FLOATING TOOLBAR ===
  let floatingToolbar = null;
  function createFloatingToolbar() {
    if (floatingToolbar) return;
    floatingToolbar = document.createElement("div");
    floatingToolbar.className = "fbs-floating-toolbar";
    floatingToolbar.innerHTML =
      '<button class="fbs-floating-btn fbs-btn-highlight" data-action="summary"><img src="' +
      ICON_BASE64 +
      '" width="13" height="13" style="vertical-align:-2px"> Tóm tắt</button>' +
      '<button class="fbs-floating-btn" data-action="affiliate"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg> Affiliate</button>' +
      (SITE === "facebook" ? '<button class="fbs-floating-btn" data-action="batch" title="Chọn nhiều bài để tóm tắt (Alt+B)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Batch</button>' : '');
    document.body.appendChild(floatingToolbar);

    floatingToolbar.addEventListener("mousedown", (e) => e.preventDefault());
    floatingToolbar.addEventListener("click", (e) => {
      e.preventDefault();
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.getAttribute("data-action");
      if (action === "batch") {
        floatingToolbar.classList.remove("fbs-visible");
        if (batchMode) exitBatchMode(); else enterBatchMode();
        return;
      }
      const sel = window.getSelection();
      const text = sel.toString().trim();
      if (text) {
        floatingToolbar.classList.remove("fbs-visible");
        const anchor =
          sel.rangeCount > 0
            ? sel.getRangeAt(0).startContainer.parentElement
            : null;
        summarizeText(text, action, anchor);
      }
    });

    const scrollHandler = () => {
      if (floatingToolbar.classList.contains("fbs-visible"))
        floatingToolbar.classList.remove("fbs-visible");
    };
    document.addEventListener("scroll", scrollHandler, { capture: true, passive: true });
    listeners.push({ element: document, event: "scroll", handler: scrollHandler, options: { capture: true, passive: true } });
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
      const left = rect.left + window.scrollX + rect.width / 2 - 80;
      floatingToolbar.style.top = top + "px";
      floatingToolbar.style.left = left + "px";
      floatingToolbar.classList.add("fbs-visible");
    }, 0);
  }

  const mouseupHandler = (e) => {
    if (floatingToolbar && floatingToolbar.contains(e.target)) return;
    handleSelection();
  };
  document.addEventListener("mouseup", mouseupHandler);
  listeners.push({ element: document, event: "mouseup", handler: mouseupHandler });

  const mousedownHandler = (e) => {
    if (floatingToolbar && !floatingToolbar.contains(e.target)) {
      floatingToolbar.classList.remove("fbs-visible");
    }
  };
  document.addEventListener("mousedown", mousedownHandler);
  listeners.push({ element: document, event: "mousedown", handler: mousedownHandler });

  // === VISIBLE POSTS TRACKER (IntersectionObserver) ===
  const visiblePosts = new Set();
  let postObserver = null;
  if (typeof IntersectionObserver !== "undefined") {
    postObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          visiblePosts.add(entry.target);
        } else {
          visiblePosts.delete(entry.target);
        }
      }
    }, { rootMargin: "800px 0px" });
  }

  // === FB ALL POSTS (Feature 6) — hover "Tóm tắt" for posts without "Xem thêm" ===
  const fbAllPostInjected = new WeakSet();
  function scanFBAllPosts() {
    if (SITE !== "facebook") return;
    const root = document.querySelector('div[role="main"]') || document.querySelector('div[id^="mount_0_0"]') || document.body;

    // Support both old layout (role="article") and new virtualized layout (data-virtualized)
    const candidates = [
      ...root.querySelectorAll('article[role="article"]'),
      ...root.querySelectorAll('[data-virtualized]'),
    ];

    for (const article of candidates) {
      if (postObserver && !article.dataset.fbsObserved) {
        article.dataset.fbsObserved = "1";
        postObserver.observe(article);
      }

      if (fbAllPostInjected.has(article)) continue;
      // Skip if already has a regular fbs button
      if (article.querySelector(".fbs-wrap, .fbs-btn, .fbs-btn-inline, .fbs-allpost-btn")) continue;
      // Skip if this is nested inside another post container (comment articles)
      let depth = 0;
      let anc = article.parentElement;
      for (let j = 0; j < 20; j++) {
        if (!anc || anc === document.body) break;
        if (anc.getAttribute("role") === "article" || anc.hasAttribute("data-virtualized")) depth++;
        anc = anc.parentElement;
      }
      if (depth >= 1) continue; // nested = comment/reply
      if (isSponsored(article)) { fbAllPostInjected.add(article); continue; }
      const text = (article.innerText || "").trim();
      if (text.length < MIN_LEN) continue;
      fbAllPostInjected.add(article);
      const pos = getComputedStyle(article).position;
      if (pos === "static" || pos === "") article.style.position = "relative";
      const btn = document.createElement("button");
      btn.className = "fbs-allpost-btn";
      btn.innerHTML = '<img src="' + ICON_BASE64 + '" width="12" height="12" style="vertical-align:-1px"> Tóm tắt';
      btn.title = "Tóm tắt bài này";
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        const t = (article.innerText || "").trim();
        if (t.length >= MIN_LEN) summarizeText(t, "summary", article);
      });
      article.appendChild(btn);
    }
  }

  // === COMMENT THREAD SUMMARY (Feature 11) ===
  const commentBtnInjected = new WeakSet();
  function scanCommentSections() {
    if (SITE !== "facebook") return;
    const root = document.querySelector('div[role="main"]') || document.querySelector('div[id^="mount_0_0"]') || document.body;
    // Include both old (role="article") and new (data-virtualized) top-level post containers
    const articles = [
      ...root.querySelectorAll('article[role="article"]'),
      ...root.querySelectorAll('[data-virtualized]'),
    ];
    for (const article of articles) {
      // Only top-level post containers — not nested in another post
      let depth = 0;
      let ancestor = article.parentElement;
      for (let j = 0; j < 20; j++) {
        if (!ancestor || ancestor === document.body) break;
        if (ancestor.getAttribute("role") === "article" || ancestor.hasAttribute("data-virtualized")) depth++;
        ancestor = ancestor.parentElement;
      }
      if (depth >= 1) continue; // nested = not a top-level post
      if (commentBtnInjected.has(article)) continue;
      // Check for comment articles inside this post
      const commentArticles = article.querySelectorAll('article[role="article"]');
      if (commentArticles.length < 2) continue; // need at least 2 visible comments
      commentBtnInjected.add(article);
      // Collect comment text
      const commentTexts = [];
      for (const ca of commentArticles) {
        const t = (ca.innerText || "").trim();
        if (t.length > 10) commentTexts.push(t);
      }
      if (commentTexts.length < 2) continue;
      const btn = document.createElement("button");
      btn.className = "fbs-comment-summary-btn";
      btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg> Tóm tắt ' + commentTexts.length + ' bình luận';
      btn.title = "Tóm tắt toàn bộ thread bình luận";
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        const currentComments = Array.from(article.querySelectorAll('article[role="article"]'))
          .map(ca => (ca.innerText || "").trim()).filter(t => t.length > 10);
        if (currentComments.length === 0) return;
        const combined = "THREAD BÌNH LUẬN (" + currentComments.length + " comments):\n\n" +
          currentComments.map((t, i) => (i + 1) + ". " + t).join("\n\n");
        summarizeText(combined, "summary", article);
      });
      // Insert before the first comment article
      const firstComment = commentArticles[0];
      firstComment.parentElement?.insertBefore(btn, firstComment);
    }
  }

  // === BATCH QUEUE (Feature 12) ===
  let batchMode = false;
  let batchQueue = []; // [{text, el}]
  let batchBar = null;
  const batchCheckboxes = new WeakMap(); // article → checkbox el

  function createBatchBar() {
    if (batchBar) return;
    batchBar = document.createElement("div");
    batchBar.className = "fbs-batch-bar";
    batchBar.innerHTML =
      '<span class="fbs-batch-count">0 bài đã chọn</span>' +
      '<button class="fbs-batch-run-btn">Tóm tắt tất cả</button>' +
      '<button class="fbs-batch-cancel-btn" title="Thoát Batch Mode">✕</button>';
    document.body.appendChild(batchBar);
    batchBar.querySelector(".fbs-batch-run-btn").addEventListener("click", runBatch);
    batchBar.querySelector(".fbs-batch-cancel-btn").addEventListener("click", exitBatchMode);
  }

  function updateBatchBar() {
    if (!batchBar) return;
    batchBar.querySelector(".fbs-batch-count").textContent = batchQueue.length + " bài đã chọn";
  }

  function enterBatchMode() {
    batchMode = true;
    batchQueue = [];
    createBatchBar();
    batchBar.classList.add("fbs-batch-visible");
    document.body.classList.add("fbs-batch-mode");
    // Add checkboxes to all visible post articles
    const root = document.querySelector('div[role="main"]') || document.body;
    root.querySelectorAll('article[role="article"]').forEach(article => {
      let articleAncestors = 0;
      let anc = article.parentElement;
      for (let j = 0; j < 20; j++) {
        if (!anc || anc === document.body) break;
        if (anc.getAttribute("role") === "article") articleAncestors++;
        anc = anc.parentElement;
      }
      if (articleAncestors !== 1) return;
      if (batchCheckboxes.has(article)) return;
      const pos = getComputedStyle(article).position;
      if (pos === "static" || pos === "") article.style.position = "relative";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "fbs-batch-checkbox";
      cb.addEventListener("change", () => {
        if (cb.checked) {
          cb.classList.add("fbs-checked");
          const text = (article.innerText || "").trim();
          if (text.length >= MIN_LEN) batchQueue.push({ text, el: article, cb });
        } else {
          cb.classList.remove("fbs-checked");
          batchQueue = batchQueue.filter(item => item.cb !== cb);
        }
        updateBatchBar();
      });
      article.appendChild(cb);
      batchCheckboxes.set(article, cb);
    });
    updateBatchBar();
  }

  function exitBatchMode() {
    batchMode = false;
    batchQueue = [];
    document.body.classList.remove("fbs-batch-mode");
    if (batchBar) {
      batchBar.classList.remove("fbs-batch-visible");
    }
    // Remove all checkboxes
    document.querySelectorAll(".fbs-batch-checkbox").forEach(cb => cb.remove());
  }

  async function runBatch() {
    if (batchQueue.length === 0) return;
    const items = [...batchQueue];
    exitBatchMode();
    for (let i = 0; i < items.length; i++) {
      const { text, el } = items[i];
      await summarizeText(text, "summary", el);
      // Small delay between items so UI is responsive
      await new Promise(r => setTimeout(r, 800));
    }
  }

  // Alt+B toggles batch mode
  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.key === "b") {
      e.preventDefault();
      if (batchMode) exitBatchMode(); else enterBatchMode();
    }
  });

  // === HIDE SPONSORED POSTS ===
  // Inject one-time CSS for structural clutter (Stories, Reels, Right Rail, etc.)
  function injectClutterCSS() {
    if (document.getElementById("fbs-clutter-css")) return;
    const style = document.createElement("style");
    style.id = "fbs-clutter-css";
    // Các selector ẩn bằng CSS (không cần MutationObserver vì chúng là structural)
    style.textContent = [
      // Stories row (thanh story trên đầu feed)
      'div[data-pagelet="Stories"]',
      'div[data-pagelet*="Stories"]',
      'div[aria-label="Stories"]',
      'div[aria-label="Tin"]',
      // Reels shelf trong feed
      'div[data-pagelet*="Reels"]',
      'div[aria-label="Reels"]',
      'div[aria-label="Thước phim ngắn"]',
      // Watch / Video suggestions
      'div[aria-label="Facebook Watch"]',
      'div[aria-label="Video gợi ý"]',
      // Right rail (sidebar contacts, sponsored, birthdays, etc.)
      'div[data-pagelet="RightRail"]',
      'div[data-pagelet="RightRail2"]',
      'div[data-pagelet="BirthdayNotifications"]',
      'div[data-pagelet="LeftRail"] div[data-pagelet*="sponsored"]',
      // Chat sidebar
      'div[data-pagelet*="Chat"]',
      'div[aria-label="Chat"]',
      'div[aria-label="Danh sách trò chuyện"]',
      // Marketplace widget trong feed
      'div[data-pagelet*="Marketplace"]',
      'div[aria-label="Marketplace"]',
      // Groups you should join widget
      'div[data-pagelet*="GroupsYouShouldJoin"]',
      // "People you may know" widget
      'div[data-pagelet*="PeopleYouMayKnow"]',
    ].join(",\n") + " { display: none !important; }";
    (document.head || document.documentElement).appendChild(style);
  }

  // ── All bad labels ───────────────────────────────────────────────────────
  const ALL_CLUTTER_LABELS = [
    ...SPONSORED_KEYWORDS,
    ...CLUTTER_LABELS,
  ];

  function _matchesClutterLabel(t) {
    return ALL_CLUTTER_LABELS.some(kw =>
      t === kw ||
      t.startsWith(kw + " ") ||
      t.startsWith(kw + "·") ||
      t.startsWith(kw + " ·")
    );
  }

  // Pre-computed whitespace-stripped versions for obfuscated text matching
  // Facebook splits "Được tài trợ" into per-character spans — stripping spaces
  // from both sides lets textContent "Đượctàitrợ" match keyword "được tài trợ"
  const ALL_CLUTTER_LABELS_NORM = ALL_CLUTTER_LABELS.map(kw =>
    kw.replace(/\s+/g, "").toLowerCase()
  );

  function _matchesClutterLabelNorm(normText) {
    return ALL_CLUTTER_LABELS_NORM.some(kw => normText === kw || normText.startsWith(kw));
  }

  // ── Toast ────────────────────────────────────────────────────────────────
  let hiddenClutterCount = 0;
  let clutterToast = null;
  let clutterToastTimer = null;

  function showClutterToast(count) {
    if (!clutterToast) {
      clutterToast = document.createElement("div");
      clutterToast.style.cssText =
        "position:fixed;bottom:72px;right:20px;z-index:2147483641;" +
        "background:rgba(20,10,40,0.92);color:#c9b8ff;font-size:12px;font-weight:600;" +
        "padding:7px 14px;border-radius:20px;border:1px solid rgba(168,85,247,0.35);" +
        "backdrop-filter:blur(6px);pointer-events:none;transition:opacity 0.3s;" +
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;";
      document.body.appendChild(clutterToast);
    }
    clutterToast.textContent = "🧹 Đã ẩn " + count + " phần tử thừa";
    clutterToast.style.opacity = "1";
    clearTimeout(clutterToastTimer);
    clutterToastTimer = setTimeout(() => { if (clutterToast) clutterToast.style.opacity = "0"; }, 2500);
  }

  function _hideWrapper(wrapper) {
    // Walk up to a single-child pass-through parent if present
    let toHide = wrapper;
    const par = wrapper.parentElement;
    if (par && par !== document.body &&
        par.getAttribute("role") !== "feed" &&
        par.getAttribute("role") !== "main" &&
        par.children.length === 1) {
      toHide = par;
    }
    // Smooth collapse: shrink height with CSS transition → then display:none.
    // This prevents the jarring layout jump from instant display:none.
    const h = toHide.offsetHeight;
    toHide.style.cssText += ";overflow:hidden!important;transition:max-height 0.22s ease,opacity 0.18s ease;max-height:" + h + "px;opacity:1";
    // RAF ensures browser paints the starting state before we animate to 0
    requestAnimationFrame(() => {
      toHide.style.maxHeight = "0";
      toHide.style.opacity = "0";
      setTimeout(() => toHide.style.setProperty("display", "none", "important"), 240);
    });
  }

  function hideFeedClutter() {
    if (SITE !== "facebook") return;
    injectClutterCSS();

    let newlyHidden = 0;

    // ── Strategy 1: React portal detection (primary for Facebook) ────────────
    // Facebook renders "Được tài trợ" / clutter labels as React portals:
    //   <div class="__fb-light-mode">
    //     <span id="_r_a2_">Được tài trợ</span>
    //   </div>
    // These portals live directly under <body>, completely detached from the
    // feed DOM. The feed post references them via aria-describedby on a <span>
    // inside a DIV[data-virtualized] post wrapper:
    //   SPAN[aria-describedby="_r_a2_"] → A[role=link] → DIV[data-virtualized]
    // So we: (1) find portals with clutter text, (2) get their span IDs,
    // (3) find the feed element with aria-describedby pointing to that ID,
    // (4) walk up to find DIV[data-virtualized] via findFeedWrapper.
    // Sponsored signals: exact label OR substring inside longer aria text
    // e.g. "Mở menu cho nội dung được tài trợ của Kính Hải Triều Vietnam"
    const SPONSORED_NORM_LIST = SPONSORED_KEYWORDS.map(kw => kw.replace(/\s+/g, "").toLowerCase());
    function _portalIsSponsored(tcNorm) {
      // exact clutter label match
      if (_matchesClutterLabelNorm(tcNorm)) return true;
      // substring: portal text contains a sponsored keyword anywhere
      return SPONSORED_NORM_LIST.some(kw => tcNorm.includes(kw));
    }

    // Scan .__fb-light-mode portals — these are small detached React portals.
    // Match both exact labels ("Được tài trợ") AND portals whose text contains
    // a sponsored keyword as substring, e.g.:
    //   "Mở menu cho nội dung được tài trợ của Kính Hải Triều Vietnam"
    // That portal's ID is on the ··· button inside the sponsored post.
    const portals = document.querySelectorAll(".__fb-light-mode");
    for (const portal of portals) {
      if (portal.dataset.fbsPortalChecked) continue;
      const tcNorm = (portal.textContent || "").replace(/\s+/g, "").toLowerCase();
      // Mark non-sponsored portals immediately so we skip them next scan
      if (tcNorm.length < 2 || !_portalIsSponsored(tcNorm)) {
        portal.dataset.fbsPortalChecked = "1";
        continue;
      }
      // Sponsored portal: try to find the feed post referencing it.
      // Do NOT mark as checked until we successfully hide — the post may not
      // be in the DOM yet (virtual scroll) and we need to retry on next scan.
      const idEls = portal.querySelectorAll("[id]");
      let didHide = false;
      for (const idEl of idEls) {
        if (!idEl.id) continue;
        const qid = JSON.stringify(idEl.id);
        const sel = "[aria-describedby~=" + qid + "],[aria-labelledby~=" + qid + "]";
        let ref;
        try { ref = document.querySelector(sel); } catch (e) { continue; }
        if (!ref) continue;
        const wrapper = findFeedWrapper(ref);
        if (!wrapper) continue; // post not in DOM yet — retry next scan
        if (wrapper.dataset.fbsHidden === "1") { didHide = true; break; } // already hidden
        wrapper.dataset.fbsHidden = "1";
        _hideWrapper(wrapper);
        hiddenClutterCount++;
        newlyHidden++;
        didHide = true;
        break;
      }
      if (didHide) portal.dataset.fbsPortalChecked = "1";
    }

    // ── Strategy 2: aria-label substring scan on elements in the feed ───────
    const SPKW_NORM = SPONSORED_KEYWORDS.map(kw => kw.replace(/\s+/g, "").toLowerCase());
    const roots = (typeof visiblePosts !== "undefined" && visiblePosts.size > 0) ? Array.from(visiblePosts) : [document];
    for (const root of roots) {
      root.querySelectorAll("[aria-label]").forEach(el => {
        if (el.dataset.fbsClutterChecked) return;
        const lbl = (el.getAttribute("aria-label") || "").replace(/\s+/g, "").toLowerCase();
        if (lbl.length < 3 || lbl.length > 120) return;
        if (!SPKW_NORM.some(kw => lbl.includes(kw))) return;
        el.dataset.fbsClutterChecked = "1";
        if (isInNonPostArea(el)) return;
        const wrapper = findFeedWrapper(el);
        if (!wrapper || wrapper.dataset.fbsHidden === "1") return;
        wrapper.dataset.fbsHidden = "1";
        _hideWrapper(wrapper);
        hiddenClutterCount++;
        newlyHidden++;
      });
    }

    // ── Strategy 3: ad link detection ───────────────────────────────────────
    for (const root of roots) {
      const adLinks = root.querySelectorAll(
        'a[href*="/ads/about"], a[href*="about_ads"], a[href*="adchoices"], a[href*="/ads/preferences"]'
      );
      for (const link of adLinks) {
        if (link.dataset.fbsAdLinkChecked) continue;
        link.dataset.fbsAdLinkChecked = "1";
        if (isInNonPostArea(link)) continue;
        const wrapper = findFeedWrapper(link);
        if (!wrapper || wrapper.dataset.fbsHidden === "1") continue;
        wrapper.dataset.fbsHidden = "1";
        _hideWrapper(wrapper);
        hiddenClutterCount++;
        newlyHidden++;
      }
    }

    // ── Strategy 4: CLUTTER_LABELS (Gợi ý, Reels, People you may know, ...) ─
    // Quét text label ngắn trong header của các item feed
    const CLUTTER_LABELS_NORM = CLUTTER_LABELS.map(kw => kw.replace(/\s+/g, "").toLowerCase());
    function _matchesClutter(tcNorm) {
      return CLUTTER_LABELS_NORM.some(kw => tcNorm === kw || tcNorm.startsWith(kw));
    }
    // Check spans/divs trong article headers (h2, h3, h4) hoặc dir="auto" labels
    // Giới hạn scope: chỉ quét trong feed container
    const feed = document.querySelector('[role="feed"]') || document.querySelector('[role="main"]');
    if (feed) {
      const headerCandidates = feed.querySelectorAll('h2 span[dir="auto"], h3 span[dir="auto"], h4 span[dir="auto"], h2 > span, h3 > span, h4 > span');
      for (const el of headerCandidates) {
        if (el.dataset.fbsLabelChecked) continue;
        const text = (el.textContent || "").trim();
        if (text.length < 3 || text.length > 60) continue;
        const tcNorm = text.replace(/\s+/g, "").toLowerCase();
        if (!_matchesClutter(tcNorm)) continue;
        el.dataset.fbsLabelChecked = "1";
        if (isInNonPostArea(el)) continue;
        const wrapper = findFeedWrapper(el);
        if (!wrapper || wrapper.dataset.fbsHidden === "1") continue;
        wrapper.dataset.fbsHidden = "1";
        _hideWrapper(wrapper);
        hiddenClutterCount++;
        newlyHidden++;
      }
    }

    if (newlyHidden > 0) showClutterToast(hiddenClutterCount);
  }

  // Alias for auto-pilot compatibility
  const hideSponsoredPosts = hideFeedClutter;

  // === REDDIT ===
  function scanRedditPosts() {
    const posts = document.querySelectorAll(
      'shreddit-post, div[data-testid="post-container"]',
    );
    for (const post of posts) {
      if (post.dataset.fbsScanned) continue;
      post.dataset.fbsScanned = "1";
      const textEl = post.querySelector(
        '[data-testid="post-content"], .md, [slot="text-body"]',
      );
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
      btn.innerHTML =
        ' <span title="Bóc Link Không Cookie" style="cursor:pointer;display:inline-flex;align-items:center;gap:4px;padding:0px 6px 1px;border-radius:6px;background:rgba(255,107,107,0.15);color:#ff6b6b;font-size:0.85em;font-weight:bold;margin-left:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>Bóc Link</span>';
      btn.querySelector("span").addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        chrome.runtime
          .sendMessage({ action: "unshorten-shopee-inline", url: a.href })
          .catch(() => {});
      });
      a.insertAdjacentElement("afterend", btn);
    }
  }

  function scan() {
    if (!isContextValid() || isBlocked) return;
    if (SITE === "reddit") scanRedditPosts();
    hideFeedClutter();
    findNewSeeMoreElements().forEach(processSeeMore);
    scanFBAllPosts();
    scanCommentSections();
    scanShopeeLinks();
  }

  function debouncedScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 200);
  }

  scan();
  setTimeout(scan, 500);
  setTimeout(scan, 1500);

  // Fast-path clutter observer: fires hideFeedClutter() immediately (no debounce)
  // whenever either:
  //   (a) a .__fb-light-mode portal is added — sponsored label just became available
  //   (b) a data-virtualized feed post is added — check if its portal already exists
  // React renders post + portal in the same synchronous batch, so by the time
  // MutationObserver fires, both are in the DOM. We just need to act fast.
  let clutterPending = false;
  const clutterObserver = new MutationObserver((mutations) => {
    if (SITE !== "facebook" || clutterPending) return;
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        const isPortal = node.classList.contains("__fb-light-mode");
        const isPost = node.hasAttribute?.("data-virtualized");
        const hasPortal = !isPortal && node.querySelector?.(".__fb-light-mode");
        if (isPortal || isPost || hasPortal) {
          // Batch multiple rapid additions into a single hideFeedClutter call
          clutterPending = true;
          requestAnimationFrame(() => {
            clutterPending = false;
            hideFeedClutter();
          });
          return;
        }
      }
    }
  });
  clutterObserver.observe(document.body, { childList: true, subtree: true });
  observers.push(clutterObserver);

  const scanObserver = new MutationObserver(() => debouncedScan());
  scanObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
  observers.push(scanObserver);
  scanTimer = setInterval(scan, 5000);
})();
