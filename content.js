(function () {
  "use strict";

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
    const els = root.querySelectorAll("div, span, button");
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
      if (len >= 100 && len < 4000) best = el;
      if (len >= 4000) break;
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

  function cleanText(text) {
    const patterns = [...SEE_MORE, "show less", "ẩn bớt", "see less"];
    let t = text;
    for (const p of patterns) {
      const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      t = t.replace(new RegExp("\\s*" + escaped + "\\s*$", "i"), "");
    }
    return t.trim();
  }

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
      '<div class="fbs-panel-head"><span><svg width="16" height="16" viewBox="0 0 128 128" fill="currentColor"><path d="M64 14 C36.4 14 14 36.4 14 64 C14 74.3 17.1 84 22.4 92 L28.8 85.6 C25.1 79.2 23 71.8 23 64 C23 41.3 41.3 23 64 23 C68.8 23 73.4 23.8 77.7 25.4 L68 34 L96 38 L94 10 L84.4 18.6 C78.1 15.6 71.2 14 64 14 Z"/><path d="M104.6 36 L98.2 42.4 C101.9 48.8 104 56.2 104 64 C104 86.7 85.7 105 64 105 C59.2 105 54.6 104.2 50.3 102.6 L60 94 L32 90 L34 118 L43.6 109.4 C49.9 112.4 56.8 114 64 114 C91.6 114 114 91.6 114 64 C114 53.7 110.9 44 105.6 36 Z"/><path d="M64 36 C64 54 54 64 36 64 C54 64 64 74 64 92 C64 74 74 64 92 64 C74 64 64 54 64 36 Z"/></svg> <span class="fbs-title-text">Tóm tắt AI</span></span>' +
      '<div class="fbs-close" role="button" tabindex="0">&#10005;</div></div>' +
      '<div class="fbs-panel-body"></div>' +
      '<div class="fbs-panel-footer">' +
      '<button class="fbs-tts-btn" title="Đọc"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg></button>' +
      '<button class="fbs-stop-btn">Dừng</button>' +
      '<button class="fbs-regen-btn" title="Viết lại"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M21 13a9 9 0 1 1-3-7.7L21 8"/></svg></button>' +
      '<button class="fbs-copy-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy</button>' +
      '</div>';
    document.body.appendChild(panel);
    panelBody = panel.querySelector(".fbs-panel-body");
    panel.querySelector(".fbs-close").addEventListener("click", closeOverlay);
    panel.querySelector(".fbs-copy-btn").addEventListener("click", copyResult);
    panel.querySelector(".fbs-stop-btn").addEventListener("click", stopSummarize);
    panel.querySelector(".fbs-tts-btn").addEventListener("click", toggleTTS);
    panel.querySelector(".fbs-regen-btn").addEventListener("click", regenerate);
  }

  let lastSummarizeParams = null;
  function regenerate() {
    if (!lastSummarizeParams) return;
    const { text, type } = lastSummarizeParams;
    const key = hashText(text) + "_" + type;
    summaryCache.delete(key);
    summarizeText(text, type);
  }

  function openOverlay(html, streaming, type = "summary") {
    ensureOverlay();
    const titleText = panel.querySelector(".fbs-title-text");
    if (titleText) titleText.textContent = type === "affiliate" ? "Chế bài Affiliate" : "Viết Status MXH";
    panelBody.innerHTML = html;
    backdrop.classList.add("fbs-visible");
    panel.classList.add("fbs-visible");
    const footer = panel.querySelector(".fbs-panel-footer");
    const hasContent = html.includes("fbs-result") || html.includes("fbs-loading") || streaming;
    footer.style.display = hasContent ? "flex" : "none";
    panel.querySelector(".fbs-stop-btn").style.display = (isSummarizing || streaming) ? "inline-flex" : "none";
    panel.querySelector(".fbs-copy-btn").style.display = (!isSummarizing && !streaming) ? "inline-flex" : "none";
    panel.querySelector(".fbs-regen-btn").style.display = (!isSummarizing && !streaming) ? "inline-flex" : "none";
    panel.querySelector(".fbs-tts-btn").style.display = (!isSummarizing && !streaming && html.includes("fbs-result")) ? "inline-flex" : "none";
    if (streaming && panelBody.scrollHeight - panelBody.scrollTop < 500) panelBody.scrollTop = panelBody.scrollHeight;
  }

  function closeOverlay() {
    stopSummarize();
    if (speechSynthesis.speaking) speechSynthesis.cancel();
    if (panel) panel.classList.remove("fbs-visible");
    if (backdrop) backdrop.classList.remove("fbs-visible");
    const tts = panel?.querySelector(".fbs-tts-btn");
    if (tts) tts.classList.remove("fbs-playing");
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
    const text = panelBody?.innerText || "";
    navigator.clipboard.writeText(text).then(() => {
      const btn = panel.querySelector(".fbs-copy-btn");
      const orig = btn.innerHTML;
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied';
      setTimeout(() => { btn.innerHTML = orig; }, 1500);
    });
  }

  function toggleTTS() {
    const btn = panel.querySelector(".fbs-tts-btn");
    if (speechSynthesis.speaking) { speechSynthesis.cancel(); btn.classList.remove("fbs-playing"); return; }
    const text = panelBody?.innerText || "";
    if (!text) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "vi-VN"; u.rate = 1.1;
    u.onend = () => btn.classList.remove("fbs-playing");
    speechSynthesis.speak(u);
    btn.classList.add("fbs-playing");
  }

  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeOverlay(); });

  // === HELPERS ===
  function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
  function fmt(t) {
    return esc(t)
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/^[-•]\s*/gm, "• ").replace(/\n/g, "<br>");
  }

  // === BUTTONS ===
  function createBtn() {
    const d = document.createElement("div");
    d.className = "fbs-btn";
    d.setAttribute("role", "button");
    d.setAttribute("tabindex", "0");
    d.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 128 128" fill="currentColor">' +
      '<path d="M64 14 C36.4 14 14 36.4 14 64 C14 74.3 17.1 84 22.4 92 L28.8 85.6 C25.1 79.2 23 71.8 23 64 C23 41.3 41.3 23 64 23 C68.8 23 73.4 23.8 77.7 25.4 L68 34 L96 38 L94 10 L84.4 18.6 C78.1 15.6 71.2 14 64 14 Z"/>' +
      '<path d="M104.6 36 L98.2 42.4 C101.9 48.8 104 56.2 104 64 C104 86.7 85.7 105 64 105 C59.2 105 54.6 104.2 50.3 102.6 L60 94 L32 90 L34 118 L43.6 109.4 C49.9 112.4 56.8 114 64 114 C91.6 114 114 91.6 114 64 C114 53.7 110.9 44 105.6 36 Z"/>' +
      '<path d="M64 36 C64 54 54 64 36 64 C54 64 64 74 64 92 C64 74 74 64 92 64 C74 64 64 54 64 36 Z"/></svg><span title="Click: Viết Status | Shift+Click: Affiliate"> Tóm tắt</span>';
    return d;
  }

  function createInlineBtn() {
    const d = document.createElement("span");
    d.className = "fbs-btn-inline";
    d.setAttribute("role", "button");
    d.setAttribute("tabindex", "0");
    d.style.cssText = "cursor:pointer;font-size:inherit;font-family:inherit;background:none;border:none;padding:0;margin:0;display:inline;line-height:inherit;vertical-align:baseline;";
    d.innerHTML = ' · <span title="Click: Viết Status | Shift+Click: Affiliate" style="cursor:pointer;display:inline-flex;align-items:center;gap:3px;vertical-align:baseline;color:#4fc3f7;font-weight:600;font-size:0.92em;background:rgba(79,195,247,0.13);padding:0px 6px 1px;border-radius:8px;transition:background 0.15s"><svg style="width:11px;height:11px;vertical-align:-1px;flex-shrink:0;fill:#4fc3f7" viewBox="0 0 128 128"><path d="M64 14 C36.4 14 14 36.4 14 64 C14 74.3 17.1 84 22.4 92 L28.8 85.6 C25.1 79.2 23 71.8 23 64 C23 41.3 41.3 23 64 23 C68.8 23 73.4 23.8 77.7 25.4 L68 34 L96 38 L94 10 L84.4 18.6 C78.1 15.6 71.2 14 64 14 Z"/><path d="M104.6 36 L98.2 42.4 C101.9 48.8 104 56.2 104 64 C104 86.7 85.7 105 64 105 C59.2 105 54.6 104.2 50.3 102.6 L60 94 L32 90 L34 118 L43.6 109.4 C49.9 112.4 56.8 114 64 114 C91.6 114 114 91.6 114 64 C114 53.7 110.9 44 105.6 36 Z"/><path d="M64 36 C64 54 54 64 36 64 C54 64 64 74 64 92 C64 74 74 64 92 64 C74 64 64 54 64 36 Z"/></svg>Tóm tắt</span>';
    const pill = d.querySelector("span");
    d.addEventListener("mouseenter", () => { pill.style.background = "rgba(79,195,247,0.28)"; });
    d.addEventListener("mouseleave", () => { pill.style.background = "rgba(79,195,247,0.13)"; });
    return d;
  }

  // === STREAMING SUMMARIZE ===
  async function wakeServiceWorker() {
    try { await chrome.runtime.sendMessage({ action: "ping" }); } catch (_) { }
  }

  async function summarizeText(text, type = "summary") {
    if (!text || text.length < 50) {
      openOverlay('<div class="fbs-error">Text quá ngắn để tóm tắt.</div>', false);
      return;
    }
    const key = hashText(text) + "_" + type;
    if (summaryCache.has(key)) {
      openOverlay('<div class="fbs-result">' + fmt(summaryCache.get(key)) + '</div>', false, type);
      return;
    }
    if (!isContextValid()) {
      openOverlay('<div class="fbs-error">Extension đã cập nhật. Vui lòng F5.</div>', false, type);
      return;
    }

    lastSummarizeParams = { text, type };
    isSummarizing = true;
    const title = type === "affiliate" ? "Đang viết bài Affiliate..." : "Đang viết Status...";
    openOverlay('<div class="fbs-loading"><div class="fbs-spinner"></div><span>' + title + '</span></div>', false, type);

    // Wake SW before connecting port (MV3 SW dies after ~30s idle)
    await wakeServiceWorker();
    currentPort = chrome.runtime.connect({ name: "summarize-stream" });
    currentPort.postMessage({ action: "summarize", text, site: SITE, type });

    let first = true;
    currentPort.onMessage.addListener((msg) => {
      if (msg.action === "chunk") {
        if (first) { first = false; }
        openOverlay('<div class="fbs-result">' + fmt(msg.full) + '<span class="fbs-cursor"></span></div>', true);
      } else if (msg.action === "done") {
        isSummarizing = false;
        summaryCache.set(key, msg.full);
        openOverlay('<div class="fbs-result">' + fmt(msg.full) + '</div>', false);
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
    if (msg.action === "summarize-selection" && msg.text) summarizeText(msg.text, msg.type);
    if (msg.action === "shortcut-summarize-shortcut" || msg.action === "shortcut-affiliate-shortcut") {
      const text = window.getSelection().toString();
      if (text) summarizeText(text, msg.action.includes("affiliate") ? "affiliate" : "summary");
      else alert("Vui lòng bôi đen đoạn văn bản trước khi bấm Hotkey!");
    }
    if (msg.action === "unshorten-result") {
      if (msg.error) {
        alert(msg.error);
      } else if (msg.text) {
        navigator.clipboard.writeText(msg.text)
          .catch(() => alert("Lỗi ghi clipboard. Link gốc là:\n\n" + msg.text));
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
      const type = e.shiftKey ? "affiliate" : "summary";
      const title = type === "affiliate" ? "Đang viết bài Affiliate..." : "Đang viết Status...";
      openOverlay('<div class="fbs-loading"><div class="fbs-spinner"></div><span>' + title + '</span></div>', false, type);

      // Expand to get full text
      if (seeMoreClickable) {
        try { seeMoreClickable.click(); } catch (_) { }
        await new Promise(r => setTimeout(r, 800));
      }

      const text = cleanText((textContainer || target).innerText || "");

      // Try to collapse back by clicking "See less" / "Ẩn bớt"
      if (textContainer) {
        const collapseBtn = Array.from(textContainer.querySelectorAll('div[role="button"], span'))
          .find(el => {
            const t = (el.textContent || "").trim().toLowerCase();
            return t === "ẩn bớt" || t === "see less" || t === "show less";
          });
        if (collapseBtn) try { collapseBtn.click(); } catch (_) { }
      }

      await summarizeText(text, type);
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
    floatingToolbar.innerHTML = '<button class="fbs-floating-btn fbs-btn-highlight" data-action="summary"><svg width="13" height="13" viewBox="0 0 128 128" fill="currentColor"><path d="M64 14 C36.4 14 14 36.4 14 64 C14 74.3 17.1 84 22.4 92 L28.8 85.6 C25.1 79.2 23 71.8 23 64 C23 41.3 41.3 23 64 23 C68.8 23 73.4 23.8 77.7 25.4 L68 34 L96 38 L94 10 L84.4 18.6 C78.1 15.6 71.2 14 64 14 Z"/><path d="M104.6 36 L98.2 42.4 C101.9 48.8 104 56.2 104 64 C104 86.7 85.7 105 64 105 C59.2 105 54.6 104.2 50.3 102.6 L60 94 L32 90 L34 118 L43.6 109.4 C49.9 112.4 56.8 114 64 114 C91.6 114 114 91.6 114 64 C114 53.7 110.9 44 105.6 36 Z"/><path d="M64 36 C64 54 54 64 36 64 C54 64 64 74 64 92 C64 74 74 64 92 64 C74 64 64 54 64 36 Z"/></svg> Tóm tắt</button><button class="fbs-floating-btn" data-action="affiliate"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg> Affiliate</button>';
    document.body.appendChild(floatingToolbar);

    floatingToolbar.addEventListener("mousedown", (e) => e.preventDefault());
    floatingToolbar.addEventListener("click", (e) => {
      e.preventDefault();
      const action = e.target.getAttribute("data-action");
      if (!action) return;
      const text = window.getSelection().toString().trim();
      if (text) {
        floatingToolbar.classList.remove("fbs-visible");
        summarizeText(text, action);
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
      if (text.length < 15) {
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
      btn.innerHTML = ' <span title="Bóc Link Không Cookie" style="cursor:pointer;display:inline-flex;align-items:center;padding:0px 6px 1px;border-radius:6px;background:rgba(255,107,107,0.15);color:#ff6b6b;font-size:0.85em;font-weight:bold;margin-left:4px;">🛒 Bóc Link</span>';
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
    scanTimer = setTimeout(scan, 50);
  }

  scan();
  setTimeout(scan, 300);
  setTimeout(scan, 700);
  setTimeout(scan, 1200);
  setTimeout(scan, 2000);
  new MutationObserver(() => debouncedScan()).observe(document.body, { childList: true, subtree: true });
  setInterval(scan, 2500);
})();
