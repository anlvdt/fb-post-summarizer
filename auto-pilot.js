// auto-pilot.js - FeedWriter Autonomous Agent
// Injected alongside content.js to enable 100% autonomous Facebook posting

(function() {
  let isAgentRunning = false;
  let postedUrls = new Set();

  // Add Toggle Button to UI
  function createAgentUI() {
    const ui = document.createElement('div');
    ui.id = "fbs-agent-ui";
    ui.style.cssText = "position:fixed;bottom:90px;right:16px;z-index:2147483647;background:var(--secondary-button-background, #4b4c4f);color:var(--primary-text, #e4e6eb);width:48px;height:48px;border-radius:50%;font-family:sans-serif;font-size:10px;font-weight:bold;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;cursor:pointer;user-select:none;box-shadow:0 2px 8px rgba(0,0,0,0.4);transition:all 0.2s ease;";
    
    ui.innerHTML = `
      <div id="fbs-agent-status" style="width:12px;height:12px;border-radius:50%;background:#d63031;"></div>
      <span id="fbs-agent-text" style="font-weight:600;line-height:1.2;">OFF</span>
    `;

    ui.addEventListener('click', () => {
      isAgentRunning = !isAgentRunning;
      const status = document.getElementById("fbs-agent-status");
      const text = document.getElementById("fbs-agent-text");
      
      if (isAgentRunning) {
        status.style.background = "#00b894";
        status.style.boxShadow = "0 0 8px #00b894";
        text.innerText = "SCAN";
        startAgent();
      } else {
        status.style.background = "#d63031";
        status.style.boxShadow = "none";
        text.innerText = "OFF";
        stopAgent();
      }
    });

    document.body.appendChild(ui);
  }

  // State machine: SCANNING → WAITING_SUMMARY → WAITING_EVAL → EXECUTING → SCANNING
  // SLEEPING: outside golden hours
  let state = "SCANNING";
  let currentPost = null;
  let lastPostTime = 0;
  let stateEnteredAt = 0; // Timestamp khi vào state hiện tại
  const MIN_POST_INTERVAL_MS = 3 * 60 * 1000; // Tối thiểu 3 phút giữa 2 lần post
  const SUMMARY_TIMEOUT_MS  = 90 * 1000;       // Tối đa 90s chờ tóm tắt (Gemini chậm + bài dài)
  const EVAL_TIMEOUT_MS     = 30 * 1000;       // Tối đa 30s chờ AI eval (SW có thể bị kill)

  function updateStatus(text, color) {
    const status = document.getElementById("fbs-agent-status");
    const label = document.getElementById("fbs-agent-text");
    if (status) { status.style.background = color; status.style.boxShadow = color !== "#d63031" ? "0 0 6px " + color : "none"; }
    if (label) label.innerText = text;
  }

  function isGoldenHour() {
    const d = new Date();
    const t = d.getHours() + d.getMinutes() / 60;
    if (t >= 7 && t < 9) return true;
    if (t >= 11 && t < 13.5) return true;
    if (t >= 19 && t < 24) return true;
    return false;
  }

  let loopTimer = null;

  function runAgentLoop() {
    if (!isAgentRunning) return;

    if (!isGoldenHour()) {
      state = "SLEEPING";
      updateStatus("SLEEP", "#6c5ce7");
      loopTimer = setTimeout(runAgentLoop, 60000);
      return;
    }

    // Đang chờ AI hoặc đang thực thi → poll lại sau 2s, nhưng có timeout guard
    if (state === "WAITING_EVAL" || state === "EXECUTING") {
      const elapsed = Date.now() - stateEnteredAt;
      if (state === "WAITING_EVAL" && elapsed > EVAL_TIMEOUT_MS) {
        console.warn("[Agent] WAITING_EVAL timeout — background SW có thể bị kill. Reset về SCANNING.");
        document.querySelector(".fbs-close")?.click();
        state = "SCANNING";
        updateStatus("SCAN", "#00b894");
      } else {
        loopTimer = setTimeout(runAgentLoop, 2000);
        return;
      }
    }

    let nextDelay = 5000 + Math.random() * 5000;

    if (state === "SLEEPING" || state === "SCANNING") {
      state = "SCANNING";
      updateStatus("SCAN", "#00b894");
      
      const buttons = document.querySelectorAll('.fbs-btn-inline:not([data-agent-clicked])');
      let targetBtn = null;
      
      for (const btn of buttons) {
        btn.setAttribute('data-agent-clicked', 'true');
        const postNode = btn.closest('[role="article"]') || btn.closest('div[data-ad-preview="message"]') || btn.parentElement;
        if (!postNode) continue;

        // Bỏ qua bài do chính tài khoản này đăng
        try {
          const author = typeof window.fbsExtractAuthor === "function" ? window.fbsExtractAuthor(postNode) : "";
          const navProfile = document.querySelector('svg[aria-label="Trang cá nhân"]')?.closest('a') || document.querySelector('a[href^="/me/"]');
          if (author && navProfile && navProfile.innerText && author === navProfile.innerText.trim()) {
            console.log("[Agent] Bỏ qua bài của chính mình:", author);
            continue;
          }
        } catch(e) { console.warn("[Agent] Lỗi check own-post:", e); }

        // Bỏ qua bài đã đăng
        try {
          const rawUrl = typeof window.fbsExtractPermalink === "function" ? window.fbsExtractPermalink(postNode) : "";
          if (rawUrl && postedUrls.has(rawUrl)) {
            console.log("[Agent] Bỏ qua bài đã đăng:", rawUrl);
            continue;
          }
        } catch(e) { console.warn("[Agent] Lỗi check history:", e); }

        targetBtn = btn;
        currentPost = postNode;
        break;
      }

      if (targetBtn) {
        targetBtn.scrollIntoView({ behavior: "smooth", block: "center" });
        
        const readDelay = 4000 + Math.random() * 4000;
        setTimeout(() => {
          if (!isAgentRunning) return;
          targetBtn.click();
          state = "WAITING_SUMMARY";
          stateEnteredAt = Date.now();
          updateStatus("SUM", "#0984e3");
        }, readDelay);
        
        nextDelay = readDelay + 2000;
      } else {
        // Cuộn chậm như người lướt thật
        const distance = window.innerHeight * (0.2 + Math.random() * 0.3);
        window.scrollBy({ top: distance, behavior: 'smooth' });
      }
    } 
    else if (state === "WAITING_SUMMARY") {
      // Timeout guard: nếu chờ quá lâu mà panel không hiện → reset
      if (Date.now() - stateEnteredAt > SUMMARY_TIMEOUT_MS) {
        console.warn("[Agent] WAITING_SUMMARY timeout — panel không mở. Reset về SCANNING.");
        document.querySelector(".fbs-close")?.click();
        state = "SCANNING";
        updateStatus("SCAN", "#00b894");
        loopTimer = setTimeout(runAgentLoop, 3000);
        return;
      }

      const copyBtn = document.querySelector(".fbs-copy-btn");
      const panel = document.querySelector(".fbs-panel");
      
      if (copyBtn && copyBtn.style.display !== "none" && panel && panel.classList.contains("fbs-visible")) {
        const resultEl = document.querySelector(".fbs-result");
        if (resultEl) {
          const summaryText = resultEl.innerText.trim();
          
          if (!summaryText || summaryText.includes("quá tải") || summaryText.includes("lỗi") || summaryText.includes("error")) {
            // Tóm tắt lỗi → đóng panel, tiếp tục scan
            document.querySelector(".fbs-close")?.click();
            state = "SCANNING";
            loopTimer = setTimeout(runAgentLoop, 3000);
            return;
          }

          // Gửi summary lên background để AI đánh giá
          state = "WAITING_EVAL";
          stateEnteredAt = Date.now();
          updateStatus("EVAL", "#fdcb6e");
          console.log("[Agent] Gửi summary để AI đánh giá...");

          try {
            chrome.runtime.sendMessage({
              action: "agent_eval_summary",
              payload: { text: summaryText }
            });
          } catch(e) {
            console.warn("[Agent] Lỗi gửi eval:", e);
            // Fallback: post luôn nếu không gửi được
            state = "EXECUTING";
            executePost(summaryText);
          }
          
          return;
        } else {
          // Panel mở nhưng chưa có result → chờ thêm
        }
      }
      nextDelay = 2000;
    }

    loopTimer = setTimeout(runAgentLoop, nextDelay);
  }

  async function executePost(summaryText) {
    updateStatus("POST", "#d63031");

    const imageUrl  = currentPost ? window.fbsExtractImage(currentPost)     : "";
    const rawSrcUrl = currentPost ? window.fbsExtractPermalink(currentPost)  : "";

    // Kiểm tra rate limit giữa các lần post
    const now = Date.now();
    if (now - lastPostTime < MIN_POST_INTERVAL_MS) {
      const waitSec = Math.ceil((MIN_POST_INTERVAL_MS - (now - lastPostTime)) / 1000);
      console.log("[Agent] Rate limit nội bộ: chờ thêm " + waitSec + "s trước khi post tiếp.");
      updateStatus("WAIT", "#b2bec3");
      await new Promise(r => setTimeout(r, MIN_POST_INTERVAL_MS - (now - lastPostTime)));
    }

    if (summaryText && typeof window.fbsAgentPost === "function") {
      document.querySelector(".fbs-close")?.click();
      await new Promise(r => setTimeout(r, 500));

      const result = await window.fbsAgentPost(summaryText, imageUrl, rawSrcUrl);
      console.log("[Agent] Post result:", result);
      
      if (result.ok) {
        lastPostTime = Date.now();
        if (rawSrcUrl) {
          postedUrls.add(rawSrcUrl);
          chrome.storage.local.set({ agentPostedUrls: Array.from(postedUrls) });
        }
      } else {
        console.warn("[Agent] Post failed:", result.reason);
      }
    } else {
      console.warn("[Agent] Missing fbsAgentPost or summaryText");
      document.querySelector(".fbs-close")?.click();
    }

    state = "SCANNING";
    updateStatus("SCAN", "#00b894");
    if (loopTimer) clearTimeout(loopTimer);
    loopTimer = setTimeout(runAgentLoop, 3000 + Math.random() * 2000);
  }

  function startAgent() {
    if (loopTimer) clearTimeout(loopTimer);
    state = "SCANNING";
    chrome.storage.local.get(["agentPostedUrls"], (data) => {
      if (data.agentPostedUrls && Array.isArray(data.agentPostedUrls)) {
        data.agentPostedUrls.forEach(url => postedUrls.add(url));
      }
      runAgentLoop();
    });
  }

  function stopAgent() {
    if (loopTimer) clearTimeout(loopTimer);
    loopTimer = null;
    state = "OFF";
  }

  // Handle AI evaluation result from background
  chrome.runtime.onMessage.addListener(async (msg) => {
    try { if (!chrome.runtime.id) return; } catch (e) { return; }

    if (msg.action === "agent_decision" && isAgentRunning && state === "WAITING_EVAL") {
      console.log("[Agent] AI decision score:", msg.score);

      if (msg.score >= 5) {
        // Lấy summary text từ panel
        const resultEl = document.querySelector(".fbs-result");
        const summaryText = resultEl ? resultEl.innerText.trim() : "";

        if (summaryText) {
          state = "EXECUTING";
          await executePost(summaryText);
        } else {
          console.warn("[Agent] Không lấy được summaryText sau eval");
          document.querySelector(".fbs-close")?.click();
          state = "SCANNING";
          updateStatus("SCAN", "#00b894");
          if (loopTimer) clearTimeout(loopTimer);
          loopTimer = setTimeout(runAgentLoop, 2000);
        }
      } else {
        // Điểm thấp → bỏ qua bài này
        console.log("[Agent] Bỏ qua bài (score=" + msg.score + ")");
        updateStatus("SKIP", "#b2bec3");
        await new Promise(r => setTimeout(r, 1000));
        document.querySelector(".fbs-close")?.click();
        state = "SCANNING";
        updateStatus("SCAN", "#00b894");
        if (loopTimer) clearTimeout(loopTimer);
        loopTimer = setTimeout(runAgentLoop, 2000 + Math.random() * 2000);
      }
    }
  });

  // Init: hiện UI trên Facebook feed, groups, pages
  const isFacebook = window.location.hostname.includes("facebook.com");
  const isValidPage = isFacebook && (
    window.location.pathname === "/" ||
    window.location.pathname.startsWith("/groups/") ||
    window.location.pathname.startsWith("/pages/") ||
    window.location.pathname.startsWith("/watch")
  );

  if (isValidPage) {
    setTimeout(createAgentUI, 2000);
  }
})();
