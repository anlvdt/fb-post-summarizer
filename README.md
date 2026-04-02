# Social Post Summarizer

Chrome Extension tóm tắt bài viết dài trên mạng xã hội bằng AI miễn phí.

Hỗ trợ: Facebook, X (Twitter), LinkedIn, Reddit.

## Tính năng

- Tự động detect bài viết dài, hiện nút "Tóm tắt" ở góc bài
- Right-click text bất kỳ để tóm tắt
- Tóm tắt bằng AI (Groq / Gemini) dạng overlay popup
- Tự động dịch sang tiếng Việt hoặc chọn ngôn ngữ output
- Cache kết quả, không gọi API lại cho cùng bài
- Tự retry khi API rate limit
- Copy tóm tắt vào clipboard
- Lịch sử tóm tắt, export JSON
- Tùy chỉnh prompt
- Dark/Light mode tự động
- Badge đếm số bài đã tóm tắt trong ngày

## Cài đặt

1. Clone repo: `git clone https://github.com/anlvdt/fb-post-summarizer.git`
2. Mở Chrome → `chrome://extensions/` → bật Developer mode
3. Click Load unpacked → chọn folder `fb-summarizer`
4. Click icon extension → nhập API Key → Lưu

## API Key miễn phí

| Dịch vụ | Free tier | Lấy key |
|---------|-----------|---------|
| Groq (khuyên dùng) | 14,400 req/ngày | [console.groq.com/keys](https://console.groq.com/keys) |
| Google Gemini | 15 req/phút | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |

## Tech Stack

- Chrome Extension Manifest V3
- Groq API (Llama 3.3 70B) / Gemini API
- Vanilla JS, zero dependencies
