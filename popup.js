// === THEME ===
const themeSelect = document.getElementById("themeSelect");
chrome.storage.sync.get("theme", (d) => {
  const theme = d.theme || "dark";
  if (theme === "light") document.body.classList.add("light");
  themeSelect.value = theme;
});
themeSelect.addEventListener("change", () => {
  const theme = themeSelect.value;
  document.body.classList.toggle("light", theme === "light");
  chrome.storage.sync.set({ theme });
});

// === TABS ===
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById("tab-" + tab.dataset.tab).classList.add("active");
    if (tab.dataset.tab === "history") loadHistory();
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
const saveBtn = document.getElementById("saveBtn");
const status = document.getElementById("status");

chrome.storage.sync.get(["minLength","outputLang","summaryLength","promptStyle","customInstructions","customSummaryPrompt","customAffPrompt","sourceTemplate","apiKeys"], (d) => {
  if (d.minLength) minLengthInput.value = d.minLength;
  if (d.outputLang) outputLangSel.value = d.outputLang;
  if (d.summaryLength) summaryLengthSel.value = d.summaryLength;
  if (d.promptStyle) promptStyleSel.value = d.promptStyle;
  if (d.customInstructions) customInstructionsEl.value = d.customInstructions;
  if (d.customSummaryPrompt) customSummaryPromptEl.value = d.customSummaryPrompt;
  if (d.customAffPrompt) customAffPromptEl.value = d.customAffPrompt;
  if (d.sourceTemplate) sourceTemplateEl.value = d.sourceTemplate;
  const total = Object.values(d.apiKeys || {}).reduce((s, a) => s + (a ? a.length : 0), 0);
  if (total === 0) showStatus('Chưa có API Key. Thêm ở tab "API Keys".', "error");
});

saveBtn.addEventListener("click", () => {
  chrome.storage.sync.set({
    minLength: parseInt(minLengthInput.value) || 400,
    outputLang: outputLangSel.value,
    summaryLength: summaryLengthSel.value,
    promptStyle: promptStyleSel.value,
    customInstructions: customInstructionsEl.value.trim(),
    customSummaryPrompt: customSummaryPromptEl.value.trim(),
    customAffPrompt: customAffPromptEl.value.trim(),
    sourceTemplate: sourceTemplateEl.value.trim(),
  }, () => showStatus("Đã lưu", "success"));
});

function showStatus(msg, type) {
  status.textContent = msg;
  status.className = "status " + type;
  status.style.display = "block";
  setTimeout(() => { status.style.display = "none"; }, 4000);
}

function esc(s) { const d = document.createElement("span"); d.textContent = s; return d.innerHTML; }

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
  setTimeout(() => { keyStatus.style.display = "none"; }, 3500);
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
  if (keyEmptyState) keyEmptyState.style.display = totalKeys === 0 ? "block" : "none";
}

function renderKeyList(provider, keys, keyStatusData) {
  const cap = provider.charAt(0).toUpperCase() + provider.slice(1);
  const container = document.getElementById("keyList" + cap + "Items");
  if (!container || keys.length === 0) { if (container) container.innerHTML = ""; return; }

  container.innerHTML = keys.map((key, i) => {
    const info = keyStatusData[key] || {};
    let cls, txt;
    if (info.rateLimitedUntil && Date.now() < info.rateLimitedUntil) {
      cls = "rate-limited";
      txt = "limit " + Math.ceil((info.rateLimitedUntil - Date.now()) / 60000) + "p";
    } else if (info.lastUsed && (Date.now() - info.lastUsed) < 60000) {
      cls = "active"; txt = "vừa dùng";
    } else {
      cls = "idle"; txt = "OK";
    }
    return '<div class="key-item">' +
      '<span class="key-item-text">' + esc(maskKey(key)) + '</span>' +
      '<span class="key-item-status ' + cls + '">' + txt + '</span>' +
      '<button class="key-item-delete" data-provider="' + provider + '" data-idx="' + i + '" title="Xóa key">&times;</button>' +
      '</div>';
  }).join("");

  container.querySelectorAll(".key-item-delete").forEach(btn => {
    btn.addEventListener("click", async () => {
      const d = await chrome.storage.sync.get(["apiKeys"]);
      const apiKeys = d.apiKeys || {};
      if (apiKeys[btn.dataset.provider]) apiKeys[btn.dataset.provider].splice(+btn.dataset.idx, 1);
      await chrome.storage.sync.set({ apiKeys });
      loadKeyLists();
      showKeyStatus("Đã xóa", "success");
    });
  });
}

addKeyBtn.addEventListener("click", async () => {
  const key = newApiKeyInput.value.trim();
  if (!key) { showKeyStatus("Nhập API Key", "error"); return; }
  const provider = detectProvider(key);
  const data = await chrome.storage.sync.get(["apiKeys"]);
  const apiKeys = data.apiKeys || {};
  for (const p of ALL_PROVIDERS) { if (!apiKeys[p]) apiKeys[p] = []; }
  if (apiKeys[provider].includes(key)) { showKeyStatus("Key đã tồn tại", "error"); return; }
  apiKeys[provider].push(key);
  await chrome.storage.sync.set({ apiKeys });
  newApiKeyInput.value = "";
  loadKeyLists();
  showKeyStatus("Đã thêm — " + provider.charAt(0).toUpperCase() + provider.slice(1), "success");
});

testBtn.addEventListener("click", async () => {
  const data = await chrome.storage.sync.get(["apiKeys"]);
  const total = Object.values(data.apiKeys || {}).reduce((s, a) => s + (a ? a.length : 0), 0);
  if (total === 0) { showKeyStatus("Chưa có API Key", "error"); return; }
  testBtn.disabled = true;
  testBtn.textContent = "Đang test...";
  try {
    const r = await chrome.runtime.sendMessage({ action: "test-connection" });
    showKeyStatus(r?.ok ? "OK — " + r.provider : (r?.error || "Lỗi"), r?.ok ? "success" : "error");
  } catch (e) { showKeyStatus("Lỗi: " + e.message, "error"); }
  testBtn.disabled = false;
  testBtn.textContent = "Test kết nối";
});

// Migrate old single apiKey
(async () => {
  const data = await chrome.storage.sync.get(["apiKey", "apiKeys", "provider"]);
  const apiKeys = data.apiKeys || {};
  for (const p of ALL_PROVIDERS) { if (!apiKeys[p]) apiKeys[p] = []; }
  if (data.apiKey) {
    const provider = data.provider || detectProvider(data.apiKey);
    if (!apiKeys[provider].includes(data.apiKey)) apiKeys[provider].push(data.apiKey);
    await chrome.storage.sync.set({ apiKeys });
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
  if (historyData.length === 0) { list.innerHTML = '<p class="empty">Chưa có lịch sử</p>'; return; }
  list.innerHTML = historyData.map((h, i) => {
    const bt = h.type || "summary";
    return '<div class="history-item" data-idx="' + i + '">' +
      '<div class="history-date">' + esc(new Date(h.date).toLocaleString("vi")) + ' · ' + esc(h.site || "") +
      '<span class="history-badge ' + bt + '">' + (bt === "affiliate" ? "Affiliate" : "Tóm tắt") + '</span></div>' +
      '<div class="history-text">' + esc((h.text || "").substring(0, 80)) + '...</div>' +
      '<div class="history-summary">' + esc((h.summary || "").substring(0, 120)) + '...</div></div>';
  }).join("");
  list.querySelectorAll(".history-item").forEach(item => {
    item.addEventListener("click", () => showHistoryDetail(+item.dataset.idx));
  });
}

function showHistoryDetail(idx) {
  const h = historyData[idx]; if (!h) return;
  document.getElementById("historyList").style.display = "none";
  document.getElementById("historyActions").style.display = "none";
  document.getElementById("historyDetail").style.display = "block";
  document.getElementById("historyDetailDate").textContent = new Date(h.date).toLocaleString("vi") + " · " + (h.site || "");
  document.getElementById("historyDetailBody").textContent = h.summary || "";
}

document.getElementById("historyBack").addEventListener("click", () => {
  document.getElementById("historyDetail").style.display = "none";
  document.getElementById("historyList").style.display = "block";
  document.getElementById("historyActions").style.display = "block";
});

document.getElementById("historyDetailCopy").addEventListener("click", () => {
  navigator.clipboard.writeText(document.getElementById("historyDetailBody").textContent).then(() => {
    const btn = document.getElementById("historyDetailCopy");
    btn.textContent = "Copied"; setTimeout(() => { btn.textContent = "Copy"; }, 1500);
  });
});

document.getElementById("exportBtn").addEventListener("click", async () => {
  const data = await chrome.storage.local.get("history");
  const blob = new Blob([JSON.stringify(data.history || [], null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = "feedwriter-history.json"; a.click(); URL.revokeObjectURL(url);
});

document.getElementById("exportMdBtn").addEventListener("click", async () => {
  const data = await chrome.storage.local.get("history");
  const hist = data.history || [];
  let md = "# Lịch sử FeedWriter\n\n";
  hist.forEach(h => {
    md += `## ${new Date(h.date).toLocaleString("vi")} - ${h.site || ""}\n\n`;
    md += `> ${(h.text || "").replace(/\n/g, "\n> ").substring(0, 500)}...\n\n${h.summary}\n\n---\n\n`;
  });
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = "feedwriter-history.md"; a.click(); URL.revokeObjectURL(url);
});

document.getElementById("clearBtn").addEventListener("click", async () => {
  if (!confirm("Xóa toàn bộ lịch sử?")) return;
  await chrome.storage.local.remove("history"); loadHistory();
});

// === REVIEW TAB ===
let reviewItems = [];

function setAlarmButtonState(on) {
  document.getElementById("setAlarmBtn").classList.toggle("alarm-active", on);
}

async function loadReviewTab() {
  let data = null;
  try { data = await chrome.runtime.sendMessage({ action: "get-ai-review" }); } catch (_) { }
  if (data && data.items && data.items.length > 0 && data.date === new Date().toISOString().slice(0, 10)) {
    reviewItems = data.items; renderReviewResults();
  }
  const alarmData = await chrome.storage.local.get("reviewAlarm");
  const alarm = alarmData.reviewAlarm;
  const alarmEl = document.getElementById("alarmStatus");
  if (alarm && alarm.enabled) {
    const t = String(alarm.hour).padStart(2, "0") + ":" + String(alarm.minute).padStart(2, "0");
    document.getElementById("reviewTime").value = t;
    alarmEl.textContent = "Bật — " + t + " mỗi ngày";
    alarmEl.className = "review-alarm-status alarm-on";
    setAlarmButtonState(true);
  } else {
    alarmEl.textContent = "Chưa bật";
    alarmEl.className = "review-alarm-status";
    setAlarmButtonState(false);
  }
}

function renderReviewResults() {
  document.getElementById("reviewResults").style.display = "block";
  document.getElementById("reviewCount").textContent = reviewItems.length + " tin hay";
  const list = document.getElementById("reviewList");
  list.innerHTML = reviewItems.map((item, i) => {
    const title = esc(item.postTitle || item.summary.split(/[.\n]/)[0].substring(0, 80));
    const img = item.imageUrl ? '<img class="review-item-thumb" src="' + esc(item.imageUrl) + '" onerror="this.style.display=\'none\'">' : '';
    return '<div class="review-item"><input type="checkbox" class="review-check" data-idx="' + i + '" checked>' +
      '<div class="review-item-content"><div class="review-item-title">' + title + '</div>' +
      '<div class="review-item-meta">' + esc(item.author || item.site || "") + ' · ' + esc(item.aiReason || "") + '</div></div>' +
      (item.aiScore ? '<span class="review-item-score">' + item.aiScore + '</span>' : '') + img + '</div>';
  }).join("");
  // Use a single delegated handler instead of re-adding listeners
  const selectAll = document.getElementById("selectAllReview");
  selectAll.checked = true;
  selectAll.onchange = (e) => {
    list.querySelectorAll(".review-check").forEach(cb => { cb.checked = e.target.checked; });
  };
}

document.getElementById("aiReviewBtn").addEventListener("click", async () => {
  const btn = document.getElementById("aiReviewBtn");
  const st = document.getElementById("reviewStatus");
  btn.disabled = true; btn.textContent = "Đang phân tích..."; st.style.display = "none";
  try {
    const r = await chrome.runtime.sendMessage({ action: "ai-review" });
    if (r.error) { st.textContent = r.error; st.className = "status error"; st.style.display = "block"; }
    else if (r.success) { reviewItems = r.items; renderReviewResults(); st.textContent = "Tìm được " + r.count + " tin hay"; st.className = "status success"; st.style.display = "block"; }
  } catch (e) { st.textContent = "Lỗi: " + e.message; st.className = "status error"; st.style.display = "block"; }
  btn.disabled = false; btn.textContent = "AI Đề xuất tin hay";
});

document.getElementById("exportDtcnBtn").addEventListener("click", async () => {
  const sel = Array.from(document.querySelectorAll(".review-check:checked")).map(cb => reviewItems[+cb.dataset.idx]).filter(Boolean);
  if (!sel.length) { alert("Chọn ít nhất 1 tin"); return; }
  const r = await chrome.runtime.sendMessage({ action: "export-dtcn", items: sel });
  if (r && r.data) {
    const blob = new Blob([JSON.stringify({ _scanned_candidates: r.data, source: "feedwriter", exported_at: new Date().toISOString(), count: r.data.length }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = "feedwriter-dtcn-" + new Date().toISOString().slice(0, 10) + ".json"; a.click(); URL.revokeObjectURL(url);
  }
});

document.getElementById("setAlarmBtn").addEventListener("click", async () => {
  const t = document.getElementById("reviewTime").value; if (!t) return;
  const [h, m] = t.split(":").map(Number);
  await chrome.storage.local.set({ reviewAlarm: { hour: h, minute: m, enabled: true } });
  const alarmEl = document.getElementById("alarmStatus");
  alarmEl.textContent = "Bật — " + t + " mỗi ngày";
  alarmEl.className = "review-alarm-status alarm-on";
  setAlarmButtonState(true);
  chrome.runtime.sendMessage({ action: "set-review-alarm", hour: h, minute: m }).catch(() => { });
});

document.getElementById("clearAlarmBtn").addEventListener("click", async () => {
  await chrome.storage.local.set({ reviewAlarm: { enabled: false } });
  const alarmEl = document.getElementById("alarmStatus");
  alarmEl.textContent = "Đã tắt";
  alarmEl.className = "review-alarm-status";
  setAlarmButtonState(false);
  chrome.runtime.sendMessage({ action: "clear-review-alarm" }).catch(() => { });
});

// === ABOUT: load version from manifest ===
const ver = chrome.runtime.getManifest().version;
const verEl = document.getElementById("aboutVersion");
if (verEl) verEl.textContent = "FeedWriter v" + ver;
