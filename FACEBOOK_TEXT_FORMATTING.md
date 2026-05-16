# Facebook Status Text Formatting Improvements

**Date:** 2026-05-18  
**Focus:** Cải tiến format văn bản khi đăng lên Facebook Status

---

## 🎯 CURRENT STATE

### Existing Behavior

**Code Location:** `content-composer.js`

**Line 409 (Manual Post):**
```javascript
const textWithFooter = cleanedText + "\n\n—\nNguồn dưới cmt đầu";
pasteToLexical(editor, textWithFooter, imgFiles.length > 0 ? imgFiles : null);
```

**Line 546 (Agent Post):**
```javascript
postText += "\n\n—\nNguồn dưới cmt đầu";
pasteToLexical(editor, postText, imgFiles.length > 0 ? imgFiles : null);
```

### Current Format

Văn bản AI tạo ra (từ `content.js` line 1130-1162):
```
TIÊU ĐỀ BÀI VIẾT

Đoạn văn thứ nhất với nội dung chi tiết.

Đoạn văn thứ hai với thông tin bổ sung.

· Bullet point 1
· Bullet point 2
· Bullet point 3

—
Nguồn dưới cmt đầu
```

**Problem:** Khi paste lên Facebook, format này **không tối ưu** vì:
1. Bullet points dùng `·` (middle dot) thay vì emoji hoặc ký tự đẹp hơn
2. Tiêu đề không nổi bật (không có emoji hoặc formatting)
3. Separator `—` (em dash) có thể không hiển thị đẹp trên mobile
4. Không có visual hierarchy rõ ràng

---

## 💡 PROPOSED IMPROVEMENTS

### Wave 6: Facebook Status Text Formatting

**Estimated Time:** 2 hours  
**Complexity:** Level 2 (Medium)  
**Risk:** Low (text transformation only)

---

## Task 23: Enhanced Text Formatting for Facebook

**Time:** 2h  
**Goal:** Transform AI-generated text into Facebook-optimized format

### Changes

**1. Add formatForFacebook() Function**

Create new function in `content-composer.js`:

```javascript
/**
 * Format AI-generated text for Facebook status posting
 * Transforms plain text into visually appealing Facebook format
 * 
 * @param {string} text - AI-generated text with \n line breaks
 * @returns {string} - Facebook-optimized text
 */
function formatForFacebook(text) {
  let lines = text.split('\n');
  let formatted = [];
  let inBulletSection = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Skip empty lines (will add strategic spacing later)
    if (!line) {
      // Add spacing between sections
      if (formatted.length > 0 && formatted[formatted.length - 1] !== '') {
        formatted.push('');
      }
      continue;
    }
    
    // Detect title (first non-empty line, all caps or short)
    if (i === 0 || (i === 1 && !lines[0].trim())) {
      // Add emoji prefix for title based on content
      const titleEmoji = detectTitleEmoji(line);
      formatted.push(titleEmoji + ' ' + line.toUpperCase());
      formatted.push(''); // Spacing after title
      continue;
    }
    
    // Detect bullet points
    if (line.startsWith('·') || line.startsWith('•') || line.startsWith('-')) {
      if (!inBulletSection) {
        // Add spacing before bullet section
        if (formatted[formatted.length - 1] !== '') {
          formatted.push('');
        }
        inBulletSection = true;
      }
      // Replace bullet with emoji
      const bulletText = line.replace(/^[·•\-]\s*/, '');
      formatted.push('✓ ' + bulletText);
      continue;
    }
    
    // Regular paragraph
    if (inBulletSection) {
      // Add spacing after bullet section
      formatted.push('');
      inBulletSection = false;
    }
    formatted.push(line);
  }
  
  return formatted.join('\n');
}

/**
 * Detect appropriate emoji for title based on content
 */
function detectTitleEmoji(title) {
  const lower = title.toLowerCase();
  
  // Technology/AI
  if (lower.match(/ai|công nghệ|tech|phần mềm|app|tool/)) return '🤖';
  
  // Business/Money
  if (lower.match(/kinh doanh|tiền|thu nhập|doanh thu|marketing/)) return '💰';
  
  // Education/Learning
  if (lower.match(/học|giáo dục|khóa học|kiến thức|kỹ năng/)) return '📚';
  
  // News/Update
  if (lower.match(/tin tức|cập nhật|thông báo|mới/)) return '📰';
  
  // Tips/Guide
  if (lower.match(/tips|hướng dẫn|cách|bí quyết|mẹo/)) return '💡';
  
  // Warning/Important
  if (lower.match(/cảnh báo|quan trọng|chú ý|lưu ý/)) return '⚠️';
  
  // Success/Achievement
  if (lower.match(/thành công|đạt được|chiến thắng|kỷ lục/)) return '🎉';
  
  // Default
  return '📌';
}
```

**2. Update Manual Post (Line 409)**

```javascript
// Before
const textWithFooter = cleanedText + "\n\n—\nNguồn dưới cmt đầu";

// After
const formattedText = formatForFacebook(cleanedText);
const textWithFooter = formattedText + "\n\n━━━━━━━━━━\n👉 Nguồn dưới cmt đầu";
```

**3. Update Agent Post (Line 546)**

```javascript
// Before
postText += "\n\n—\nNguồn dưới cmt đầu";

// After
const formattedText = formatForFacebook(postText);
postText = formattedText + "\n\n━━━━━━━━━━\n👉 Nguồn dưới cmt đầu";
```

**4. Enhanced Separator**

Replace simple `—` with visual separator:
```
━━━━━━━━━━
👉 Nguồn dưới cmt đầu
```

Or alternative styles:
```
▬▬▬▬▬▬▬▬▬▬
📍 Nguồn dưới cmt đầu
```

```
═══════════
🔗 Nguồn dưới cmt đầu
```

### Benefits

✅ **Visual hierarchy** — Title with emoji stands out  
✅ **Better bullets** — ✓ checkmarks instead of middle dots  
✅ **Clear sections** — Strategic spacing between parts  
✅ **Mobile-friendly** — Emojis display well on all devices  
✅ **Professional look** — Polished Facebook status format  
✅ **Engagement boost** — Emojis increase readability and engagement

---

## BEFORE & AFTER COMPARISON

### Before (Current)
```
CÁCH TỐI ƯU HÓA FACEBOOK ADS

Để chạy quảng cáo Facebook hiệu quả, bạn cần chú ý các yếu tố sau.

Đầu tiên là targeting đúng đối tượng khách hàng.

· Chọn độ tuổi phù hợp
· Xác định sở thích rõ ràng
· Test nhiều audience khác nhau

—
Nguồn dưới cmt đầu
```

### After (Improved)
```
🤖 CÁCH TỐI ƯU HÓA FACEBOOK ADS

Để chạy quảng cáo Facebook hiệu quả, bạn cần chú ý các yếu tố sau.

Đầu tiên là targeting đúng đối tượng khách hàng.

✓ Chọn độ tuổi phù hợp
✓ Xác định sở thích rõ ràng
✓ Test nhiều audience khác nhau

━━━━━━━━━━
👉 Nguồn dưới cmt đầu
```

**Key Improvements:**
- Title has emoji (🤖) and is uppercase
- Bullets use checkmarks (✓) instead of middle dots (·)
- Visual separator (━━━━━━━━━━) instead of single dash (—)
- Footer has pointer emoji (👉) for emphasis
- Better spacing between sections

---

## ALTERNATIVE FORMATTING STYLES

### Style 1: Minimal (Current Proposal)
```
🤖 TITLE

Paragraph 1

Paragraph 2

✓ Bullet 1
✓ Bullet 2

━━━━━━━━━━
👉 Nguồn dưới cmt đầu
```

### Style 2: Boxed
```
┏━━━━━━━━━━━━━━━━━━┓
┃ 🤖 TITLE
┗━━━━━━━━━━━━━━━━━━┛

Paragraph 1

Paragraph 2

✓ Bullet 1
✓ Bullet 2

━━━━━━━━━━
👉 Nguồn dưới cmt đầu
```

### Style 3: Emoji-Heavy
```
🔥 TITLE 🔥

📝 Paragraph 1

📝 Paragraph 2

✅ Bullet 1
✅ Bullet 2
✅ Bullet 3

━━━━━━━━━━
👉 Nguồn dưới cmt đầu
```

### Style 4: Professional
```
【 TITLE 】

Paragraph 1

Paragraph 2

▸ Bullet 1
▸ Bullet 2
▸ Bullet 3

━━━━━━━━━━
📍 Nguồn dưới cmt đầu
```

**Recommendation:** Start with **Style 1 (Minimal)** as it's clean, professional, and not overwhelming.

---

## IMPLEMENTATION PLAN

### Step 1: Add formatForFacebook() function
- Location: `content-composer.js` after line 434
- ~80 lines of code
- Include detectTitleEmoji() helper

### Step 2: Update Manual Post
- Location: Line 409
- Replace direct concatenation with formatForFacebook()

### Step 3: Update Agent Post
- Location: Line 546
- Replace direct concatenation with formatForFacebook()

### Step 4: Test with real content
- Test with different content types (tech, business, education)
- Verify emoji detection works correctly
- Check spacing on Facebook mobile and desktop

---

## CONFIGURATION OPTIONS

Add user settings in `popup.html`:

```html
<div class="field">
  <label for="fbFormatStyle">Facebook Status Format</label>
  <select id="fbFormatStyle">
    <option value="minimal" selected>Minimal (Recommended)</option>
    <option value="boxed">Boxed Title</option>
    <option value="emoji-heavy">Emoji Heavy</option>
    <option value="professional">Professional</option>
    <option value="plain">Plain (No Formatting)</option>
  </select>
  <div class="field-hint">Cách format văn bản khi đăng lên Facebook</div>
</div>

<div class="field">
  <label class="checkbox-label">
    <input type="checkbox" id="autoDetectEmoji" checked>
    <span>Tự động thêm emoji vào tiêu đề</span>
  </label>
</div>

<div class="field">
  <label for="bulletStyle">Bullet Point Style</label>
  <select id="bulletStyle">
    <option value="check" selected>✓ Checkmark</option>
    <option value="arrow">▸ Arrow</option>
    <option value="dot">• Dot</option>
    <option value="star">★ Star</option>
  </select>
</div>
```

---

## EXPECTED OUTCOMES

### User Experience
1. **More engaging posts** — Emojis and formatting catch attention
2. **Better readability** — Clear hierarchy and spacing
3. **Professional appearance** — Polished status format
4. **Higher engagement** — Well-formatted posts get more likes/comments

### Technical Benefits
1. **Configurable** — Users can choose formatting style
2. **Maintainable** — Centralized formatting logic
3. **Extensible** — Easy to add new styles
4. **Backward compatible** — Plain style available for users who prefer it

---

## RISKS & MITIGATION

### Risk 1: Emoji Overload
**Mitigation:** Default to minimal style, make it configurable

### Risk 2: Unicode Compatibility
**Mitigation:** Test on different devices, provide fallback characters

### Risk 3: User Preference
**Mitigation:** Add "Plain" option to disable all formatting

### Risk 4: Content Detection Errors
**Mitigation:** Use safe default emoji (📌) when detection fails

---

## NEXT STEPS

1. **Get user approval** — Confirm formatting style preference
2. **Implement formatForFacebook()** — Core formatting logic
3. **Update post functions** — Manual and agent post
4. **Add settings UI** — Configuration options in popup
5. **Test with real content** — Verify on Facebook
6. **Create changelog** — Document changes

---

**Status:** ⏳ AWAITING APPROVAL  
**Estimated Time:** 2 hours  
**Risk Level:** Low  
**Impact:** High (Better engagement on Facebook)
