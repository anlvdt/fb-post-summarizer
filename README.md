# FB Post Summarizer

Chrome Extension tự động detect bài viết dài trên Facebook và tóm tắt nội dung bằng AI miễn phí.

## Tính năng

- Tự động detect bài viết dài (có nút "Xem thêm") trên News Feed
- Hiển thị nút "Tóm tắt" nhỏ gọn ở góc bài viết
- Tóm tắt nội dung bằng AI (Groq hoặc Gemini) dạng overlay popup
- Bài tiếng Anh tự động dịch tóm tắt sang tiếng Việt
- Hỗ trợ đa ngôn ngữ

## Cài đặt

1. Clone repo này
2. Mở Chrome → `chrome://extensions/`
3. Bật **Developer mode** (góc phải trên)
4. Click **Load unpacked** → chọn folder `fb-summarizer`
5. Click icon extension → nhập API Key

## API Key miễn phí

| Dịch vụ | Free tier | Lấy key |
|---------|-----------|---------|
| **Groq** (khuyên dùng) | 14,400 req/ngày | [console.groq.com/keys](https://console.groq.com/keys) |
| Google Gemini | 15 req/phút | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |

## Screenshot

Nút "Tóm tắt" hiện ở góc phải bài viết dài. Click để xem tóm tắt dạng overlay.

## Tech Stack

- Chrome Extension Manifest V3
- Groq API (Llama 3.3 70B) / Gemini API
- Vanilla JS, no dependencies
