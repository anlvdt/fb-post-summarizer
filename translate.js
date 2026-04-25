// FeedWriter — Double-click English → Vietnamese translator
// Runs on ALL web pages
// https://github.com/anlvdt/fb-post-summarizer
// Author: Le An (anlvdt)

(function () {
  "use strict";
  if (window.__feedwriter_translate_loaded) return;
  window.__feedwriter_translate_loaded = true;

  let translateTooltip = null;

  function isContextValid() {
    try { return !!chrome.runtime?.id; } catch (e) { return false; }
  }

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function createTranslateTooltip() {
    if (translateTooltip) return;
    translateTooltip = document.createElement("div");
    translateTooltip.className = "fbs-translate-tooltip";
    document.body.appendChild(translateTooltip);
  }

  function hideTranslateTooltip() {
    if (translateTooltip) translateTooltip.classList.remove("fbs-visible");
  }

  function showTranslateTooltip(text, rect) {
    createTranslateTooltip();
    translateTooltip.innerHTML = '<div class="fbs-translate-loading"><div class="fbs-spinner" style="width:14px;height:14px;border-width:2px"></div> Đang dịch...</div>';

    const top = rect.bottom + window.scrollY + 6;
    const left = rect.left + window.scrollX + (rect.width / 2) - 120;
    translateTooltip.style.top = top + "px";
    translateTooltip.style.left = Math.max(8, left) + "px";
    translateTooltip.classList.add("fbs-visible");

    chrome.runtime.sendMessage({ action: "translate-word", word: text }, (resp) => {
      if (!translateTooltip || !translateTooltip.classList.contains("fbs-visible")) return;
      if (chrome.runtime.lastError || !resp) {
        translateTooltip.innerHTML = '<div class="fbs-translate-error">Không dịch được</div>';
        return;
      }
      if (resp.error) {
        translateTooltip.innerHTML = '<div class="fbs-translate-error">' + esc(resp.error) + '</div>';
        return;
      }
      const word = esc(resp.word || text);
      const translation = esc(resp.translation || "").replace(/\n/g, "<br>");
      translateTooltip.innerHTML =
        '<div class="fbs-translate-word">' + word + '</div>' +
        '<div class="fbs-translate-result">' + translation + '</div>' +
        '<button class="fbs-translate-copy" title="Copy">Copy</button>';

      translateTooltip.querySelector(".fbs-translate-copy").addEventListener("click", (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(resp.translation || "").then(() => {
          e.target.textContent = "✓";
          setTimeout(() => { e.target.textContent = "Copy"; }, 1000);
        });
      });
    });
  }

  function isEnglishWord(text) {
    return /^[a-zA-Z][-a-zA-Z']{1,30}$/.test(text) || /^[a-zA-Z][-a-zA-Z' ]{1,50}$/.test(text);
  }

  document.addEventListener("dblclick", (e) => {
    if (e.target.closest(".fbs-panel, .fbs-floating-toolbar, .fbs-translate-tooltip")) return;

    const selection = window.getSelection();
    const text = selection.toString().trim();

    if (!text || !isEnglishWord(text)) {
      hideTranslateTooltip();
      return;
    }

    if (!isContextValid()) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    showTranslateTooltip(text, rect);
  });

  document.addEventListener("mousedown", (e) => {
    if (translateTooltip && !translateTooltip.contains(e.target)) {
      hideTranslateTooltip();
    }
  });
  document.addEventListener("scroll", hideTranslateTooltip, { capture: true, passive: true });
})();
