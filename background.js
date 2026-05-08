// FeedWriter — Background service worker
// https://github.com/anlvdt/fb-post-summarizer
// Author: Le An (anlvdt)

try {
  importScripts("env.js");
} catch (e) {
  console.warn("No env.js found");
}
try {
  importScripts("utils.js");
} catch (e) {
  console.warn("No utils.js found");
}

// Fallback logger and feature flags if utils.js failed to load
if (typeof logger === 'undefined') {
  logger = {
    debug: (...args) => console.debug('[DEBUG]', ...args),
    info: (...args) => console.info('[INFO]', ...args),
    warn: (...args) => console.warn('[WARN]', ...args),
    error: (...args) => console.error('[ERROR]', ...args),
  };
}

if (typeof featureFlags === 'undefined') {
  featureFlags = {
    enableLogging: false,
    enableCache: false,
    enableBatchStorage: false,
    enableEventDelegation: false,
    enableMutationObserver: false,
    enableIntersectionObserver: false,
    testMode: false,
  };
}

// Initialize StorageBatcher for history (must be after importScripts)
const historyBatcher = typeof StorageBatcher !== 'undefined' ? new StorageBatcher(500) : { set: () => chrome.storage.local.set.bind(chrome.storage.local) };

// Storage schema version
const STORAGE_VERSION = 1;

// === STORAGE MIGRATION ===
async function migrateStorageIfNeeded() {
  if (!chrome?.storage?.local) return; // SW not ready
  const data = await chrome.storage.local.get(['storageVersion', 'history', 'apiKeys']);
  const currentVersion = data.storageVersion || 0;

  if (currentVersion < STORAGE_VERSION) {
    logger.info(`Migrating storage from v${currentVersion} to v${STORAGE_VERSION}`);
    await chrome.storage.local.set({ storageVersion: STORAGE_VERSION });
    logger.info('Storage migration completed');
  }
}

// Run migration on startup
migrateStorageIfNeeded().catch(e => logger.error('Storage migration failed:', e));

// === TELEMETRY ===
let telemetryData = { sessions: 0, summaries: 0, errors: 0 };

async function saveTelemetry() {
  if (!featureFlags.enableLogging) return;
  if (!chrome?.storage?.local) return; // SW not ready
  await chrome.storage.local.set({ telemetry: telemetryData });
}

async function loadTelemetry() {
  if (!chrome?.storage?.local) return; // SW not ready
  const data = await chrome.storage.local.get('telemetry');
  telemetryData = { ...telemetryData, ...data.telemetry };
}

function trackEvent(event, data = {}) {
  if (!featureFlags.enableLogging) return;
  logger.info(`Event: ${event}`, data);
  // Could send to analytics service here
}

// Load telemetry on startup
loadTelemetry().catch(e => logger.error('Failed to load telemetry:', e));

// Track session start
telemetryData.sessions++;
saveTelemetry();

// === KEEP SERVICE WORKER ALIVE ===
function ensureKeepAliveAlarm() {
  if (!chrome?.alarms) {
    logger.warn('Alarms API unavailable, cannot set keep-alive');
    return;
  }

  const desiredPeriod = 1;
  const createAlarm = () => {
    chrome.alarms.create('keep-alive', {
      delayInMinutes: desiredPeriod,
      periodInMinutes: desiredPeriod,
    });
    logger.info('Keep-alive alarm created with periodInMinutes=' + desiredPeriod);
  };

  chrome.alarms.get('keep-alive', (existing) => {
    if (chrome.runtime.lastError) {
      logger.warn('Keep-alive alarm get failed:', chrome.runtime.lastError.message);
      createAlarm();
      return;
    }

    if (!existing) {
      createAlarm();
    } else if (existing.periodInMinutes !== desiredPeriod) {
      logger.warn('Keep-alive alarm exists with wrong interval, recreating', existing);
      chrome.alarms.clear('keep-alive', (wasCleared) => {
        if (!wasCleared) {
          logger.warn('Failed to clear stale keep-alive alarm');
        }
        createAlarm();
      });
    } else {
      logger.info('Keep-alive alarm already exists with correct interval', existing);
    }

    chrome.alarms.getAll((alarms) => {
      logger.debug('Current alarms', alarms);
    });
  });
}

// Setup keep-alive on startup
ensureKeepAliveAlarm();

// === UTILITIES ===
// Fallback fetchWithTimeout if utils.js not loaded
if (typeof fetchWithTimeout === "undefined") {
  var fetchWithTimeout = function (url, options = {}, timeoutMs = 30000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, {
      ...options,
      signal: options.signal || controller.signal,
    }).finally(() => clearTimeout(timeoutId));
  };
}

async function injectAndSend(tabId, message) {
  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["content.css"],
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    chrome.tabs.sendMessage(tabId, message);
  } catch (e) {
    console.error("Injection failed", e);
  }
}

// === CONTEXT MENU ===
if (chrome?.runtime?.onInstalled) {
chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.create({
    id: "summarize-selection",
    title: "Tóm tắt nội dung",
    contexts: ["selection"],
  });
  chrome.contextMenus.create({
    id: "affiliate-rewrite",
    title: "Chế bài Affiliate Marketing",
    contexts: ["selection"],
  });
  chrome.contextMenus.create({
    id: "unshorten-shopee",
    title: "Bóc Link Shopee (No Cookie)",
    contexts: ["selection"],
  });

  // Migrate old single apiKey to multi-key system
  chrome.storage.sync.get(["apiKey", "apiKeys", "provider"], (data) => {
    const apiKeys = data.apiKeys || {
      groq: [],
      gemini: [],
      cerebras: [],
      sambanova: [],
      openrouter: [],
    };
    for (const p of ["groq", "gemini", "cerebras", "sambanova", "openrouter"]) {
      if (!apiKeys[p]) apiKeys[p] = [];
    }
    if (data.apiKey && !apiKeys.groq?.length && !apiKeys.gemini?.length) {
      const provider = data.provider || "groq";
      if (!apiKeys[provider].includes(data.apiKey)) {
        apiKeys[provider].push(data.apiKey);
      }
    }
    chrome.storage.sync.set({ apiKeys });
  });

  // Re-register alarm on install/update
  const alarmData = await chrome.storage.local.get(["reviewAlarm"]);
  const alarm = alarmData.reviewAlarm;
  if (alarm && alarm.enabled) {
    const now = new Date();
    const target = new Date();
    target.setHours(alarm.hour, alarm.minute, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    chrome.alarms.create("daily-ai-review", {
      delayInMinutes: (target - now) / 60000,
      periodInMinutes: 24 * 60,
    });
  }

  ensureKeepAliveAlarm();
});
} // end if (chrome?.runtime?.onInstalled)

async function clearShopeeCookies() {
  const domains = [".shopee.vn", "shopee.vn", ".shope.ee", "shope.ee"];
  for (const d of domains) {
    const cookies = await chrome.cookies.getAll({ domain: d });
    for (const c of cookies) {
      await chrome.cookies.remove({
        url: "https://" + c.domain + c.path,
        name: c.name,
      });
    }
  }
}

async function processUnshorten(url, tabId) {
  try {
    const resp = await fetchWithTimeout(
      url,
      { method: "GET", redirect: "follow" },
      30000,
    );
    const finalUrl = resp.url;
    const cleanMatch = finalUrl.match(/-i\.(\d+)\.(\d+)/);
    const output = cleanMatch
      ? "https://shopee.vn/product/" + cleanMatch[1] + "/" + cleanMatch[2]
      : finalUrl;
    await clearShopeeCookies();
    chrome.tabs
      .sendMessage(tabId, { action: "unshorten-result", text: output })
      .catch(() => {});
    chrome.tabs.create({
      url: "https://affiliate.shopee.vn/offer/custom_link",
    });
  } catch (e) {
    chrome.tabs
      .sendMessage(tabId, {
        action: "unshorten-result",
        error: "Lỗi extract: " + e.message,
      })
      .catch(() => {});
  }
}

chrome.commands.onCommand.addListener((command) => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      const msg = { action: "shortcut-" + command };
      chrome.tabs
        .sendMessage(tabs[0].id, msg)
        .catch(() => injectAndSend(tabs[0].id, msg));
    }
  });
});

if (chrome?.contextMenus?.onClicked) {
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "summarize-selection" && info.selectionText) {
    const msg = {
      action: "summarize-selection",
      text: info.selectionText,
      type: "summary",
    };
    chrome.tabs
      .sendMessage(tab.id, msg)
      .catch(() => injectAndSend(tab.id, msg));
  } else if (info.menuItemId === "affiliate-rewrite" && info.selectionText) {
    const msg = {
      action: "summarize-selection",
      text: info.selectionText,
      type: "affiliate",
    };
    chrome.tabs
      .sendMessage(tab.id, msg)
      .catch(() => injectAndSend(tab.id, msg));
  } else if (info.menuItemId === "unshorten-shopee" && info.selectionText) {
    const urlMatches = info.selectionText.match(/https?:\/\/shope\.ee\/[^\s]*/);
    if (!urlMatches) {
      chrome.tabs
        .sendMessage(tab.id, {
          action: "unshorten-result",
          error: "Không tìm thấy link shope.ee trong phần bôi đen",
        })
        .catch(() => {});
      return;
    }
    processUnshorten(urlMatches[0], tab.id);
  }
});
} // end if (chrome?.contextMenus?.onClicked)

// === BADGE COUNTER ===
async function incrementBadge() {
  const today = new Date().toDateString();
  const data = await chrome.storage.local.get(["dailyCount", "lastDate"]);
  let count = data.lastDate === today ? data.dailyCount || 0 : 0;
  count++;
  await chrome.storage.local.set({ dailyCount: count, lastDate: today });
  chrome.action.setBadgeText({ text: count.toString() });
  chrome.action.setBadgeBackgroundColor({ color: "#6c5ce7" });
}

// === IMPROVED PROMPTS based on Vietnamese NLP research ===
// References: VietAI ViT5, Underthesea, Vietnamese summarization best practices

// TÓM TẮT TIẾNG VIỆT CHUẨN - Hybrid extractive + abstractive approach
const SUMMARY_PROMPT = `Bạn là chuyên gia phân tích và tóm tắt tiếng Việt, giỏi viết tiêu đề hấp dẫn.

NHIỆM VỤ: Đọc kỹ nội dung, xác định thông tin quan trọng, viết TIÊU ĐỀ có hook mạnh + tóm tắt ngắn gọn.

QUY TRÌNH:
1. XÁC ĐỊNH: Chủ đề chính là gì? Kết luận/điểm then chốt nhất?
2. VIẾT TIÊU ĐỀ (HOOK): Dòng đầu tiên là tiêu đề hấp dẫn, tạo tò mò. Dùng 1 trong các kỹ thuật:
   - CURIOSITY GAP: Thông tin chưa đầy đủ khiến người đọc muốn biết thêm
   - CONTRARIAN: Phản bác niềm tin phổ biến
   - DATA HOOK: Con số/chi tiết cụ thể gây ấn tượng
   - BENEFIT HOOK: Nêu ngay giá trị người đọc nhận được
   - QUESTION HOOK: Câu hỏi cụ thể đánh vào pain point
   Tiêu đề tối đa 15-20 từ, PHẢI chứa thông tin cụ thể từ bài gốc.
3. TRÍCH XUẤT: Các ý quan trọng nhất (2-5 điểm)
4. VIẾT LẠI: Hoàn toàn bằng lời của bạn, KHÔNG copy

FORMAT OUTPUT:
[Tiêu đề hook mạnh — viết bình thường, hệ thống sẽ tự viết hoa]

[dòng trống]

[Nội dung tóm tắt]

**Giải thích thuật ngữ:**
· Thuật ngữ: Giải thích ngắn 1 câu.

—
Nguồn dưới cmt đầu

YÊU CẦU:
- Tiêu đề PHẢI ở dòng đầu, KHÔNG bọc trong ** hay ký tự đặc biệt. Viết bình thường (hệ thống tự viết hoa).
- SAU TIÊU ĐỀ: LUÔN 1 dòng trống.
- Tối đa 5 câu liền mạch hoặc 5 bullet points cho phần tóm tắt. KHÔNG viết dài hơn.
- NẾU bài gốc là HƯỚNG DẪN/TUTORIAL: giữ nguyên các bước (Bước 1, Bước 2...) dạng list ngắn gọn. Mỗi bước tối đa 1-2 câu. Người đọc phải biết cách làm ngay.
- NẾU bài gốc là TIN TỨC/PHÂN TÍCH: viết đoạn văn liền mạch 3-5 câu.
- CẤM LẶP Ý: Mỗi câu phải mang thông tin MỚI. Không diễn đạt lại ý cũ bằng từ khác. Kiểm tra lại trước khi output.
- Nếu muốn tách đoạn cho dễ đọc, cách bằng 1 dòng trống. Nhưng mỗi đoạn phải là ý KHÁC NHAU.
- GIẢI THÍCH THUẬT NGỮ: CHỈ thêm mục "**Giải thích thuật ngữ:**" khi có thuật ngữ THẬT SỰ chuyên ngành mà người đọc phổ thông chưa biết. TUYỆT ĐỐI KHÔNG giải thích: app, addon, update, plugin, extension, post, link, share, like, comment, feed, API, Chrome, Firefox, Google, Facebook, YouTube, TikTok, iPhone, Android, AI, ChatGPT, Wi-Fi, internet, website, server, cloud, crypto, NFT, CEO, startup — đây là từ người Việt dùng hàng ngày. Nếu không có thuật ngữ thực sự khó → BỎ QUA hoàn toàn mục này.
- LUÔN kết thúc bằng dòng — rồi xuống dòng "Nguồn dưới cmt đầu".
- Giọng tự nhiên, dễ hiểu như đang kể cho bạn bè
- Giữ thông tin có giá trị thực, dữ liệu, kết luận
- Bỏ ví dụ dài, chi tiết lan man, rào đón
- CHỈ dùng thông tin CÓ TRONG bài gốc, KHÔNG bịa thêm số liệu/thông số/phiên bản
- CẤM tiêu đề nhạt không có thông tin: "Tin mới", "Có một điều thú vị..."
- CẤM câu dẫn dắt rỗng: "Mình vừa đọc...", "Gần đây..."
- CẤM lạm dụng sở hữu "của bạn", "của mình", "của chúng ta". Viết trực tiếp: "iPhone báo đầy bộ nhớ" thay vì "iPhone của bạn báo đầy bộ nhớ". Chỉ dùng khi thật sự cần phân biệt sở hữu.
- Trả lời bằng tiếng Việt`;

// TÓM TẮT NGẮN - Quick overview
const SUMMARY_SHORT_PROMPT = `Tóm tắt cực ngắn nội dung sau:

Yêu cầu:
- Dòng đầu tiên: tiêu đề có hook mạnh (con số, phản bác, tò mò), tối đa 15 từ. Viết bình thường, KHÔNG bọc **, hệ thống tự viết hoa.
- Sau tiêu đề: 1 dòng trống, rồi 1-2 câu tóm tắt
- Nắm bắt thông điệp cốt lõi nhất
- Viết lại bằng lời mình, KHÔNG copy
- Giọng tự nhiên
- Nếu có thuật ngữ mới, giải thích ngắn 1 dòng bắt đầu bằng · trước dòng nguồn
- Kết thúc: — rồi xuống dòng "Nguồn dưới cmt đầu"`;

// TÓM TẮT CHI TIẾT - Detailed với cấu trúc
const SUMMARY_DETAILED_PROMPT = `Bạn là chuyên gia phân tích và tóm tắt có cấu trúc.

NHIỆM VỤ: Viết tiêu đề hook mạnh + tóm tắt chi tiết, giữ cấu trúc logic.

YÊU CẦU:
- Dòng đầu tiên: tiêu đề có hook mạnh (con số, phản bác, tò mò), tối đa 20 từ. Viết bình thường, KHÔNG bọc **, hệ thống tự viết hoa.
- Sau tiêu đề: 1 dòng trống
- Xác định thesis/luận điểm chính
- Các luận điểm hỗ trợ quan trọng nhất
- Kết luận và hàm ý
- Cấu trúc rõ ràng: Tiêu đề → Điểm chính → Kết luận
- Mỗi đoạn cách nhau 1 dòng trống
- Tối đa 150 từ
- Viết lại hoàn toàn, KHÔNG copy
- Nếu có thuật ngữ mới/khó, thêm "*** Giải thích thuật ngữ:" trước dòng nguồn
- Kết thúc: — rồi xuống dòng "Nguồn dưới cmt đầu"`;

// TÓM TẮT DẠNG BULLET - Easy to scan
const SUMMARY_BULLET_PROMPT = `Tóm tắt thành các bullet points ngắn gọn.

Quy tắc:
- Dòng đầu tiên: tiêu đề có hook mạnh (con số, phản bác, tò mò), tối đa 15 từ. Viết bình thường, KHÔNG bọc **, hệ thống tự viết hoa.
- Sau tiêu đề: 1 dòng trống
- Mỗi bullet bắt đầu bằng · tối đa 15 từ
- Ưu tiên thông tin có giá trị, dữ liệu, kết luận
- Bỏ ví dụ, chỉ giữ kết quả
- 5-7 bullet max
- Nếu có thuật ngữ mới/khó, thêm "*** Giải thích thuật ngữ:" trước dòng nguồn
- Kết thúc: — rồi xuống dòng "Nguồn dưới cmt đầu"`;

// === QUY TẮC CHÍNH TẢ VNREVIEW (áp dụng cho mọi output tiếng Việt) ===
const VNREVIEW_RULES = `
QUY TẮC CHÍNH TẢ VÀ HÀNH VĂN BẮT BUỘC:

CẤM MỞ ĐẦU BẰNG CÂU DẪN DẮT RỖNG:
- TUYỆT ĐỐI KHÔNG bắt đầu bằng: "Mình vừa đọc được...", "Gần đây...", "Như chúng ta đã biết...", "Mới đây...", "Theo như mình được biết...", "Hôm nay mình đọc được..."
- Câu đầu tiên PHẢI chứa thông tin thực, đi thẳng vào nội dung chính.
- VD SAI: "Mình vừa đọc được tin tức về giá điện thoại cao cấp..."
- VD ĐÚNG: "Huawei thay đổi chiến lược: bản Pro Max giá ngang Xiaomi Ultra."

HẠN CHẾ SỞ HỮU THỪA:
- KHÔNG lạm dụng "của bạn", "của mình", "của chúng ta", "của Apple", "của Google" khi không cần thiết.
- Viết trực tiếp: "iPhone báo đầy bộ nhớ" thay vì "iPhone của bạn báo đầy bộ nhớ".
- "Cập nhật iOS" thay vì "Cập nhật iOS của bạn". "Tài khoản Google" thay vì "Tài khoản Google của bạn".
- Chỉ dùng sở hữu khi thật sự cần phân biệt (VD: "ảnh của bạn" vs "ảnh của người khác").

TIỀN VIỆT NAM:
- Viết gọn bằng đơn vị triệu/tỷ: "45 triệu đồng", "1,2 tỷ đồng"
- KHÔNG viết dạng đầy đủ: "44.990.000 đồng" → viết "gần 45 triệu đồng" hoặc "44,99 triệu đồng"

KHÔNG LẶP CẢM XÚC:
- Mỗi cảm xúc/nhận xét chỉ nói MỘT lần. Không lặp "thật sự ngạc nhiên", "thật sự không hiểu", "quá đắt đỏ" trong cùng bài.

CẤM EMOJI:
- TUYỆT ĐỐI KHÔNG dùng emoji, icon, hay ký tự đặc biệt Unicode trong output (📌🔗✅⚠️🔥💡⚡🎯🚀❌👍...).
- Dùng text thuần: "Nguồn:" thay vì "📌 Nguồn:", "Link:" thay vì "🔗".

CHỐNG BỊA THÔNG TIN (HALLUCINATION):
- TUYỆT ĐỐI KHÔNG bịa số liệu, tên sản phẩm, phiên bản, thông số kỹ thuật, giá cả mà KHÔNG có trong bài gốc.
- Nếu bài gốc không nêu con số cụ thể, KHÔNG được tự thêm con số.
- Nếu không chắc chắn thông tin, KHÔNG viết. Bỏ qua còn hơn bịa.
- Chỉ sử dụng thông tin CÓ TRONG bài gốc được cung cấp.

QUY TẮC CHÍNH TẢ:
- Câu ngắn, từ ngắn. Mỗi đoạn văn thể hiện MỘT ý.
- THUẬT NGỮ CÔNG NGHỆ: "code/coding" dịch là "lập trình" hoặc giữ nguyên "code", TUYỆT ĐỐI KHÔNG dịch thành "mã hóa". "coder" = "lập trình viên". "source code" = "mã nguồn".
- Chữ số: dấu chấm (.) chỉ hàng nghìn (VD: 1.500), dấu phẩy (,) chỉ phần thập phân (VD: 2,2 mm).
- Dấu chấm (.) cho inch, pixel, GHz: 8.9 inch, 18.2 megapixel, 2.2 GHz.
- Viết bằng chữ số dưới 10 trước danh từ chỉ người/địa danh: "hai tỉnh", "năm nhóm người".
- Dùng con số cho tuổi, số lượng, khoảng cách, %, tỷ lệ, nhiệt độ, tốc độ, tiền tệ, model máy.
- Ngoặc đơn () để giải thích: Steve Jobs (1955-2011). Ngoặc kép "" để trích dẫn nguyên văn.
- Đơn vị: mm, cm, m, kg, độ C, inch, megapixel, lít.
- Tiền tệ: USD (không viết "đô-la"), euro, yên. Ngoại tệ phải kèm quy đổi VND tương đương.
- Ngày tháng: dùng gạch chéo (13/10/2011). Viết hoa tên tháng chữ (tháng Sáu), tháng 10 trở đi dùng số. Viết hoa tên ngày (thứ Hai, Chủ nhật).
- Viết hoa: tên người, tên công ty, địa danh, chức danh.
- KHÔNG viết tắt địa danh ngắn: Việt Nam, Hà Nội (không viết VN, HN).`;

// AFFILIATE - Review sản phẩm chân thật + Quy tắc VnReview
const AFFILIATE_PROMPT =
  `Bạn là người dùng thật, viết review sản phẩm tự nhiên.

NHIỆM VỤ: Viết bài affiliate từ thông tin sản phẩm, như đã dùng thử.

QUY TRÌNH:
1. XÁC ĐỊNH: Sản phẩm giải quyết vấn đề gì? Điểm nổi bật nhất?
2. XÂY DỰNG: Tạo câu chuyện trải nghiệm chân thật (vấn đề → tìm kiếm → thử dùng → kết quả)
3. VIẾT: Xưng "mình", giọng kể bạn bè, chi tiết cụ thể

YÊU CẦU:
- 2-3 đoạn ngắn, tổng 100-200 từ
- Mở bằng vấn đề thực tế, KHÔNG mở bằng tên sản phẩm
- Điểm mạnh viết như phát hiện, không quảng cáo
- Cuối bài: "Link: [LINK]" hoặc "Mua ở đây: [LINK]"
- KHÔNG hô hào "MUA NGAY", "GIÁ SỐC"
- Giọng chân thật, không phóng đại
` + VNREVIEW_RULES;

// AFFILIATE NHẸ NHÀNG - Soft sell
const AFFILIATE_SOFT_PROMPT =
  `Viết chia sẻ trải nghiệm sản phẩm nhẹ nhàng, không giống quảng cáo.

QUY TRÌNH:
1. Tìm 1 vấn đề thực tế mà sản phẩm giải quyết
2. Viết như đang kể chuyện, phát hiện sản phẩm một cách tự nhiên
3. Để link ở cuối, không kêu gọi mua

YÊU CẦU:
- 80-150 từ, giọng nhẹ nhàng
- Mở bằng câu chuyện/vấn đề, KHÔNG mở bằng tên sản phẩm
- Điểm mạnh viết như phát hiện ra, không PR
- Link ở cuối tự nhiên, không kêu gọi
` + VNREVIEW_RULES;

// AFFILIATE CÂU CHUYỆN - Storytelling format
const AFFILIATE_STORY_PROMPT =
  `Viết bài affiliate theo format câu chuyện hấp dẫn.

QUY TRÌNH:
1. TÌNH HUỐNG: Mình đang gặp vấn đề gì cụ thể?
2. HÀNH TRÌNH: Đã thử những gì? Tại sao chưa ổn?
3. PHÁT HIỆN: Tìm ra sản phẩm này, dùng thử thấy sao?
4. KẾT QUẢ: Điều mình thích nhất + chia sẻ link cho ai cần

YÊU CẦU:
- 100-200 từ, giọng kể chuyện tự nhiên
- Xưng "mình", chi tiết cụ thể (bao lâu, kết quả gì)
- Không PR cứng, không hô hào
- Link cuối bài tự nhiên
` + VNREVIEW_RULES;

// TÓM TẮT GIỮ CẤU TRÚC - Preserve original structure
const SUMMARY_STRUCTURED_PROMPT = `Bạn là chuyên gia tóm tắt có cấu trúc.

NHIỆM VỤ: Viết tiêu đề hook mạnh, giữ nguyên cấu trúc bài viết, chỉ rút gọn nội dung.

YÊU CẦU:
- Dòng đầu tiên: tiêu đề có hook mạnh, tối đa 20 từ. Viết bình thường, KHÔNG bọc **, hệ thống tự viết hoa.
- Sau tiêu đề: 1 dòng trống
- Giữ headings, bullet points, numbering từ bài gốc
- Mỗi section: rút còn 1-3 ý quan trọng nhất
- Giảm 50-70% nội dung
- Viết lại, không copy
- Nếu có thuật ngữ mới/khó, thêm "*** Giải thích thuật ngữ:" trước dòng nguồn
- Kết thúc: — rồi xuống dòng "Nguồn dưới cmt đầu"`;

// PROMPT MAP - All available templates
const PROMPT_TEMPLATES = {
  // Summary variants
  summary: SUMMARY_PROMPT,
  summary_short: SUMMARY_SHORT_PROMPT,
  summary_detailed: SUMMARY_DETAILED_PROMPT,
  summary_bullet: SUMMARY_BULLET_PROMPT,
  summary_structured: SUMMARY_STRUCTURED_PROMPT,

  // Affiliate variants
  affiliate: AFFILIATE_PROMPT,
  affiliate_soft: AFFILIATE_SOFT_PROMPT,
  affiliate_story: AFFILIATE_STORY_PROMPT,
};

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

// === PORT-BASED STREAMING ===
if (chrome?.runtime?.onConnect) {
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "summarize-stream") return;
  const controller = new AbortController();

  port.onMessage.addListener(async (msg) => {
    if (msg.action !== "summarize") return;
    try {
      const result = await handleStream(
        msg.text,
        msg.site,
        port,
        controller.signal,
        msg.type,
        msg.sourceUrl,
        msg.imageUrl,
        msg.author,
        msg.postTitle,
        msg.postSource,
        msg.agentMode,
        msg.tone || null,
        msg.preferredProvider || null,
      );
      if (result && result.error)
        port.postMessage({ action: "error", error: result.error });
      else if (result && result.summary)
        port.postMessage({
          action: "done",
          full: result.summary,
          quality: result.quality,
          issues: result.issues,
          imageUrl: msg.imageUrl || "",
          agentScore: result.agentScore,
        });
    } catch (e) {
      if (e.name !== "AbortError") {
        try {
          port.postMessage({ action: "error", error: e.message });
        } catch (_) {}
      }
    }
  });

  port.onDisconnect.addListener(() => controller.abort());
});
} // end if (chrome?.runtime?.onConnect)

// === FALLBACK: non-streaming for test/context menu ===
if (chrome?.runtime?.onMessage) {
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "ping") {
    sendResponse({ ok: true });
    return true;
  }
  // === AGENT POSTED — show browser notification ===
  if (request.action === "agent-posted") {
    const preview = (request.preview || "").substring(0, 80);
    chrome.notifications.create("agent-posted-" + Date.now(), {
      type: "basic",
      iconUrl: "icons/icon48.png",
      title: "FeedWriter Agent đã đăng bài ✓",
      message: preview + (preview.length >= 80 ? "…" : ""),
      priority: 1,
    });
    sendResponse({ ok: true });
    return true;
  }
  // === GET KEY STATUS for popup ===
  if (request.action === "get-key-status") {
    chrome.storage.local.get(["keyStatus"], (data) => {
      sendResponse(data.keyStatus || {});
    });
    return true;
  }
  if (
    request.action === "unshorten-shopee-inline" &&
    request.url &&
    sender.tab
  ) {
    processUnshorten(request.url, sender.tab.id);
    return true;
  }
  if (request.action === "summarize") {
    const fakePort = { postMessage: () => {} };
    const controller = new AbortController();
    handleStream(
      request.text,
      request.site || "unknown",
      fakePort,
      controller.signal,
      "summary",
    )
      .then((r) => sendResponse(r || { error: "Unknown error" }))
      .catch((e) => sendResponse({ error: e.message }));
    return true;
  }
  // === TEST CONNECTION (lightweight, no guardrails) ===
  if (request.action === "test-connection") {
    (async () => {
      try {
        const keyInfo = await getAvailableKey();
        if (!keyInfo.key) {
          if (keyInfo.noKeys)
            return sendResponse({ error: "Chưa có API Key." });
          if (keyInfo.allLimited)
            return sendResponse({
              error:
                "Tất cả " +
                keyInfo.total +
                " key bị rate limit. Thử lại sau ~" +
                keyInfo.waitMinutes +
                " phút.",
            });
          return sendResponse({ error: "Không tìm được key." });
        }
        const nonStreamFns = {
          groq: callGroqNonStream,
          gemini: callGeminiNonStream,
          cerebras: callCerebrasNonStream,
          sambanova: callSambanovaNonStream,
          openrouter: callOpenrouterNonStream,
        };
        const callFn = nonStreamFns[keyInfo.provider];
        if (!callFn)
          return sendResponse({ error: "Provider lỗi: " + keyInfo.provider });
        const result = await callFn(
          keyInfo.key,
          "Reply with exactly: OK",
          "You are a test bot. Reply OK.",
        );
        sendResponse({
          ok: true,
          provider: keyInfo.provider,
          response: (result || "").substring(0, 50),
        });
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }
  // === AI REVIEW ===
  if (request.action === "ai-review") {
    reviewTodayHistory()
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ error: e.message }));
    return true;
  }
  // === GET AI REVIEW RESULTS ===
  if (request.action === "get-ai-review") {
    chrome.storage.local.get("aiReview", (data) => {
      sendResponse(data.aiReview || null);
    });
    return true;
  }
  // === EXPORT DTCN JSON ===
  if (request.action === "export-dtcn") {
    const items = request.items || [];
    const exported = exportDtcnJson(items);
    sendResponse({ success: true, data: exported });
    return true;
  }
  // === SET/CLEAR AUTO REVIEW ALARM ===
  if (request.action === "set-review-alarm") {
    const hour = request.hour || 18;
    const minute = request.minute || 0;
    // Calculate delay to next occurrence
    const now = new Date();
    const target = new Date();
    target.setHours(hour, minute, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    const delayMs = target - now;
    chrome.alarms.create("daily-ai-review", {
      delayInMinutes: delayMs / 60000,
      periodInMinutes: 24 * 60,
    });
    chrome.storage.local.set({ reviewAlarm: { hour, minute, enabled: true } });
    sendResponse({ success: true });
    return true;
  }
  if (request.action === "clear-review-alarm") {
    chrome.alarms.clear("daily-ai-review");
    chrome.storage.local.set({ reviewAlarm: { enabled: false } });
    sendResponse({ success: true });
    return true;
  }
  // === TRANSLATE WORD ===
  if (request.action === "translate-word" && request.word) {
    translateWord(request.word)
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ error: e.message }));
    return true;
  }
  // === AUTO-PILOT AGENT EVALUATION ===
  if (request.action === "agent_eval") {
    evaluatePostForAgent(request.payload, sender.tab.id);
    return true;
  }
  // === AUTO-PILOT EVALUATE GENERATED SUMMARY ===
  if (request.action === "agent_eval_summary") {
    evaluateSummaryForAgent(request.payload, sender.tab.id);
    return true;
  }
  // === FETCH IMAGE AS BASE64 (CORS Bypass) ===
  if (request.action === "fetch-image") {
    fetchWithTimeout(request.url, {}, 30000)
      .then((res) => res.blob())
      .then((blob) => {
        const reader = new FileReader();
        reader.onloadend = () => sendResponse({ base64: reader.result });
        reader.readAsDataURL(blob);
      })
      .catch((e) => sendResponse({ error: e.message }));
    return true;
  }
});
} // end if (chrome?.runtime?.onMessage)

// === HEURISTIC SCORING (thay thế AI eval để tiết kiệm API call) ===
// Đánh giá nhanh dựa trên keywords, patterns, độ dài — không cần gọi AI
// Baseline thấp (default-reject): bài phải có tín hiệu dương rõ ràng mới qua ngưỡng >= 5
function heuristicScore(text) {
  if (!text || text.length < 30) return 1;

  const lower = text.toLowerCase();
  let score = 3; // Baseline thấp — default reject, cần tín hiệu dương để qua 5

  // === TIER 1A: AI/LLM brands — ưu tiên cao nhất (+3/hit, tối đa +6) ===
  const aiBrands = [
    'claude', 'anthropic', 'chatgpt', 'openai', 'gpt-4', 'gpt-3', 'gpt4',
    'gemini', 'google deepmind', 'llama', 'mistral', 'deepseek', 'qwen',
    'grok', 'copilot', 'perplexity', 'midjourney', 'sora', 'dall-e',
    'stable diffusion', 'runway ml', 'large language model', 'trí tuệ nhân tạo',
    'google ai studio', 'notebooklm', 'meta ai', 'microsoft ai', 'amazon bedrock',
  ];
  let aiBoost = 0;
  for (const kw of aiBrands) {
    if (lower.includes(kw)) aiBoost = Math.min(aiBoost + 3, 6);
  }
  score += aiBoost;

  // === TIER 1B: AI subscription / free-tier deals (+2 bonus trên AI boost) ===
  // "Claude Pro miễn phí", "ChatGPT Plus trial", "Gemini Advanced gói free"
  const freeSignals = ['miễn phí', 'free tier', 'free plan', 'dùng thử', 'trial ', 'gói miễn', 'đăng ký miễn', 'tháng miễn phí', 'promo code'];
  if (aiBoost > 0 && freeSignals.some((kw) => lower.includes(kw))) score += 2;

  // === TIER 1C: Security incidents — quan tâm cao (+2.5 nếu có 2+ tín hiệu, +1.5 nếu 1) ===
  const securityKeywords = [
    'data breach', 'rò rỉ dữ liệu', 'lộ dữ liệu', 'rò rỉ thông tin',
    'tấn công mạng', 'tin tặc', 'hacker tấn',
    'ransomware', 'malware', 'mã độc', 'phishing',
    'lỗ hổng bảo mật', 'bảo mật nghiêm trọng', 'zero-day',
    'vulnerability', 'exploit', 'an ninh mạng',
  ];
  const secHits = securityKeywords.filter((kw) => lower.includes(kw)).length;
  if (secHits >= 2) score += 2.5;
  else if (secHits === 1) score += 1.5;

  // === TIER 2: Tech companies / flagship hardware (+2/hit, tối đa +3) ===
  const techBrands = [
    'iphone', 'ipad', 'macbook', 'apple silicon', 'vision pro',
    'samsung galaxy', 'pixel phone', 'oneplus',
    'nvidia', 'rtx ', 'geforce', 'h100', 'a100',
    'microsoft', 'windows 11', 'azure', 'google cloud',
    'qualcomm', 'snapdragon', ' tsmc', 'intel core',
  ];
  let brandBoost = 0;
  for (const kw of techBrands) {
    if (lower.includes(kw)) brandBoost = Math.min(brandBoost + 2, 3);
  }
  score += brandBoost;

  // === TIER 3: Tech topics (+1/hit, tối đa +2) ===
  const techTopics = [
    'machine learning', 'deep learning', 'neural network', 'llm',
    'github', 'open source', 'mã nguồn mở',
    'lập trình', 'developer', 'kỹ sư phần mềm',
    'bảo mật', 'cybersecurity',
    'startup', 'unicorn', 'gọi vốn', 'funding', 'series a', 'series b',
    'chip ', 'vi xử lý', 'bán dẫn', 'semiconductor',
    'python', 'javascript', 'typescript', 'react', 'docker', 'kubernetes',
    'aws ', 'devops', 'cicd', 'api ', 'framework',
  ];
  const topicHits = techTopics.filter((kw) => lower.includes(kw)).length;
  score += Math.min(topicHits, 2);

  // === TIER 4: Tips/hướng dẫn (chỉ tính khi có tech anchor) ===
  const tipKeywords = ['hướng dẫn', 'tutorial', 'tips', 'thủ thuật', 'mẹo hay', 'tối ưu', 'productivity'];
  const techAnchors = ['điện thoại', 'máy tính', 'laptop', 'app ', 'phần mềm', 'chrome', 'android', 'ios '];
  const hasTip = tipKeywords.some((kw) => lower.includes(kw));
  const hasTechAnchor = techAnchors.some((kw) => lower.includes(kw));
  if (hasTip && hasTechAnchor) score += 1.5;
  else if (hasTip) score += 0.3;

  // === News signals (+1 nếu bài có tín hiệu tin tức) ===
  const newsKeywords = [
    'ra mắt', 'vừa ra mắt', 'chính thức ra', 'công bố', 'announce',
    'phiên bản mới', 'cập nhật mới', 'billion', 'triệu usd', 'funding',
    'nghiên cứu mới', 'research paper',
  ];
  if (newsKeywords.some((kw) => lower.includes(kw))) score += 1;

  // === URL presence (+0.5): bài có link thường là chia sẻ tin ===
  if (/https?:\/\//.test(text)) score += 0.5;

  // === NEGATIVE: spam bán hàng (-3 mỗi hit, cap -5) ===
  const spamKeywords = [
    'mua ngay', 'giá sốc', 'flash sale', 'voucher', 'mã giảm',
    'shopee.vn', 'lazada.vn', 'tiki.vn',
    'dm để', 'inbox để', 'liên hệ ngay', 'số lượng có hạn',
    'free ship', 'miễn phí vận chuyển',
  ];
  let spamHits = 0;
  for (const kw of spamKeywords) {
    if (lower.includes(kw)) spamHits++;
  }
  score -= Math.min(spamHits * 3, 5);

  // === NEGATIVE: nội dung cá nhân/drama/off-topic (-2 mỗi hit, cap -4) ===
  const offTopicKeywords = [
    'chúc mừng sinh nhật', 'happy birthday', 'bóc phốt', 'drama',
    'sao hàn', 'kpop', 'phim bộ', 'bóng đá', 'ngoại hạng anh',
    'công thức nấu', 'cách nấu', 'tuyển dụng', 'cần tuyển',
    'chiêm tinh', 'tarot', 'tử vi',
  ];
  let offTopicHits = 0;
  for (const kw of offTopicKeywords) {
    if (lower.includes(kw)) offTopicHits++;
  }
  score -= Math.min(offTopicHits * 2, 4);

  // === LENGTH heuristic ===
  if (text.length < 100) score -= 1;
  if (text.length >= 200 && text.length <= 3000) score += 0.5;

  return Math.max(1, Math.min(9, Math.round(score)));
}

// === AUTO-PILOT EVALUATE SUMMARY LOGIC ===
async function evaluateSummaryForAgent(payload, tabId) {
  const prompt = `Bạn là biên tập viên tech. Đánh giá bài tóm tắt sau có xứng đáng chia sẻ lên trang công nghệ không.

ĐĂNG (score 7-9) — ưu tiên cao nhất cho:
- AI/LLM mới: Claude, ChatGPT, Gemini, Anthropic, OpenAI, DeepSeek, Llama, Grok, Mistral...
- Đăng ký AI miễn phí / giá rẻ: gói free tier, trial, promo của các AI tool lớn
- Bảo mật: data breach, lỗ hổng nghiêm trọng, ransomware, tấn công quy mô lớn
- Sản phẩm tech nổi bật: iPhone, MacBook, chip AI, GPU thế hệ mới
- Startup tech gọi vốn lớn, IPO, M&A đáng chú ý
- Lập trình, công cụ dev, GitHub repo nổi bật, framework mới

BỎ QUA (score 1-3) — bài thuộc loại:
- Status cá nhân, cảm xúc, tâm sự, drama
- Quảng cáo, bán hàng thông thường (shopee, lazada, affiliate hàng tiêu dùng)
- Ẩm thực, du lịch, thời trang, thể thao, giải trí không liên quan tech
- Tin tức chính trị, xã hội không liên quan tech
- Tuyển dụng, chúc mừng, sự kiện cá nhân

Trả về JSON: {"score": 7}`;

  const nonStreamFns = {
    groq: callGroqNonStream,
    gemini: callGeminiNonStream,
    cerebras: callCerebrasNonStream,
    sambanova: callSambanovaNonStream,
    openrouter: callOpenrouterNonStream,
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    const keyInfo = await getAvailableKey();
    console.log(
      "[Agent Eval] Attempt",
      attempt,
      "key:",
      keyInfo.key ? keyInfo.provider + ":***" : "NONE",
      "noKeys:",
      keyInfo.noKeys,
      "allLimited:",
      keyInfo.allLimited,
    );
    if (!keyInfo.key) {
      // Không có key — giải phóng agent ngay, không thể eval
      chrome.tabs
        .sendMessage(tabId, { action: "agent_decision", score: 0 })
        .catch(() => {});
      return;
    }

    const callFn = nonStreamFns[keyInfo.provider] || callGroqNonStream;
    try {
      const result = await callFn(
        keyInfo.key,
        prompt + "\n\nTóm tắt:\n" + payload.text,
        "You are a JSON-only API. Only output valid JSON.",
      );
      // Robust JSON extraction
      let data = { score: 0 };
      const match = result.match(/\{[\s\S]*"score"\s*:\s*\d+[\s\S]*\}/i);
      if (match) {
        try {
          data = JSON.parse(match[0]);
        } catch (e) {}
      } else {
        let cleanResult = (result || "").trim();
        if (cleanResult.startsWith("```json")) {
          cleanResult = cleanResult
            .replace(/^```json\n?/, "")
            .replace(/\n?```$/, "");
        }
        try {
          data = JSON.parse(cleanResult);
        } catch (e) {}
      }

      console.log("[Agent] Summary Score:", data.score);
      chrome.tabs
        .sendMessage(tabId, { action: "agent_decision", score: data.score })
        .catch(() => {});
      return;
    } catch (e) {
      if (
        e.message &&
        (e.message.includes("429") ||
          e.message.toLowerCase().includes("rate") ||
          e.message.toLowerCase().includes("limit"))
      ) {
        await markKeyRateLimited(keyInfo.key, parseRetryAfter(e.message));
      } else {
        // Lỗi thông thường (API down, sai key...) → mark key bị lỗi, thử provider tiếp theo
        const localData = await chrome.storage.local.get(["keyStatus"]);
        const keyStatus = localData.keyStatus || {};
        keyStatus[keyInfo.key] = {
          ...(keyStatus[keyInfo.key] || {}),
          rateLimitedUntil: Date.now() + 5 * 60 * 1000,
        }; // Tạm skip 5 phút
        await chrome.storage.local.set({ keyStatus });
        console.warn(
          "[Agent Eval] Provider",
          keyInfo.provider,
          "failed, trying next. Error:",
          e.message,
        );
      }
      continue; // Luôn thử provider tiếp theo
    }
  }

  // Trả về 0 nếu fail cả 3 lần để giải phóng Agent khỏi trạng thái WAITING_EVAL
  console.log("[Agent] Eval failed 3 times, sending score 0");
  chrome.tabs
    .sendMessage(tabId, { action: "agent_decision", score: 0 })
    .catch(() => {});
}

// === AUTO-PILOT EVALUATION LOGIC ===
async function evaluatePostForAgent(payload, tabId) {
  const prompt = `Bạn là một AI phân tích nội dung mạng xã hội.
Hãy đọc bài viết sau và chấm điểm độ thu hút từ 1-10 (ưu tiên bài có thông tin hữu ích, tin tức công nghệ, bài học).
Nếu điểm >= 8, hãy tóm tắt và viết lại thành 1 status Facebook mang phong cách cá nhân của bạn, ngắn gọn, hấp dẫn.
Nếu bài có gắn link, yêu cầu người đọc xem link ở dưới comment.
Luôn trả về ĐÚNG ĐỊNH DẠNG JSON (không có markdown code block):
{"score": 9, "status": "nội dung status..."}`;

  const nonStreamFns = {
    groq: callGroqNonStream,
    gemini: callGeminiNonStream,
    cerebras: callCerebrasNonStream,
    sambanova: callSambanovaNonStream,
    openrouter: callOpenrouterNonStream,
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    const keyInfo = await getAvailableKey();
    if (!keyInfo.key) return;

    const callFn = nonStreamFns[keyInfo.provider] || callGroqNonStream;
    try {
      const result = await callFn(
        keyInfo.key,
        prompt,
        "You are a JSON-only API. Only output valid JSON.",
      );
      let cleanResult = (result || "").trim();
      if (cleanResult.startsWith("\`\`\`json")) {
        cleanResult = cleanResult
          .replace(/^\`\`\`json\n/, "")
          .replace(/\n\`\`\`$/, "");
      }
      try {
        const data = JSON.parse(cleanResult);
        console.log("[Agent] AI Score:", data.score);
        if (data.score >= 5 && data.status) {
          chrome.tabs
            .sendMessage(tabId, {
              action: "agent_execute",
              status: data.status,
              source: payload.source,
              image: payload.image,
            })
            .catch(() => {});
        } else {
          // Score too low or no status — release agent
          chrome.tabs
            .sendMessage(tabId, { action: "agent_decision", score: data.score || 0 })
            .catch(() => {});
        }
        return;
      } catch (pe) {
        console.error("[Agent] JSON parse error:", pe);
      }
    } catch (e) {
      if (
        e.message &&
        (e.message.includes("429") ||
          e.message.toLowerCase().includes("rate") ||
          e.message.toLowerCase().includes("limit"))
      ) {
        await markKeyRateLimited(keyInfo.key, parseRetryAfter(e.message));
        continue;
      }
      return;
    }
  }
}

// === TRANSLATE: Quick dictionary lookup via AI ===
const translateCache = new LRUCache(200);

async function translateWord(word) {
  const key = word.toLowerCase().trim();
  if (translateCache.has(key)) return translateCache.get(key);

  const prompt = `Dịch từ/cụm từ tiếng Anh sang tiếng Việt. Trả lời NGẮN GỌN theo format:
[phiên âm] — nghĩa 1, nghĩa 2
(loại từ) giải thích ngắn nếu cần

Ví dụ:
"resilient" → /rɪˈzɪl.i.ənt/ — kiên cường, bền bỉ
(adj) khả năng phục hồi sau khó khăn

Từ cần dịch: "${key}"`;

  const nonStreamFns = {
    groq: callGroqNonStream,
    gemini: callGeminiNonStream,
    cerebras: callCerebrasNonStream,
    sambanova: callSambanovaNonStream,
    openrouter: callOpenrouterNonStream,
  };

  // Try up to 3 times (different keys/providers on each attempt)
  for (let attempt = 0; attempt < 3; attempt++) {
    const keyInfo = await getAvailableKey();
    if (!keyInfo.key) return { error: "Chưa có API Key khả dụng." };

    const callFn = nonStreamFns[keyInfo.provider] || callGroqNonStream;
    try {
      const result = await callFn(
        keyInfo.key,
        prompt,
        "You are a concise English-Vietnamese dictionary.",
      );
      const output = { word: key, translation: (result || "").trim() };
      translateCache.set(key, output);
      return output;
    } catch (e) {
      // If rate limited, mark key and retry with next
      if (
        e.message &&
        (e.message.includes("429") ||
          e.message.toLowerCase().includes("rate") ||
          e.message.toLowerCase().includes("limit"))
      ) {
        await markKeyRateLimited(keyInfo.key, parseRetryAfter(e.message));
        continue;
      }
      return { error: e.message };
    }
  }
  return { error: "Tất cả key đều bị rate limit." };
}

// === HELPER: Intelligent text cleaning ===
function cleanInputText(text) {
  // Normalize whitespace only — don't remove content words
  return text.replace(/\s+/g, " ").trim();
}

// ============================================================
// === POST-PROCESSING GUARDRAILS (Validator Sandwich Pattern)
// ============================================================
// Research: freeCodeCamp "How to Build Reliable AI Systems",
// LangChain evaluation concepts, LLM guardrails best practices.
//
// Architecture:
//   INPUT GUARDRAILS → LLM (probabilistic) → OUTPUT GUARDRAILS
//
// Output guardrails run AFTER streaming completes, checking:
// 1. Length validation (too short / too long)
// 2. Copy detection (n-gram overlap with source)
// 3. Quality heuristics (empty, repetitive, off-topic)
// 4. Auto-fix for common issues (trim, clean formatting)
// ============================================================

// --- Input Guardrails ---
function validateInput(text) {
  if (!text || typeof text !== "string")
    return { valid: false, error: "Không có nội dung." };
  const trimmed = text.trim();
  if (trimmed.length < 30)
    return { valid: false, error: "Nội dung quá ngắn (cần ít nhất 30 ký tự)." };
  if (trimmed.length > 100000)
    return { valid: false, error: "Nội dung quá dài (tối đa 100.000 ký tự)." };
  return { valid: true, text: trimmed };
}

// --- Output Guardrails ---

// N-gram overlap: detect if output copies too much from source
function computeNgramOverlap(source, output, n = 4) {
  if (!source || !output) return 0;
  const normalize = (s) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, "")
      .replace(/\s+/g, " ")
      .trim();
  const getNgrams = (text, size) => {
    const words = text.split(" ");
    const ngrams = new Set();
    for (let i = 0; i <= words.length - size; i++) {
      ngrams.add(words.slice(i, i + size).join(" "));
    }
    return ngrams;
  };

  const srcNgrams = getNgrams(normalize(source), n);
  const outNgrams = getNgrams(normalize(output), n);
  if (outNgrams.size === 0) return 0;

  let overlap = 0;
  for (const ng of outNgrams) {
    if (srcNgrams.has(ng)) overlap++;
  }
  return overlap / outNgrams.size;
}

// Repetition detection: check if output repeats itself
function detectRepetition(text) {
  const sentences = text
    .split(/[.!?。]\s*/)
    .filter((s) => s.trim().length > 10);
  if (sentences.length < 2) return 0;

  let dupes = 0;
  const seen = new Set();
  for (const s of sentences) {
    const key = s.toLowerCase().trim();
    if (seen.has(key)) dupes++;
    seen.add(key);
  }
  return dupes / sentences.length;
}

// Main post-processing function
function postProcessOutput(output, sourceText, type) {
  const issues = [];
  let processed = output.trim();

  // 1. Empty or near-empty check
  if (!processed || processed.length < 10) {
    return {
      text: processed,
      quality: "fail",
      issues: ["Output trống hoặc quá ngắn."],
    };
  }

  // 2. Length validation based on type
  const minLen = { summary: 20, affiliate: 30 };
  const maxLen = { summary: 2000, affiliate: 3000 };
  const baseType = type.startsWith("affiliate") ? "affiliate" : "summary";

  if (processed.length < (minLen[baseType] || 20)) {
    issues.push("Output ngắn bất thường.");
  }
  if (processed.length > (maxLen[baseType] || 2000)) {
    // Auto-fix: truncate at last complete sentence
    const cutoff = maxLen[baseType] || 2000;
    const lastSentence = processed.substring(0, cutoff).lastIndexOf(".");
    if (lastSentence > cutoff * 0.5) {
      processed = processed.substring(0, lastSentence + 1);
      issues.push("Output đã được cắt ngắn.");
    }
  }

  // 3. Copy detection (n-gram overlap) — only for Vietnamese content
  if (sourceText && sourceText.length > 50) {
    const isVietnamese =
      /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(
        sourceText,
      );
    if (isVietnamese) {
      const overlap = computeNgramOverlap(sourceText, processed, 4);
      if (overlap > 0.6) {
        issues.push(
          "[!] Output copy nhiều từ bài gốc (" +
            Math.round(overlap * 100) +
            "%).",
        );
      }
    }
  }

  // 4. Repetition detection + auto-dedup
  const repRate = detectRepetition(processed);
  if (repRate > 0.3) {
    // Auto-fix: remove duplicate sentences
    const sentParts = processed.split(/([.!?。]\s*)/);
    const seen = new Set();
    const deduped = [];
    for (let i = 0; i < sentParts.length; i += 2) {
      const s = sentParts[i];
      const punct = sentParts[i + 1] || "";
      const key = s.toLowerCase().replace(/\s+/g, " ").trim();
      if (key.length < 10 || !seen.has(key)) {
        seen.add(key);
        deduped.push(s + punct);
      }
    }
    const dedupedText = deduped.join("").trim();
    if (dedupedText !== processed) {
      processed = dedupedText;
      issues.push("Đã xóa câu lặp lại.");
    } else {
      issues.push("Output có nhiều câu lặp lại.");
    }
  }

  // 5. Clean formatting artifacts
  // Remove leading/trailing quotes that LLMs sometimes add
  processed = processed.replace(/^["'""'']+|["'""'']+$/g, "").trim();
  // Remove "Tóm tắt:" or "Summary:" prefix that LLMs sometimes prepend
  processed = processed
    .replace(/^(tóm tắt|summary|status|review|affiliate)\s*[:：]\s*/i, "")
    .trim();
  // Strip "Đoạn 1:", "Đoạn 2:" labels that AI copies from format example
  processed = processed.replace(/^Đoạn\s*\d+\s*[:：]\s*/gim, "");
  // Normalize "*** Giải thích" → "**Giải thích" (old prompt format)
  processed = processed.replace(/^\*{3}\s*/gm, "**");

  // Xử lý tiêu đề dòng đầu tiên
  if (type && type.startsWith("summary")) {
    const lines = processed.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().length > 0) {
        // Strip ** bold markdown nếu AI vẫn trả về (prompt mới yêu cầu không dùng **)
        lines[i] = lines[i].replace(/^\*\*(.+?)\*\*$/, "$1");
        lines[i] = lines[i].replace(/^\*\*(.+)$/, "$1");
        lines[i] = lines[i].replace(/^(.+)\*\*$/, "$1");
        // Viết hoa toàn bộ tiêu đề
        lines[i] = lines[i].toUpperCase();
        break;
      }
    }
    processed = lines.join("\n");
  }

  // 6. VnReview spelling rules auto-fix
  // Fix common currency formatting
  processed = processed.replace(/\bđô[ -]?la\b/gi, "USD");
  processed = processed.replace(/\bđô\b(?!\s*C)/gi, "USD");
  // Fix abbreviated place names
  processed = processed.replace(/\bVN\b(?!\w)/g, "Việt Nam");
  processed = processed.replace(/\bHN\b(?!\w)/g, "Hà Nội");
  processed = processed.replace(/\bSG\b(?!\w)/g, "TP. HCM");
  // Fix day names capitalization (thứ hai → thứ Hai)
  processed = processed.replace(
    /\bthứ (hai|ba|tư|năm|sáu|bảy)\b/gi,
    (m, d) => "thứ " + d.charAt(0).toUpperCase() + d.slice(1),
  );
  processed = processed.replace(/\bchủ nhật\b/gi, "Chủ nhật");
  // Fix month names (tháng một → tháng Một, but tháng 10 stays)
  processed = processed.replace(
    /\btháng (một|hai|ba|tư|năm|sáu|bảy|tám|chín)\b/gi,
    (m, mo) => "tháng " + mo.charAt(0).toUpperCase() + mo.slice(1),
  );

  // 7. Brand name capitalization — fix lowercase brand names in body text.
  // Applied before title-uppercase step so the title still gets all-caps.
  // Only fix in body (after first line) to avoid fighting with toUpperCase().
  const titleEnd = processed.indexOf("\n");
  if (titleEnd > 0) {
    const title = processed.slice(0, titleEnd);
    let body = processed.slice(titleEnd);
    const brandFixes = [
      [/\bchrome\b/gi, "Chrome"],
      [/\bfirebase\b/gi, "Firebase"],
      [/\bgoogle\b/gi, "Google"],
      [/\bfacebook\b/gi, "Facebook"],
      [/\binstagram\b/gi, "Instagram"],
      [/\byoutube\b/gi, "YouTube"],
      [/\btiktok\b/gi, "TikTok"],
      [/\bwhatsapp\b/gi, "WhatsApp"],
      [/\btwitter\b/gi, "Twitter"],
      [/\bwindows\b/gi, "Windows"],
      [/\bmacos\b/gi, "macOS"],
      [/\b(?<![a-z])ios\b/gi, "iOS"],
      [/\bandroid\b/gi, "Android"],
      [/\biphone\b/gi, "iPhone"],
      [/\bipad\b/gi, "iPad"],
      [/\bapple\b/gi, "Apple"],
      [/\bmicrosoft\b/gi, "Microsoft"],
      [/\bopenai\b/gi, "OpenAI"],
      [/\bchatgpt\b/gi, "ChatGPT"],
      [/\bclaude\b/gi, "Claude"],
      [/\bgemini\b/gi, "Gemini"],
      [/\bgpt-(\d)/gi, "GPT-$1"],
      [/\blinkedin\b/gi, "LinkedIn"],
      [/\bpaypal\b/gi, "PayPal"],
      [/\bspotify\b/gi, "Spotify"],
      [/\bnetflix\b/gi, "Netflix"],
      [/\bamazon\b/gi, "Amazon"],
    ];
    for (const [re, fix] of brandFixes) body = body.replace(re, fix);
    processed = title + body;
  }

  // 8. Fix VND long format → short format (44.990.000 đồng → gần 45 triệu đồng)
  processed = processed.replace(
    /(\d{1,3})\.(\d{3})\.(\d{3})\s*(?:đồng|VND|vnđ|VNĐ)/gi,
    (match, a, b, c) => {
      const num = parseInt(a + b + c, 10);
      if (num >= 1000000000) {
        const ty = num / 1000000000;
        return (
          (ty % 1 === 0 ? ty.toString() : ty.toFixed(1).replace(".", ",")) +
          " tỷ đồng"
        );
      }
      const trieu = num / 1000000;
      if (trieu % 1 === 0) return trieu + " triệu đồng";
      return trieu.toFixed(1).replace(".", ",") + " triệu đồng";
    },
  );

  // 9. Remove empty lead-in sentences at the beginning
  const leadInPatterns = [
    /^[^\n.!?]*(?:mình|tôi|mình)\s+(?:vừa|mới|đã)\s+(?:đọc|xem|thấy|nghe|biết)\s+(?:được|thấy|về)?\s*[^\n.!?]*[.!?]\s*/i,
    /^(?:gần đây|mới đây|dạo gần đây|thời gian gần đây)[,.]?\s*[^\n.!?]*[.!?]\s*/i,
    /^(?:như (?:chúng ta|mọi người|các bạn) (?:đã |đều )?biết)[,.]?\s*[^\n.!?]*[.!?]\s*/i,
    /^(?:hôm nay|hôm qua|sáng nay|tối qua)\s+(?:mình|tôi)\s+(?:đọc|xem|thấy|nghe)[^\n.!?]*[.!?]\s*/i,
  ];
  for (const pat of leadInPatterns) {
    if (pat.test(processed)) {
      processed = processed.replace(pat, "").trim();
      issues.push("Đã xóa câu dẫn dắt rỗng ở đầu bài.");
      break;
    }
  }

  // 10. Hallucination detection: check if output contains numbers not in source
  if (sourceText && sourceText.length > 50) {
    const sourceNums = new Set(
      (sourceText.match(/\d[\d.,]*\d|\d+/g) || []).map((n) =>
        n.replace(/[.,]/g, ""),
      ),
    );
    const outputNums = (processed.match(/\d[\d.,]*\d|\d+/g) || []).map((n) =>
      n.replace(/[.,]/g, ""),
    );
    const fabricated = outputNums.filter(
      (n) => n.length >= 2 && !sourceNums.has(n),
    );
    if (fabricated.length >= 2) {
      issues.push(
        "[!] Output có thể chứa số liệu bịa (" +
          fabricated.slice(0, 3).join(", ") +
          ") — không tìm thấy trong bài gốc.",
      );
    }
  }

  // 11. Detect "nói xạo" - writing as if personally experienced when sharing others' content
  const fakeExperiencePatterns = [
    /\b(?:mình|tôi)\s+(?:vừa|đã|mới)\s+(?:thử|test|dùng|tạo|làm|mua|cài|nâng cấp|update)\b/i,
    /\b(?:mình|tôi)\s+(?:thử|test|dùng)\s+(?:rồi|xong|thấy)\b/i,
    /\b(?:mình|tôi)\s+(?:đã\s+)?(?:tạo|làm)\s+(?:được|ra|xong)\b/i,
    /\bthật\s+sự\s+(?:choáng|sốc|bất ngờ|ngạc nhiên)\b/i,
    /\b(?:mình|tôi)\s+(?:rất|cực kỳ|vô cùng)\s+(?:thích|hài lòng|ấn tượng|ngạc nhiên)\b/i,
    /\bsau khi (?:mình|tôi)\s+(?:dùng|thử|test|cài)\b/i,
    /\b(?:mình|tôi)\s+(?:khuyên|recommend|đề xuất)\b/i,
  ];
  for (const pat of fakeExperiencePatterns) {
    if (pat.test(processed)) {
      issues.push(
        "[!] Output viết như người trải nghiệm trực tiếp — có thể không chính xác nếu đây là nội dung chia sẻ lại.",
      );
      break;
    }
  }

  // 12. Detect excessive possessive "của bạn/mình/chúng ta"
  const possessiveMatches =
    processed.match(/của\s+(?:bạn|mình|chúng ta)/gi) || [];
  if (possessiveMatches.length >= 3) {
    issues.push(
      'Output dùng "của bạn/mình" ' +
        possessiveMatches.length +
        " lần — nên viết trực tiếp hơn.",
    );
  }

  // 13. Quality score
  let quality = "good";
  if (issues.some((i) => i.includes("fail") || i.includes("trống")))
    quality = "fail";
  else if (issues.some((i) => i.includes("[!]") || i.includes("copy")))
    quality = "warn";
  else if (issues.length > 0) quality = "info";

  return { text: processed, quality, issues };
}

async function handleStream(
  text,
  site,
  port,
  signal,
  type = "summary",
  sourceUrl = "",
  imageUrl = "",
  author = "",
  postTitle = "",
  postSource = "",
  agentMode = false,
  tone = null,
  preferredProvider = null,
) {
  // === INPUT GUARDRAILS ===
  const inputCheck = validateInput(text);
  if (!inputCheck.valid) return { error: inputCheck.error };

  const data = await chrome.storage.sync.get(["summaryLength"]);
  const summaryLength = data.summaryLength || "medium";

  // Clean and truncate text
  const cleanedText = cleanInputText(inputCheck.text);
  const truncated =
    cleanedText.length > MAX_INPUT_CHARS
      ? cleanedText.substring(0, MAX_INPUT_CHARS) +
        "\n[...bài viết đã được cắt ngắn]"
      : cleanedText;

  let systemPrompt = await getSystemPrompt(
    type,
    site,
    author,
    sourceUrl,
    postTitle,
    postSource,
    tone,
  );

  // Agent mode: check if user prefers heuristic-only eval (skip AI scoring)
  const agentSettings = await chrome.storage.sync.get(['useHeuristicEval']);
  const useHeuristicOnly = agentSettings.useHeuristicEval === true;

  // Agent mode: yêu cầu AI tự chấm điểm trong cùng lần gọi — tránh round-trip eval riêng
  // Nếu useHeuristicEval = true → bỏ qua, dùng heuristic sau khi có summary
  if (agentMode && !useHeuristicOnly) {
    systemPrompt +=
      "\n\nAGENT MODE: Trước khi viết tóm tắt, chấm điểm bài theo tiêu chí sau:\n- 8-9: Tin AI hot (Claude/ChatGPT/Gemini/Anthropic/OpenAI/DeepSeek ra tính năng mới, đăng ký AI miễn phí/giá rẻ), sự cố bảo mật nghiêm trọng (data breach, ransomware, lỗ hổng lớn)\n- 7: Sản phẩm tech nổi bật, startup gọi vốn lớn, lập trình/tool dev quan trọng\n- 4-6: Tech liên quan nhưng không nổi bật\n- 1-3: Status cá nhân, drama, quảng cáo bán hàng, ẩm thực, thể thao, giải trí không liên quan tech\nĐặt tag [SCORE:N] ở DÒNG ĐẦU TIÊN (N là 1-9), xuống dòng rồi viết tóm tắt (tiêu đề viết bình thường, hệ thống tự viết hoa). Ví dụ:\n[SCORE:8]\nClaude 4 Opus ra mắt: vượt GPT-4o về lập trình\n\nNội dung tóm tắt...";
  }
  const streamFns = {
    groq: callGroqStream,
    gemini: callGeminiStream,
    cerebras: callCerebrasStream,
    sambanova: callSambanovaStream,
    openrouter: callOpenrouterStream,
  };

  const maxTokensMap = { short: 256, medium: 512, long: 1024 };
  const maxTokens = maxTokensMap[summaryLength] || 512;

  for (let attempt = 0; attempt <= 3; attempt++) {
    if (signal.aborted) return { error: "Đã hủy." };

    // Get best available key across all providers
    const keyInfo = await getAvailableKey(attempt === 0 ? preferredProvider : null);
    if (!keyInfo.key) {
      if (keyInfo.noKeys)
        return { error: "Chưa có API Key. Thêm ở tab API Keys." };
      if (keyInfo.allLimited)
        return {
          error:
            "Tất cả " +
            keyInfo.total +
            " key đều bị rate limit. Thử lại sau ~" +
            keyInfo.waitMinutes +
            " phút.",
        };
      return { error: "Không tìm được key khả dụng." };
    }

    const callFn = streamFns[keyInfo.provider];
    if (!callFn) return { error: "Provider không hợp lệ: " + keyInfo.provider };

    const result = await callFn(
      keyInfo.key,
      truncated,
      systemPrompt,
      port,
      signal,
      maxTokens,
    );

    if (result.rateLimited) {
      const retryMs = parseRetryAfter(result.rateLimitError || "");
      await markKeyRateLimited(keyInfo.key, retryMs);
      continue; // Thử provider tiếp theo
    }

    if (result.error) {
      // Provider lỗi (API down, sai key, model lỗi...) → skip key này 5 phút, thử tiếp
      console.warn(
        "[Stream] Provider",
        keyInfo.provider,
        "error:",
        result.error,
        "→ trying next",
      );
      const localData = await chrome.storage.local.get(["keyStatus"]);
      const ks = localData.keyStatus || {};
      ks[keyInfo.key] = {
        ...(ks[keyInfo.key] || {}),
        rateLimitedUntil: Date.now() + 5 * 60 * 1000,
      };
      await chrome.storage.local.set({ keyStatus: ks });
      continue;
    }

    if (result.summary) {
      // Track successful summary
      telemetryData.summaries++;
      saveTelemetry();
      trackEvent('summary_completed', { provider: keyInfo.provider, type });
      // Agent mode: parse [SCORE:N] tag từ dòng đầu, strip khỏi text hiển thị
      let agentScore = undefined;
      if (agentMode) {
        if (useHeuristicOnly) {
          // Heuristic-only mode: chấm điểm bằng keywords, không cần AI eval
          agentScore = heuristicScore(text);
          logger.info('[Agent] Heuristic-only mode, score:', agentScore);
        } else {
          const scoreMatch = result.summary.match(/^\[SCORE:(\d+)\]\s*\n?/);
          if (scoreMatch) {
            agentScore = parseInt(scoreMatch[1], 10);
            result.summary = result.summary
              .replace(/^\[SCORE:\d+\]\s*\n?/, "")
              .trim();
          } else {
            // Fallback: AI không trả score inline → dùng heuristic thay vì gọi AI lần 2
            agentScore = heuristicScore(text);
            logger.info('[Agent] AI did not return inline score, using heuristic:', agentScore);
          }
        }
        result.agentScore = agentScore;
      }
      const postResult = postProcessOutput(result.summary, text, type);
      result.summary = postResult.text;
      result.quality = postResult.quality;
      result.issues = postResult.issues;
      incrementBadge();
      saveHistory(
        text,
        result.summary,
        site,
        type,
        sourceUrl,
        imageUrl,
        author,
        postTitle,
      );
    }
    return result;
  }
  return {
    error:
      "Tất cả API đều lỗi hoặc quá tải. Thử lại sau hoặc kiểm tra API Key.",
  };
}
// === HISTORY ===
async function saveHistory(
  text,
  summary,
  site,
  type,
  sourceUrl,
  imageUrl,
  author,
  postTitle,
) {
  const data = await chrome.storage.local.get("history");
  const history = data.history || [];
  history.unshift({
    text: text.substring(0, 2000),
    summary,
    date: new Date().toISOString(),
    site: site || "unknown",
    type: type || "summary",
    sourceUrl: sourceUrl || "",
    imageUrl: imageUrl || "",
    author: author || "",
    postTitle: postTitle || "",
  });
  if (history.length > 200) history.length = 200;
  historyBatcher.set('history', history);
}

// reviewTodayHistory uses getAvailableKey with retry on rate limit
async function reviewTodayHistory() {
  const localData = await chrome.storage.local.get("history");
  const history = localData.history || [];
  const today = new Date().toISOString().slice(0, 10);
  const todayItems = history.filter((h) => h.date && h.date.startsWith(today));

  if (todayItems.length === 0)
    return { error: "Chưa có bài tóm tắt nào hôm nay." };

  const MAX_ITEMS = 20;
  const cappedItems = todayItems.slice(0, MAX_ITEMS);

  const itemsList = cappedItems
    .map((h, i) => {
      const title = (h.postTitle || "N/A").substring(0, 80);
      const summary = (h.summary || "").substring(0, 200);
      return `[${i}] Nguồn: ${h.site} | Tác giả: ${h.author || "N/A"} | Tiêu đề: ${title}\nTóm tắt: ${summary}\nLink: ${h.sourceUrl || "N/A"}`;
    })
    .join("\n\n");

  const systemPrompt = `Bạn là biên tập viên tin công nghệ. Nhiệm vụ: đánh giá danh sách bài tóm tắt trong ngày và chọn ra những bài HAY NHẤT để đăng "Điểm tin công nghệ".

Tiêu chí chọn:
- Tin nóng, xu hướng, có giá trị thông tin cao
- Đủ nội dung để viết bài ngắn (150-350 chữ)
- Có link nguồn (ưu tiên)
- Không trùng lặp chủ đề
- Ưu tiên tin AI, smartphone, bảo mật, startup, sản phẩm mới

Trả về ĐÚNG JSON array, mỗi phần tử là index của bài được chọn kèm lý do ngắn:
[{"index": 0, "score": 85, "reason": "Tin AI mới ra mắt, hot"}, ...]

CHỈ trả về JSON, không giải thích thêm.`;

  const nonStreamFns = {
    groq: callGroqNonStream,
    gemini: callGeminiNonStream,
    cerebras: callCerebrasNonStream,
    sambanova: callSambanovaNonStream,
    openrouter: callOpenrouterNonStream,
  };

  // Retry up to 3 times with different keys/providers
  for (let attempt = 0; attempt < 3; attempt++) {
    const keyInfo = await getAvailableKey();
    if (!keyInfo.key) {
      if (keyInfo.noKeys)
        return { error: "Chưa có API Key. Thêm ở tab API Keys." };
      if (keyInfo.allLimited)
        return {
          error:
            "Tất cả key bị rate limit. Thử lại sau ~" +
            keyInfo.waitMinutes +
            " phút.",
        };
      return { error: "Không tìm được key khả dụng." };
    }

    const callFn = nonStreamFns[keyInfo.provider] || callGroqNonStream;
    try {
      const result = await callFn(keyInfo.key, itemsList, systemPrompt);
      if (!result) return { error: "AI không phản hồi." };

      const jsonMatch = result.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return { error: "AI phản hồi không hợp lệ." };

      const picks = JSON.parse(jsonMatch[0]);
      const recommended = picks
        .filter(
          (p) =>
            typeof p.index === "number" &&
            p.index >= 0 &&
            p.index < todayItems.length,
        )
        .map((p) => ({
          ...todayItems[p.index],
          aiScore: p.score || 0,
          aiReason: p.reason || "",
        }));

      await chrome.storage.local.set({
        aiReview: {
          date: today,
          items: recommended,
          reviewedAt: new Date().toISOString(),
        },
      });

      return { success: true, count: recommended.length, items: recommended };
    } catch (e) {
      if (
        e.message &&
        (e.message.includes("429") || e.message.toLowerCase().includes("rate"))
      ) {
        await markKeyRateLimited(keyInfo.key, parseRetryAfter(e.message));
        continue;
      }
      return { error: "Lỗi AI Review: " + e.message };
    }
  }
  // Track error
  telemetryData.errors++;
  saveTelemetry();
  trackEvent('summary_error', { reason: 'all_keys_rate_limited' });
  return { error: "Tất cả key bị rate limit." };
}

// Generic streaming API call function
async function callStreamAPI(config) {
  const {
    url,
    headers = {},
    body,
    extractFn,
    port,
    signal,
    maxTokens = 512,
    provider = "unknown",
  } = config;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    signal,
    body: JSON.stringify(body),
  });

  if (resp.status === 429) {
    const err = await resp.json().catch(() => ({}));
    return { rateLimited: true, rateLimitError: err.error?.message || "" };
  }
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    return {
      error: `${provider} API lỗi: ` + (err.error?.message || resp.statusText),
    };
  }
  return processStream(resp, port, signal, extractFn);
}

// Non-streaming API calls for AI review
async function callNonStream(url, extraHeaders, body, extractFn) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    const msg = data?.error?.message || "HTTP " + response.status;
    throw new Error(msg);
  }
  return extractFn(data) || "";
}

async function callGroqNonStream(apiKey, userMessage, systemPrompt) {
  return callNonStream(
    "https://api.groq.com/openai/v1/chat/completions",
    { Authorization: "Bearer " + apiKey },
    {
      model: "llama-3.3-70b-versatile",
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

async function callGeminiNonStream(apiKey, userMessage, systemPrompt) {
  return callNonStream(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" +
      apiKey,
    {},
    {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userMessage }] }],
      generationConfig: { maxOutputTokens: 1024, temperature: 0.3 },
    },
    (d) => d?.candidates?.[0]?.content?.parts?.[0]?.text,
  );
}

// === EXPORT: Generate dtcn-v2 compatible JSON ===
function exportDtcnJson(items) {
  return items.map((item) => ({
    source: formatSourceName(item.site, item.author),
    title: item.postTitle || item.summary.split(/[.\n]/)[0].substring(0, 100),
    link: item.sourceUrl || "",
    image: item.imageUrl || "",
    summary: item.summary || "",
    full_body: item.text || "",
    score: item.aiScore || 50,
    pub_date: item.date || new Date().toISOString(),
  }));
}

function formatSourceName(site, author) {
  const siteNames = {
    facebook: "Facebook",
    threads: "Threads",
    x: "X (Twitter)",
    linkedin: "LinkedIn",
    reddit: "Reddit",
  };
  const siteName = siteNames[site] || site || "Web";
  return author ? `${author} (${siteName})` : siteName;
}

// === ALARM: Auto review ===
// Re-register alarm on SW startup if previously enabled
if (chrome?.runtime?.onStartup) {
chrome.runtime.onStartup.addListener(async () => {
  const today = new Date().toDateString();
  const data = await chrome.storage.local.get([
    "dailyCount",
    "lastDate",
    "reviewAlarm",
  ]);
  if (data.lastDate === today) {
    chrome.action.setBadgeText({ text: (data.dailyCount || 0).toString() });
    chrome.action.setBadgeBackgroundColor({ color: "#6c5ce7" });
  }
  // Re-create alarm if it was enabled
  const alarm = data.reviewAlarm;
  if (alarm && alarm.enabled) {
    const existing = await chrome.alarms.get("daily-ai-review");
    if (!existing) {
      const now = new Date();
      const target = new Date();
      target.setHours(alarm.hour, alarm.minute, 0, 0);
      if (target <= now) target.setDate(target.getDate() + 1);
      chrome.alarms.create("daily-ai-review", {
        delayInMinutes: (target - now) / 60000,
        periodInMinutes: 24 * 60,
      });
    }
  }

  ensureKeepAliveAlarm();
});
} // end if (chrome?.runtime?.onStartup)

if (chrome?.alarms?.onAlarm) {
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "keep-alive") {
    logger.debug("Keep-alive ping");
    ensureKeepAliveAlarm();
    return;
  }
  if (alarm.name === "daily-ai-review") {
    try {
      const result = await reviewTodayHistory();
      if (result.success && result.count > 0) {
        chrome.notifications.create("ai-review-done", {
          type: "basic",
          iconUrl: "icons/icon128.png",
          title: "FeedWriter — Đề xuất tin hay",
          message: `AI đã chọn ${result.count} tin hay. Mở extension để xem.`,
        });
      } else if (result.error) {
        chrome.notifications.create("ai-review-error", {
          type: "basic",
          iconUrl: "icons/icon128.png",
          title: "FeedWriter — Lỗi đề xuất",
          message: result.error,
        });
      } else {
        // No items found today
        chrome.notifications.create("ai-review-empty", {
          type: "basic",
          iconUrl: "icons/icon128.png",
          title: "FeedWriter",
          message: "Chưa có bài tóm tắt nào hôm nay để đề xuất.",
        });
      }
    } catch (e) {
      chrome.notifications.create("ai-review-crash", {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "FeedWriter — Lỗi",
        message: "Lỗi khi chạy đề xuất: " + e.message,
      });
    }
  }
});
} // end if (chrome?.alarms?.onAlarm)

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
