// === THEME ===
async function initTheme() {
  const { theme } = await chrome.storage.sync.get({ theme: 'auto' });
  applyTheme(theme);

  // Update select value
  const themeSelect = document.getElementById("themeSelect");
  themeSelect.value = theme;
}

function applyTheme(theme) {
  if (theme === 'auto') {
    // Detect from system preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.body.classList.toggle('light', !prefersDark);
  } else if (theme === 'light') {
    document.body.classList.add('light');
  } else {
    document.body.classList.remove('light');
  }
}

const themeSelect = document.getElementById("themeSelect");
themeSelect.addEventListener("change", async () => {
  const theme = themeSelect.value;
  await chrome.storage.sync.set({ theme });
  applyTheme(theme);
});

// Listen to system theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async () => {
  const { theme } = await chrome.storage.sync.get({ theme: 'auto' });
  if (theme === 'auto') {
    applyTheme('auto');
  }
});

// Initialize theme on load
initTheme();

// === SETUP WIZARD CHECK ===
// Check if wizard has been completed, if not, redirect to wizard
async function checkWizardStatus() {
  const data = await chrome.storage.local.get('wizardCompleted');
  if (!data.wizardCompleted) {
    // Open wizard in new window
    chrome.windows.create({
      url: chrome.runtime.getURL('setup-wizard.html'),
      type: 'popup',
      width: 400,
      height: 600
    });
    // Close current popup
    window.close();
  }
}

// Run wizard check on popup load
checkWizardStatus();

// === TABS ===
// Cache selectors for better performance
const allTabs = document.querySelectorAll(".tab");
const allTabContents = document.querySelectorAll(".tab-content");

allTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    allTabs.forEach((t) => {
      t.classList.remove("active");
      t.setAttribute("aria-selected", "false");
    });
    allTabContents.forEach((c) => c.classList.remove("active"));
    tab.classList.add("active");
    tab.setAttribute("aria-selected", "true");
    document.getElementById("tab-" + tab.dataset.tab).classList.add("active");
    if (tab.dataset.tab === "history") { loadHistory(); loadAgentStats(); }
    if (tab.dataset.tab === "apikeys") loadKeyLists();
  });
});

// === SETTINGS ===
const minLengthInput = document.getElementById("minLength");
const outputLangSel = document.getElementById("outputLanguage");
const summaryLengthSel = document.getElementById("summaryLength");
const promptStyleSel = document.getElementById("promptStyle");
const customInstructionsEl = document.getElementById("customInstructions");
const customSummaryPromptEl = document.getElementById("customSummaryPrompt");
const customAffPromptEl = document.getElementById("customAffPrompt");
const sourceTemplateEl = document.getElementById("sourceTemplate");
const useHeuristicEvalEl = document.getElementById("useHeuristicEval");
const hideAffiliatePostsEl = document.getElementById("hideAffiliatePosts");
const adDisplayModeEl = document.getElementById("adDisplayMode");
const affiliateDisplayModeEl = document.getElementById("affiliateDisplayMode");
const blockedDomainsEl = document.getElementById("blockedDomains");
const saveBtn = document.getElementById("saveBtn");
const status = document.getElementById("status");

chrome.storage.sync.get(
  [
    "minLength",
    "outputLanguage",
    "summaryLength",
    "promptStyle",
    "customInstructions",
    "customSummaryPrompt",
    "customAffPrompt",
    "sourceTemplate",
    "useHeuristicEval",
    "hideAffiliatePosts",
    "adDisplayMode",
    "affiliateDisplayMode",
    "blockedDomains",
    "apiKeys",
  ],
  (d) => {
    if (d.minLength) minLengthInput.value = d.minLength;
    if (d.outputLanguage) outputLangSel.value = d.outputLanguage;
    if (d.summaryLength) summaryLengthSel.value = d.summaryLength;
    if (d.promptStyle) promptStyleSel.value = d.promptStyle;
    if (d.customInstructions) customInstructionsEl.value = d.customInstructions;
    if (d.customSummaryPrompt)
      customSummaryPromptEl.value = d.customSummaryPrompt;
    if (d.customAffPrompt) customAffPromptEl.value = d.customAffPrompt;
    if (d.sourceTemplate) sourceTemplateEl.value = d.sourceTemplate;
    if (d.useHeuristicEval) useHeuristicEvalEl.checked = true;
    if (d.hideAffiliatePosts) hideAffiliatePostsEl.checked = true;
    if (d.adDisplayMode) adDisplayModeEl.value = d.adDisplayMode;
    if (d.affiliateDisplayMode) affiliateDisplayModeEl.value = d.affiliateDisplayMode;
    if (d.blockedDomains) blockedDomainsEl.value = d.blockedDomains;
    const total = Object.values(d.apiKeys || {}).reduce(
      (s, a) => s + (a ? a.length : 0),
      0,
    );
    if (total === 0)
      showStatus('Chưa có API Key. Thêm ở tab "API Keys".', "error");
  },
);

saveBtn.addEventListener("click", () => {
  // Input validation
  const minLen = parseInt(minLengthInput.value);
  if (isNaN(minLen) || minLen < 100 || minLen > 5000) {
    showStatus("Độ dài tối thiểu phải từ 100-5000 ký tự", "error");
    return;
  }

  chrome.storage.sync.set(
    {
      minLength: minLen,
      outputLanguage: outputLangSel.value,
      summaryLength: summaryLengthSel.value,
      promptStyle: promptStyleSel.value,
      customInstructions: customInstructionsEl.value.trim(),
      customSummaryPrompt: customSummaryPromptEl.value.trim(),
      customAffPrompt: customAffPromptEl.value.trim(),
      sourceTemplate: sourceTemplateEl.value.trim(),
      useHeuristicEval: useHeuristicEvalEl.checked,
      hideAffiliatePosts: hideAffiliatePostsEl.checked,
      adDisplayMode: adDisplayModeEl.value,
      affiliateDisplayMode: affiliateDisplayModeEl.value,
      blockedDomains: blockedDomainsEl.value.trim(),
      languageAutoDetected: false, // User manually changed settings
    },
    () => {
      showStatus("Đã lưu", "success");

      // Create backup after saving
      chrome.runtime.sendMessage({ action: "backupSettings" }, (response) => {
        if (response && response.success) {
          loadBackupList();
        }
      });
    },
  );
});

// Enable test mode debug panel
if (typeof featureFlags !== 'undefined' && featureFlags.testMode) {
  const debugPanel = document.getElementById('debugPanel');
  if (debugPanel) {
    debugPanel.style.display = 'block';
    updateDebugInfo();
  }
}

function updateDebugInfo() {
  const debugInfo = document.getElementById('debugInfo');
  if (!debugInfo) return;

  chrome.storage.local.get(['history', 'telemetry'], (data) => {
    const historyCount = data.history ? data.history.length : 0;
    const telemetry = data.telemetry || {};
    const now = Date.now();
    debugInfo.innerHTML = `
      <div>📊 History items: ${historyCount}</div>
      <div>📈 Sessions: ${telemetry.sessions || 0}</div>
      <div>📝 Summaries: ${telemetry.summaries || 0}</div>
      <div>❌ Errors: ${telemetry.errors || 0}</div>
      <div>🔧 Test Mode: Enabled</div>
      <div>⏰ Last active: ${new Date(now).toLocaleTimeString()}</div>
    `;
  });
}

function showStatus(msg, type) {
  status.textContent = msg;
  status.className = "status " + type;
  status.style.display = "block";
  setTimeout(() => {
    status.style.display = "none";
  }, 4000);
}

function esc(s) {
  const d = document.createElement("span");
  d.textContent = s;
  return d.innerHTML;
}

// === API KEYS ===
const newApiKeyInput = document.getElementById("newApiKey");
const addKeyBtn = document.getElementById("addKeyBtn");
const keyStatus = document.getElementById("keyStatus");
const testBtn = document.getElementById("testBtn");
const keyEmptyState = document.getElementById("keyEmptyState");
function showKeyStatus(msg, type) {
  keyStatus.textContent = msg;
  keyStatus.className = "status " + type;
  keyStatus.style.display = "block";
  setTimeout(() => {
    keyStatus.style.display = "none";
  }, 3500);
}

function maskKey(key) {
  if (key.length <= 8) return "****";
  return key.substring(0, 6) + "..." + key.substring(key.length - 4);
}

function detectProvider(key) {
  if (key.startsWith("gsk_")) return "groq";
  if (key.startsWith("AI")) return "gemini";
  if (key.startsWith("csk-")) return "cerebras";
  if (key.startsWith("sk-or-")) return "openrouter";
  return "sambanova";
}

const ALL_PROVIDERS = ["groq", "gemini", "cerebras", "sambanova", "openrouter"];

async function loadKeyLists() {
  const data = await chrome.storage.sync.get(["apiKeys"]);
  const apiKeys = data.apiKeys || {};
  const localData = await chrome.storage.local.get(["keyStatus"]);
  const ks = localData.keyStatus || {};
  let totalKeys = 0;
  for (const p of ALL_PROVIDERS) {
    const keys = apiKeys[p] || [];
    totalKeys += keys.length;
    const cap = p.charAt(0).toUpperCase() + p.slice(1);
    const wrapper = document.getElementById("keyList" + cap);
    if (wrapper) wrapper.style.display = keys.length > 0 ? "block" : "none";
    renderKeyList(p, keys, ks);
  }
  if (keyEmptyState)
    keyEmptyState.style.display = totalKeys === 0 ? "block" : "none";
}

function renderKeyList(provider, keys, keyStatusData) {
  const cap = provider.charAt(0).toUpperCase() + provider.slice(1);
  const container = document.getElementById("keyList" + cap + "Items");
  if (!container || keys.length === 0) {
    if (container) container.innerHTML = "";
    return;
  }

  container.innerHTML = keys
    .map((key, i) => {
      const info = keyStatusData[key] || {};
      let cls, txt;
      if (info.rateLimitedUntil && Date.now() < info.rateLimitedUntil) {
        cls = "rate-limited";
        txt =
          "limit " +
          Math.ceil((info.rateLimitedUntil - Date.now()) / 60000) +
          "p";
      } else if (info.lastUsed && Date.now() - info.lastUsed < 60000) {
        cls = "active";
        txt = "vừa dùng";
      } else {
        cls = "idle";
        txt = "OK";
      }
      return (
        '<div class="key-item">' +
        '<span class="key-item-text">' +
        esc(maskKey(key)) +
        "</span>" +
        '<span class="key-item-status ' +
        cls +
        '">' +
        txt +
        "</span>" +
        '<button class="key-item-delete" data-provider="' +
        provider +
        '" data-idx="' +
        i +
        '" title="Xóa key">&times;</button>' +
        "</div>"
      );
    })
    .join("");
}

// Event delegation for key delete buttons
document.addEventListener("click", async (e) => {
  if (e.target.classList.contains("key-item-delete")) {
    const btn = e.target;
    const d = await chrome.storage.sync.get(["apiKeys"]);
    const apiKeys = d.apiKeys || {};
    if (apiKeys[btn.dataset.provider])
      apiKeys[btn.dataset.provider].splice(+btn.dataset.idx, 1);
    await chrome.storage.sync.set({ apiKeys });
    await chrome.storage.local.set({ backupApiKeys: apiKeys });
    loadKeyLists();
    showKeyStatus("Đã xóa", "success");
  }
});


// Auto-validate API key on paste
newApiKeyInput.addEventListener('paste', (e) => {
  setTimeout(() => {
    const key = newApiKeyInput.value.trim();
    if (key.length > 20) {
      addKeyBtn.click();
      setTimeout(() => testBtn.click(), 300);
    }
  }, 10);
});

addKeyBtn.addEventListener("click", async () => {
  const key = newApiKeyInput.value.trim();
  if (!key) {
    showKeyStatus("Nhập API Key", "error");
    return;
  }
  const provider = detectProvider(key);
  const data = await chrome.storage.sync.get(["apiKeys"]);
  const apiKeys = data.apiKeys || {};
  for (const p of ALL_PROVIDERS) {
    if (!apiKeys[p]) apiKeys[p] = [];
  }
  if (apiKeys[provider].includes(key)) {
    showKeyStatus("Key đã tồn tại", "error");
    return;
  }
  apiKeys[provider].push(key);
  await chrome.storage.sync.set({ apiKeys });
  await chrome.storage.local.set({ backupApiKeys: apiKeys });
  newApiKeyInput.value = "";
  loadKeyLists();
  showKeyStatus(
    "Đã thêm — " + provider.charAt(0).toUpperCase() + provider.slice(1),
    "success",
  );
});

async function handleTestConnection(btn) {
  const data = await chrome.storage.sync.get(["apiKeys"]);
  const total = Object.values(data.apiKeys || {}).reduce(
    (s, a) => s + (a ? a.length : 0),
    0,
  );
  if (total === 0) {
    showKeyStatus("Chưa có API Key. Thêm key ở ô bên trên.", "error");
    return;
  }
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = "Đang test...";
  try {
    const r = await chrome.runtime.sendMessage({ action: "test-connection" });
    if (r?.ok) {
      showKeyStatus("✓ " + r.provider + (r.model ? " — " + r.model : " — OK"), "success");
    } else if (r?.error && r.error.includes("429")) {
      showKeyStatus("⏱ Rate limited — thử lại sau vài phút", "error");
    } else if (r?.error && (r.error.includes("401") || r.error.includes("403"))) {
      showKeyStatus("✗ Key không hợp lệ hoặc hết hạn", "error");
    } else if (r?.error && r.error.includes("network")) {
      showKeyStatus("✗ Lỗi mạng — kiểm tra kết nối internet", "error");
    } else {
      showKeyStatus(r?.error || "Lỗi không xác định", "error");
    }
  } catch (e) {
    if (e.message.includes("Extension context invalidated")) {
      showKeyStatus("Extension đã reload — mở lại popup", "error");
    } else {
      showKeyStatus("Lỗi: " + e.message, "error");
    }
  }
  btn.disabled = false;
  btn.textContent = originalText;
}

testBtn.addEventListener("click", () => handleTestConnection(testBtn));

const debugTestBtn = document.getElementById("debugTestBtn");
if (debugTestBtn) {
  debugTestBtn.addEventListener("click", () => handleTestConnection(debugTestBtn));
}

// Clear cache button (test mode)
const clearCacheBtn = document.getElementById("clearCacheBtn");
if (clearCacheBtn) {
  clearCacheBtn.addEventListener("click", async () => {
    try {
      // Clear local storage cache
      await chrome.storage.local.remove(['history', 'telemetry']);
      // Send message to content script to clear summaryCache
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "clear-cache" });
      }
      showStatus("Đã xóa cache", "success");
      // Reload history
      loadHistory();
    } catch (e) {
      showStatus("Lỗi xóa cache: " + e.message, "error");
    }
  });
}

// Migrate old single apiKey
(async () => {
  const data = await chrome.storage.sync.get(["apiKey", "apiKeys", "provider"]);
  const apiKeys = data.apiKeys || {};
  for (const p of ALL_PROVIDERS) {
    if (!apiKeys[p]) apiKeys[p] = [];
  }
  if (data.apiKey) {
    const provider = data.provider || detectProvider(data.apiKey);
    if (!apiKeys[provider].includes(data.apiKey))
      apiKeys[provider].push(data.apiKey);
    await chrome.storage.sync.set({ apiKeys });
    await chrome.storage.local.set({ backupApiKeys: apiKeys });
  }
  loadKeyLists();
})();

// === HISTORY ===
let historyData = [];

function formatHm(ts) {
  return new Date(ts).toLocaleTimeString("vi", { hour: "2-digit", minute: "2-digit" });
}

function renderPostTimeSuggestions(items) {
  const box = document.getElementById("postTimeSuggestBox");
  if (!box) return;
  if (!items || items.length < 1) {
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }

  const sorted = [...items].sort((a, b) => new Date(a.date) - new Date(b.date));
  const firstTs = new Date(sorted[0].date).getTime();
  if (!Number.isFinite(firstTs)) {
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }

  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  const candidates = [];
  for (let i = 1; i <= 24; i++) {
    const t1 = firstTs + i * oneHour;
    const t2 = firstTs + i * 2 * oneHour;
    if (t1 > now) candidates.push(t1);
    if (t2 > now) candidates.push(t2);
  }

  const unique = [...new Set(candidates)]
    .sort((a, b) => a - b)
    .slice(0, 4);

  if (unique.length === 0) {
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }

  box.style.display = "block";
  box.innerHTML = `
    <div class="post-time-suggest-title">🕒 Gợi ý giờ đăng tiếp theo (cách 1–2 giờ từ bài đầu)</div>
    <div class="post-time-suggest-list">
      ${unique.map((ts) => `<span class="post-time-pill">${formatHm(ts)}</span>`).join("")}
    </div>
  `;
}

async function loadHistory() {
  const data = await chrome.storage.local.get("history");
  historyData = data.history || [];
  const list = document.getElementById("historyList");
  const detail = document.getElementById("historyDetail");
  const actions = document.getElementById("historyActions");
  detail.style.display = "none";
  list.style.display = "block";
  actions.style.display = historyData.length > 0 ? "block" : "none";
  renderPostTimeSuggestions(historyData);
  if (historyData.length === 0) {
    list.innerHTML = '<p class="empty">Chưa có lịch sử</p>';
    return;
  }
  list.innerHTML = historyData
    .map((h, i) => {
      const bt = h.type || "summary";
      // Sử dụng esc() cho tất cả user-generated content để ngăn XSS
      const dateStr = esc(new Date(h.date).toLocaleString("vi"));
      const siteStr = esc(h.site || "");
      const textPreview = esc((h.text || "").substring(0, 80));
      const summaryPreview = esc((h.summary || "").substring(0, 120));
      return (
        '<div class="history-item" data-idx="' +
        i +
        '">' +
        '<div class="history-date">' +
        dateStr +
        " · " +
        siteStr +
        '<span class="history-badge ' +
        esc(bt) +
        '">' +
        (bt === "affiliate" ? "Affiliate" : "Tóm tắt") +
        "</span></div>" +
        '<div class="history-text">' +
        textPreview +
        "...</div>" +
        '<div class="history-summary">' +
        summaryPreview +
        "...</div></div>"
      );
    })
    .join("");
  // Update debug info
  if (typeof featureFlags !== 'undefined' && featureFlags.testMode) {
    updateDebugInfo();
  }
}

// Event delegation for history items
document.addEventListener("click", (e) => {
  if (e.target.closest(".history-item")) {
    const item = e.target.closest(".history-item");
    showHistoryDetail(+item.dataset.idx);
  }
});

function showHistoryDetail(idx) {
  const h = historyData[idx];
  if (!h) return;
  document.getElementById("historyList").style.display = "none";
  document.getElementById("historyActions").style.display = "none";
  document.getElementById("historyDetail").style.display = "block";
  document.getElementById("historyDetailDate").textContent =
    new Date(h.date).toLocaleString("vi") + " · " + (h.site || "");
  document.getElementById("historyDetailBody").textContent = h.summary || "";
}

document.getElementById("historyBack").addEventListener("click", () => {
  document.getElementById("historyDetail").style.display = "none";
  document.getElementById("historyList").style.display = "block";
  document.getElementById("historyActions").style.display = "block";
});

document.getElementById("historyDetailCopy").addEventListener("click", () => {
  navigator.clipboard
    .writeText(document.getElementById("historyDetailBody").textContent)
    .then(() => {
      const btn = document.getElementById("historyDetailCopy");
      btn.textContent = "Copied";
      setTimeout(() => {
        btn.textContent = "Copy";
      }, 1500);
    });
});

document.getElementById("exportBtn").addEventListener("click", async () => {
  const data = await chrome.storage.local.get("history");
  const blob = new Blob([JSON.stringify(data.history || [], null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "feedwriter-history.json";
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("exportMdBtn").addEventListener("click", async () => {
  const data = await chrome.storage.local.get("history");
  const hist = data.history || [];
  let md = "# Lịch sử FeedWriter\n\n";
  hist.forEach((h) => {
    md += `## ${new Date(h.date).toLocaleString("vi")} - ${h.site || ""}\n\n`;
    md += `> ${(h.text || "").replace(/\n/g, "\n> ").substring(0, 500)}...\n\n${h.summary}\n\n---\n\n`;
  });
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "feedwriter-history.md";
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("rescanBtn").addEventListener("click", async () => {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0]?.id) {
      showStatus("Không tìm thấy tab hiện tại", "error");
      return;
    }
    const res = await chrome.tabs.sendMessage(tabs[0].id, { action: "rescan-feed" });
    if (res?.ok) showStatus("Đã yêu cầu quét lại feed", "success");
    else showStatus(res?.error || "Không thể quét lại feed", "error");
  } catch (err) {
    showStatus("Lỗi quét lại: " + (err?.message || err), "error");
  }
});

document.getElementById("clearBtn").addEventListener("click", async () => {
  if (!confirm("Xóa toàn bộ lịch sử? (Có thể khôi phục trong 30 giây)")) return;

  // Soft delete: backup trước khi xóa
  const data = await chrome.storage.local.get("history");
  const backup = data.history || [];

  await chrome.storage.local.set({ history: [], historyBackup: { items: backup, deletedAt: Date.now() } });
  loadHistory();

  // Show undo option
  showStatus("Đã xóa lịch sử", "success");
  const undoBtn = document.createElement("button");
  undoBtn.textContent = "↩ Hoàn tác";
  undoBtn.style.cssText = "margin-left:8px;padding:3px 10px;border:1px solid #a855f7;border-radius:6px;background:transparent;color:#a855f7;font-size:12px;cursor:pointer;";
  undoBtn.addEventListener("click", async () => {
    const backupData = await chrome.storage.local.get("historyBackup");
    if (backupData.historyBackup && backupData.historyBackup.items) {
      await chrome.storage.local.set({ history: backupData.historyBackup.items });
      await chrome.storage.local.remove("historyBackup");
      loadHistory();
      showStatus("Đã khôi phục lịch sử", "success");
    }
  });
  status.appendChild(undoBtn);

  // Auto-remove backup after 30 seconds
  setTimeout(async () => {
    await chrome.storage.local.remove("historyBackup");
  }, 30000);
});

// === REVIEW TAB ===

// === AGENT STATS (Feature 7) ===
async function loadAgentStats() {
  try {
    const data = await chrome.storage.local.get(["agentStats", "agentPostedUrls", "fbsTelemetry"]);
    const stats = data.agentStats;
    const telemetry = data.fbsTelemetry || {};
    const box = document.getElementById("agentStatsBox");
    const hasAgentStats = !!stats || (data.agentPostedUrls && data.agentPostedUrls.length > 0);
    const hasTelemetry = (telemetry.postsScanned || 0) > 0;

    if (!hasAgentStats && !hasTelemetry) {
      box.style.display = "none";
      return;
    }

    // Always show the widget when there are stats
    box.style.display = "block";
    const today = new Date().toDateString();
    const postsToday = (stats && stats.postsTodayDate === today) ? (stats.postsToday || 0) : 0;
    const postsTotal = stats ? (stats.postsTotal || 0) : (data.agentPostedUrls ? data.agentPostedUrls.length : 0);
    const skippedToday = (stats && stats.postsTodayDate === today) ? (stats.skippedToday || 0) : 0;
    const flagged = (telemetry.postsFlaggedAds || 0) + (telemetry.postsFlaggedAffiliate || 0);

    document.getElementById("statPostsToday").textContent = hasAgentStats ? postsToday : (telemetry.postsScanned || 0);
    document.getElementById("statPostsTotal").textContent = hasAgentStats ? postsTotal : flagged;
    document.getElementById("statSkipped").textContent = hasAgentStats ? skippedToday : (telemetry.falsePositiveProxy || 0);

    if (hasAgentStats) {
      const lastPost = stats && stats.lastPostTime ? new Date(stats.lastPostTime).toLocaleString("vi") : "–";
      document.getElementById("statLastPost").textContent = lastPost;
    } else {
      const topReasons = telemetry.topReasons || {};
      const topReason = Object.entries(topReasons).sort((a, b) => b[1] - a[1])[0];
      document.getElementById("statLastPost").textContent = topReason ? `${topReason[0]} (${topReason[1]})` : "–";
    }
  } catch (err) {
    console.warn("[FeedWriter] Failed to load stats:", err?.message || err);
  }
}

// === ABOUT: load version from manifest ===
const ver = chrome.runtime.getManifest().version;
const verEl = document.getElementById("aboutVersion");
if (verEl) verEl.textContent = "FeedWriter v" + ver;

// === ACCORDION LOGIC ===
function toggleAccordion(header) {
  header.classList.toggle('active');
  const isActive = header.classList.contains('active');
  header.setAttribute('aria-expanded', String(isActive));

  const content = header.nextElementSibling;
  content.style.display = isActive ? 'block' : 'none';
}

document.querySelectorAll('.accordion-header').forEach(header => {
  header.addEventListener('click', () => toggleAccordion(header));
  header.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleAccordion(header);
    }
  });
});

// === TEMPLATE LIBRARY ===
const templateNameInput = document.getElementById("templateName");
const templateTypeSelect = document.getElementById("templateType");
const templatePromptInput = document.getElementById("templatePrompt");
const saveTemplateBtn = document.getElementById("saveTemplateBtn");
const clearTemplateFormBtn = document.getElementById("clearTemplateFormBtn");
const templateStatus = document.getElementById("templateStatus");
const templateList = document.getElementById("templateList");

// Load templates on init
loadTemplates();

// Save template
saveTemplateBtn.addEventListener("click", async () => {
  const name = templateNameInput.value.trim();
  const type = templateTypeSelect.value;
  const prompt = templatePromptInput.value.trim();

  if (!name) {
    showTemplateStatus("Vui lòng nhập tên template", "error");
    return;
  }

  if (!prompt) {
    showTemplateStatus("Vui lòng nhập nội dung prompt", "error");
    return;
  }

  const template = {
    id: Date.now().toString(),
    name,
    type,
    prompt,
    createdAt: Date.now()
  };

  const { templates = [] } = await chrome.storage.local.get("templates");
  templates.push(template);
  await chrome.storage.local.set({ templates });

  showTemplateStatus("Đã lưu template", "success");
  clearTemplateForm();
  loadTemplates();
});

// Clear template form
clearTemplateFormBtn.addEventListener("click", () => {
  clearTemplateForm();
});

function clearTemplateForm() {
  templateNameInput.value = "";
  templatePromptInput.value = "";
  templateTypeSelect.value = "summary";
}

// Load templates
async function loadTemplates() {
  const { templates = [] } = await chrome.storage.local.get("templates");

  if (templates.length === 0) {
    templateList.innerHTML = '<div class="template-empty">Chưa có template nào. Tạo template đầu tiên của bạn!</div>';
    return;
  }

  templateList.innerHTML = templates.map(template => `
    <div class="template-item" data-id="${template.id}">
      <div class="template-header">
        <div class="template-name">${escapeHtml(template.name)}</div>
        <div class="template-type ${template.type}">${template.type}</div>
      </div>
      <div class="template-prompt">${escapeHtml(template.prompt)}</div>
      <div class="template-actions">
        <button class="btn btn-secondary template-use-btn" data-id="${template.id}">Sử dụng</button>
        <button class="btn btn-danger template-delete-btn" data-id="${template.id}">Xóa</button>
      </div>
    </div>
  `).join('');

  // Add event listeners
  document.querySelectorAll('.template-use-btn').forEach(btn => {
    btn.addEventListener('click', () => useTemplate(btn.dataset.id));
  });

  document.querySelectorAll('.template-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteTemplate(btn.dataset.id));
  });
}

// Use template
async function useTemplate(id) {
  const { templates = [] } = await chrome.storage.local.get("templates");
  const template = templates.find(t => t.id === id);

  if (!template) return;

  // Apply template to appropriate field
  if (template.type === "summary") {
    customSummaryPromptEl.value = template.prompt;
  } else if (template.type === "affiliate") {
    customAffPromptEl.value = template.prompt;
  } else if (template.type === "status") {
    customSummaryPromptEl.value = template.prompt;
  }

  showTemplateStatus("Đã áp dụng template", "success");

  // Scroll to the field
  const targetField = template.type === "affiliate" ? customAffPromptEl : customSummaryPromptEl;
  targetField.scrollIntoView({ behavior: 'smooth', block: 'center' });
  targetField.focus();
}

// Delete template
async function deleteTemplate(id) {
  if (!confirm("Xóa template này?")) return;

  const { templates = [] } = await chrome.storage.local.get("templates");
  const filtered = templates.filter(t => t.id !== id);
  await chrome.storage.local.set({ templates: filtered });

  showTemplateStatus("Đã xóa template", "success");
  loadTemplates();
}

// Show template status
function showTemplateStatus(message, type) {
  templateStatus.textContent = message;
  templateStatus.className = `status ${type}`;
  templateStatus.style.display = "block";
  setTimeout(() => {
    templateStatus.style.display = "none";
  }, 3000);
}

// Escape HTML helper
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// === SETTINGS MANAGEMENT ===
const backupSettingsBtn = document.getElementById("backupSettingsBtn");
const restoreSettingsBtn = document.getElementById("restoreSettingsBtn");
const backupList = document.getElementById("backupList");
const settingsManagementStatus = document.getElementById("settingsManagementStatus");

// Load backup list on init
loadBackupList();

// Backup settings
backupSettingsBtn.addEventListener("click", async () => {
  try {
    const response = await chrome.runtime.sendMessage({ action: "backupSettings" });
    if (response && response.success) {
      showSettingsManagementStatus("Đã backup cài đặt", "success");
      loadBackupList();
    } else {
      showSettingsManagementStatus("Lỗi backup: " + (response?.error || "Unknown error"), "error");
    }
  } catch (error) {
    showSettingsManagementStatus("Lỗi backup: " + error.message, "error");
  }
});

// Restore settings (restore most recent)
restoreSettingsBtn.addEventListener("click", async () => {
  if (!confirm("Restore cài đặt từ backup gần nhất?")) return;

  try {
    const response = await chrome.runtime.sendMessage({ action: "restoreSettings", backupIndex: 0 });
    if (response && response.success) {
      showSettingsManagementStatus("Đã restore cài đặt. Reload trang để áp dụng.", "success");
      setTimeout(() => {
        location.reload();
      }, 1500);
    } else {
      showSettingsManagementStatus("Lỗi restore: " + (response?.error || "Unknown error"), "error");
    }
  } catch (error) {
    showSettingsManagementStatus("Lỗi restore: " + error.message, "error");
  }
});

// Load backup list
async function loadBackupList() {
  try {
    const data = await chrome.storage.local.get("settingsBackups");
    const backups = data.settingsBackups || [];

    if (backups.length === 0) {
      backupList.innerHTML = '<div style="text-align:center;padding:12px;color:var(--text-muted);font-size:11px;">Chưa có backup nào</div>';
      return;
    }

    // Show backups in reverse order (most recent first)
    backupList.innerHTML = backups.reverse().map((backup, index) => {
      const date = new Date(backup.timestamp);
      const dateStr = date.toLocaleString('vi-VN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });

      return `
        <div class="backup-item">
          <div class="backup-info">
            <div class="backup-date">${dateStr}</div>
            <div class="backup-version">Version ${backup.version}</div>
          </div>
          <div class="backup-actions">
            <button class="btn btn-secondary backup-restore-btn" data-index="${index}">Restore</button>
          </div>
        </div>
      `;
    }).join('');

    // Add event listeners
    document.querySelectorAll('.backup-restore-btn').forEach(btn => {
      btn.addEventListener('click', () => restoreFromBackup(parseInt(btn.dataset.index)));
    });
  } catch (error) {
    console.error("Failed to load backup list:", error);
  }
}

// Restore from specific backup
async function restoreFromBackup(index) {
  if (!confirm("Restore cài đặt từ backup này?")) return;

  try {
    const response = await chrome.runtime.sendMessage({ action: "restoreSettings", backupIndex: index });
    if (response && response.success) {
      showSettingsManagementStatus("Đã restore cài đặt. Reload trang để áp dụng.", "success");
      setTimeout(() => {
        location.reload();
      }, 1500);
    } else {
      showSettingsManagementStatus("Lỗi restore: " + (response?.error || "Unknown error"), "error");
    }
  } catch (error) {
    showSettingsManagementStatus("Lỗi restore: " + error.message, "error");
  }
}

// Show settings management status
function showSettingsManagementStatus(message, type) {
  settingsManagementStatus.textContent = message;
  settingsManagementStatus.className = `status ${type}`;
  settingsManagementStatus.style.display = "block";
  setTimeout(() => {
    settingsManagementStatus.style.display = "none";
  }, 3000);
}
