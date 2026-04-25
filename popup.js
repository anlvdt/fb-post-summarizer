// === TABS ===
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById("tab-" + tab.dataset.tab).classList.add("active");
    if (tab.dataset.tab === "history") loadHistory();
    if (tab.dataset.tab === "review") loadReviewTab();
  });
});

// === SETTINGS ===
const providerSel = document.getElementById("provider");
const apiKeyInput = document.getElementById("apiKey");
const minLengthInput = document.getElementById("minLength");
const outputLangSel = document.getElementById("outputLang");
const summaryLengthSel = document.getElementById("summaryLength");
const promptStyleSel = document.getElementById("promptStyle");
const customInstructionsEl = document.getElementById("customInstructions");
const customSummaryPromptEl = document.getElementById("customSummaryPrompt");
const customAffPromptEl = document.getElementById("customAffPrompt");
const toggleKeyBtn = document.getElementById("toggleKey");
const saveBtn = document.getElementById("saveBtn");
const testBtn = document.getElementById("testBtn");
const status = document.getElementById("status");
const linkGroq = document.getElementById("linkGroq");
const linkGemini = document.getElementById("linkGemini");

const KEYS = [
  "apiKey", "minLength", "provider", "outputLang",
  "summaryLength", "promptStyle", "customInstructions",
  "customSummaryPrompt", "customAffPrompt"
];

chrome.storage.sync.get(KEYS, (d) => {
  if (d.apiKey) apiKeyInput.value = d.apiKey;
  if (d.minLength) minLengthInput.value = d.minLength;
  if (d.provider) providerSel.value = d.provider;
  if (d.outputLang) outputLangSel.value = d.outputLang;
  if (d.summaryLength) summaryLengthSel.value = d.summaryLength;
  if (d.promptStyle) promptStyleSel.value = d.promptStyle;
  if (d.customInstructions) customInstructionsEl.value = d.customInstructions;
  if (d.customSummaryPrompt) customSummaryPromptEl.value = d.customSummaryPrompt;
  if (d.customAffPrompt) customAffPromptEl.value = d.customAffPrompt;
  updateLinks();

  // Onboarding: highlight API key if empty
  if (!d.apiKey) {
    showStatus("Nhập API Key để bắt đầu sử dụng!", "success");
    apiKeyInput.style.borderColor = "#a855f7";
    apiKeyInput.focus();
  }
});

providerSel.addEventListener("change", updateLinks);
toggleKeyBtn.addEventListener("click", () => {
  apiKeyInput.type = apiKeyInput.type === "password" ? "text" : "password";
});

function updateLinks() {
  const g = providerSel.value === "groq";
  linkGroq.style.display = g ? "block" : "none";
  linkGemini.style.display = g ? "none" : "block";
  apiKeyInput.placeholder = g ? "gsk_..." : "AI...";
}

saveBtn.addEventListener("click", () => {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) { showStatus("Nhập API Key", "error"); return; }
  apiKeyInput.style.borderColor = "";
  chrome.storage.sync.set({
    apiKey,
    minLength: parseInt(minLengthInput.value) || 400,
    provider: providerSel.value,
    outputLang: outputLangSel.value,
    summaryLength: summaryLengthSel.value,
    promptStyle: promptStyleSel.value,
    customInstructions: customInstructionsEl.value.trim(),
    customSummaryPrompt: customSummaryPromptEl.value.trim(),
    customAffPrompt: customAffPromptEl.value.trim(),
  }, () => showStatus("Đã lưu ✓", "success"));
});

testBtn.addEventListener("click", async () => {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) { showStatus("Nhập API Key trước", "error"); return; }
  await chrome.storage.sync.set({ apiKey, provider: providerSel.value });
  showStatus("Đang test...", "success");
  try {
    const r = await chrome.runtime.sendMessage({ action: "summarize", text: "Test connection. Reply: OK" });
    showStatus(r?.summary ? "Kết nối OK ✓" : (r?.error || "Lỗi"), r?.summary ? "success" : "error");
  } catch (e) { showStatus("Lỗi: " + e.message, "error"); }
});

function showStatus(msg, type) {
  status.textContent = msg;
  status.className = "status " + type;
  status.style.display = "block";
  if (!msg.includes("Nhập API Key")) setTimeout(() => { status.style.display = "none"; }, 3000);
}

// === HISTORY ===
function esc(s) { const d = document.createElement("span"); d.textContent = s; return d.innerHTML; }
let historyData = [];

async function loadHistory() {
  const data = await chrome.storage.local.get("history");
  historyData = data.history || [];
  const list = document.getElementById("historyList");
  const detail = document.getElementById("historyDetail");
  const actions = document.getElementById("historyActions");
  detail.style.display = "none";
  list.style.display = "block";
  actions.style.display = "block";

  if (historyData.length === 0) {
    list.innerHTML = '<p class="empty">Chưa có lịch sử</p>';
    return;
  }
  list.innerHTML = historyData.map((h, i) => {
    const badgeType = h.type || "summary";
    const badgeText = badgeType === "affiliate" ? "Affiliate" : "Tóm tắt";
    return '<div class="history-item" data-idx="' + i + '">' +
      '<div class="history-date">' + esc(new Date(h.date).toLocaleString("vi")) + ' · ' + esc(h.site || "") +
      '<span class="history-badge ' + badgeType + '">' + badgeText + '</span></div>' +
      '<div class="history-text">' + esc((h.text || "").substring(0, 80)) + '...</div>' +
      '<div class="history-summary">' + esc((h.summary || "").substring(0, 120)) + '...</div>' +
      '</div>'
  }).join("");

  list.querySelectorAll(".history-item").forEach(item => {
    item.addEventListener("click", () => showHistoryDetail(+item.dataset.idx));
  });
}

function showHistoryDetail(idx) {
  const h = historyData[idx];
  if (!h) return;
  document.getElementById("historyList").style.display = "none";
  document.getElementById("historyActions").style.display = "none";
  const detail = document.getElementById("historyDetail");
  detail.style.display = "block";
  document.getElementById("historyDetailDate").textContent = new Date(h.date).toLocaleString("vi") + " · " + (h.site || "");
  document.getElementById("historyDetailBody").textContent = h.summary || "";
}

document.getElementById("historyBack").addEventListener("click", () => {
  document.getElementById("historyDetail").style.display = "none";
  document.getElementById("historyList").style.display = "block";
  document.getElementById("historyActions").style.display = "block";
});

document.getElementById("historyDetailCopy").addEventListener("click", () => {
  const text = document.getElementById("historyDetailBody").textContent;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById("historyDetailCopy");
    btn.textContent = "Copied ✓";
    setTimeout(() => { btn.textContent = "Copy"; }, 1500);
  });
});

document.getElementById("exportBtn").addEventListener("click", async () => {
  const data = await chrome.storage.local.get("history");
  const blob = new Blob([JSON.stringify(data.history || [], null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "summarizer-history.json"; a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("exportMdBtn").addEventListener("click", async () => {
  const data = await chrome.storage.local.get("history");
  const hist = data.history || [];
  let mdStr = "# Lịch sử Social Content Repurposer\n\n";
  hist.forEach(h => {
    mdStr += `## ${new Date(h.date).toLocaleString("vi")} - ${h.site || ""} [${(h.type || "summary").toUpperCase()}]\n\n`;
    mdStr += `**Bài gốc:**\n> ${h.text.replace(/\n/g, "\n> ")}...\n\n`;
    mdStr += `**Output:**\n${h.summary}\n\n---\n\n`;
  });
  const blob = new Blob([mdStr], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "summarizer-history.md"; a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("clearBtn").addEventListener("click", async () => {
  await chrome.storage.local.remove("history");
  loadHistory();
  showStatus("Đã xóa", "success");
});

// === REVIEW TAB ===
let reviewItems = [];

function setAlarmButtonState(enabled) {
  const btnOn = document.getElementById("setAlarmBtn");
  const btnOff = document.getElementById("clearAlarmBtn");
  if (enabled) {
    btnOn.classList.add("alarm-active");
    btnOff.classList.remove("alarm-active");
  } else {
    btnOn.classList.remove("alarm-active");
    btnOff.classList.remove("alarm-active");
  }
}

async function loadReviewTab() {
  // Load existing review results
  let data = null;
  try { data = await chrome.runtime.sendMessage({ action: "get-ai-review" }); } catch (_) { }
  if (data && data.items && data.items.length > 0) {
    const today = new Date().toISOString().slice(0, 10);
    if (data.date === today) {
      reviewItems = data.items;
      renderReviewResults();
    }
  }
  // Load alarm status
  const alarmData = await chrome.storage.local.get("reviewAlarm");
  const alarm = alarmData.reviewAlarm;
  if (alarm && alarm.enabled) {
    document.getElementById("reviewTime").value =
      String(alarm.hour).padStart(2, "0") + ":" + String(alarm.minute).padStart(2, "0");
    document.getElementById("alarmStatus").textContent = "Đã bật — chạy lúc " +
      String(alarm.hour).padStart(2, "0") + ":" + String(alarm.minute).padStart(2, "0") + " mỗi ngày";
    document.getElementById("alarmStatus").style.color = "#34d399";
    setAlarmButtonState(true);
  } else {
    document.getElementById("alarmStatus").textContent = "Chưa bật";
    document.getElementById("alarmStatus").style.color = "#666";
    setAlarmButtonState(false);
  }
}

function renderReviewResults() {
  const container = document.getElementById("reviewResults");
  const list = document.getElementById("reviewList");
  const countEl = document.getElementById("reviewCount");

  container.style.display = "block";
  countEl.textContent = `AI chọn ${reviewItems.length} tin hay`;

  list.innerHTML = reviewItems.map((item, i) => {
    const title = esc(item.postTitle || item.summary.split(/[.\n]/)[0].substring(0, 80));
    const imgHtml = item.imageUrl
      ? '<img class="review-item-thumb" src="' + esc(item.imageUrl) + '" onerror="this.style.display=\'none\'">'
      : '';
    return '<div class="review-item">' +
      '<input type="checkbox" class="review-check" data-idx="' + i + '" checked>' +
      '<div class="review-item-content">' +
      '<div class="review-item-title">' + title + '</div>' +
      '<div class="review-item-meta">' + esc(item.author || item.site || "") + ' · ' + esc(item.aiReason || "") + '</div>' +
      '</div>' +
      (item.aiScore ? '<span class="review-item-score">' + item.aiScore + '</span>' : '') +
      imgHtml +
      '</div>';
  }).join("");

  // Select all checkbox
  document.getElementById("selectAllReview").checked = true;
  document.getElementById("selectAllReview").addEventListener("change", (e) => {
    list.querySelectorAll(".review-check").forEach(cb => { cb.checked = e.target.checked; });
  });
}

// AI Review button
document.getElementById("aiReviewBtn").addEventListener("click", async () => {
  const btn = document.getElementById("aiReviewBtn");
  const statusEl = document.getElementById("reviewStatus");
  btn.disabled = true;
  btn.textContent = "Đang phân tích...";
  statusEl.style.display = "none";

  try {
    const result = await chrome.runtime.sendMessage({ action: "ai-review" });
    if (result.error) {
      statusEl.textContent = result.error;
      statusEl.className = "status error";
      statusEl.style.display = "block";
    } else if (result.success) {
      reviewItems = result.items;
      renderReviewResults();
      statusEl.textContent = `Đã tìm ${result.count} tin hay!`;
      statusEl.className = "status success";
      statusEl.style.display = "block";
    }
  } catch (e) {
    statusEl.textContent = "Lỗi: " + e.message;
    statusEl.className = "status error";
    statusEl.style.display = "block";
  }

  btn.disabled = false;
  btn.textContent = "AI Đề xuất tin hay";
});

// Export DTCN JSON
document.getElementById("exportDtcnBtn").addEventListener("click", async () => {
  const checks = document.querySelectorAll(".review-check:checked");
  const selectedItems = Array.from(checks).map(cb => reviewItems[+cb.dataset.idx]).filter(Boolean);

  if (selectedItems.length === 0) {
    alert("Chọn ít nhất 1 tin để export!");
    return;
  }

  const result = await chrome.runtime.sendMessage({ action: "export-dtcn", items: selectedItems });
  if (result && result.data) {
    const exportPayload = {
      _scanned_candidates: result.data,
      source: "feedwriter",
      exported_at: new Date().toISOString(),
      count: result.data.length,
    };
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const dateStr = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = "feedwriter-dtcn-" + dateStr + ".json";
    a.click();
    URL.revokeObjectURL(url);
  }
});

// Alarm controls
document.getElementById("setAlarmBtn").addEventListener("click", async () => {
  const time = document.getElementById("reviewTime").value;
  if (!time) return;
  const [hour, minute] = time.split(":").map(Number);
  await chrome.storage.local.set({ reviewAlarm: { hour, minute, enabled: true } });
  document.getElementById("alarmStatus").textContent = "Đã bật — chạy lúc " + time + " mỗi ngày";
  document.getElementById("alarmStatus").style.color = "#34d399";
  setAlarmButtonState(true);
  chrome.runtime.sendMessage({ action: "set-review-alarm", hour, minute }).catch(() => { });
});

document.getElementById("clearAlarmBtn").addEventListener("click", async () => {
  await chrome.storage.local.set({ reviewAlarm: { enabled: false } });
  document.getElementById("alarmStatus").textContent = "Đã tắt";
  document.getElementById("alarmStatus").style.color = "#666";
  setAlarmButtonState(false);
  chrome.runtime.sendMessage({ action: "clear-review-alarm" }).catch(() => { });
});
