(function () {
  "use strict";

  let MIN_LEN = 400;
  let scanTimer = null;
  const injected = new WeakSet();

  chrome.storage.sync.get("minLength", (d) => {
    if (d.minLength) MIN_LEN = d.minLength;
  });

  const SEE_MORE = [
    "xem thêm", "see more", "voir plus", "mehr anzeigen",
    "もっと見る", "더 보기", "ver más", "ver mais",
  ];

  function findNewSeeMoreElements() {
    const results = [];
    const els = document.querySelectorAll("div, span");
    for (const el of els) {
      if (el.dataset.fbsScanned) continue;
      if (el.children.length > 3) continue;
      const t = (el.textContent || "").trim().toLowerCase();
      if (t.length > 30 || t.length < 4) continue;
      if (SEE_MORE.includes(t)) {
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
      const pos = getComputedStyle(p).position;
      if (pos === "fixed" || pos === "sticky") return true;
    }
    return false;
  }

  function findClickable(el) {
    let p = el;
    for (let i = 0; i < 5; i++) {
      if (!p) return el;
      if (p.getAttribute("role") === "button" || p.tagName === "A") return p;
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
    return text.replace(
      /\s*(Xem thêm|See more|Voir plus|Mehr anzeigen|もっと見る|더 보기|Ver más|Ver mais)\s*$/i, ""
    ).trim();
  }

  // UI
  let backdrop = null, activePanel = null;

  function getBackdrop() {
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.className = "fbs-backdrop";
      document.body.appendChild(backdrop);
      backdrop.addEventListener("click", closeOverlay);
    }
    return backdrop;
  }

  function closeOverlay() {
    if (activePanel) { activePanel.classList.remove("fbs-visible"); activePanel = null; }
    if (backdrop) backdrop.classList.remove("fbs-visible");
  }

  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeOverlay(); });

  function createBtn() {
    const d = document.createElement("div");
    d.className = "fbs-btn";
    d.setAttribute("role", "button");
    d.setAttribute("tabindex", "0");
    d.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
      '<polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/>' +
      '<line x1="16" y1="17" x2="8" y2="17"/></svg><span>Tóm tắt</span>';
    return d;
  }

  function createPanel() {
    const d = document.createElement("div");
    d.className = "fbs-panel";
    document.body.appendChild(d);
    d.innerHTML =
      '<div class="fbs-panel-head"><span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> Tóm tắt AI</span>' +
      '<div class="fbs-close" role="button" tabindex="0">✕</div></div>' +
      '<div class="fbs-panel-body"></div>';
    return d;
  }

  function fmt(t) {
    return t.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/^[-•]\s*/gm, "• ").replace(/\n/g, "<br>");
  }

  function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

  function inject(target, postText) {
    if (injected.has(target)) return;
    if (target.querySelector(".fbs-wrap")) return;
    injected.add(target);

    const wrap = document.createElement("div");
    wrap.className = "fbs-wrap";
    wrap.appendChild(createBtn());

    const pos = getComputedStyle(target).position;
    if (pos === "static" || pos === "") target.style.position = "relative";
    target.appendChild(wrap);

    const panel = createPanel();
    const body = panel.querySelector(".fbs-panel-body");
    let loaded = false;

    panel.querySelector(".fbs-close").addEventListener("click", closeOverlay);

    wrap.querySelector(".fbs-btn").addEventListener("click", async () => {
      closeOverlay();
      activePanel = panel;
      getBackdrop().classList.add("fbs-visible");
      panel.classList.add("fbs-visible");
      if (loaded) return;

      body.innerHTML = '<div class="fbs-loading"><div class="fbs-spinner"></div><span>Đang tóm tắt...</span></div>';
      try {
        const r = await chrome.runtime.sendMessage({ action: "summarize", text: postText });
        if (r && r.error) { body.innerHTML = '<div class="fbs-error">' + esc(r.error) + '</div>'; }
        else if (r && r.summary) { loaded = true; body.innerHTML = '<div class="fbs-result">' + fmt(r.summary) + '</div>'; }
        else { body.innerHTML = '<div class="fbs-error">Không nhận được phản hồi.</div>'; }
      } catch (e) { body.innerHTML = '<div class="fbs-error">Lỗi: ' + esc(e.message) + '</div>'; }
    });
  }

  function processSeeMore(sm) {
    const textContainer = findTextContainer(sm);
    if (!textContainer) return;
    if ((textContainer.innerText || "").trim().length < 150) return;

    const target = findInjectTarget(textContainer);
    if (injected.has(target) || target.querySelector(".fbs-wrap")) return;

    const clickable = findClickable(sm);
    try { clickable.click(); } catch (e) {}

    setTimeout(() => {
      const text = cleanText(textContainer.innerText || "");
      if (text.length >= MIN_LEN) inject(target, text);
    }, 700);
  }

  function scan() {
    const seeMoreEls = findNewSeeMoreElements();
    seeMoreEls.forEach(processSeeMore);
  }

  function debouncedScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 1500);
  }

  setTimeout(scan, 2000);
  setTimeout(scan, 5000);
  new MutationObserver(() => debouncedScan()).observe(document.body, { childList: true, subtree: true });
  setInterval(scan, 8000);
  console.log("[FBS] ✅ Loaded");
})();
