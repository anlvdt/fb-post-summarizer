// === THEME ===
const themeSelect = document.getElementById("themeSelect");
chrome.storage.sync.get("theme", (d) => {
  if (chrome.runtime.lastError) {
    console.error("Failed to load theme:", chrome.runtime.lastError);
    return;
  }
  const theme = d.theme || "dark";
  if (theme === "light") document.body.classList.add("light");
  themeSelect.value = theme;
});
themeSelect.addEventListener("change", () => {
  const theme = themeSelect.value;
  document.body.classList.toggle("light", theme === "light");
  chrome.storage.sync.set({ theme }, () => {
    if (chrome.runtime.lastError) {
      console.error("Failed to save theme:", chrome.runtime.lastError);
    }
  });
});

// === TABS ===
// Cache selectors for better performance
const allTabs = document.querySelectorAll(".tab");
const allTabContents = document.querySelectorAll(".tab-content");

allTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    allTabs.forEach((t) => t.classList.remove("active"));
    allTabContents.forEach((c) => c.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById("tab-" + tab.dataset.tab).classList.add("active");
    if (tab.dataset.tab === "history") { loadHistory(); loadAgentStats(); }
    if (tab.dataset.tab === "review") loadReviewTab();
    if (tab.dataset.tab === "apikeys") loadKeyLists();
  });
});

// === SETTINGS ===
const minLengthInput = document.getElementById("minLength");
const outputLangSel = document.getElementById("outputLang");
const summaryLengthSel = document.getElementById("summaryLength");
const promptStyleSel = document.getElementById("promptStyle");
const customInstructionsEl = document.getElementById("customInstructions");
const customSummaryPromptEl = document.getElementById("customSummaryPrompt");
const customAffPromptEl = document.getElementById("customAffPrompt");
const sourceTemplateEl = document.getElementById("sourceTemplate");
const useHeuristicEvalEl = document.getElementById("useHeuristicEval");
const blockedDomainsEl = document.getElementById("blockedDomains");
const saveBtn = document.getElementById("saveBtn");
const status = document.getElementById("status");

chrome.storage.sync.get(
  [
    "minLength",
    "outputLang",
    "summaryLength",
    "promptStyle",
    "customInstructions",
    "customSummaryPrompt",
    "customAffPrompt",
    "sourceTemplate",
    "useHeuristicEval",
    "blockedDomains",
    "apiKeys",
  ],
  (d) => {
    if (d.minLength) minLengthInput.value = d.minLength;
    if (d.outputLang) outputLangSel.value = d.outputLang;
    if (d.summaryLength) summaryLengthSel.value = d.summaryLength;
    if (d.promptStyle) promptStyleSel.value = d.promptStyle;
    if (d.customInstructions) customInstructionsEl.value = d.customInstructions;
    if (d.customSummaryPrompt)
      customSummaryPromptEl.value = d.customSummaryPrompt;
    if (d.customAffPrompt) customAffPromptEl.value = d.customAffPrompt;
    if (d.sourceTemplate) sourceTemplateEl.value = d.sourceTemplate;
    if (d.useHeuristicEval) useHeuristicEvalEl.checked = true;
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
      outputLang: outputLangSel.value,
      summaryLength: summaryLengthSel.value,
      promptStyle: promptStyleSel.value,
      customInstructions: customInstructionsEl.value.trim(),
      customSummaryPrompt: customSummaryPromptEl.value.trim(),
      customAffPrompt: customAffPromptEl.value.trim(),
      sourceTemplate: sourceTemplateEl.value.trim(),
      useHeuristicEval: useHeuristicEvalEl.checked,
      blockedDomains: blockedDomainsEl.value.trim(),
    },
    () => showStatus("Đã lưu", "success"),
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

testBtn.addEventListener("click", async () => {
  const data = await chrome.storage.sync.get(["apiKeys"]);
  const total = Object.values(data.apiKeys || {}).reduce(
    (s, a) => s + (a ? a.length : 0),
    0,
  );
  if (total === 0) {
    showKeyStatus("Chưa có API Key. Thêm key ở ô bên trên.", "error");
    return;
  }
  testBtn.disabled = true;
  testBtn.textContent = "Đang test...";
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
  testBtn.disabled = false;
  testBtn.textContent = "Test kết nối";
});

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

async function loadHistory() {
  const data = await chrome.storage.local.get("history");
  historyData = data.history || [];
  const list = document.getElementById("historyList");
  const detail = document.getElementById("historyDetail");
  const actions = document.getElementById("historyActions");
  detail.style.display = "none";
  list.style.display = "block";
  actions.style.display = historyData.length > 0 ? "block" : "none";
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
    const data = await chrome.storage.local.get(["agentStats", "agentPostedUrls"]);
    const stats = data.agentStats;
    const box = document.getElementById("agentStatsBox");
    if (!stats && (!data.agentPostedUrls || data.agentPostedUrls.length === 0)) {
      box.style.display = "none";
      return;
    }
    box.style.display = "block";
    const today = new Date().toDateString();
    const postsToday = (stats && stats.postsTodayDate === today) ? (stats.postsToday || 0) : 0;
    document.getElementById("statPostsToday").textContent = postsToday;
    document.getElementById("statPostsTotal").textContent = stats ? (stats.postsTotal || 0) : (data.agentPostedUrls ? data.agentPostedUrls.length : 0);
    document.getElementById("statSkipped").textContent = (stats && stats.postsTodayDate === today) ? (stats.skippedToday || 0) : 0;
    const lastPost = stats && stats.lastPostTime ? new Date(stats.lastPostTime).toLocaleString("vi") : "–";
    document.getElementById("statLastPost").textContent = lastPost;
  } catch (_) {}
}

// === ABOUT: load version from manifest ===
const ver = chrome.runtime.getManifest().version;
const verEl = document.getElementById("aboutVersion");
if (verEl) verEl.textContent = "FeedWriter v" + ver;

// === ACCORDION LOGIC ===
document.querySelectorAll('.accordion-header').forEach(header => {
  header.addEventListener('click', () => {
    // Toggle active class on header
    header.classList.toggle('active');
    
    // Toggle display on content
    const content = header.nextElementSibling;
    if (header.classList.contains('active')) {
      content.style.display = 'block';
    } else {
      content.style.display = 'none';
    }
  });
});
