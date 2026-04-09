// Background service worker — Social Post Summarizer v1.4.0

// === CONTEXT MENU ===
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "summarize-selection",
    title: "Tóm tắt đoạn text này",
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "summarize-selection" && info.selectionText) {
    chrome.tabs.sendMessage(tab.id, {
      action: "summarize-selection",
      text: info.selectionText,
    });
  }
});

// === BADGE COUNTER ===
async function incrementBadge() {
  const today = new Date().toDateString();
  const data = await chrome.storage.local.get(["dailyCount", "lastDate"]);
  let count = (data.lastDate === today) ? (data.dailyCount || 0) : 0;
  count++;
  await chrome.storage.local.set({ dailyCount: count, lastDate: today });
  chrome.action.setBadgeText({ text: count.toString() });
  chrome.action.setBadgeBackgroundColor({ color: "#6c5ce7" });
}

chrome.runtime.onStartup.addListener(async () => {
  const today = new Date().toDateString();
  const data = await chrome.storage.local.get(["dailyCount", "lastDate"]);
  if (data.lastDate === today) {
    chrome.action.setBadgeText({ text: (data.dailyCount || 0).toString() });
    chrome.action.setBadgeBackgroundColor({ color: "#6c5ce7" });
  }
});

// === DEFAULT PROMPT ===
const DEFAULT_PROMPT = `Tóm tắt bài viết dưới đây. Quy tắc bắt buộc:
- CHỈ dùng thông tin có trong bài viết, KHÔNG thêm, KHÔNG suy luận, KHÔNG bịa.
- Trả về 3-5 bullet points (dùng "•"), mỗi ý 1-2 câu ngắn gọn.
- Không mở đầu, không kết luận, không giải thích thêm. Chỉ trả về các dòng tóm tắt.`;

const MAX_INPUT_CHARS = 8000;

async function getSystemPrompt() {
  const data = await chrome.storage.sync.get(["customPrompt", "outputLang"]);
  const lang = data.outputLang || "auto";
  let prompt = data.customPrompt || DEFAULT_PROMPT;
  if (lang === "vi") prompt += "\n- Luôn trả lời bằng tiếng Việt, dịch nếu bài viết bằng ngôn ngữ khác.";
  else if (lang === "en") prompt += "\n- Always respond in English, translate if the post is in another language.";
  else prompt += "\n- Nếu bài viết bằng tiếng Anh hoặc ngôn ngữ khác tiếng Việt, dịch tóm tắt sang tiếng Việt. Nếu bằng tiếng Việt, giữ nguyên.";
  return prompt;
}

// === PORT-BASED STREAMING ===
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "summarize-stream") return;
  const controller = new AbortController();

  port.onMessage.addListener(async (msg) => {
    if (msg.action !== "summarize") return;
    try {
      const result = await handleStream(msg.text, msg.site, port, controller.signal);
      if (result && result.error) port.postMessage({ action: "error", error: result.error });
      else if (result && result.summary) port.postMessage({ action: "done", full: result.summary });
    } catch (e) {
      if (e.name !== "AbortError") {
        try { port.postMessage({ action: "error", error: e.message }); } catch (_) {}
      }
    }
  });

  port.onDisconnect.addListener(() => controller.abort());
});

// === FALLBACK: non-streaming for test/context menu ===
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "summarize") {
    const fakePort = { postMessage: () => {} };
    const controller = new AbortController();
    handleStream(request.text, request.site || "unknown", fakePort, controller.signal)
      .then(r => sendResponse(r || { error: "Unknown error" }))
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }
});

async function handleStream(text, site, port, signal) {
  const data = await chrome.storage.sync.get(["apiKey", "provider"]);
  const apiKey = data.apiKey;
  const provider = data.provider || "groq";

  if (!apiKey) return { error: "Chưa nhập API Key. Click icon extension để cài đặt." };

  const truncated = text.length > MAX_INPUT_CHARS
    ? text.substring(0, MAX_INPUT_CHARS) + "\n[...bài viết đã được cắt ngắn]"
    : text;
  const systemPrompt = await getSystemPrompt();
  const callFn = provider === "groq" ? callGroqStream : callGeminiStream;

  for (let attempt = 0; attempt <= 2; attempt++) {
    if (signal.aborted) return { error: "Đã hủy." };
    const result = await callFn(apiKey, truncated, systemPrompt, port, signal);
    if (!result.rateLimited) {
      if (result.summary) {
        incrementBadge();
        saveHistory(text, result.summary, site);
      }
      return result;
    }
    await new Promise(r => setTimeout(r, (attempt + 1) * 3000));
  }
  return { error: "API quá tải. Vui lòng thử lại sau." };
}

// === HISTORY ===
async function saveHistory(text, summary, site) {
  const data = await chrome.storage.local.get("history");
  const history = data.history || [];
  history.unshift({ text: text.substring(0, 200), summary, date: new Date().toISOString(), site: site || "unknown" });
  if (history.length > 50) history.length = 50;
  await chrome.storage.local.set({ history });
}

// === STREAMING HELPERS ===
async function processStream(response, port, signal, parseLine) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  let buffer = "";
  while (true) {
    if (signal.aborted) { reader.cancel(); return { error: "Đã hủy." }; }
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim().startsWith("data: ")) continue;
      const dataStr = line.replace(/^data: /, "").trim();
      if (dataStr === "[DONE]" || !dataStr) continue;
      try {
        const token = parseLine(JSON.parse(dataStr));
        if (token) {
          fullText += token;
          try { port.postMessage({ action: "chunk", text: token, full: fullText }); } catch (_) {}
        }
      } catch (e) {}
    }
  }
  return { summary: fullText };
}

async function callGroqStream(apiKey, text, systemPrompt, port, signal) {
  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
    signal,
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
      temperature: 0.3,
      max_tokens: 512,
    }),
  });
  if (resp.status === 429) return { rateLimited: true };
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    return { error: "Groq API lỗi: " + (err.error?.message || resp.statusText) };
  }
  return processStream(resp, port, signal, (d) => d.choices?.[0]?.delta?.content || "");
}

async function callGeminiStream(apiKey, text, systemPrompt, port, signal) {
  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=" + apiKey;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      contents: [{ parts: [{ text: systemPrompt + "\n\nBài viết:\n" + text }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 512 },
    }),
  });
  if (resp.status === 429) return { rateLimited: true };
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    return { error: "Gemini API lỗi: " + (err.error?.message || resp.statusText) };
  }
  return processStream(resp, port, signal, (d) => d.candidates?.[0]?.content?.parts?.[0]?.text || "");
}
