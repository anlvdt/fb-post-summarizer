// auto-pilot.js - FeedWriter Autonomous Agent
// Injected alongside content.js to enable 100% autonomous Facebook posting
// Human-like behavior: random delays, natural scroll patterns, rate limiting

(function () {
  "use strict";

  let isAgentRunning = false;
  let postedUrls = new Set();

  // === HUMAN-LIKE TIMING ===
  // Tạo delay ngẫu nhiên theo phân phối gaussian (tự nhiên hơn uniform random)
  function humanDelay(minMs, maxMs) {
    // Box-Muller transform cho gaussian-like distribution
    const u1 = Math.random();
    const u2 = Math.random();
    const gaussian = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const mid = (minMs + maxMs) / 2;
    const spread = (maxMs - minMs) / 4;
    const delay = Math.max(minMs, Math.min(maxMs, mid + gaussian * spread));
    return Math.round(delay);
  }

  function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // Structured logging
  function log(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const prefix = `[Agent:${state}]`;
    const logData = Object.keys(data).length > 0 ? JSON.stringify(data) : "";
    if (level === "error") console.error(`${timestamp} ${prefix} ${message}`, logData);
    else if (level === "warn") console.warn(`${timestamp} ${prefix} ${message}`, logData);
    else console.log(`${timestamp} ${prefix} ${message}`, logData);
  }

  // === UI ===
  function createAgentUI() {
    const ui = document.createElement("div");
    ui.id = "fbs-agent-ui";
    ui.style.cssText = "position:fixed;bottom:90px;right:16px;z-index:2147483647;background:var(--secondary-button-background, #4b4c4f);color:var(--primary-text, #e4e6eb);width:56px;height:64px;border-radius:14px;font-family:sans-serif;font-size:10px;font-weight:bold;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;cursor:pointer;user-select:none;box-shadow:0 2px 12px rgba(0,0,0,0.4);transition:all 0.2s ease;";
    ui.innerHTML = `
      <div id="fbs-agent-status" style="width:12px;height:12px;border-radius:50%;background:#d63031;"></div>
      <span id="fbs-agent-text" style="font-weight:600;line-height:1.2;">OFF</span>
      <span id="fbs-agent-mode" style="font-size:8px;line-height:1.1;letter-spacing:0.2px;color:#dfe6e9;">ALW</span>
    `;
    ui.title = "Click để Start/Stop, nhấn phải để chuyển chế độ Always Run / Golden Hour";
    ui.addEventListener("click", () => {
      isAgentRunning = !isAgentRunning;
      if (isAgentRunning) startAgent();
      else stopAgent();
    });
    ui.addEventListener("contextmenu", (e) => { e.preventDefault(); toggleAgentMode(); });
    document.body.appendChild(ui);
    updateAgentModeDisplay();
  }

  function updateAgentModeDisplay() {
    const mode = document.getElementById("fbs-agent-mode");
    if (!mode) return;
    mode.innerText = agentAlwaysRun ? "ALW" : "HOUR";
    mode.style.color = agentAlwaysRun ? "#00b894" : "#fdcb6e";
  }

  function toggleAgentMode() {
    agentAlwaysRun = !agentAlwaysRun;
    updateAgentModeDisplay();
    log("info", "Agent mode toggled", { alwaysRun: agentAlwaysRun });
  }

  function updateStatus(text, color) {
    try {
      const status = document.getElementById("fbs-agent-status");
      const label = document.getElementById("fbs-agent-text");
      if (status) { status.style.background = color; status.style.boxShadow = color !== "#d63031" ? "0 0 6px " + color : "none"; }
      if (label) label.innerText = text;
    } catch (_) {}
  }

  // === STATE ===
  let state = "SCANNING";
  let currentPost = null;
  let currentPostUrl = "";
  let lastPostTime = 0;
  let lastPostedText = "";
  let stateEnteredAt = 0;
  let pendingScore = null;
  let ownProfileName = "";
  let postsToday = 0;
  let postsTodayDate = "";
  let agentAlwaysRun = false;
  let loopTimer = null;

  // === LIMITS (research-based, safe for Facebook) ===
  const MAX_POSTS_PER_DAY = 5;
  const MIN_POST_INTERVAL_MS = 20 * 60 * 1000; // 20 phút giữa 2 bài
  const SUMMARY_TIMEOUT_MS = 90 * 1000;
  const EVAL_TIMEOUT_MS = 30 * 1000;
  const EXECUTING_TIMEOUT_MS = 90 * 1000; // 90s cho toàn bộ post + comment flow

  function isGoldenHour() {
    const d = new Date();
    const t = d.getHours() + d.getMinutes() / 60;
    return (t >= 7 && t < 9) || (t >= 11 && t < 13.5) || (t >= 19 && t < 24);
  }


  // === MAIN LOOP ===
  function runAgentLoop() {
    if (!isAgentRunning) return;

    if (!agentAlwaysRun && !isGoldenHour()) {
      state = "SLEEPING";
      updateStatus("SLEEP", "#6c5ce7");
      loopTimer = setTimeout(runAgentLoop, 60000);
      return;
    }

    // Guard: đang chờ AI hoặc đang post
    if (state === "WAITING_EVAL" || state === "EXECUTING") {
      const elapsed = Date.now() - stateEnteredAt;
      if ((state === "WAITING_EVAL" && elapsed > EVAL_TIMEOUT_MS) ||
          (state === "EXECUTING" && elapsed > EXECUTING_TIMEOUT_MS)) {
        log("warn", state + " timeout - resetting", { elapsed });
        try { document.querySelector(".fbs-close")?.click(); } catch (_) {}
        state = "SCANNING";
        updateStatus("SCAN", "#00b894");
      } else {
        loopTimer = setTimeout(runAgentLoop, 2000);
        return;
      }
    }

    // === SCANNING STATE ===
    if (state === "SLEEPING" || state === "SCANNING") {
      state = "SCANNING";
      updateStatus("SCAN", "#00b894");

      const buttons = document.querySelectorAll(".fbs-btn-inline:not([data-agent-clicked])");
      let targetBtn = null;

      for (const btn of buttons) {
        btn.setAttribute("data-agent-clicked", "true");
        const postNode = btn.closest('[role="article"]') || btn.closest('div[data-ad-preview="message"]') || btn.parentElement;
        if (!postNode) continue;

        // === SKIP OWN POST ===
        if (shouldSkipPost(postNode)) continue;

        // === SKIP ALREADY POSTED ===
        try {
          if (typeof window.fbsExtractPermalink === "function") {
            const rawUrl = window.fbsExtractPermalink(postNode);
            if (rawUrl && postedUrls.has(rawUrl)) {
              log("info", "Skipping already posted", { url: rawUrl.substring(0, 50) });
              continue;
            }
          }
        } catch (_) {}

        targetBtn = btn;
        currentPost = postNode;
        // Pre-extract permalink
        try {
          currentPostUrl = typeof window.fbsExtractPermalink === "function"
            ? window.fbsExtractPermalink(postNode) : "";
          log("info", "Pre-extracted permalink", { url: currentPostUrl || "(EMPTY)" });
        } catch (_) { currentPostUrl = ""; }
        break;
      }

      if (targetBtn) {
        // Human-like: scroll to post, pause to "read", then click
        targetBtn.scrollIntoView({ behavior: "smooth", block: "center" });
        const readDelay = humanDelay(10000, 25000); // 10-25s giả lập đọc bài

        // Trong lúc "đọc", extract permalink async (click menu ⋯)
        if (typeof window.fbsExtractPermalinkAsync === "function" && !currentPostUrl) {
          window.fbsExtractPermalinkAsync(currentPost).then((url) => {
            if (url) {
              currentPostUrl = url;
              log("info", "Async permalink extracted", { url: url.substring(0, 70) });
            }
          }).catch(() => {});
        }

        log("info", "Reading post before summarize", { delay: Math.round(readDelay / 1000) + "s" });

        loopTimer = setTimeout(() => {
          if (!isAgentRunning) return;
          try {
            targetBtn.click();
            state = "WAITING_SUMMARY";
            stateEnteredAt = Date.now();
            updateStatus("SUM", "#0984e3");
            log("info", "Clicked summarize button");
          } catch (err) {
            log("error", "Failed to click button", { error: err.message });
            state = "SCANNING";
          }
          loopTimer = setTimeout(runAgentLoop, 2000);
        }, readDelay);
        return; // Don't set another timer
      } else {
        // Human-like scroll: nhẹ nhàng, không đều
        const distance = window.innerHeight * (0.25 + Math.random() * 0.35);
        window.scrollBy({ top: distance, behavior: "smooth" });
        const scrollPause = humanDelay(12000, 30000); // 12-30s giữa mỗi scroll
        loopTimer = setTimeout(runAgentLoop, scrollPause);
        return;
      }
    }

    // === WAITING_SUMMARY STATE ===
    if (state === "WAITING_SUMMARY") {
      const elapsed = Date.now() - stateEnteredAt;
      if (elapsed > SUMMARY_TIMEOUT_MS) {
        log("warn", "WAITING_SUMMARY timeout", { elapsed });
        try { document.querySelector(".fbs-close")?.click(); } catch (_) {}
        state = "SCANNING";
        pendingScore = null;
        loopTimer = setTimeout(runAgentLoop, humanDelay(5000, 10000));
        return;
      }

      // Check if summary is ready
      const copyBtn = document.querySelector(".fbs-copy-btn");
      const panel = document.querySelector(".fbs-panel");
      if (copyBtn && copyBtn.style.display !== "none" && panel && panel.classList.contains("fbs-visible")) {
        const resultEl = document.querySelector(".fbs-result");
        if (resultEl) {
          const summaryText = resultEl.innerText.trim();
          if (!summaryText || summaryText.includes("API Error") || summaryText.includes("Lỗi API") || summaryText.includes("quá tải")) {
            log("warn", "Bad summary, skipping", { preview: (summaryText || "").substring(0, 50) });
            try { document.querySelector(".fbs-close")?.click(); } catch (_) {}
            state = "SCANNING";
            loopTimer = setTimeout(runAgentLoop, humanDelay(5000, 10000));
            return;
          }

          // Summary ready → chuyển sang WAITING_EVAL
          state = "WAITING_EVAL";
          stateEnteredAt = Date.now();
          updateStatus("EVAL", "#fdcb6e");
          log("info", "Summary ready, waiting for score");

          // Handle buffered score (race condition fix)
          if (pendingScore !== null) {
            log("info", "Processing buffered score", { score: pendingScore });
            const s = pendingScore;
            pendingScore = null;
            handleAgentDecision(s);
            return;
          }
        }
      }
      loopTimer = setTimeout(runAgentLoop, 2000);
      return;
    }

    loopTimer = setTimeout(runAgentLoop, 2000);
  }

  // === SKIP OWN POST LOGIC ===
  function shouldSkipPost(postNode) {
    try {
      if (typeof window.fbsExtractAuthor === "function") {
        const author = window.fbsExtractAuthor(postNode);
        // Detect profile name nếu chưa có
        if (!ownProfileName) {
          const navProfile =
            document.querySelector('svg[aria-label="Trang cá nhân"]')?.closest("a") ||
            document.querySelector('svg[aria-label="Your profile"]')?.closest("a") ||
            document.querySelector('a[href^="/me/"]') ||
            document.querySelector('a[aria-label="Profile"]');
          if (navProfile && navProfile.innerText) ownProfileName = navProfile.innerText.trim();
        }
        if (author && ownProfileName && author === ownProfileName) {
          log("info", "Skipping own post", { author });
          return true;
        }
      }
      // Check text match với bài vừa đăng
      if (lastPostedText) {
        const postContent = (postNode.textContent || "").toLowerCase();
        const snippet = lastPostedText.replace(/\*\*/g, "").substring(0, 50).toLowerCase().trim();
        if (snippet && postContent.includes(snippet)) {
          log("info", "Skipping own post (text match)");
          return true;
        }
      }
    } catch (_) {}
    return false;
  }


  // === EXECUTE POST (human-like timing) ===
  async function executePost(summaryText) {
    try {
      if (!isAgentRunning) { log("info", "Agent stopped - aborting post"); return; }

      // Daily limit
      const today = new Date().toDateString();
      if (postsTodayDate !== today) { postsTodayDate = today; postsToday = 0; }
      if (postsToday >= MAX_POSTS_PER_DAY) {
        log("warn", "Daily limit reached", { postsToday });
        updateStatus("LIMIT", "#636e72");
        return;
      }

      updateStatus("POST", "#d63031");

      if (!summaryText || !currentPost) {
        throw new Error("Missing summary text or post reference");
      }

      // Extract metadata
      let imageUrl = "";
      let rawSrcUrl = "";
      try {
        imageUrl = typeof window.fbsExtractImage === "function" ? window.fbsExtractImage(currentPost) : "";
        rawSrcUrl = currentPostUrl || (typeof window.fbsExtractPermalink === "function" ? window.fbsExtractPermalink(currentPost) : "");
        // Async fallback: thử click menu ⋯ nếu vẫn chưa có
        if (!rawSrcUrl && typeof window.fbsExtractPermalinkAsync === "function") {
          rawSrcUrl = await window.fbsExtractPermalinkAsync(currentPost);
        }
        if (!rawSrcUrl && location.href.includes("facebook.com")) {
          if (/\/groups\/|\/posts\/|\/permalink\/|story_fbid|pfbid/.test(location.pathname + location.search)) {
            rawSrcUrl = location.href;
          }
        }
      } catch (_) {}

      log("info", "Executing post", {
        textLength: summaryText.length,
        preview: summaryText.substring(0, 60),
        hasImage: !!imageUrl,
        sourceUrl: rawSrcUrl || "(EMPTY - will use page URL)",
      });

      // Rate limit check
      const now = Date.now();
      if (now - lastPostTime < MIN_POST_INTERVAL_MS) {
        const waitMs = MIN_POST_INTERVAL_MS - (now - lastPostTime);
        log("info", "Rate limit wait", { seconds: Math.round(waitMs / 1000) });
        updateStatus("WAIT", "#b2bec3");
        await wait(waitMs);
      }

      if (!isAgentRunning) return; // Check again after wait

      // Close summary panel
      try { document.querySelector(".fbs-close")?.click(); } catch (_) {}
      await wait(humanDelay(1000, 2000));

      if (typeof window.fbsAgentPost !== "function") throw new Error("fbsAgentPost not available");

      // === CALL fbsAgentPost ===
      const result = await window.fbsAgentPost(summaryText, imageUrl, rawSrcUrl, currentPost);

      if (result && result.ok) {
        lastPostTime = Date.now();
        lastPostedText = summaryText;
        postsToday++;
        if (rawSrcUrl) postedUrls.add(rawSrcUrl);
        try { chrome?.storage?.local?.set({ agentPostedUrls: Array.from(postedUrls) }); } catch (_) {}
        log("info", "Post successful!", { postsToday, nextIn: "20 min" });
      } else {
        log("warn", "Post failed", { reason: result?.reason || "unknown" });
      }
    } catch (err) {
      log("error", "Execute post failed", { error: err.message });
      try { document.querySelector(".fbs-close")?.click(); } catch (_) {}
    } finally {
      state = "SCANNING";
      updateStatus("SCAN", "#00b894");
      if (loopTimer) clearTimeout(loopTimer);
      // Human-like cooldown: 90-180s sau mỗi post attempt
      const cooldown = humanDelay(90000, 180000);
      log("info", "Cooldown before next scan", { seconds: Math.round(cooldown / 1000) });
      loopTimer = setTimeout(runAgentLoop, cooldown);
    }
  }

  // === AGENT DECISION HANDLER ===
  function handleAgentDecision(score) {
    if (!isAgentRunning) return;
    if (state !== "WAITING_EVAL") {
      if (state === "WAITING_SUMMARY") {
        log("info", "Buffering score (state still WAITING_SUMMARY)", { score });
        pendingScore = score;
      }
      return;
    }
    if (typeof score !== "number" || isNaN(score)) return;

    log("info", "AI decision received", { score });

    (async () => {
      try {
        if (score >= 5) {
          const resultEl = document.querySelector(".fbs-result");
          const summaryText = resultEl ? resultEl.innerText.trim() : "";
          if (!summaryText) {
            log("error", "Empty summary text");
            try { document.querySelector(".fbs-close")?.click(); } catch (_) {}
            state = "SCANNING";
            loopTimer = setTimeout(runAgentLoop, humanDelay(5000, 10000));
            return;
          }
          log("info", "Score passed, will post", { score, textLength: summaryText.length });
          state = "EXECUTING";
          stateEnteredAt = Date.now();
          await executePost(summaryText);
        } else {
          log("info", "Score too low, skipping", { score });
          updateStatus("SKIP", "#b2bec3");
          await wait(humanDelay(2000, 4000));
          try { document.querySelector(".fbs-close")?.click(); } catch (_) {}
          state = "SCANNING";
          updateStatus("SCAN", "#00b894");
          if (loopTimer) clearTimeout(loopTimer);
          loopTimer = setTimeout(runAgentLoop, humanDelay(15000, 30000));
        }
      } catch (err) {
        log("error", "handleAgentDecision error", { error: err.message });
        state = "SCANNING";
        loopTimer = setTimeout(runAgentLoop, 5000);
      }
    })();
  }

  // === START / STOP ===
  function startAgent() {
    try {
      if (loopTimer) clearTimeout(loopTimer);
      state = "SCANNING";
      window._fbsAgentMode = true;
      log("info", "Agent starting");

      // Detect profile name
      try {
        const navProfile =
          document.querySelector('svg[aria-label="Trang cá nhân"]')?.closest("a") ||
          document.querySelector('svg[aria-label="Your profile"]')?.closest("a") ||
          document.querySelector('a[href^="/me/"]');
        if (navProfile && navProfile.innerText) {
          ownProfileName = navProfile.innerText.trim();
          log("info", "Profile detected", { name: ownProfileName });
        }
      } catch (_) {}

      // Load history
      if (!chrome?.storage?.local) {
        log("warn", "No storage access - starting without history");
        runAgentLoop();
        return;
      }
      chrome.storage.local.get(["agentPostedUrls"], (data) => {
        try {
          if (!chrome.runtime.lastError && data.agentPostedUrls && Array.isArray(data.agentPostedUrls)) {
            data.agentPostedUrls.forEach((url) => postedUrls.add(url));
            log("info", "Loaded history", { count: postedUrls.size });
          }
        } catch (_) {}
        runAgentLoop();
      });
    } catch (err) {
      log("error", "Failed to start", { error: err.message });
    }
  }

  function stopAgent() {
    if (loopTimer) clearTimeout(loopTimer);
    loopTimer = null;
    isAgentRunning = false;
    state = "OFF";
    pendingScore = null;
    currentPost = null;
    currentPostUrl = "";
    window._fbsAgentMode = false;
    updateStatus("OFF", "#d63031");
    log("info", "Agent stopped");
  }

  // === EVENT LISTENERS ===
  window.addEventListener("fbs_agent_decision", (e) => {
    try {
      if (e.detail && typeof e.detail.score !== "undefined") handleAgentDecision(e.detail.score);
    } catch (_) {}
  });

  chrome.runtime.onMessage.addListener((msg) => {
    try {
      if (!chrome.runtime.id) return;
      if (msg && msg.action === "agent_decision" && typeof msg.score !== "undefined") {
        handleAgentDecision(msg.score);
      }
    } catch (_) {}
  });

  // === INIT ===
  const isFacebook = window.location.hostname.includes("facebook.com");
  const isValidPage = isFacebook && (
    window.location.pathname === "/" ||
    window.location.pathname.startsWith("/groups/") ||
    window.location.pathname.startsWith("/pages/") ||
    window.location.pathname.startsWith("/watch")
  );

  if (isValidPage) {
    setTimeout(() => {
      try { createAgentUI(); log("info", "Agent UI initialized"); } catch (_) {}
    }, 2000);
  }
})();
