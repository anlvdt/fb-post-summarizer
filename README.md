# FeedWriter

<p align="center">
  <img src="icons/icon128.png" width="80" alt="FeedWriter">
</p>

<p align="center">
  Chrome Extension — Tóm tắt bài viết, viết status & affiliate bằng AI.<br>
  Dịch từ vựng Anh → Việt. Tối ưu cho Facebook.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/manifest-v3-blue" alt="Manifest V3">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License">
  <img src="https://img.shields.io/badge/dependencies-zero-brightgreen" alt="Zero deps">
</p>

---

## Tổng quan

Extension giúp bạn xử lý nội dung trên Facebook nhanh hơn:

- **Tóm tắt** bài viết dài thành vài câu ngắn gọn
- **Viết lại** thành status cá nhân ở ngôi thứ nhất
- **Chế bài affiliate** từ bài review sản phẩm
- **Dịch từ** tiếng Anh sang tiếng Việt bằng double-click

Mọi thứ chạy bằng AI (Groq hoặc Gemini), API key miễn phí, không thu thập dữ liệu.

## Demo

| Tóm tắt bài viết | Viết Status | Dịch từ |
|---|---|---|
| Click nút cạnh "Xem thêm" | Shift+Click hoặc floating toolbar | Double-click từ tiếng Anh |

## Cài đặt

```bash
git clone https://github.com/anlvdt/fb-post-summarizer.git
```

1. Mở Chrome → `chrome://extensions/` → bật **Developer mode**
2. Click **Load unpacked** → chọn folder vừa clone
3. Click icon extension trên toolbar → nhập API Key → **Lưu**

## Lấy API Key (miễn phí)

| Dịch vụ | Free tier | Link |
|---------|-----------|------|
| **Groq** (khuyên dùng) | 14.400 request/ngày | [console.groq.com/keys](https://console.groq.com/keys) |
| Google Gemini | 15 request/phút | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |

## Cách sử dụng

**Tóm tắt / Status / Affiliate:**
- Nút **Tóm tắt** tự động hiện cạnh "Xem thêm" trên Facebook
- Bôi đen text → floating toolbar hiện lên → chọn chế độ
- Chuột phải → context menu → chọn tính năng
- Phím tắt: `Ctrl+Shift+S` (tóm tắt) · `Ctrl+Shift+T` (status) · `Ctrl+Shift+A` (affiliate)

**Dịch từ vựng:**
- Double-click vào từ tiếng Anh bất kỳ → tooltip hiện phiên âm + nghĩa

**Bóc link Shopee:**
- Bôi đen link shope.ee → chuột phải → "Bóc Link Shopee"

## Tính năng nổi bật

**11 prompt templates**

| Nhóm | Templates |
|------|-----------|
| Tóm tắt | Mặc định · Ngắn gọn · Chi tiết · Bullet points · Giữ cấu trúc |
| Status | Ngôi thứ nhất · Cực ngắn · Cảm xúc |
| Affiliate | Review chân thật · Soft sell · Storytelling |

**Chất lượng output**
- Quy tắc chính tả VnReview tích hợp (số, tiền tệ, ngày tháng, viết hoa)
- Post-processing tự động: phát hiện copy nguyên văn (n-gram), câu lặp, auto-fix chính tả
- Nhận biết nền tảng nguồn để điều chỉnh giọng văn

**Tùy biến**
- Chọn độ dài output: ngắn / vừa / dài
- Chọn phong cách tóm tắt
- Thêm hướng dẫn bổ sung riêng
- Tự viết prompt hoàn toàn

## Nền tảng

| Nền tảng | Trạng thái |
|----------|-----------|
| Facebook | ✅ Ổn định — đã test kỹ |
| X (Twitter) | 🧪 Thử nghiệm |
| LinkedIn | 🧪 Thử nghiệm |
| Reddit | 🧪 Thử nghiệm |
| Threads | 🧪 Thử nghiệm |

## Cấu trúc project

```
├── manifest.json        # Chrome extension config
├── background.js        # Service worker: API calls, prompts, guardrails
├── content.js           # Content script: DOM scan, UI overlay, translate
├── content.css          # Styles cho overlay, tooltip, buttons
├── popup.html           # Popup settings UI
├── popup.js             # Popup logic
├── popup.css            # Popup styles
├── icons/               # Extension icons (16, 48, 128)
├── LICENSE              # MIT
└── README.md
```

## Kiến trúc

```
INPUT GUARDRAILS          validate length, sanitize
        ↓
SMART PROMPT ASSEMBLY     11 templates + platform hints + VnReview rules
        ↓
LLM (Groq / Gemini)      streaming response
        ↓
OUTPUT GUARDRAILS         copy detection, repetition, length, auto-fix
        ↓
UI                        overlay panel + quality warnings
```

## Tech stack

- Chrome Extension Manifest V3
- Groq API (Llama 3.3 70B) / Google Gemini 2.0 Flash
- Vanilla JS — zero dependencies, zero build step

## Contributing

Mọi đóng góp đều được chào đón.

1. Fork repo
2. Tạo branch: `git checkout -b feature/ten-tinh-nang`
3. Commit & push
4. Tạo Pull Request

**Cần help:**
- Test & fix cho X, LinkedIn, Reddit, Threads
- Cải thiện prompt templates
- Bug reports

**Quy tắc:**
- Zero dependencies — không thêm npm package
- Vanilla JS — không framework
- Test trên Chrome trước khi tạo PR

## License

[MIT](LICENSE) — Lê Ẩn
