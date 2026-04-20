# Social Content Repurposer

Chrome Extension tóm tắt bài viết, viết lại status & bài affiliate từ nội dung mạng xã hội bằng AI miễn phí.

**Tối ưu cho Facebook.** Các nền tảng khác (X, LinkedIn, Reddit, Threads) đang thử nghiệm.

## Tính năng chính

**Tóm tắt & Viết lại**
- Tự động detect bài viết dài trên Facebook, hiện nút "Tóm tắt" cạnh "Xem thêm"
- 3 chế độ: Tóm tắt · Viết Status ngôi thứ nhất · Viết bài Affiliate
- 11 prompt templates (ngắn, chi tiết, bullet, cảm xúc, storytelling...)
- Streaming real-time — thấy kết quả ngay khi AI đang viết

**Dịch từ vựng Anh → Việt**
- Double-click vào từ tiếng Anh bất kỳ → tooltip hiện phiên âm + nghĩa tiếng Việt
- Cache kết quả, không gọi API lại

**Chất lượng output**
- Quy tắc chính tả VnReview tích hợp sẵn (số, tiền tệ, ngày tháng, viết hoa)
- Post-processing: phát hiện copy nguyên văn, câu lặp, tự sửa chính tả
- Nhận biết nền tảng (Facebook/LinkedIn/X) để điều chỉnh giọng văn

**Tiện ích khác**
- Bóc link Shopee affiliate (xóa cookie tracking)
- Lịch sử tóm tắt, export JSON/Markdown
- Dark/Light mode tự động
- Phím tắt: Ctrl+Shift+S (tóm tắt), Ctrl+Shift+T (status), Ctrl+Shift+A (affiliate)

## Nền tảng hỗ trợ

| Nền tảng | Trạng thái | Ghi chú |
|----------|-----------|---------|
| Facebook | ✅ Ổn định | Đã test kỹ, hoạt động tốt nhất |
| X (Twitter) | 🧪 Thử nghiệm | Cơ bản hoạt động |
| LinkedIn | 🧪 Thử nghiệm | Cơ bản hoạt động |
| Reddit | 🧪 Thử nghiệm | Cơ bản hoạt động |
| Threads | 🧪 Thử nghiệm | Cơ bản hoạt động |

## Cài đặt

1. Clone repo: `git clone https://github.com/user/fb-post-summarizer.git`
2. Mở Chrome → `chrome://extensions/` → bật Developer mode
3. Click "Load unpacked" → chọn folder project
4. Click icon extension → nhập API Key → Lưu

## API Key miễn phí

| Dịch vụ | Free tier | Lấy key |
|---------|-----------|---------|
| Groq (khuyên dùng) | 14.400 req/ngày | [console.groq.com/keys](https://console.groq.com/keys) |
| Google Gemini | 15 req/phút | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |

## Tech Stack

- Chrome Extension Manifest V3
- Groq API (Llama 3.3 70B) / Google Gemini 2.0 Flash
- Vanilla JS, zero dependencies
