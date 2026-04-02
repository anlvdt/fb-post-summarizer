const providerSel = document.getElementById("provider");
const apiKeyInput = document.getElementById("apiKey");
const minLengthInput = document.getElementById("minLength");
const saveBtn = document.getElementById("saveBtn");
const status = document.getElementById("status");
const linkGroq = document.getElementById("linkGroq");
const linkGemini = document.getElementById("linkGemini");

chrome.storage.sync.get(["apiKey", "minLength", "provider"], (data) => {
  if (data.apiKey) apiKeyInput.value = data.apiKey;
  if (data.minLength) minLengthInput.value = data.minLength;
  if (data.provider) providerSel.value = data.provider;
  updateLinks();
});

providerSel.addEventListener("change", updateLinks);

function updateLinks() {
  const isGroq = providerSel.value === "groq";
  linkGroq.style.display = isGroq ? "block" : "none";
  linkGemini.style.display = isGroq ? "none" : "block";
  apiKeyInput.placeholder = isGroq ? "gsk_... (từ console.groq.com)" : "AI... (từ aistudio.google.com)";
}

saveBtn.addEventListener("click", () => {
  const apiKey = apiKeyInput.value.trim();
  const minLength = parseInt(minLengthInput.value) || 400;
  const provider = providerSel.value;
  if (!apiKey) { showStatus("Vui lòng nhập API Key", "error"); return; }
  chrome.storage.sync.set({ apiKey, minLength, provider }, () => {
    showStatus("Đã lưu thành công", "success");
  });
});

function showStatus(msg, type) {
  status.textContent = msg;
  status.className = "status " + type;
  status.style.display = "block";
  setTimeout(() => { status.style.display = "none"; }, 2500);
}
