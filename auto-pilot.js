// auto-pilot.js - FeedWriter Autonomous Agent
// Injected alongside content.js to enable 100% autonomous Facebook posting
// Human-like behavior: random delays, natural scroll patterns, rate limiting

(function () {
  "use strict";

  let isAgentRunning = false;
  let postedUrls = new Set();

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
  let skippedToday = 0;
  let postsTotal = 0;
  let agentAlwaysRun = false;
  let loopTimer = null;

  function scheduleNext(fn, delayMs) {
    if (loopTimer) {
      clearTimeout(loopTimer);
      loopTimer = null;
    }
    scheduleNext(fn, delayMs);
  }

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
    
    // Add CSS for the dashboard via JS to avoid modifying content.css if possible
    ui.style.cssText = "position:fixed;bottom:90px;right:16px;z-index:2147483647;background:var(--surface-background, #242526);color:var(--primary-text, #e4e6eb);border-radius:12px;font-family:-apple-system, sans-serif;font-size:12px;box-shadow:0 4px 16px rgba(0,0,0,0.3);transition:all 0.3s cubic-bezier(0.4, 0, 0.2, 1);overflow:hidden;border:1px solid rgba(255,255,255,0.1);display:flex;flex-direction:column;width:160px;transform-origin:bottom right;";
    
    ui.innerHTML = "<div id='fbs-agent-header' style='padding:10px 12px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;background:rgba(255,255,255,0.05);'>" +
        "<div style='display:flex;align-items:center;gap:8px;'>" +
          "<div id='fbs-agent-status' style='width:10px;height:10px;border-radius:50%;background:#d63031;box-shadow:0 0 4px #d63031;'></div>" +
          "<span id='fbs-agent-text' style='font-weight:600;font-size:13px;letter-spacing:0.3px;'>OFF</span>" +
        "</div>" +
        "<span id='fbs-agent-mode' style='font-size:10px;font-weight:bold;padding:2px 6px;border-radius:6px;background:rgba(255,255,255,0.1);color:#dfe6e9;' title='Chuột phải để đổi chế độ'>ALW</span>" +
      "</div>" +
      "<div id='fbs-agent-dashboard' style='padding:12px;display:none;flex-direction:column;gap:8px;border-top:1px solid rgba(255,255,255,0.05);'>" +
        "<div style='display:flex;justify-content:space-between;'><span>Đã đăng:</span><strong id='fbs-dash-posts' style='color:#00b894;'>0</strong></div>" +
        "<div style='display:flex;justify-content:space-between;'><span>Bỏ qua:</span><strong id='fbs-dash-skipped' style='color:#b2bec3;'>0</strong></div>" +
        "<div style='display:flex;justify-content:space-between;font-size:11px;color:#a8a0cc;'><span>Wait:</span><strong id='fbs-dash-timer'>-</strong></div>" +
      "</div>";
    
    const header = ui.querySelector('#fbs-agent-header');
    header.addEventListener("click", () => {
      isAgentRunning = !isAgentRunning;
      if (isAgentRunning) startAgent();
      else stopAgent();
      updateDashboardVisibility();
    });
    header.addEventListener("contextmenu", (e) => { e.preventDefault(); toggleAgentMode(); });
    
    document.body.appendChild(ui);
    updateAgentModeDisplay();
    
    // Add hover expansion logic
    ui.addEventListener("mouseenter", () => {
      if (isAgentRunning) document.getElementById("fbs-agent-dashboard").style.display = "flex";
    });
    ui.addEventListener("mouseleave", () => {
      if (isAgentRunning) document.getElementById("fbs-agent-dashboard").style.display = "none";
    });
  }

  function updateDashboardVisibility() {
    const dash = document.getElementById("fbs-agent-dashboard");
    if (dash) dash.style.display = isAgentRunning ? "flex" : "none";
  }

  function updateDashboardStats() {
    const elPosts = document.getElementById("fbs-dash-posts");
    const elSkipped = document.getElementById("fbs-dash-skipped");
    if (elPosts) elPosts.innerText = postsToday + "/" + (agentAlwaysRun ? MAX_POSTS_PER_DAY_ALW : MAX_POSTS_PER_DAY_HOUR);
    if (elSkipped) elSkipped.innerText = skippedToday;
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

  // === LIMITS ===
  // HOUR mode: 3 bài/ngày chỉ trong giờ vàng — quality, không spam
  // ALW mode:  5 bài/ngày, 24/7 — dùng khi cần bắt tin nóng ngoài giờ vàng
  const MAX_POSTS_PER_DAY_HOUR = 3;
  const MAX_POSTS_PER_DAY_ALW  = 5;
  const MIN_POST_INTERVAL_MS = 90 * 60 * 1000; // 90 phút giữa 2 bài (cả 2 mode)
  const SUMMARY_TIMEOUT_MS = 90 * 1000;
  const EVAL_TIMEOUT_MS = 30 * 1000;
  const EXECUTING_TIMEOUT_MS = 180 * 1000; // 3 phút — đủ cho upload ảnh + comment chậm

  // Giờ vàng Facebook Việt Nam (engagement cao nhất)
  // 7-9 sáng | 11-13 trưa | 19-22 tối — cắt 22-24 vì engagement thấp
  // Hỗ trợ timezone configurable qua storage
  const DEFAULT_GOLDEN_HOURS = [[7, 9], [11, 13], [19, 22]];
  let cachedGoldenHours = null;
  let cachedTimezone = "Asia/Ho_Chi_Minh";

  // Load golden hours config (non-blocking)
  try {
    chrome.storage.sync.get(["goldenHours", "timezone"], (data) => {
      if (!chrome.runtime.lastError) {
        if (data.goldenHours && Array.isArray(data.goldenHours)) cachedGoldenHours = data.goldenHours;
        if (data.timezone) cachedTimezone = data.timezone;
      }
    });
  } catch (_) {}

  function isGoldenHour() {
    const goldenHours = cachedGoldenHours || DEFAULT_GOLDEN_HOURS;
    // Sử dụng Intl.DateTimeFormat để tính giờ theo timezone chính xác
    let hour, minute;
    try {
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: cachedTimezone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const parts = formatter.formatToParts(new Date());
      hour = parseInt(parts.find(p => p.type === "hour").value);
      minute = parseInt(parts.find(p => p.type === "minute").value);
    } catch (_) {
      // Fallback nếu timezone không hợp lệ
      const d = new Date();
      hour = d.getHours();
      minute = d.getMinutes();
    }
    const t = hour + minute / 60;
    return goldenHours.some(([start, end]) => t >= start && t < end);
  }


  // === MAIN LOOP ===
  function runAgentLoop() {
    try {
      _runAgentLoopCore();
    } catch (err) {
      log("error", "Agent loop crashed (Error Boundary)", { error: err.message });
      state = "SCANNING";
      try { document.querySelector(".fbs-close")?.click(); } catch (_) {}
      // Tự động restart sau 30s thay vì dừng hẳn
      scheduleNext(runAgentLoop, 30000);
    }
  }

  function _runAgentLoopCore() {
    if (!isAgentRunning) return;

    if (!agentAlwaysRun && !isGoldenHour()) {
      state = "SLEEPING";
      updateStatus("SLEEP", "#6c5ce7");
      scheduleNext(runAgentLoop, 5 * 60 * 1000); // check lại sau 5 phút
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
        currentPost = null;
        currentPostUrl = "";
        pendingScore = null;
        updateStatus("SCAN", "#00b894");
      } else {
        scheduleNext(runAgentLoop, 2000);
        return;
      }
    }

    // Guard: WAITING_SUMMARY timeout
    if (state === "WAITING_SUMMARY") {
      const elapsed = Date.now() - stateEnteredAt;
      if (elapsed > SUMMARY_TIMEOUT_MS) {
        log("warn", "WAITING_SUMMARY timeout", { elapsed });
        try { document.querySelector(".fbs-close")?.click(); } catch (_) {}
        state = "SCANNING";
        currentPost = null;
        currentPostUrl = "";
        pendingScore = null;
        scheduleNext(runAgentLoop, humanDelay(5000, 10000));
        return;
      }

      // Check if summary is ready
      const copyBtn = document.querySelector(".fbs-copy-btn");
      const panel = document.querySelector(".fbs-panel");
      if (copyBtn && copyBtn.style.display !== "none" && panel && panel.classList.contains("fbs-visible")) {
        const resultEl = document.querySelector(".fbs-result");
        if (resultEl) {
          const summaryText = resultEl.innerText.trim();
          if (!summaryText || summaryText.includes("API Error") || summaryText.includes("Lỗi API") || summaryText.includes("quá tải") || summaryText.includes("Extension đã cập nhật")) {
            log("warn", "Bad summary, skipping", { preview: (summaryText || "").substring(0, 50) });
            try { document.querySelector(".fbs-close")?.click(); } catch (_) {}
            state = "SCANNING";
            currentPost = null;
            currentPostUrl = "";
            pendingScore = null;
            scheduleNext(runAgentLoop, humanDelay(5000, 10000));
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
      // Also check for error state in panel (summary failed without proper error message)
      const errorEl = document.querySelector(".fbs-error");
      if (errorEl) {
        log("warn", "Summary error detected", { text: (errorEl.textContent || "").substring(0, 50) });
        try { document.querySelector(".fbs-close")?.click(); } catch (_) {}
        state = "SCANNING";
        currentPost = null;
        currentPostUrl = "";
        pendingScore = null;
        scheduleNext(runAgentLoop, humanDelay(5000, 10000));
        return;
      }
      scheduleNext(runAgentLoop, 2000);
      return;
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

        // === SKIP SPONSORED / AFFILIATE / ADS ===
        const postSignals = evaluatePostForAgent(postNode);
        if (postSignals.isSponsored || postSignals.isAffiliate) {
          const type = postSignals.isSponsored ? "sponsored" : "affiliate";
          log("info", "Skipping " + type + " post", {
            reasons: postSignals.reasons,
            confidence: postSignals.confidence,
          });
          skippedToday++;
          updateDashboardStats();
          continue;
        }

        // === SKIP OFF-TOPIC CONTENT (pre-filter — saves API call) ===
        if (!isTargetContent(postNode)) continue;

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

        scheduleNext(() => {
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
          scheduleNext(runAgentLoop, 2000);
        }, readDelay);
        return; // Don't set another timer
      } else {
        // Human-like scroll: nhẹ nhàng, không đều
        const distance = window.innerHeight * (0.25 + Math.random() * 0.35);
        window.scrollBy({ top: distance, behavior: "smooth" });
        const scrollPause = humanDelay(12000, 30000); // 12-30s giữa mỗi scroll
        scheduleNext(runAgentLoop, scrollPause);
        return;
      }
    }

    scheduleNext(runAgentLoop, 2000);
  }

  // === PRE-FILTER: classify post topic before spending API call ===
  // Reads visible DOM text and rejects off-topic content (ads, drama, food, sport...)
  // Returns true only for tech/AI/tips/deals content matching the target profile.
  function isTargetContent(postNode) {
    try {
      const clone = postNode.cloneNode(true);
      // Strip buttons and tiny UI labels so they don't pollute keyword matching
      clone.querySelectorAll("script, style").forEach((el) => el.remove());
      const text = (clone.innerText || clone.textContent || "").toLowerCase().trim();
      if (text.length < 80) return false;

      // === HARD REJECT — clear off-topic signals ===
      const REJECT_PATTERNS = [
        "mua ngay", "flash sale", "mã giảm giá", "voucher mua", "giá sốc",
        "shopee.vn", "lazada.vn", "tiki.vn", "sendo.vn",
        "dm để", "inbox mình", "liên hệ ngay", "số lượng có hạn",
        "chúc mừng sinh nhật", "happy birthday", "hbd ",
        "công thức nấu", "cách nấu", "nấu ăn ngon", "món ngon",
        "bóng đá", "ngoại hạng anh", "premier league", "world cup",
        "bóc phốt", "kpop", "sao hàn", "phim bộ", "diễn viên",
        "tuyển dụng", "cần tuyển", "nộp cv",
        "chiêm tinh", "tarot", "tử vi",
      ];
      for (const kw of REJECT_PATTERNS) {
        if (text.includes(kw)) {
          log("info", "Pre-filter: hard reject", { reason: kw, preview: text.substring(0, 50) });
          return false;
        }
      }

      // === AI / LLM brands — strong accept (unambiguous names) ===
      const AI_BRANDS = [
        "claude", "chatgpt", "gpt-4", "gpt-3", "gpt4", "gpt3",
        "llama", "mistral", "gemini", "anthropic", "openai",
        "deepseek", "qwen", "grok", "copilot", "perplexity",
        "midjourney", "sora", "dall-e", "stable diffusion",
        "runway ml", "llm", "large language model",
        "trí tuệ nhân tạo", "mô hình ngôn ngữ",
        "google ai studio", "notebooklm", "google ai ", "meta ai",
        "microsoft ai", "amazon bedrock", "hugging face",
      ];
      for (const kw of AI_BRANDS) {
        if (text.includes(kw)) return true;
      }

      // === AI product launches / updates — accept even without "free" signal ===
      // Bắt tin ra mắt sản phẩm AI mới (Claude Pro, GPT-5, Gemini Ultra...)
      const MAJOR_AI_NAMES = ["claude", "chatgpt", "gemini", "gpt-4", "gpt-5", "copilot", "grok", "deepseek", "perplexity", "midjourney"];
      const LAUNCH_SIGNALS = ["ra mắt", "vừa ra", "just launched", "now available", "chính thức", "phiên bản mới", "bản cập nhật", "update ", "upgrade", "nâng cấp", "mở rộng", "rolling out"];
      const hasMajorAI = MAJOR_AI_NAMES.some((kw) => text.includes(kw));
      const hasLaunch = LAUNCH_SIGNALS.some((kw) => text.includes(kw));
      if (hasMajorAI && hasLaunch) return true;

      // === AI subscription / free-tier deals — explicit pass ===
      // "Claude Pro miễn phí", "ChatGPT Plus trial", "Gemini Advanced free 3 tháng"...
      // Must combine a general AI term with a free/deal signal to avoid false positives.
      const AI_TERMS_BROAD = ["claude", "chatgpt", "gemini", "openai", "anthropic", "copilot", "gpt", "ai pro", "ai plus", "ai premium"];
      const FREE_SIGNALS = ["miễn phí", "free tier", "free plan", "dùng thử", "trial ", "gói miễn", "đăng ký miễn", "tháng miễn phí", "promo code", "coupon ai"];
      const hasAITerm = AI_TERMS_BROAD.some((kw) => text.includes(kw));
      const hasFreeSig = FREE_SIGNALS.some((kw) => text.includes(kw));
      if (hasAITerm && hasFreeSig) return true;

      // === Security incidents — always accept ===
      const SECURITY_TOPICS = [
        "data breach", "rò rỉ dữ liệu", "lộ dữ liệu", "rò rỉ thông tin",
        "tấn công mạng", "tin tặc", "hacker tấn",
        "ransomware", "malware", "mã độc", "phishing",
        "lỗ hổng bảo mật", "bảo mật nghiêm trọng",
        "zero-day", "vulnerability", "exploit",
        "cybersecurity", "an ninh mạng",
      ];
      for (const kw of SECURITY_TOPICS) {
        if (text.includes(kw)) return true;
      }

      // === Tech companies / flagship products ===
      const TECH_BRANDS = [
        "iphone", "ipad", "macbook", "apple silicon", "vision pro",
        "samsung galaxy", "pixel phone", "oneplus",
        "nvidia", "rtx ", "geforce", " gpu ", "a100", "h100",
        "microsoft", "windows 11", "azure",
        "google cloud", " gcp", " aws ", "amazon web",
        "qualcomm", "snapdragon", "apple m",
      ];
      for (const kw of TECH_BRANDS) {
        if (text.includes(kw)) return true;
      }

      // === Tech topics ===
      const TECH_TOPICS = [
        "machine learning", "deep learning", "neural network",
        "github", "open source", "mã nguồn mở",
        "lập trình", "developer", "kỹ sư phần mềm", "software engineer",
        "bảo mật", "cybersecurity",
        "startup", "unicorn", "gọi vốn", "funding round", "series a", "series b",
        "chip ", "vi xử lý", "bán dẫn", "semiconductor",
        "ra mắt", "phiên bản mới", "bản cập nhật", "vừa ra",
      ];
      for (const kw of TECH_TOPICS) {
        if (text.includes(kw)) return true;
      }

      // === Tips/tutorials require a tech anchor to avoid food/lifestyle tips ===
      const TIP_TRIGGERS = ["hướng dẫn", "tutorial", "thủ thuật", "mẹo hay", "cách dùng", "tối ưu"];
      const TECH_ANCHORS = ["điện thoại", "máy tính", "laptop", "app ", "phần mềm", "website", "chrome", "android", "ios "];
      const hasTip = TIP_TRIGGERS.some((kw) => text.includes(kw));
      const hasTechAnchor = TECH_ANCHORS.some((kw) => text.includes(kw));
      if (hasTip && hasTechAnchor) return true;

      // === Tech/device deals require a device anchor ===
      const DEAL_TRIGGERS = ["khuyến mãi", "giảm giá", "sale "];
      const DEVICE_ANCHORS = ["iphone", "samsung", "laptop", "màn hình", "tai nghe", "phần mềm"];
      const hasDeal = DEAL_TRIGGERS.some((kw) => text.includes(kw));
      const hasDevice = DEVICE_ANCHORS.some((kw) => text.includes(kw));
      if (hasDeal && hasDevice) return true;

      log("info", "Pre-filter: no target signal", { len: text.length, preview: text.substring(0, 60) });
      return false;
    } catch (_) {
      return true; // On error: don't block, let the post through
    }
  }

  // === SKIP OWN POST LOGIC ===
  const SPONSORED_KW = [
    "được tài trợ", "sponsored", "quảng cáo", "publicité", "gesponsert",
    "patrocinado", "sponsorizzato", "gesponsord", "рекламная запись", "広告",
  ];

  function isSponsoredPost(postNode) {
    try {
      // Multi-signal detection: kiểm tra nhiều dấu hiệu quảng cáo
      if (postNode.querySelector('a[href*="/ads/"], a[href*="about_ads"], a[href*="adchoices"]')) return true;
      if (postNode.querySelector('a[aria-label*="Why"], a[aria-label*="Tại sao"], a[aria-label*="Vì sao"]')) return true;

      const candidates = postNode.querySelectorAll('a[role="link"], span[dir="auto"], span[aria-label]');
      for (const node of candidates) {
        const t = (node.innerText || node.textContent || "").trim().toLowerCase();
        if (t.length === 0 || t.length > 30) continue;
        if (SPONSORED_KW.some(kw => t === kw || t.startsWith(kw))) return true;
      }

      const ariaRefs = postNode.querySelectorAll("[aria-describedby],[aria-labelledby]");
      for (const ref of ariaRefs) {
        const ids = ((ref.getAttribute("aria-describedby") || "") + " " + (ref.getAttribute("aria-labelledby") || "")).trim().split(/\s+/);
        for (const id of ids) {
          if (!id) continue;
          const portal = document.getElementById(id);
          if (!portal) continue;
          const tcNorm = (portal.textContent || "").replace(/\s+/g, "").toLowerCase();
          if (SPONSORED_KW.some(kw => tcNorm === kw.replace(/\s+/g, "") || tcNorm.startsWith(kw.replace(/\s+/g, "")))) return true;
        }
      }
    } catch (_) {}
    return false;
  }

  function evaluatePostForAgent(postNode) {
    try {
      if (typeof window.fbsEvaluatePostSignals === "function") {
        const evalResult = window.fbsEvaluatePostSignals(postNode);
        return {
          isSponsored: !!evalResult.isSponsored,
          isAffiliate: !!evalResult.isAffiliate,
          reasons: evalResult.reasons || [],
          confidence: evalResult.confidence || 0,
        };
      }
    } catch (_) {}

    // Fallback if unified engine is not available yet
    return {
      isSponsored: isSponsoredPost(postNode),
      isAffiliate: false,
      reasons: [],
      confidence: 0,
    };
  }

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
      // Check text match với bài vừa đăng — dùng hash-based comparison
      // để tránh false positive khi 2 bài khác nhau có cùng 50 ký tự đầu
      if (lastPostedText) {
        const postContent = (postNode.textContent || "").toLowerCase().replace(/\s+/g, " ").trim();
        const lastContent = lastPostedText.replace(/\*\*/g, "").toLowerCase().replace(/\s+/g, " ").trim();
        // So sánh 200 ký tự đầu thay vì 50 — giảm false positive đáng kể
        const compareLen = 200;
        const postSnippet = postContent.substring(0, compareLen);
        const lastSnippet = lastContent.substring(0, compareLen);
        if (lastSnippet.length >= 50 && postSnippet.includes(lastSnippet)) {
          log("info", "Skipping own post (text match)", { matchLen: lastSnippet.length });
          return true;
        }
      }
    } catch (_) {}
    return false;
  }


  // === EXECUTE POST (human-like timing) ===
  let isExecutingPost = false;

  async function executePost(summaryText) {
    if (isExecutingPost) {
      log("warn", "executePost called but already executing");
      return;
    }
    isExecutingPost = true;
    try {
      if (!isAgentRunning) { log("info", "Agent stopped - aborting post"); return; }

      // Daily limit — khác nhau theo mode
      const today = new Date().toDateString();
      if (postsTodayDate !== today) { postsTodayDate = today; postsToday = 0; updateDashboardStats(); }
      const maxToday = agentAlwaysRun ? MAX_POSTS_PER_DAY_ALW : MAX_POSTS_PER_DAY_HOUR;
      if (postsToday >= maxToday) {
        log("warn", "Daily limit reached", { postsToday, limit: maxToday, mode: agentAlwaysRun ? "ALW" : "HOUR" });
        updateStatus("LIMIT", "#636e72");
        return;
      }

      updateStatus("POST", "#d63031");

      if (!summaryText || !currentPost) {
        throw new Error("Missing summary text or post reference");
      }

      // Extract metadata — retry permalink extraction if empty
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
      } catch (extractErr) {
        log("warn", "Metadata extraction error", { error: extractErr.message });
      }

      log("info", "Executing post", {
        textLength: summaryText.length,
        preview: summaryText.substring(0, 60),
        hasImage: !!imageUrl,
        imageUrl: imageUrl ? imageUrl.substring(0, 80) : "(none)",
        sourceUrl: rawSrcUrl || "(EMPTY - will use page URL)",
      });

      if (!isAgentRunning) return;

      // Close summary panel
      try { document.querySelector(".fbs-close")?.click(); } catch (_) {}
      await wait(humanDelay(1000, 2000));

      if (typeof window.fbsAgentPost !== "function") throw new Error("fbsAgentPost not available");

      // === CALL fbsAgentPost ===
      const result = await window.fbsAgentPost(summaryText, imageUrl, rawSrcUrl, currentPost);

      if (result && result.ok) {
        lastPostTime = Date.now();
        lastPostedText = summaryText;
        postsToday++; updateDashboardStats();
        if (rawSrcUrl) {
          postedUrls.add(rawSrcUrl);
          // Trim to last 500 to prevent storage quota exhaustion
          if (postedUrls.size > 500) {
            const arr = Array.from(postedUrls);
            postedUrls = new Set(arr.slice(arr.length - 500));
          }
        }
        try { chrome?.storage?.local?.set({ agentPostedUrls: Array.from(postedUrls) }); } catch (_) {}
        postsTotal++;
        log("info", "Post successful!", { postsToday, nextAllowed: "90 min" });
        try {
          chrome.runtime.sendMessage({ action: "agent-posted", preview: summaryText.substring(0, 80) });
        } catch (_) {}
        try {
          chrome.storage.local.set({
            agentStats: { postsToday, postsTotal, skippedToday, lastPostTime: Date.now(), postsTodayDate }
          });
        } catch (_) {}

        // Defensive: đóng TẤT CẢ modal FB còn sót (fbsAgentPost Step 8 có thể chưa đủ)
        // Retry loop vì Facebook có thể mở nhiều dialog chồng nhau
        for (let closeAttempt = 0; closeAttempt < 5; closeAttempt++) {
          await wait(800);
          try {
            const dialogs = document.querySelectorAll('div[role="dialog"]');
            if (dialogs.length === 0) break;
            const lastDialog = dialogs[dialogs.length - 1];
            const closeBtn =
              lastDialog.querySelector('[aria-label="Đóng"][role="button"]') ||
              lastDialog.querySelector('[aria-label="Close"][role="button"]') ||
              lastDialog.querySelector('[aria-label="Đóng"]') ||
              lastDialog.querySelector('[aria-label="Close"]');
            if (closeBtn) {
              log("info", "Closing leftover FB dialog #" + (closeAttempt + 1));
              closeBtn.click();
            } else {
              document.dispatchEvent(
                new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }),
              );
            }
          } catch (_) { break; }
        }

        // Scroll về đầu feed để sẵn sàng quét bài mới
        await wait(500);
        window.scrollTo({ top: 0, behavior: "smooth" });
        log("info", "Scrolled back to top of feed");
      } else {
        log("warn", "Post failed", { reason: result?.reason || "unknown" });
        // Đóng dialog nếu có (post failed nhưng dialog có thể vẫn mở)
        try {
          const dialogs = document.querySelectorAll('div[role="dialog"]');
          for (const d of dialogs) {
            const closeBtn = d.querySelector('[aria-label="Đóng"][role="button"]') ||
                             d.querySelector('[aria-label="Close"][role="button"]');
            if (closeBtn) closeBtn.click();
          }
          if (dialogs.length > 0) {
            await wait(500);
            document.dispatchEvent(
              new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }),
            );
          }
        } catch (_) {}
      }
    } catch (err) {
      log("error", "Execute post failed", { error: err.message });
      try { document.querySelector(".fbs-close")?.click(); } catch (_) {}
    } finally {
      isExecutingPost = false;
      state = "SCANNING";
      updateStatus("SCAN", "#00b894");
      if (loopTimer) clearTimeout(loopTimer);
      // Nghỉ 10-20 phút sau mỗi lần post (kể cả failed).
      // Rate limit thực sự (90 phút) được xử lý trong handleAgentDecision.
      const cooldown = humanDelay(10 * 60 * 1000, 20 * 60 * 1000);
      log("info", "Post cooldown", { minutes: Math.round(cooldown / 60000) });
      scheduleNext(runAgentLoop, cooldown);
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
          // === RATE LIMIT CHECK — trước khi vào EXECUTING ===
          // Kiểm tra ở đây để tránh bug: await wait(18 phút) bên trong EXECUTING
          // bị EXECUTING_TIMEOUT (2 phút) cắt ngang → race condition.
          const now = Date.now();
          if (now - lastPostTime < MIN_POST_INTERVAL_MS) {
            const waitMs = MIN_POST_INTERVAL_MS - (now - lastPostTime);
            log("info", "Rate limit: quá gần bài trước, bỏ qua + ngủ", { waitMin: Math.round(waitMs / 60000) });
            updateStatus("WAIT", "#b2bec3");
            try { document.querySelector(".fbs-close")?.click(); } catch (_) {}
            state = "SCANNING";
            // Ngủ đến hết interval + buffer nhỏ trước khi quét lại
            scheduleNext(runAgentLoop, waitMs + humanDelay(60000, 120000));
            return;
          }

          const resultEl = document.querySelector(".fbs-result");
          const summaryText = resultEl ? resultEl.innerText.trim() : "";
          if (!summaryText) {
            log("error", "Empty summary text");
            try { document.querySelector(".fbs-close")?.click(); } catch (_) {}
            state = "SCANNING";
            scheduleNext(runAgentLoop, humanDelay(5000, 10000));
            return;
          }
          log("info", "Score passed, will post", { score, textLength: summaryText.length });
          state = "EXECUTING";
          stateEnteredAt = Date.now();
          await executePost(summaryText);
        } else {
          log("info", "Score too low, skipping", { score });
          skippedToday++; updateDashboardStats();
          updateStatus("SKIP", "#b2bec3");
          await wait(humanDelay(2000, 4000));
          try { document.querySelector(".fbs-close")?.click(); } catch (_) {}
          state = "SCANNING";
          updateStatus("SCAN", "#00b894");
          if (loopTimer) clearTimeout(loopTimer);
          scheduleNext(runAgentLoop, humanDelay(15000, 30000));
        }
      } catch (err) {
        log("error", "handleAgentDecision error", { error: err.message });
        state = "SCANNING";
        scheduleNext(runAgentLoop, 5000);
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
      chrome.storage.local.get(["agentPostedUrls", "agentStats"], (data) => {
        try {
          if (!chrome.runtime.lastError && data.agentPostedUrls && Array.isArray(data.agentPostedUrls)) {
            data.agentPostedUrls.forEach((url) => postedUrls.add(url));
            log("info", "Loaded history", { count: postedUrls.size });
          }
          if (!chrome.runtime.lastError && data.agentStats) {
            postsTotal = data.agentStats.postsTotal || 0;
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
    // Close any open summary panel
    try { document.querySelector(".fbs-close")?.click(); } catch (_) {}
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
      try { 
        createAgentUI(); 
        log("info", "Agent UI initialized"); 
        // Agent OFF by default — user must click to start
      } catch (_) {}
    }, 2000);
  }
})();
