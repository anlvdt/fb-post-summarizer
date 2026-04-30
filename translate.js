// FeedWriter — Double-click English → Vietnamese translator
// Runs on ALL web pages
// https://github.com/anlvdt/fb-post-summarizer
// Author: Le An (anlvdt)

(function () {
  "use strict";
  if (window.__feedwriter_translate_loaded) return;
  window.__feedwriter_translate_loaded = true;

  let translateTooltip = null;
  let lastClickTime = 0;
  const DEBOUNCE_DELAY = 300; // ms

  function isContextValid() {
    try {
      return !!chrome.runtime?.id;
    } catch (e) {
      return false;
    }
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
    translateTooltip.innerHTML =
      '<div class="fbs-translate-loading"><div class="fbs-spinner" style="width:14px;height:14px;border-width:2px"></div> Đang dịch...</div>';

    // Optimize tooltip positioning - check viewport boundaries
    const tooltipWidth = 240;
    const tooltipHeight = 100; // estimated
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let top = rect.bottom + window.scrollY + 6;
    let left = rect.left + window.scrollX + rect.width / 2 - tooltipWidth / 2;

    // Adjust horizontal position if overflow
    if (left + tooltipWidth > viewportWidth + window.scrollX) {
      left = viewportWidth + window.scrollX - tooltipWidth - 8;
    }
    left = Math.max(8, left);

    // Adjust vertical position if overflow (show above selection)
    if (rect.bottom + tooltipHeight > viewportHeight) {
      top = rect.top + window.scrollY - tooltipHeight - 6;
    }

    translateTooltip.style.top = top + "px";
    translateTooltip.style.left = left + "px";
    translateTooltip.classList.add("fbs-visible");

    // Error handling for chrome.runtime.sendMessage
    try {
      chrome.runtime.sendMessage(
        { action: "translate-word", word: text },
        (resp) => {
          // Check if context is still valid
          if (chrome.runtime.lastError) {
            console.warn(
              "[Translate] Runtime error:",
              chrome.runtime.lastError.message,
            );
            if (
              translateTooltip &&
              translateTooltip.classList.contains("fbs-visible")
            ) {
              translateTooltip.innerHTML =
                '<div class="fbs-translate-error">Không kết nối được</div>';
            }
            return;
          }

          if (
            !translateTooltip ||
            !translateTooltip.classList.contains("fbs-visible")
          )
            return;

          if (!resp) {
            translateTooltip.innerHTML =
              '<div class="fbs-translate-error">Không nhận được phản hồi</div>';
            return;
          }

          if (resp.error) {
            translateTooltip.innerHTML =
              '<div class="fbs-translate-error">' + esc(resp.error) + "</div>";
            return;
          }

          const word = esc(resp.word || text);
          const translation = esc(resp.translation || "").replace(
            /\n/g,
            "<br>",
          );
          translateTooltip.innerHTML =
            '<div class="fbs-translate-word">' +
            word +
            "</div>" +
            '<div class="fbs-translate-result">' +
            translation +
            "</div>" +
            '<button class="fbs-translate-copy" title="Copy">Copy</button>';

          const copyBtn = translateTooltip.querySelector(".fbs-translate-copy");
          if (copyBtn) {
            copyBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              navigator.clipboard
                .writeText(resp.translation || "")
                .then(() => {
                  e.target.textContent = "✓";
                  setTimeout(() => {
                    e.target.textContent = "Copy";
                  }, 1000);
                })
                .catch((err) => {
                  console.warn("[Translate] Copy failed:", err);
                });
            });
          }
        },
      );
    } catch (err) {
      console.error("[Translate] Failed to send message:", err);
      if (
        translateTooltip &&
        translateTooltip.classList.contains("fbs-visible")
      ) {
        translateTooltip.innerHTML =
          '<div class="fbs-translate-error">Lỗi hệ thống</div>';
      }
    }
  }

  function isEnglishWord(text) {
    return (
      /^[a-zA-Z][-a-zA-Z']{1,30}$/.test(text) ||
      /^[a-zA-Z][-a-zA-Z' ]{1,50}$/.test(text)
    );
  }

  document.addEventListener("dblclick", (e) => {
    // Debounce double-click events
    const now = Date.now();
    if (now - lastClickTime < DEBOUNCE_DELAY) {
      return;
    }
    lastClickTime = now;

    if (
      e.target.closest(
        ".fbs-panel, .fbs-floating-toolbar, .fbs-translate-tooltip",
      )
    )
      return;

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

    // Wake service worker before sending message (MV3 SW may be asleep)
    try {
      chrome.runtime.sendMessage({ action: "ping" }, () => {
        if (chrome.runtime.lastError) {
          console.warn(
            "[Translate] Service worker unavailable:",
            chrome.runtime.lastError.message,
          );
          return;
        }
        showTranslateTooltip(text, rect);
      });
    } catch (err) {
      console.error("[Translate] Failed to ping service worker:", err);
    }
  });

  document.addEventListener("mousedown", (e) => {
    if (translateTooltip && !translateTooltip.contains(e.target)) {
      hideTranslateTooltip();
    }
  });
  document.addEventListener("scroll", hideTranslateTooltip, {
    capture: true,
    passive: true,
  });

  // Cleanup tooltip DOM when extension is reloaded/invalidated
  try {
    const port = chrome.runtime.connect({ name: "translate-keepalive" });
    port.onDisconnect.addListener(() => {
      if (translateTooltip) {
        translateTooltip.remove();
        translateTooltip = null;
      }
    });
  } catch (_) {}
})();
