// === API KEY ROTATION ===
// Supports multiple API keys per provider with automatic rotation on rate limit
// Cross-provider fallback: if all keys of one provider are limited, try another provider

const PROVIDER_PRIORITY = [
  "groq",
  "cerebras",
  "sambanova",
  "gemini",
  "openrouter",
];

// Get the best available key across ALL providers
async function getAvailableKey(preferredProvider = null) {
  const data = await chrome.storage.sync.get(["apiKeys", "apiKey", "provider"]);
  const localData = await chrome.storage.local.get([
    "keyStatus",
    "keyRotationIndex",
    "backupApiKeys",
  ]);

  let apiKeys = data.apiKeys;
  let hasAnyKey = false;
  if (apiKeys) {
    for (const p in apiKeys) {
      if (apiKeys[p] && apiKeys[p].length > 0) hasAnyKey = true;
    }
  }

  // 1. Fallback for sync wipe -> use local backup
  if (!hasAnyKey && localData.backupApiKeys) {
    apiKeys = localData.backupApiKeys;
    hasAnyKey = true;
    chrome.storage.sync.set({ apiKeys });
  }

  if (!apiKeys)
    apiKeys = {
      groq: [],
      gemini: [],
      cerebras: [],
      sambanova: [],
      openrouter: [],
    };

  // 2. Fallback to ENV file (Hardcoded keys)
  if (typeof ENV_API_KEYS !== "undefined") {
    for (const p in ENV_API_KEYS) {
      if (ENV_API_KEYS[p] && ENV_API_KEYS[p].length > 0) {
        if (!apiKeys[p]) apiKeys[p] = [];
        const newKeys = ENV_API_KEYS[p].filter((k) => !apiKeys[p].includes(k));
        if (newKeys.length > 0) {
          apiKeys[p].push(...newKeys);
          hasAnyKey = true;
        }
      }
    }
  }

  // 3. Fallback to legacy single key
  if (!hasAnyKey && data.apiKey) {
    const provider = data.provider || "groq";
    if (!apiKeys[provider]) apiKeys[provider] = [];
    if (!apiKeys[provider].includes(data.apiKey)) {
      apiKeys[provider].push(data.apiKey);
    }
  }

  const keyStatus = localData.keyStatus || {};
  const rotationIndex = localData.keyRotationIndex || {};
  const now = Date.now();

  // Try each provider in priority order, hoisting preferredProvider to front
  const orderedProviders = preferredProvider && PROVIDER_PRIORITY.includes(preferredProvider)
    ? [preferredProvider, ...PROVIDER_PRIORITY.filter(p => p !== preferredProvider)]
    : PROVIDER_PRIORITY;
  for (const provider of orderedProviders) {
    const keys = apiKeys[provider] || [];
    if (keys.length === 0) continue;

    const startIdx = (rotationIndex[provider] || 0) % keys.length;
    for (let i = 0; i < keys.length; i++) {
      const idx = (startIdx + i) % keys.length;
      const key = keys[idx];
      const status = keyStatus[key] || {};

      if (!status.rateLimitedUntil || now >= status.rateLimitedUntil) {
        // Found a usable key — update rotation
        const newRotation = {
          ...rotationIndex,
          [provider]: (idx + 1) % keys.length,
        };
        keyStatus[key] = { ...(keyStatus[key] || {}), lastUsed: now };
        await chrome.storage.local.set({
          keyRotationIndex: newRotation,
          keyStatus,
        });
        return { key, provider, index: idx };
      }
    }
  }

  // All keys across all providers are rate-limited
  let soonestTime = Infinity;
  let totalKeys = 0;
  for (const provider of PROVIDER_PRIORITY) {
    const keys = apiKeys[provider] || [];
    totalKeys += keys.length;
    for (const key of keys) {
      const until = (keyStatus[key] || {}).rateLimitedUntil || 0;
      if (until < soonestTime) soonestTime = until;
    }
  }

  if (totalKeys === 0) return { key: null, provider: null, noKeys: true };
  const waitMin = Math.max(1, Math.ceil((soonestTime - now) / 60000));
  return {
    key: null,
    provider: null,
    allLimited: true,
    waitMinutes: waitMin,
    total: totalKeys,
  };
}

async function markKeyRateLimited(key, retryAfterMs) {
  const localData = await chrome.storage.local.get(["keyStatus"]);
  const keyStatus = localData.keyStatus || {};
  keyStatus[key] = {
    ...(keyStatus[key] || {}),
    rateLimitedUntil: Date.now() + (retryAfterMs || 30 * 60 * 1000),
    lastRateLimited: Date.now(),
  };
  await chrome.storage.local.set({ keyStatus });
}

function parseRetryAfter(errorMessage) {
  const match = errorMessage?.match(/try again in (\d+)m([\d.]+)s/i);
  if (match) return (parseInt(match[1]) * 60 + parseFloat(match[2])) * 1000;
  const secMatch = errorMessage?.match(/retry.?after:?\s*(\d+)/i);
  if (secMatch) return parseInt(secMatch[1]) * 1000;
  return 30 * 60 * 1000;
}

const MAX_INPUT_CHARS = 8000;
const MAX_OUTPUT_TOKENS = 1024;

async function getSystemPrompt(
  type,
  site,
  author,
  sourceUrl,
  postTitle,
  postSource,
  tone = null,
) {
  const data = await chrome.storage.sync.get([
    "customSummaryPrompt",
    "customAffPrompt",
    "outputLang",
    "promptStyle",
    "summaryLength",
    "customInstructions",
  ]);

  const lang = data.outputLang || "auto";
  const promptStyle = data.promptStyle || "default";
  const summaryLength = data.summaryLength || "medium";
  const customInstructions = data.customInstructions || "";

  // Determine base type for prompt lookup
  const baseType = type.startsWith("affiliate") ? "affiliate" : "summary";

  let prompt;

  // 1. Custom user prompt takes highest priority
  if (baseType === "affiliate" && data.customAffPrompt) {
    prompt = data.customAffPrompt;
  } else if (baseType === "summary" && data.customSummaryPrompt) {
    prompt = data.customSummaryPrompt;
  }
  // 2. promptStyle only applies to summary type
  else if (
    baseType === "summary" &&
    promptStyle !== "default" &&
    PROMPT_TEMPLATES[promptStyle]
  ) {
    prompt = PROMPT_TEMPLATES[promptStyle];
  }
  // 3. Length-based variant (summary_short, status_short, etc.)
  else if (summaryLength !== "medium") {
    const lengthKey = baseType + "_" + summaryLength;
    prompt =
      PROMPT_TEMPLATES[lengthKey] ||
      PROMPT_TEMPLATES[baseType] ||
      PROMPT_TEMPLATES.summary;
  }
  // 4. Default template for the type
  else {
    prompt =
      PROMPT_TEMPLATES[type] ||
      PROMPT_TEMPLATES[baseType] ||
      PROMPT_TEMPLATES.summary;
  }

  // === SMART CONTEXT: Adapt prompt based on source platform ===
  const siteHints = {
    facebook:
      "\n\nNGỮ CẢNH: Bài viết từ Facebook. Giọng văn thường casual, cá nhân. Nếu là bài chia sẻ link/tin tức, tập trung vào thông tin. Nếu là status cá nhân, giữ cảm xúc và quan điểm.",
    linkedin:
      "\n\nNGỮ CẢNH: Bài viết từ LinkedIn. Giọng văn chuyên nghiệp. Tập trung vào insight nghề nghiệp, bài học kinh doanh, dữ liệu.",
    x: "\n\nNGỮ CẢNH: Bài viết từ X/Twitter. Nội dung thường ngắn, có thể là thread. Tập trung vào ý chính, bỏ qua hashtag và mention.",
    threads: "\n\nNGỮ CẢNH: Bài viết từ Threads. Giọng casual, ngắn gọn.",
    reddit:
      "\n\nNGỮ CẢNH: Bài viết từ Reddit. Có thể là discussion dài. Tập trung vào luận điểm chính và kết luận của tác giả, bỏ qua comment.",
  };
  if (site && siteHints[site]) {
    prompt += siteHints[site];
  }

  // === SMART CONTEXT: Auto-detect content type ===
  prompt +=
    "\n\nTRƯỚC KHI VIẾT, hãy tự xác định loại nội dung (tin tức/ý kiến cá nhân/review sản phẩm/hướng dẫn/câu chuyện) và điều chỉnh giọng văn phù hợp.";

  if (baseType === "summary") {
    prompt +=
      "\n- Tiêu đề (dòng đầu tiên) viết bình thường, hệ thống sẽ tự động viết hoa.";
  }

  // Tone override (from overlay tone buttons)
  if (tone) {
    const toneMap = {
      short: "\n\nRÚT NGẮN: Viết kết quả tối đa 2-3 câu, cực kỳ súc tích.",
      academic: "\n\nPHONG CÁCH HỌC THUẬT: Viết chuyên nghiệp, dùng thuật ngữ chuyên ngành, cấu trúc mạch lạc, khách quan.",
      viral: "\n\nPHONG CÁCH VIRAL: Mở đầu bằng câu gây sốc/tò mò, nhấn mạnh con số nổi bật, kết thúc bằng câu hỏi mở hoặc call-to-action.",
      bullet: "\n\nDẠNG BULLET: Trình bày dưới dạng 4-6 bullet points ngắn gọn (dùng dấu • hoặc -), mỗi điểm 1 ý chính.",
    };
    if (toneMap[tone]) prompt += toneMap[tone];
  }

  // Add custom instructions if provided
  if (customInstructions) {
    prompt += "\n\nYÊU CẦU BỔ SUNG:\n" + customInstructions;
  }

  // Add language instruction
  if (lang === "vi") {
    prompt +=
      "\n- Luôn trả lời bằng tiếng Việt, dịch nếu bài viết bằng ngôn ngữ khác.";
  } else if (lang === "en") {
    prompt +=
      "\n- Always respond in English, translate if the post is in another language.";
  } else {
    prompt +=
      "\n- Nếu bài viết bằng tiếng Anh hoặc ngôn ngữ khác tiếng Việt, dịch tóm tắt sang tiếng Việt. Nếu bằng tiếng Việt, giữ nguyên.";
  }

  return prompt;
}

// === STREAMING HELPERS ===
async function processStream(response, port, signal, parseLine) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  let buffer = "";
  while (true) {
    if (signal.aborted) {
      reader.cancel();
      return { error: "Đã hủy." };
    }
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ") && trimmed !== "data:") continue;
      const dataStr = trimmed.replace(/^data:\s*/, "");
      if (dataStr === "[DONE]" || !dataStr) continue;
      try {
        const token = parseLine(JSON.parse(dataStr));
        if (token) {
          fullText += token;
          try {
            port.postMessage({ action: "chunk", text: token, full: fullText });
          } catch (_) {}
        }
      } catch (e) {}
    }
  }
  return { summary: fullText };
}

async function callGroqStream(
  apiKey,
  text,
  systemPrompt,
  port,
  signal,
  maxTokens = 512,
) {
  return callStreamAPI({
    url: "https://api.groq.com/openai/v1/chat/completions",
    headers: { Authorization: "Bearer " + apiKey },
    body: {
      model: "llama-3.3-70b-versatile",
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
      temperature: 0.3,
      max_tokens: maxTokens,
    },
    extractFn: (d) => d.choices?.[0]?.delta?.content || "",
    port,
    signal,
    maxTokens,
    provider: "Groq",
  });
}

async function callGeminiStream(
  apiKey,
  text,
  systemPrompt,
  port,
  signal,
  maxTokens = 512,
) {
  return callStreamAPI({
    url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=" + apiKey,
    headers: {},
    body: {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: text }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: maxTokens },
    },
    extractFn: (d) => d.candidates?.[0]?.content?.parts?.[0]?.text || "",
    port,
    signal,
    maxTokens,
    provider: "Gemini",
  });
}

// === CEREBRAS: OpenAI-compatible API, ultra-fast inference ===
async function callCerebrasStream(
  apiKey,
  text,
  systemPrompt,
  port,
  signal,
  maxTokens = 512,
) {
  return callStreamAPI({
    url: "https://api.cerebras.ai/v1/chat/completions",
    headers: { Authorization: "Bearer " + apiKey },
    body: {
      model: "llama-3.3-70b",
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
      temperature: 0.3,
      max_tokens: maxTokens,
    },
    extractFn: (d) => d.choices?.[0]?.delta?.content || "",
    port,
    signal,
    maxTokens,
    provider: "Cerebras",
  });
}

async function callCerebrasNonStream(apiKey, userMessage, systemPrompt) {
  return callNonStream(
    "https://api.cerebras.ai/v1/chat/completions",
    { Authorization: "Bearer " + apiKey },
    {
      model: "llama-3.3-70b",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      max_tokens: 1024,
      temperature: 0.3,
    },
    (d) => d?.choices?.[0]?.message?.content,
  );
}

// === SAMBANOVA: OpenAI-compatible API, fast open-source models ===
async function callSambanovaStream(
  apiKey,
  text,
  systemPrompt,
  port,
  signal,
  maxTokens = 512,
) {
  return callStreamAPI({
    url: "https://api.sambanova.ai/v1/chat/completions",
    headers: { Authorization: "Bearer " + apiKey },
    body: {
      model: "Meta-Llama-3.3-70B-Instruct",
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
      temperature: 0.3,
      max_tokens: maxTokens,
    },
    extractFn: (d) => d.choices?.[0]?.delta?.content || "",
    port,
    signal,
    maxTokens,
    provider: "SambaNova",
  });
}

async function callSambanovaNonStream(apiKey, userMessage, systemPrompt) {
  return callNonStream(
    "https://api.sambanova.ai/v1/chat/completions",
    { Authorization: "Bearer " + apiKey },
    {
      model: "Meta-Llama-3.3-70B-Instruct",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      max_tokens: 1024,
      temperature: 0.3,
    },
    (d) => d?.choices?.[0]?.message?.content,
  );
}

// === OPENROUTER: Unified API gateway, many free models ===
async function callOpenrouterStream(
  apiKey,
  text,
  systemPrompt,
  port,
  signal,
  maxTokens = 512,
) {
  return callStreamAPI({
    url: "https://openrouter.ai/api/v1/chat/completions",
    headers: {
      Authorization: "Bearer " + apiKey,
      "HTTP-Referer": "https://github.com/anlvdt/fb-post-summarizer",
      "X-Title": "FeedWriter",
    },
    body: {
      model: "meta-llama/llama-3.3-70b-instruct",
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
      temperature: 0.3,
      max_tokens: maxTokens,
    },
    extractFn: (d) => d.choices?.[0]?.delta?.content || "",
    port,
    signal,
    maxTokens,
    provider: "OpenRouter",
  });
}

async function callOpenrouterNonStream(apiKey, userMessage, systemPrompt) {
  return callNonStream(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      Authorization: "Bearer " + apiKey,
      "HTTP-Referer": "https://github.com/anlvdt/fb-post-summarizer",
      "X-Title": "FeedWriter",
    },
    {
      model: "meta-llama/llama-3.3-70b-instruct",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      max_tokens: 1024,
      temperature: 0.3,
    },
    (d) => d?.choices?.[0]?.message?.content,
  );
}
