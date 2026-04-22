// FeedWriter — Background service worker
// https://github.com/anlvdt/fb-post-summarizer
// Author: Le An (anlvdt)

async function injectAndSend(tabId, message) {
  try {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ["content.css"] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    chrome.tabs.sendMessage(tabId, message);
  } catch (e) {
    console.error("Injection failed", e);
  }
}

// === CONTEXT MENU ===
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "summarize-selection",
    title: "Tóm tắt nội dung",
    contexts: ["selection"],
  });
  chrome.contextMenus.create({
    id: "status-rewrite",
    title: "Viết thành Status MXH",
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
});

async function clearShopeeCookies() {
  const domains = [".shopee.vn", "shopee.vn", ".shope.ee", "shope.ee"];
  for (const d of domains) {
    const cookies = await chrome.cookies.getAll({ domain: d });
    for (const c of cookies) {
      await chrome.cookies.remove({ url: "https://" + c.domain + c.path, name: c.name });
    }
  }
}

async function processUnshorten(url, tabId) {
  try {
    const resp = await fetch(url, { method: "GET", redirect: "follow" });
    const finalUrl = resp.url;
    const cleanMatch = finalUrl.match(/-i\.(\d+)\.(\d+)/);
    const output = cleanMatch ? "https://shopee.vn/product/" + cleanMatch[1] + "/" + cleanMatch[2] : finalUrl;
    await clearShopeeCookies();
    chrome.tabs.sendMessage(tabId, { action: "unshorten-result", text: output }).catch(() => { });
    chrome.tabs.create({ url: "https://affiliate.shopee.vn/offer/custom_link" });
  } catch (e) {
    chrome.tabs.sendMessage(tabId, { action: "unshorten-result", error: "Lỗi extract: " + e.message }).catch(() => { });
  }
}

chrome.commands.onCommand.addListener((command) => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      const msg = { action: "shortcut-" + command };
      chrome.tabs.sendMessage(tabs[0].id, msg).catch(() => injectAndSend(tabs[0].id, msg));
    }
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "summarize-selection" && info.selectionText) {
    const msg = { action: "summarize-selection", text: info.selectionText, type: "summary" };
    chrome.tabs.sendMessage(tab.id, msg).catch(() => injectAndSend(tab.id, msg));
  } else if (info.menuItemId === "status-rewrite" && info.selectionText) {
    const msg = { action: "summarize-selection", text: info.selectionText, type: "status" };
    chrome.tabs.sendMessage(tab.id, msg).catch(() => injectAndSend(tab.id, msg));
  } else if (info.menuItemId === "affiliate-rewrite" && info.selectionText) {
    const msg = { action: "summarize-selection", text: info.selectionText, type: "affiliate" };
    chrome.tabs.sendMessage(tab.id, msg).catch(() => injectAndSend(tab.id, msg));
  } else if (info.menuItemId === "unshorten-shopee" && info.selectionText) {
    const urlMatches = info.selectionText.match(/https?:\/\/shope\.ee\/[^\s]*/);
    if (!urlMatches) {
      chrome.tabs.sendMessage(tab.id, { action: "unshorten-result", error: "Không tìm thấy link shope.ee trong phần bôi đen" }).catch(() => { });
      return;
    }
    processUnshorten(urlMatches[0], tab.id);
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

// === IMPROVED PROMPTS based on Vietnamese NLP research ===
// References: VietAI ViT5, Underthesea, Vietnamese summarization best practices

// TÓM TẮT TIẾNG VIỆT CHUẨN - Hybrid extractive + abstractive approach
const SUMMARY_PROMPT = `Bạn là chuyên gia phân tích và tóm tắt tiếng Việt.

NHIỆM VỤ: Đọc kỹ nội dung, xác định thông tin quan trọng, viết lại ngắn gọn.

QUY TRÌNH:
1. XÁC ĐỊNH: Chủ đề chính là gì? Kết luận/điểm then chốt nhất?
2. TRÍCH XUẤT: Các ý quan trọng nhất (2-5 điểm)
3. VIẾT LẠI: Hoàn toàn bằng lời của bạn, KHÔNG copy

YÊU CẦU:
- Tối đa 5 câu liền mạch hoặc 5 bullet points
- Giọng tự nhiên, dễ hiểu như đang kể cho bạn bè
- Giữ thông tin có giá trị thực, dữ liệu, kết luận
- Bỏ ví dụ dài, chi tiết lan man, rào đón
- CHỈ dùng thông tin CÓ TRONG bài gốc, KHÔNG bịa thêm số liệu/thông số/phiên bản
- Trả lời bằng tiếng Việt`;

// TÓM TẮT NGẮN - Quick overview
const SUMMARY_SHORT_PROMPT = `Tóm tắt cực ngắn nội dung sau:

Yêu cầu:
- 1-2 câu duy nhất
- Nắm bắt thông điệp cốt lõi nhất
- Viết lại bằng lời mình, KHÔNG copy
- Giọng tự nhiên`;

// TÓM TẮT CHI TIẾT - Detailed với cấu trúc
const SUMMARY_DETAILED_PROMPT = `Bạn là chuyên gia phân tích và tóm tắt có cấu trúc.

NHIỆM VỤ: Tóm tắt chi tiết, giữ cấu trúc logic.

YÊU CẦU:
- Xác định thesis/luận điểm chính
- Các luận điểm hỗ trợ quan trọng nhất
- Kết luận và hàm ý
- Cấu trúc rõ ràng: Mở đầu → Điểm chính → Kết luận
- Tối đa 150 từ
- Viết lại hoàn toàn, KHÔNG copy`;

// TÓM TẮT DẠNG BULLET - Easy to scan
const SUMMARY_BULLET_PROMPT = `Tóm tắt thành các bullet points ngắn gọn.

Quy tắc:
- Mỗi bullet tối đa 15 từ
- Ưu tiên thông tin có giá trị, dữ liệu, kết luận
- Bỏ ví dụ, chỉ giữ kết quả
- 5-7 bullet max
- Dùng • hoặc - để đánh dấu`;

// === QUY TẮC CHÍNH TẢ VNREVIEW (áp dụng cho mọi output tiếng Việt) ===
const VNREVIEW_RULES = `
QUY TẮC CHÍNH TẢ VÀ HÀNH VĂN BẮT BUỘC:

CẤM MỞ ĐẦU BẰNG CÂU DẪN DẮT RỖNG:
- TUYỆT ĐỐI KHÔNG bắt đầu bằng: "Mình vừa đọc được...", "Gần đây...", "Như chúng ta đã biết...", "Mới đây...", "Theo như mình được biết...", "Hôm nay mình đọc được..."
- Câu đầu tiên PHẢI chứa thông tin thực, đi thẳng vào nội dung chính.
- VD SAI: "Mình vừa đọc được tin tức về giá điện thoại cao cấp..."
- VD ĐÚNG: "Huawei thay đổi chiến lược: bản Pro Max giá ngang Xiaomi Ultra."

TIỀN VIỆT NAM:
- Viết gọn bằng đơn vị triệu/tỷ: "45 triệu đồng", "1,2 tỷ đồng"
- KHÔNG viết dạng đầy đủ: "44.990.000 đồng" → viết "gần 45 triệu đồng" hoặc "44,99 triệu đồng"

KHÔNG LẶP CẢM XÚC:
- Mỗi cảm xúc/nhận xét chỉ nói MỘT lần. Không lặp "thật sự ngạc nhiên", "thật sự không hiểu", "quá đắt đỏ" trong cùng bài.

CHỐNG BỊA THÔNG TIN (HALLUCINATION):
- TUYỆT ĐỐI KHÔNG bịa số liệu, tên sản phẩm, phiên bản, thông số kỹ thuật, giá cả mà KHÔNG có trong bài gốc.
- Nếu bài gốc không nêu con số cụ thể, KHÔNG được tự thêm con số.
- Nếu không chắc chắn thông tin, KHÔNG viết. Bỏ qua còn hơn bịa.
- Chỉ sử dụng thông tin CÓ TRONG bài gốc được cung cấp.

QUY TẮC CHÍNH TẢ:
- Câu ngắn, từ ngắn. Mỗi đoạn văn thể hiện MỘT ý.
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

// STATUS CHIA SẺ BÀI VIẾT - Đọc → Phân tích → Nhận định → Viết status
const STATUS_PROMPT = `Bạn là người hay đọc và chia sẻ những thứ hay ho trên MXH, giọng văn tự nhiên.

BỐI CẢNH QUAN TRỌNG:
- Bạn KHÔNG phải người trải nghiệm trực tiếp. Bạn là người ĐỌC ĐƯỢC nội dung này và chia sẻ lại.
- TUYỆT ĐỐI KHÔNG viết "Mình vừa thử...", "Mình đã tạo được...", "Mình test thấy..." — đây là NÓI XẠO.
- Thay vào đó, viết theo góc nhìn người chia sẻ: "Có người vừa chia sẻ cách...", "Theo bài viết này...", "Tác giả cho biết..."

NHIỆM VỤ: Đọc nội dung gốc, viết thành status MXH hấp dẫn để chia sẻ lại.

QUY TRÌNH (tuân thủ nghiêm ngặt theo thứ tự):

BƯỚC 1 — TÓM TẮT NỘI DUNG:
Đọc kỹ bài gốc, xác định:
- Chủ đề chính là gì?
- Insight/dữ liệu đáng giá nhất?
- Có gì bất ngờ, trái với suy nghĩ thông thường?

BƯỚC 2 — CHỌN KỸ THUẬT HOOK (câu mở đầu):
Hook PHẢI chứa thông tin cụ thể, hấp dẫn. Chọn 1 trong các kỹ thuật:

a) CURIOSITY GAP (khoảng trống tò mò): Đưa thông tin chưa đầy đủ, khiến người đọc phải đọc tiếp.
   VD: "GPT Image 2 có thể tạo cả bộ branding DNA board chỉ từ 1 logo — nếu bạn biết cách prompt."

b) CONTRARIAN (phản bác niềm tin phổ biến): Nói điều ngược lại với suy nghĩ số đông.
   VD: "Không cần designer, AI giờ làm được branding board chuyên nghiệp."

c) DATA HOOK (con số/chi tiết cụ thể): Mở bằng thông tin cụ thể, ấn tượng.
   VD: "1 logo + 1 prompt chi tiết = 1 bộ branding DNA board hoàn chỉnh với GPT Image 2."

d) BENEFIT HOOK (lợi ích rõ ràng): Nêu ngay giá trị người đọc nhận được.
   VD: "Cách tạo branding DNA board bằng GPT Image 2 — có prompt mẫu luôn."

e) QUESTION HOOK (câu hỏi cụ thể): Đánh vào pain point, buộc người đọc suy nghĩ.
   VD: "Bạn có biết GPT Image 2 có thể tạo branding board từ 1 logo không?"

QUY TẮC HOOK:
- Tối đa 15-20 từ, đọc hiểu trong 2 giây
- PHẢI chứa thông tin cụ thể từ bài gốc (tên công cụ, tính năng, kết quả...)
- PHẢI tạo knowledge gap — người đọc muốn biết thêm
- CẤM hook nhạt không có thông tin: "THỬ NGHIỆM GPT IMAGE 2", "Có một điều thú vị...", "Bạn có biết không..."
- CẤM câu dẫn dắt rỗng: "Mình vừa đọc...", "Gần đây...", "Như chúng ta đã biết..."

BƯỚC 3 — VIẾT STATUS:
Sau hook, triển khai nội dung:
- Tóm nội dung gốc bằng lời mình (2-3 câu), ghi credit nguồn nếu biết
- Dùng ngôn ngữ người chia sẻ: "Theo tác giả...", "Bài viết hướng dẫn...", "Có người đã thử và..."
- Thêm quan điểm/nhận định cá nhân — đây là phần tạo giá trị
- Kết bằng câu hỏi mở CỤ THỂ liên quan đến nội dung

YÊU CẦU:
- 2-4 đoạn ngắn, tổng 100-250 từ
- Xưng "mình" cho quan điểm cá nhân, NHƯNG không nhận vơ trải nghiệm của người khác
- Mỗi cảm xúc chỉ nói MỘT lần, không lặp
- Tiền VND viết gọn: "45 triệu đồng"

RANH GIỚI CỨNG — VI PHẠM = NÓI XẠO:
- CẤM: "Mình vừa thử...", "Mình đã tạo được...", "Mình test thấy...", "Mình dùng rồi..."
- ĐÚNG: "Có người chia sẻ cách...", "Theo bài viết...", "Tác giả đã thử và...", "Workflow này cho phép..."

CHỐNG BỊA: CHỈ dùng thông tin CÓ TRONG bài gốc. KHÔNG bịa số liệu, phiên bản, thông số. Nếu bài gốc không nêu, KHÔNG thêm.
` + VNREVIEW_RULES;

// STATUS NGẮN - Quick share + nhận xét
const STATUS_SHORT_PROMPT = `Viết status MXH cực ngắn chia sẻ nội dung hay vừa đọc.

QUY TRÌNH (tuân thủ theo thứ tự):

BƯỚC 1 — TÓM TẮT: Chọn 1 insight đáng giá nhất từ bài gốc.

BƯỚC 2 — VIẾT HOOK: Câu đầu tiên dùng 1 trong các kỹ thuật:
- Con số gây bất ngờ: "49 triệu cho Oppo — đắt hơn iPhone."
- Phản bác: "Điện thoại TQ không còn rẻ."
- Curiosity gap: "Một hãng TQ vừa làm điều ngược lại tất cả."
Tối đa 15 từ, đọc hiểu trong 2 giây. CẤM câu dẫn dắt rỗng.

BƯỚC 3 — VIẾT: Thêm 1-2 câu tóm tắt + nhận xét cá nhân.

YÊU CẦU:
- Tối đa 3 câu ngắn, dưới 280 ký tự
- Ghi nguồn/credit nếu biết
- Viết lại bằng lời mình, không copy
- Tiền VND viết gọn: "45 triệu đồng"
` + VNREVIEW_RULES;

// STATUS CẢM XÚC - Emotional share + cảm nhận cá nhân
const STATUS_EMOTIONAL_PROMPT = `Viết status MXH có cảm xúc từ nội dung vừa đọc được.

QUY TRÌNH (tuân thủ theo thứ tự):

BƯỚC 1 — TÓM TẮT: Đọc bài gốc, xác định điều gì gây ấn tượng/xúc động nhất.

BƯỚC 2 — VIẾT HOOK: Câu đầu tiên dùng 1 trong các kỹ thuật:
- Story hook: Bắt đầu từ đỉnh điểm cảm xúc, không giải thích.
- Data hook: Con số cụ thể gây bất ngờ.
- Question hook: Câu hỏi đánh vào cảm xúc.
Tối đa 15-20 từ. CẤM câu dẫn dắt rỗng kiểu "Mình vừa đọc được..."

BƯỚC 3 — VIẾT STATUS:
- Tóm nội dung gốc (2-3 câu, ghi credit nếu biết)
- Liên hệ cảm xúc/suy nghĩ cá nhân — dùng chi tiết cụ thể
- Kết bằng câu hỏi hoặc suy ngẫm mở CỤ THỂ

YÊU CẦU:
- 2-3 đoạn, tối đa 150 từ
- Mỗi cảm xúc chỉ nói MỘT lần, không lặp
- Tiền VND viết gọn: "45 triệu đồng"
- Đây là nội dung mình ĐỌC ĐƯỢC — không viết như người trải nghiệm trực tiếp
- Giọng kể chuyện, chân thật, có "hồn"
` + VNREVIEW_RULES;

// AFFILIATE - Review sản phẩm chân thật + Quy tắc VnReview
const AFFILIATE_PROMPT = `Bạn là người dùng thật, viết review sản phẩm tự nhiên.

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
const AFFILIATE_SOFT_PROMPT = `Viết chia sẻ trải nghiệm sản phẩm nhẹ nhàng, không giống quảng cáo.

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
const AFFILIATE_STORY_PROMPT = `Viết bài affiliate theo format câu chuyện hấp dẫn.

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

NHIỆM VỤ: Giữ nguyên cấu trúc bài viết, chỉ rút gọn nội dung.

YÊU CẦU:
- Giữ headings, bullet points, numbering
- Mỗi section: rút còn 1-3 ý quan trọng nhất
- Bỏ ví dụ, chỉ giữ kết luận/điểm chính
- Tổng cộng giảm 50-70% nội dung
- Giọng tự nhiên, viết lại không copy`;

// PROMPT MAP - All available templates
const PROMPT_TEMPLATES = {
  // Summary variants
  summary: SUMMARY_PROMPT,
  summary_short: SUMMARY_SHORT_PROMPT,
  summary_detailed: SUMMARY_DETAILED_PROMPT,
  summary_bullet: SUMMARY_BULLET_PROMPT,
  summary_structured: SUMMARY_STRUCTURED_PROMPT,

  // Status variants
  status: STATUS_PROMPT,
  status_short: STATUS_SHORT_PROMPT,
  status_emotional: STATUS_EMOTIONAL_PROMPT,

  // Affiliate variants
  affiliate: AFFILIATE_PROMPT,
  affiliate_soft: AFFILIATE_SOFT_PROMPT,
  affiliate_story: AFFILIATE_STORY_PROMPT,
};

const MAX_INPUT_CHARS = 8000;
const MAX_OUTPUT_TOKENS = 1024;

async function getSystemPrompt(type, site) {
  const data = await chrome.storage.sync.get([
    "customSummaryPrompt", "customStatusPrompt", "customAffPrompt",
    "outputLang", "promptStyle", "summaryLength", "customInstructions"
  ]);

  const lang = data.outputLang || "auto";
  const promptStyle = data.promptStyle || "default";
  const summaryLength = data.summaryLength || "medium";
  const customInstructions = data.customInstructions || "";

  // Determine base type for prompt lookup
  const baseType = type.startsWith("affiliate") ? "affiliate"
    : type.startsWith("status") ? "status" : "summary";

  let prompt;

  // 1. Custom user prompt takes highest priority
  if (baseType === "affiliate" && data.customAffPrompt) {
    prompt = data.customAffPrompt;
  } else if (baseType === "status" && data.customStatusPrompt) {
    prompt = data.customStatusPrompt;
  } else if (baseType === "summary" && data.customSummaryPrompt) {
    prompt = data.customSummaryPrompt;
  }
  // 2. promptStyle only applies to summary type
  else if (baseType === "summary" && promptStyle !== "default" && PROMPT_TEMPLATES[promptStyle]) {
    prompt = PROMPT_TEMPLATES[promptStyle];
  }
  // 3. Length-based variant (summary_short, status_short, etc.)
  else if (summaryLength !== "medium") {
    const lengthKey = baseType + "_" + summaryLength;
    prompt = PROMPT_TEMPLATES[lengthKey] || PROMPT_TEMPLATES[baseType] || PROMPT_TEMPLATES.summary;
  }
  // 4. Default template for the type
  else {
    prompt = PROMPT_TEMPLATES[type] || PROMPT_TEMPLATES[baseType] || PROMPT_TEMPLATES.summary;
  }

  // === SMART CONTEXT: Adapt prompt based on source platform ===
  const siteHints = {
    facebook: "\n\nNGỮ CẢNH: Bài viết từ Facebook. Giọng văn thường casual, cá nhân. Nếu là bài chia sẻ link/tin tức, tập trung vào thông tin. Nếu là status cá nhân, giữ cảm xúc và quan điểm.",
    linkedin: "\n\nNGỮ CẢNH: Bài viết từ LinkedIn. Giọng văn chuyên nghiệp. Tập trung vào insight nghề nghiệp, bài học kinh doanh, dữ liệu.",
    x: "\n\nNGỮ CẢNH: Bài viết từ X/Twitter. Nội dung thường ngắn, có thể là thread. Tập trung vào ý chính, bỏ qua hashtag và mention.",
    threads: "\n\nNGỮ CẢNH: Bài viết từ Threads. Giọng casual, ngắn gọn.",
    reddit: "\n\nNGỮ CẢNH: Bài viết từ Reddit. Có thể là discussion dài. Tập trung vào luận điểm chính và kết luận của tác giả, bỏ qua comment.",
  };
  if (site && siteHints[site]) {
    prompt += siteHints[site];
  }

  // === SMART CONTEXT: Auto-detect content type ===
  prompt += "\n\nTRƯỚC KHI VIẾT, hãy tự xác định loại nội dung (tin tức/ý kiến cá nhân/review sản phẩm/hướng dẫn/câu chuyện) và điều chỉnh giọng văn phù hợp.";

  // Add custom instructions if provided
  if (customInstructions) {
    prompt += "\n\nYÊU CẦU BỔ SUNG:\n" + customInstructions;
  }

  // Add language instruction
  if (lang === "vi") {
    prompt += "\n- Luôn trả lời bằng tiếng Việt, dịch nếu bài viết bằng ngôn ngữ khác.";
  } else if (lang === "en") {
    prompt += "\n- Always respond in English, translate if the post is in another language.";
  } else {
    prompt += "\n- Nếu bài viết bằng tiếng Anh hoặc ngôn ngữ khác tiếng Việt, dịch tóm tắt sang tiếng Việt. Nếu bằng tiếng Việt, giữ nguyên.";
  }

  return prompt;
}

// === PORT-BASED STREAMING ===
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "summarize-stream") return;
  const controller = new AbortController();

  port.onMessage.addListener(async (msg) => {
    if (msg.action !== "summarize") return;
    try {
      const result = await handleStream(msg.text, msg.site, port, controller.signal, msg.type);
      if (result && result.error) port.postMessage({ action: "error", error: result.error });
      else if (result && result.summary) port.postMessage({ action: "done", full: result.summary, quality: result.quality, issues: result.issues });
    } catch (e) {
      if (e.name !== "AbortError") {
        try { port.postMessage({ action: "error", error: e.message }); } catch (_) { }
      }
    }
  });

  port.onDisconnect.addListener(() => controller.abort());
});

// === FALLBACK: non-streaming for test/context menu ===
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "ping") { sendResponse({ ok: true }); return true; }
  if (request.action === "unshorten-shopee-inline" && request.url && sender.tab) {
    processUnshorten(request.url, sender.tab.id);
    return true;
  }
  if (request.action === "summarize") {
    const fakePort = { postMessage: () => { } };
    const controller = new AbortController();
    handleStream(request.text, request.site || "unknown", fakePort, controller.signal, "summary")
      .then(r => sendResponse(r || { error: "Unknown error" }))
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }
  // === TRANSLATE WORD ===
  if (request.action === "translate-word" && request.word) {
    translateWord(request.word)
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }
});

// === TRANSLATE: Quick dictionary lookup via AI ===
const translateCache = new Map();

async function translateWord(word) {
  const key = word.toLowerCase().trim();
  if (translateCache.has(key)) return translateCache.get(key);

  const data = await chrome.storage.sync.get(["apiKey", "provider"]);
  if (!data.apiKey) return { error: "Chưa nhập API Key." };

  const prompt = `Dịch từ/cụm từ tiếng Anh sang tiếng Việt. Trả lời NGẮN GỌN theo format:
[phiên âm] — nghĩa 1, nghĩa 2
(loại từ) giải thích ngắn nếu cần

Ví dụ:
"resilient" → /rɪˈzɪl.i.ənt/ — kiên cường, bền bỉ
(adj) khả năng phục hồi sau khó khăn

Từ cần dịch: "${key}"`;

  const provider = data.provider || "groq";

  try {
    let result;
    if (provider === "groq") {
      const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + data.apiKey },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1,
          max_tokens: 150,
        }),
      });
      if (!resp.ok) return { error: "API lỗi" };
      const json = await resp.json();
      result = json.choices?.[0]?.message?.content || "";
    } else {
      const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + data.apiKey;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 150 },
        }),
      });
      if (!resp.ok) return { error: "API lỗi" };
      const json = await resp.json();
      result = json.candidates?.[0]?.content?.parts?.[0]?.text || "";
    }

    const output = { word: key, translation: result.trim() };
    translateCache.set(key, output);
    // Keep cache small
    if (translateCache.size > 200) {
      const first = translateCache.keys().next().value;
      translateCache.delete(first);
    }
    return output;
  } catch (e) {
    return { error: e.message };
  }
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
  if (!text || typeof text !== "string") return { valid: false, error: "Không có nội dung." };
  const trimmed = text.trim();
  if (trimmed.length < 30) return { valid: false, error: "Nội dung quá ngắn (cần ít nhất 30 ký tự)." };
  if (trimmed.length > 100000) return { valid: false, error: "Nội dung quá dài (tối đa 100.000 ký tự)." };
  return { valid: true, text: trimmed };
}

// --- Output Guardrails ---

// N-gram overlap: detect if output copies too much from source
function computeNgramOverlap(source, output, n = 4) {
  const normalize = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
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
  const sentences = text.split(/[.!?。]\s*/).filter(s => s.trim().length > 10);
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
    return { text: processed, quality: "fail", issues: ["Output trống hoặc quá ngắn."] };
  }

  // 2. Length validation based on type
  const minLen = { summary: 20, status: 15, affiliate: 30 };
  const maxLen = { summary: 2000, status: 1500, affiliate: 3000 };
  const baseType = type.startsWith("affiliate") ? "affiliate"
    : type.startsWith("status") ? "status" : "summary";

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

  // 3. Copy detection (n-gram overlap)
  if (sourceText && sourceText.length > 50) {
    const overlap = computeNgramOverlap(sourceText, processed, 4);
    if (overlap > 0.6) {
      issues.push("⚠️ Output copy nhiều từ bài gốc (" + Math.round(overlap * 100) + "%).");
    }
  }

  // 4. Repetition detection
  const repRate = detectRepetition(processed);
  if (repRate > 0.3) {
    issues.push("Output có nhiều câu lặp lại.");
  }

  // 5. Clean formatting artifacts
  // Remove leading/trailing quotes that LLMs sometimes add
  processed = processed.replace(/^["'""'']+|["'""'']+$/g, "").trim();
  // Remove "Tóm tắt:" or "Summary:" prefix that LLMs sometimes prepend
  processed = processed.replace(/^(tóm tắt|summary|status|review|affiliate)\s*[:：]\s*/i, "").trim();

  // 6. VnReview spelling rules auto-fix
  // Fix common currency formatting
  processed = processed.replace(/\bđô[ -]?la\b/gi, "USD");
  processed = processed.replace(/\bđô\b(?!\s*C)/gi, "USD");
  // Fix abbreviated place names
  processed = processed.replace(/\bVN\b(?!\w)/g, "Việt Nam");
  processed = processed.replace(/\bHN\b(?!\w)/g, "Hà Nội");
  processed = processed.replace(/\bSG\b(?!\w)/g, "TP. HCM");
  // Fix day names capitalization (thứ hai → thứ Hai)
  processed = processed.replace(/\bthứ (hai|ba|tư|năm|sáu|bảy)\b/gi, (m, d) => "thứ " + d.charAt(0).toUpperCase() + d.slice(1));
  processed = processed.replace(/\bchủ nhật\b/gi, "Chủ nhật");
  // Fix month names (tháng một → tháng Một, but tháng 10 stays)
  processed = processed.replace(/\btháng (một|hai|ba|tư|năm|sáu|bảy|tám|chín)\b/gi, (m, mo) => "tháng " + mo.charAt(0).toUpperCase() + mo.slice(1));

  // 7. Fix VND long format → short format (44.990.000 đồng → gần 45 triệu đồng)
  processed = processed.replace(/(\d{1,3})\.(\d{3})\.(\d{3})\s*(?:đồng|VND|vnđ|VNĐ)/gi, (match, a, b, c) => {
    const num = parseInt(a + b + c, 10);
    if (num >= 1000000000) {
      const ty = num / 1000000000;
      return (ty % 1 === 0 ? ty.toString() : ty.toFixed(1).replace(".", ",")) + " tỷ đồng";
    }
    const trieu = num / 1000000;
    if (trieu % 1 === 0) return trieu + " triệu đồng";
    return trieu.toFixed(1).replace(".", ",") + " triệu đồng";
  });

  // 8. Remove empty lead-in sentences at the beginning
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

  // 9. Hallucination detection: check if output contains numbers not in source
  if (sourceText && sourceText.length > 50) {
    const sourceNums = new Set((sourceText.match(/\d[\d.,]*\d|\d+/g) || []).map(n => n.replace(/[.,]/g, "")));
    const outputNums = (processed.match(/\d[\d.,]*\d|\d+/g) || []).map(n => n.replace(/[.,]/g, ""));
    const fabricated = outputNums.filter(n => n.length >= 2 && !sourceNums.has(n));
    if (fabricated.length >= 2) {
      issues.push("⚠️ Output có thể chứa số liệu bịa (" + fabricated.slice(0, 3).join(", ") + ") — không tìm thấy trong bài gốc.");
    }
  }

  // 10. Detect "nói xạo" - writing as if personally experienced when sharing others' content
  const fakeExperiencePatterns = [
    /\b(?:mình|tôi)\s+(?:vừa|đã|mới)\s+(?:thử|test|dùng|tạo|làm)\b/i,
    /\b(?:mình|tôi)\s+(?:thử|test|dùng)\s+(?:rồi|xong|thấy)\b/i,
    /\b(?:mình|tôi)\s+(?:đã\s+)?(?:tạo|làm)\s+(?:được|ra|xong)\b/i,
    /\bthật\s+sự\s+(?:choáng|sốc|bất ngờ|ngạc nhiên)\b/i,
  ];
  for (const pat of fakeExperiencePatterns) {
    if (pat.test(processed)) {
      issues.push("⚠️ Output viết như người trải nghiệm trực tiếp — có thể không chính xác nếu đây là nội dung chia sẻ lại.");
      break;
    }
  }

  // 7. Quality score
  let quality = "good";
  if (issues.some(i => i.includes("fail") || i.includes("trống"))) quality = "fail";
  else if (issues.some(i => i.includes("⚠️") || i.includes("copy"))) quality = "warn";
  else if (issues.length > 0) quality = "info";

  return { text: processed, quality, issues };
}

async function handleStream(text, site, port, signal, type = "summary") {
  // === INPUT GUARDRAILS ===
  const inputCheck = validateInput(text);
  if (!inputCheck.valid) return { error: inputCheck.error };

  const data = await chrome.storage.sync.get(["apiKey", "provider", "summaryLength"]);
  const apiKey = data.apiKey;
  const provider = data.provider || "groq";
  const summaryLength = data.summaryLength || "medium";

  if (!apiKey) return { error: "Chưa nhập API Key. Click icon extension để cài đặt." };

  // Clean and truncate text
  const cleanedText = cleanInputText(inputCheck.text);
  const truncated = cleanedText.length > MAX_INPUT_CHARS
    ? cleanedText.substring(0, MAX_INPUT_CHARS) + "\n[...bài viết đã được cắt ngắn]"
    : cleanedText;

  const systemPrompt = await getSystemPrompt(type, site);
  const callFn = provider === "groq" ? callGroqStream : callGeminiStream;

  // Calculate max tokens based on length preference
  const maxTokensMap = { short: 256, medium: 512, long: 1024 };
  const maxTokens = maxTokensMap[summaryLength] || 512;

  for (let attempt = 0; attempt <= 2; attempt++) {
    if (signal.aborted) return { error: "Đã hủy." };
    const result = await callFn(apiKey, truncated, systemPrompt, port, signal, maxTokens);
    if (!result.rateLimited) {
      if (result.summary) {
        // === OUTPUT GUARDRAILS ===
        const postResult = postProcessOutput(result.summary, text, type);
        result.summary = postResult.text;

        // Attach quality metadata for UI
        result.quality = postResult.quality;
        result.issues = postResult.issues;

        incrementBadge();
        saveHistory(text, result.summary, site, type);
      }
      return result;
    }
    // Exponential backoff for rate limiting
    await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 2000));
  }
  return { error: "API quá tải. Vui lòng thử lại sau." };
}

// === HISTORY ===
async function saveHistory(text, summary, site, type) {
  const data = await chrome.storage.local.get("history");
  const history = data.history || [];
  history.unshift({ text: text.substring(0, 500), summary, date: new Date().toISOString(), site: site || "unknown", type: type || "summary" });
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
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ") && trimmed !== "data:") continue;
      const dataStr = trimmed.replace(/^data:\s*/, "");
      if (dataStr === "[DONE]" || !dataStr) continue;
      try {
        const token = parseLine(JSON.parse(dataStr));
        if (token) {
          fullText += token;
          try { port.postMessage({ action: "chunk", text: token, full: fullText }); } catch (_) { }
        }
      } catch (e) { }
    }
  }
  return { summary: fullText };
}

async function callGroqStream(apiKey, text, systemPrompt, port, signal, maxTokens = 512) {
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
      max_tokens: maxTokens,
    }),
  });
  if (resp.status === 429) return { rateLimited: true };
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    return { error: "Groq API lỗi: " + (err.error?.message || resp.statusText) };
  }
  return processStream(resp, port, signal, (d) => d.choices?.[0]?.delta?.content || "");
}

async function callGeminiStream(apiKey, text, systemPrompt, port, signal, maxTokens = 512) {
  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=" + apiKey;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: text }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: maxTokens },
    }),
  });
  if (resp.status === 429) return { rateLimited: true };
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    return { error: "Gemini API lỗi: " + (err.error?.message || resp.statusText) };
  }
  return processStream(resp, port, signal, (d) => d.candidates?.[0]?.content?.parts?.[0]?.text || "");
}
