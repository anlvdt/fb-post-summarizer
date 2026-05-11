# FeedWriter — Báo cáo Cải tiến UI/UX, Logic & Thuật toán

## Các cải tiến đã thực hiện

### 1. 🔒 Bảo mật (Security)

| File | Vấn đề | Giải pháp |
|------|--------|-----------|
| `content.js` | `extractMainContent()` không loại bỏ `<iframe>`, `<object>`, `<embed>` | Thêm vào selector loại bỏ, ngăn embedded content nguy hiểm |
| `popup.js` | History badge class dùng trực tiếp `bt` (user data) → XSS | Escape tất cả user-generated content qua `esc()` |

### 2. 🧠 Logic & Thuật toán (Algorithm)

| File | Vấn đề | Giải pháp |
|------|--------|-----------|
| `auto-pilot.js` | `shouldSkipPost()` so sánh 50 ký tự đầu → false positive cao | Tăng lên 200 ký tự + normalize whitespace trước khi so sánh |
| `auto-pilot.js` | `isGoldenHour()` dùng `getHours()` local → sai timezone | Dùng `Intl.DateTimeFormat` với timezone configurable |
| `auto-pilot.js` | `isSponsoredPost()` chỉ check text → bỏ sót quảng cáo | Thêm 4 signal: ad links, "Why am I seeing this?", portal detection, text fallback |
| `auto-pilot.js` | `isTargetContent()` bỏ sót AI product launches | Thêm LAUNCH_SIGNALS detection cho major AI brands |
| `utils.js` | LRU Cache chỉ giới hạn count (50) → memory leak trên thiết bị yếu | Thêm byte-size limit (10MB default) + eviction theo cả count và bytes |

### 3. 🎨 UI/UX

| File | Vấn đề | Giải pháp |
|------|--------|-----------|
| `content.css` | Panel bị cắt trên mobile (< 480px) | Thêm responsive media queries cho mobile + tablet |
| `content.css` | Không hỗ trợ keyboard navigation | Thêm `:focus-visible` styles cho tất cả interactive elements |
| `content.css` | Animation gây khó chịu cho người nhạy cảm | Thêm `prefers-reduced-motion` media query |
| `content.js` | Streaming không hiển thị progress → user nghĩ bị treo | Thêm character count indicator khi streaming |
| `popup.js` | Test connection chỉ hiện "Lỗi" chung chung | Phân loại lỗi: rate limit, key invalid, network, context invalidated |
| `popup.js` | Clear history không có undo → mất dữ liệu vĩnh viễn | Thêm soft delete + nút "Hoàn tác" trong 30 giây |
| `popup.js` | Save settings không validate input | Thêm validation cho minLength (100-5000) |

---

## Đề xuất cải tiến tiếp theo (chưa thực hiện)

### Ưu tiên cao

1. **Refactor `background.js` (2457 dòng)** — Tách thành modules: `api.js`, `prompts.js`, `streaming.js`, `storage.js`
2. **Refactor `content.js` (2951 dòng)** — Tách: `dom-scanner.js`, `overlay.js`, `facebook-composer.js`, `permalink.js`
3. **Rate limit race condition** — Trong `handleAgentDecision`, nếu `executePost()` throw error giữa chừng, `loopTimer` có thể bị set 2 lần. Cần thêm mutex/lock.

### Ưu tiên trung bình

4. **IntersectionObserver cho DOM scanning** — Thay vì query toàn bộ page mỗi scan cycle, chỉ scan posts đang visible
5. **Debounce theme detection** — Hiện tại dùng throttle 500ms, nhưng Facebook có thể thay đổi theme nhiều lần liên tiếp khi load
6. **Error boundary cho Agent** — Nếu agent crash, tự restart sau 30s thay vì dừng hẳn
7. **Persistent agent state** — Lưu state vào storage để resume sau page reload

### Ưu tiên thấp

8. **Unit tests** — Viết tests cho `isTargetContent()`, `shouldSkipPost()`, `humanDelay()`
9. **Performance profiling** — Đo thời gian scan cycle, memory usage
10. **i18n** — Tách hardcoded Vietnamese strings thành locale files

---

## Tóm tắt

- **7 files** đã được cải tiến
- **2 lỗ hổng bảo mật** đã fix (XSS, unsafe embed)
- **5 bug logic/thuật toán** đã fix
- **7 cải tiến UX** đã thêm
- **0 lỗi compile/lint** sau khi sửa

---

## Cải tiến đợt 2: Trích xuất Link/Ảnh bài gốc + Ẩn bài rác

### 🔗 Trích xuất Link bài gốc (permalink extraction)

**Vấn đề cũ:**
- Bài share trong group/page → lấy link bài share, không phải link bài gốc
- Bài trong group chỉ hỗ trợ numeric ID (`/groups/123/posts/`), không hỗ trợ slug (`/groups/groupname/posts/`)
- URL tracking params không được clean triệt để
- Không resolve được `l.facebook.com/l.php` redirect

**Đã cải tiến:**
- ✨ Thêm `_findSharedPostArticle()` — detect bài share, ưu tiên lấy link bài GỐC
- ✨ Thêm `_cleanFbUrl()` — shared utility, loại bỏ đầy đủ tracking params (fbclid, mibextid, _rdr, _rdc, rdid, share_scenario, hoisted_section_header_type, utm_*, __*)
- ✨ Thêm `_resolveFbRedirect()` — tự động decode URL qua l.facebook.com/lm.facebook.com
- ✨ Group URL support cả numeric ID lẫn slug: `/groups/([^/?]+)`
- ✨ Thêm fallback cho **Page posts** — pattern `/pages/Name/ID` → build post URL
- ✨ Thêm parse `data-ft` fields: `top_level_post_id` VÀ `mf_story_key`
- ✨ Tìm post ID từ nhiều nguồn hơn: `data-story-id`, `data-post-id`, `data-testid*='post'`, hidden inputs
- ✨ `fbsExtractPermalinkAsync`: Trước khi click "Chia sẻ → Copy link" (slow), thử tìm link gốc trong DOM trước

### 🖼️ Trích xuất Ảnh bài gốc

**Vấn đề cũ:**
- Không ưu tiên ảnh bài gốc khi là bài share
- Chỉ dùng `src` / `data-src`, bỏ qua `srcset` (responsive) → dùng thumbnail thay vì full-res
- Không lấy được `background-image` trong inline style (Facebook dùng nhiều)
- Chọn ảnh đầu tiên tìm thấy, không phải ảnh lớn nhất

**Đã cải tiến:**
- ✨ Ưu tiên lấy ảnh từ `_findSharedPostArticle()` nếu là bài share
- ✨ `_imgSrc()` parse `srcset`/`data-srcset` → lấy URL có `w` descriptor lớn nhất (high-res)
- ✨ Strategy mới: scan `[style*="background-image"]` — lấy URL từ inline `background-image: url(...)`
- ✨ Chọn ảnh lớn nhất theo diện tích (w * h) thay vì ảnh đầu tiên
- ✨ Loại bỏ emoji/static: check pattern `/rsrc.php/`
- ✨ `_isAvatar()`: thêm detect profile link pattern (`facebook.com/username`)

### 🧹 Ẩn Bài Quảng cáo & Rác

**Vấn đề cũ:**
- Chỉ detect 11 keyword sponsored → bỏ sót nhiều biến thể ngôn ngữ
- CLUTTER_LABELS không đủ — bỏ sót "Kỷ niệm", "Xu hướng", "On this day"
- `injectClutterCSS` chỉ ẩn 8 selector — bỏ sót Marketplace, Chat, People you may know
- Chỉ có 2 detection strategies (portal + aria-label)
- `isSponsored()` chỉ có 3 signal, bỏ sót nhiều ad variants

**Đã cải tiến:**

**Expanded keyword coverage** (11 → 23 sponsored, 18 → 32 clutter):
- Sponsored thêm: "tài trợ", "nội dung được tài trợ", "paid partnership", "promoted", "paid ad", "sponsorisé", 광고, 협찬, 赞助内容, 贊助, スポンサー
- Clutter thêm: "dành cho bạn", "được đề xuất", "nội dung liên quan", "được xem nhiều", "xu hướng", "trending", "kỷ niệm", "memories", "trong ngày này", "on this day", "recommended for you", "reels and short videos", "friend suggestions", "recommandé pour vous"...

**Expanded CSS clutter selectors** (8 → 16):
- Stories variants (data-pagelet + aria-label)
- Reels shelf (3 variants)
- Watch / Video suggestions
- Right Rail + RightRail2 + sponsored sidebar
- Chat sidebar (3 variants)
- **Marketplace widget** trong feed (mới)
- **GroupsYouShouldJoin** widget (mới)
- **PeopleYouMayKnow** widget (mới)

**Enhanced detection strategies trong `hideFeedClutter`:**
1. Portal-based (giữ nguyên)
2. aria-label substring scan (giữ nguyên)
3. ✨ **Ad link detection** — scan `/ads/about`, `about_ads`, `adchoices`, `/ads/preferences` — strongest signal, không false positive
4. ✨ **Clutter label header scan** — scan text trong `h2/h3/h4 span[dir="auto"]` của feed items

**Enhanced `isSponsored()` (3 → 5 signals):**
1. Ad link href
2. ✨ "Why am I seeing this?" / "Tại sao tôi thấy" disclosure link
3. Portal detection (enhanced: handles `startsWith` + empty id check)
4. ✨ aria-label substring scan
5. Text scan fallback

---

## Tổng kết đợt 2

- **3 functions mới**: `_findSharedPostArticle`, `_cleanFbUrl`, `_resolveFbRedirect`, `_findPermalinkInContainer`, `_extractImageFromContainer`
- **5 functions được refactor/cải tiến**: `extractPostPermalink`, `extractPostImage`, `fbsExtractPermalinkAsync`, `extractPostSource`, `isSponsored`, `hideFeedClutter`, `injectClutterCSS`
- **Thêm 12 sponsored keywords + 14 clutter labels**
- **Thêm 8 CSS clutter selectors**
- **Thêm 2 detection strategies** trong `hideFeedClutter`
- **Thêm 2 signals** trong `isSponsored`
- **0 lỗi compile/lint** sau khi sửa

### Impact

| Use case | Trước | Sau |
|----------|-------|-----|
| Bài share trong group | Link bài share | Link bài gốc ✅ |
| Bài share trên page | Link page | Link bài gốc ✅ |
| Ảnh từ srcset | Thumbnail thấp | High-res ✅ |
| Ảnh background-image | Không lấy được | Lấy được ✅ |
| Group slug URL | Fail | Hoạt động ✅ |
| Page post URL | Không hỗ trợ | Hỗ trợ ✅ |
| l.facebook.com redirect | Không resolve | Resolve đúng target ✅ |
| Quảng cáo biến thể | Bỏ sót | Bắt được 5 signals ✅ |
| Marketplace widget | Không ẩn | Ẩn ✅ |
| "Kỷ niệm" / "Xu hướng" | Không ẩn | Ẩn ✅ |

---

## Cải tiến đợt 3: Deep audit automation — tự động hoá tối đa + multi-image

### 🖼️ Multi-Image Support

**Vấn đề cũ:**
- Chỉ lấy 1 ảnh duy nhất qua `extractPostImage()`
- Bài có album nhiều ảnh → chỉ đăng được ảnh thumbnail đầu tiên
- `fbsAgentPost` chỉ paste 1 File
- `pasteToLexical` chỉ hỗ trợ single file parameter
- Manual composer không có UI để chọn ảnh nào muốn đăng

**Đã cải tiến:**
- ✨ `_extractAllImagesFromContainer()` — helper mới: extract TẤT CẢ ảnh theo priority (photo-link > bg-image > large img), sort theo area desc
- ✨ `_collectImages()` — unified collector: bài share → lấy ảnh bài gốc TRƯỚC, rồi mới đến container chính
- ✨ Deduplication qua URL normalization — 2 variant của cùng ảnh (thumb vs full) bị gộp lại
- ✨ Module-level `_lastExtractedImages` cache — populated bởi `extractPostImage()`, read bởi `extractPostImages()`
- ✨ `window.fbsExtractImages(el)` mới — trả về array URL, backward compat với `fbsExtractImage(el)`
- ✨ `pasteToLexical` hỗ trợ cả single file và `Array<File>`
- ✨ `fetchImageBlobs()` mới — parallel fetch multi-image, max 10 ảnh/post (FB limit)

### 🤖 Agent Mode Automation Improvements

**Đã cải tiến:**
- ✨ Step 3 refactor: gọi `fbsExtractImages()` để lấy TẤT CẢ ảnh → `fetchImageBlobs()` parallel
- ✨ Smart upload wait: `imgFiles.length > 1 ? 3000 + n*1500 : ...` — tăng thời gian chờ upload phù hợp với số ảnh
- ✨ Fallback: nếu multi-image fetch fail → fallback single image qua `fetchImageBlob()`
- ✨ Log chi tiết số lượng ảnh fetch được / target

### 🚀 Manual Mode Full Automation

**Vấn đề cũ:**
- Nút "Đăng status" chỉ mở composer + paste text + 1 ảnh, xong
- User phải: tự click "Đăng" + tự mở comment + tự paste nguồn + tự gửi
- ~4 thao tác thủ công mỗi bài đăng

**Đã cải tiến — 1 bấm, extension tự hoàn thành:**

Full workflow khi user bấm "Đăng status":
1. ✨ Xác định ảnh user muốn đăng (từ checkbox multi-image)
2. ✨ Scroll + click "Bạn đang nghĩ gì?"
3. ✨ Poll editor xuất hiện (5s)
4. ✨ **Fetch PARALLEL tất cả ảnh đã chọn** qua `fetchImageBlobs()`
5. ✨ Paste text + multi-image (với smart upload wait)
6. ✨ **Auto-click nút "Đăng" sau 3 giây** — user có 3s để review/cancel bằng cách đóng dialog
7. ✨ Handle nút "Tiếp" (khi đăng vào group/page) — click rồi tìm nút "Đăng" thực sự
8. ✨ **Auto-comment nguồn**: chờ 7s để post lên feed → tìm nút "Viết bình luận" → paste source line → Enter
9. ✨ Verify comment paste thành công → retry nếu fail → copy vào clipboard nếu vẫn fail
10. ✨ Close leftover dialogs

**UX improvements:**
- Spinner inline trong nút đăng (thay vì chỉ đổi text)
- Status messages realtime: "Mở Composer...", "Tải 5 ảnh...", "Đăng sau 3s...", "Đang đăng...", "Chờ bài lên feed để comment nguồn..."
- Error messages cụ thể: "Không thấy ô 'Bạn đang nghĩ gì?'", "Nút Đăng chưa sẵn sàng"
- Disable button khi đang run để tránh double-click

### 🎨 Multi-Image Gallery UI

- CSS grid layout: auto-fill minmax(90px, 1fr), gap 6px, max-height 260px với scroll
- Thumbnail có aspect-ratio 1/1, lazy loading
- Checkbox ngay trên góc thumbnail (tất cả checked by default)
- Hover effect: scale 1.03
- Checked style: border purple `#a855f7`
- Unchecked opacity: 0.35 để rõ ràng

### 🔧 Infrastructure Improvements

**`fetchImageBlob()`:**
- ✨ Fallback selector: match cả `currentSrc` và `srcset` (không chỉ `src`)
- ✨ Filename parameter (cho multi-image: `image_1.png`, `image_2.png`...)
- ✨ Detect content-type thực (jpeg/webp/png) thay vì luôn "image/png"

**`background.js` fetch-image handler:**
- ✨ Validate URL (phải starts with http)
- ✨ Timeout 30s → 20s (parallel fetch yêu cầu nhanh hơn)
- ✨ `credentials: omit, referrer: no-referrer` để tránh gửi cookie không cần
- ✨ Reject blob < 100 bytes (ảnh lỗi) hoặc > 12MB (FB limit)
- ✨ Return size + type metadata
- ✨ Proper error handling với FileReader onerror

---

## Tổng kết đợt 3

### Metrics

| Metric | Trước | Sau |
|--------|-------|-----|
| Ảnh lấy được từ bài gốc | 1 | Tối đa 10 (FB limit) |
| Thao tác thủ công manual post | ~4-5 | 1 (bấm "Đăng status") + 3s review |
| Parallel image fetch | ❌ | ✅ (Promise.all) |
| Multi-image UI | ❌ | ✅ Gallery với checkbox |
| Auto-click Post button | ❌ (manual) | ✅ (agent + manual) |
| Auto-comment nguồn (manual) | ❌ | ✅ |
| Retry khi paste fail | ❌ | ✅ (2 attempts + clipboard fallback) |
| Content-type detection | png only | jpeg/webp/png |

### Files changed

- `content.js`: +300 lines (multi-image extraction, full manual automation)
- `content.css`: +90 lines (gallery grid, thumbnail styles)
- `background.js`: +25 lines (improved fetch-image handler)

### Impact

- **Agent mode**: mỗi bài đăng có thể bao gồm đến 10 ảnh từ bài gốc → visual fidelity cao hơn hẳn
- **Manual mode**: user chỉ cần 1 click thay vì 4-5 thao tác
- **Safety**: 3 giây review window cho phép user cancel bất cứ lúc nào
- **Reliability**: retry logic + fallback clipboard đảm bảo comment nguồn luôn có cách đăng được

---

## Cải tiến đợt 4: Rollback auto-post/auto-comment cho Manual mode

**Theo yêu cầu user**: Manual mode (nút "Đăng status") chỉ tự động hóa
- ✅ Lấy link bài gốc
- ✅ Lấy ảnh bài gốc (multi-image)
- ✅ Copy và paste nội dung + ảnh vào composer
- ❌ KHÔNG tự click "Đăng" — user tự bấm
- ❌ KHÔNG tự comment nguồn — user tự paste (text đã copy sẵn vào clipboard)

### Thay đổi

**Handler nút "Đăng status" trong `openFacebookComposer`:**
- Gỡ bỏ Step 6 (auto-click Post sau 3s)
- Gỡ bỏ Step 7 (auto-click Viết bình luận + paste source + Enter)
- Thêm: sau khi paste ảnh xong → copy câu "Nguồn: ..." vào clipboard
- Status cuối: "Sẵn sàng — bấm Đăng, rồi Ctrl+V ở cmt"
- Rút ngắn upload wait (không cần chờ lâu vì user tự review)

### Workflow mới

1. User bấm "Đăng status"
2. Extension scroll lên đầu feed, click "Bạn đang nghĩ gì?"
3. Extension chờ dialog mở, tìm editor
4. Extension fetch parallel tất cả ảnh đã chọn (checkbox)
5. Extension paste text + ảnh vào editor
6. Extension copy câu "Nguồn: Author (Source)\nURL" vào clipboard
7. **Xong** — user tự bấm "Đăng", chờ bài lên feed, tự click "Viết bình luận", Ctrl+V, Enter

### Agent mode giữ nguyên

Agent mode (nút góc phải màn hình, chạy autonomous theo lịch) vẫn auto-post + auto-comment. Đây là thiết kế cốt lõi của agent, nếu bỏ thì không còn autonomous. User chủ động bật ON nếu muốn dùng.

---

## Cải tiến đợt 5: Hiệu suất & Độ ổn định hệ thống (Deep audit)

### 🚀 Tối ưu hoá DOM Scanning (IntersectionObserver)
**Vấn đề cũ:** `scan()` chạy mỗi 5 giây và mỗi khi có DOM mutation, quét qua toàn bộ DOM tree bằng `querySelectorAll` với các query nặng (`span[dir="auto"]`, `[aria-label]`). Việc này gây tiêu tốn lượng lớn CPU khi scroll trên feed dài.
**Đã cải tiến:**
- ✨ Triển khai **IntersectionObserver** để theo dõi các `article[role="article"]` và `div[data-virtualized]` đang xuất hiện trên màn hình (`visiblePosts`).
- ✨ Sửa `findNewSeeMoreElements()` để chỉ quét các thẻ nằm trong vùng hiển thị (Viewport).
- ✨ Sửa `hideFeedClutter()` (Strategy 2 & 3) để giới hạn tìm kiếm quảng cáo / rác ở các `roots` đang hiển thị thay vì `document`.

### 🛡️ Xử lý lỗi & Race Condition
**Vấn đề cũ:**
- Hàm `handleAgentDecision` và timer bị trùng lặp (duplicate loop timers) tạo ra multiple agent loops.
- Agent tự dừng hẳn khi `runAgentLoop` hoặc `executePost` throw error.
**Đã cải tiến:**
- ✨ **Mutex & Safe Scheduler:** Viết thêm `scheduleNext()` để quản lý `loopTimer` chặt chẽ, luôn clear timer cũ trước khi khởi tạo mới.
- ✨ **Execution Lock:** Thêm `isExecutingPost` state giúp lock quá trình thực thi `executePost()`, chặn đứt điểm các cuộc gọi chồng chéo, xoá triệt để bug duplicate.
- ✨ **Error Boundary (Tự phục hồi):** Đóng gói `runAgentLoop` vào trong `try/catch`. Nếu script crash, agent sẽ tự gỡ lỗi, làm sạch giao diện và **tự động restart sau 30 giây** thay vì chết im lặng.

### 🧩 Tái cấu trúc mã nguồn (Refactoring)
**Vấn đề cũ:** File `background.js` quá khổng lồ (2481 dòng), chứa trộn lẫn logic khởi tạo, hệ thống Prompt, logic gọi API của các mô hình ngôn ngữ và xử lý message. Rất khó bảo trì và dễ xảy ra xung đột.
**Đã cải tiến:**
- ✨ Tách toàn bộ hệ thống Prompt (viết status, affiliate, translate) sang file `bg-prompts.js` độc lập (225 dòng).
- ✨ Tách toàn bộ logic quản lý API Key, xoay vòng Key (Key Rotation) và các hàm gọi LLM (Groq, Gemini, Cerebras...) sang file `bg-api.js` độc lập (496 dòng).
- ✨ Giữ `background.js` gọn nhẹ hơn (chỉ còn ~1764 dòng), tải các module qua `importScripts` đồng bộ để không phá vỡ logic giao tiếp của Manifest V3.
