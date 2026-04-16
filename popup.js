// === TABS ===
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById("tab-" + tab.dataset.tab).classList.add("active");
    if (tab.dataset.tab === "history") loadHistory();
  });
});

// === SETTINGS ===
const providerSel = document.getElementById("provider");
const apiKeyInput = document.getElementById("apiKey");
const minLengthInput = document.getElementById("minLength");
const outputLangSel = document.getElementById("outputLang");
const customPromptEl = document.getElementById("customPrompt");
const customAffPromptEl = document.getElementById("customAffPrompt");
const toggleKeyBtn = document.getElementById("toggleKey");
const saveBtn = document.getElementById("saveBtn");
const testBtn = document.getElementById("testBtn");
const status = document.getElementById("status");
const linkGroq = document.getElementById("linkGroq");
const linkGemini = document.getElementById("linkGemini");

const KEYS = ["apiKey", "minLength", "provider", "outputLang", "customPrompt", "customAffPrompt"];

chrome.storage.sync.get(KEYS, (d) => {
  if (d.apiKey) apiKeyInput.value = d.apiKey;
  if (d.minLength) minLengthInput.value = d.minLength;
  if (d.provider) providerSel.value = d.provider;
  if (d.outputLang) outputLangSel.value = d.outputLang;
  if (d.customPrompt) customPromptEl.value = d.customPrompt;
  if (d.customAffPrompt) customAffPromptEl.value = d.customAffPrompt;
  updateLinks();

  // Onboarding: highlight API key if empty
  if (!d.apiKey) {
    showStatus("👋 Nhập API Key để bắt đầu sử dụng!", "success");
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
    customPrompt: customPromptEl.value.trim(),
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
  if (!msg.includes("👋")) setTimeout(() => { status.style.display = "none"; }, 3000);
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
    const badgeText = badgeType === "affiliate" ? "🛒 Affiliate" : "📝 Status";
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
