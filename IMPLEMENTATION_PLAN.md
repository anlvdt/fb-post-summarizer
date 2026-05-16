# FeedWriter UX Improvements — Implementation Plan
## Từ Dễ → Khó (Complexity-Based Roadmap)

**Ngày bắt đầu:** 2026-05-18  
**Phương pháp:** Incremental improvements, test sau mỗi wave  
**Nguyên tắc:** Không phá vỡ tính năng hiện có, backward compatible  

---

## 📊 COMPLEXITY ANALYSIS

### Độ phức tạp được đánh giá dựa trên:
1. **Lines of Code (LoC):** Số dòng code cần viết/sửa
2. **Files Touched:** Số file cần thay đổi
3. **Risk Level:** Khả năng gây regression
4. **Dependencies:** Phụ thuộc vào các thay đổi khác
5. **Testing Effort:** Công sức test

### Thang điểm:
- **Level 1 (Dễ):** 1-2 files, < 50 LoC, low risk, no dependencies
- **Level 2 (Trung bình):** 2-3 files, 50-150 LoC, medium risk
- **Level 3 (Khó):** 3-5 files, 150-300 LoC, high risk
- **Level 4 (Rất khó):** 5+ files, > 300 LoC, critical risk, nhiều dependencies

---

## 🎯 TASKS RANKED BY COMPLEXITY

| # | Task | Level | LoC | Files | Risk | Time |
|---|------|-------|-----|-------|------|------|
| 1 | Dark/Light Auto-detect | 1 | 30 | 2 | Low | 30m |
| 2 | Typography Scale | 1 | 20 | 1 | Low | 20m |
| 3 | Spacing System | 1 | 25 | 1 | Low | 20m |
| 4 | Color Accessibility | 1 | 30 | 1 | Low | 30m |
| 5 | Contextual Tooltips | 1 | 40 | 2 | Low | 45m |
| 6 | Keyboard Shortcuts Hints | 2 | 60 | 2 | Low | 1h |
| 7 | Better Error Messages | 2 | 80 | 2 | Med | 1.5h |
| 8 | Loading Skeleton | 2 | 70 | 2 | Low | 1h |
| 9 | Responsive Panel | 2 | 90 | 1 | Med | 1.5h |
| 10 | Agent Widget Redesign | 2 | 100 | 2 | Med | 2h |
| 11 | Smart Defaults | 2 | 50 | 2 | Med | 1h |
| 12 | Export/Import Settings | 2 | 120 | 2 | Low | 2h |
| 13 | Streaming Progress Bar | 3 | 150 | 2 | Med | 2.5h |
| 14 | Undo/Redo Edit | 3 | 180 | 2 | Med | 3h |
| 15 | Simplified Settings | 3 | 200 | 3 | High | 3.5h |
| 16 | Unified Entry Point | 3 | 250 | 3 | High | 4h |
| 17 | Template Library | 4 | 300 | 4 | Med | 5h |
| 18 | Setup Wizard | 4 | 350 | 4 | High | 6h |

**Tổng estimated time:** ~35 giờ

---

## 🌊 IMPLEMENTATION WAVES

### **WAVE 1 — Quick Wins (CSS/Design) — 2.5h**
✅ Không đụng logic, chỉ sửa CSS và constants  
✅ Zero risk, immediate visual improvement  
✅ Có thể deploy ngay sau mỗi task  

**Tasks:**
1. ✨ Typography Scale (20m)
2. ✨ Spacing System (20m)
3. ✨ Color Accessibility (30m)
4. ✨ Dark/Light Auto-detect (30m)
5. ✨ Contextual Tooltips (45m)

**Deliverables:**
- `popup.css` — Typography + Spacing variables
- `content.css` — Color contrast improvements
- `popup.js` — Auto theme detection
- `popup.html` — Tooltip icons

---

### **WAVE 2 — UI Enhancements (Low Risk) — 7.5h**
✅ Thêm UI elements mới, không sửa core logic  
✅ Low-medium risk  
✅ Cải thiện feedback và discoverability  

**Tasks:**
6. ✨ Keyboard Shortcuts Hints (1h)
7. ✨ Better Error Messages (1.5h)
8. ✨ Loading Skeleton (1h)
9. ✨ Responsive Panel (1.5h)
10. ✨ Agent Widget Redesign (2h)
11. ✨ Smart Defaults (1h)

**Deliverables:**
- `popup.html` + `popup.css` — Shortcut hints
- `background.js` — Structured error responses
- `content.css` — Skeleton loading styles
- `content.css` — Responsive media queries
- `content.js` + `content.css` — Agent widget UI
- `popup.js` — Smart default values

---

### **WAVE 3 — Logic Improvements (Medium Risk) — 8.5h**
⚠️ Sửa logic xử lý, cần test kỹ  
⚠️ Medium-high risk  
⚠️ Có thể ảnh hưởng đến workflow hiện tại  

**Tasks:**
12. ✨ Export/Import Settings (2h)
13. ✨ Streaming Progress Bar (2.5h)
14. ✨ Undo/Redo Edit (3h)
15. ✨ Simplified Settings (3.5h)

**Deliverables:**
- `popup.js` — Export/import functions
- `background.js` + `content.js` — Progress tracking
- `content.js` — Edit history management
- `popup.html` + `popup.js` — Simple/Advanced mode toggle

---

### **WAVE 4 — Architecture Changes (High Risk) — 10h**
🔴 Thay đổi lớn về UX flow  
🔴 High risk, cần test toàn diện  
🔴 Có thể cần refactor nhiều code  

**Tasks:**
16. ✨ Unified Entry Point (4h)
17. ✨ Template Library (5h)
18. ✨ Setup Wizard (6h)

**Deliverables:**
- `content.js` + `content.css` — Unified floating button
- `popup.html` + `popup.js` + `popup.css` — Template management
- `popup.html` + `popup.js` + `popup.css` — Onboarding wizard
- `background.js` — First install detection

---

## 📋 WAVE 1 — DETAILED PLAN (Bắt đầu ngay)

### Task 1: Typography Scale (20 phút)
**File:** `popup.css`

**Changes:**
```css
/* Thêm vào :root */
:root {
  --text-xs: 10px;   /* Hints, captions */
  --text-sm: 11px;   /* Labels, secondary */
  --text-base: 12px; /* Body text */
  --text-md: 13px;   /* Emphasized */
  --text-lg: 14px;   /* Headings */
  --text-xl: 16px;   /* Page titles */
}

/* Áp dụng */
.field-hint { font-size: var(--text-xs); }
label { font-size: var(--text-sm); }
input, select, textarea { font-size: var(--text-base); }
.tab { font-size: var(--text-sm); }
h1 { font-size: var(--text-lg); }
```

**Test:**
- [ ] Mở popup → check font sizes consistent
- [ ] Zoom in/out → check readability

---

### Task 2: Spacing System (20 phút)
**File:** `popup.css`

**Changes:**
```css
/* Thêm vào :root */
:root {
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
}

/* Refactor existing spacing */
.popup { padding: var(--space-4); }
.header { gap: var(--space-2); margin-bottom: var(--space-3); }
.tabs { gap: var(--space-1); margin-bottom: var(--space-3); }
.field { margin-bottom: var(--space-3); }
label { margin-bottom: var(--space-1); }
.field-hint { margin-top: var(--space-1); }
```

**Test:**
- [ ] Mở popup → check spacing consistent
- [ ] Compare với version cũ → không có visual regression

---

### Task 3: Color Accessibility (30 phút)
**File:** `popup.css`

**Changes:**
```css
:root {
  /* Tăng contrast cho WCAG AA (4.5:1) */
  --text: #f0f0f0; /* Từ #e0e0e0 */
  --text-secondary: #b8b8b8; /* Từ #aaa */
  --text-muted: #888; /* Từ #666 */
  
  /* Accent colors với contrast tốt hơn */
  --accent: #b47aff; /* Từ #a855f7 */
  --success: #3ee87e; /* Từ #2ed573 */
  --danger: #ff7b7b; /* Từ #ff6b6b */
  --info: #5fd4ff; /* Từ #4fc3f7 */
}

body.light {
  --text: #1a1a2e; /* Giữ nguyên */
  --text-secondary: #444; /* Từ #555 */
  --text-muted: #777; /* Từ #999 */
  
  --accent: #7c3aed; /* Giữ nguyên */
  --success: #16a34a; /* Giữ nguyên */
  --danger: #dc2626; /* Giữ nguyên */
  --info: #0284c7; /* Giữ nguyên */
}
```

**Test:**
- [ ] Check contrast với WebAIM Contrast Checker
- [ ] Dark mode: text trên bg ≥ 4.5:1
- [ ] Light mode: text trên bg ≥ 4.5:1

---

### Task 4: Dark/Light Auto-detect (30 phút)
**Files:** `popup.js`, `popup.html`

**Changes in `popup.js`:**
```javascript
// Thêm vào đầu file
async function initTheme() {
  const { theme } = await chrome.storage.sync.get({ theme: 'auto' });
  applyTheme(theme);
}

function applyTheme(theme) {
  if (theme === 'auto') {
    // Detect từ system preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.body.classList.toggle('light', !prefersDark);
  } else if (theme === 'light') {
    document.body.classList.add('light');
  } else {
    document.body.classList.remove('light');
  }
}

// Sửa themeSelect change handler
document.getElementById('themeSelect').addEventListener('change', async (e) => {
  const theme = e.target.value;
  await chrome.storage.sync.set({ theme });
  applyTheme(theme);
});

// Load theme on init
initTheme();

// Listen to system theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async () => {
  const { theme } = await chrome.storage.sync.get({ theme: 'auto' });
  if (theme === 'auto') {
    applyTheme('auto');
  }
});
```

**Changes in `popup.html`:**
```html
<select id="themeSelect">
  <option value="auto">Tự động</option>
  <option value="dark">Dark</option>
  <option value="light">Light</option>
</select>
```

**Test:**
- [ ] Chọn "Tự động" → theme theo system
- [ ] Đổi system theme → extension theme tự đổi theo
- [ ] Chọn "Dark" → luôn dark
- [ ] Chọn "Light" → luôn light
- [ ] Reload extension → theme được nhớ

---

### Task 5: Contextual Tooltips (45 phút)
**Files:** `popup.html`, `popup.css`

**Changes in `popup.css`:**
```css
.fbs-hint-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--accent-bg);
  color: var(--accent);
  font-size: var(--text-xs);
  font-weight: 700;
  cursor: help;
  margin-left: var(--space-1);
  transition: all 0.2s ease;
}

.fbs-hint-icon:hover {
  background: var(--accent);
  color: #fff;
  transform: scale(1.1);
}

/* Tooltip */
.fbs-hint-icon[title]:hover::after {
  content: attr(title);
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  padding: var(--space-2) var(--space-3);
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: var(--text-xs);
  white-space: nowrap;
  z-index: 1000;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}
```

**Changes in `popup.html`:**
```html
<!-- Thêm hint icons vào các settings phức tạp -->

<!-- Heuristic Eval -->
<label class="checkbox-label">
  <input type="checkbox" id="useHeuristicEval">
  <span>
    Dùng heuristic thay AI eval
    <span class="fbs-hint-icon" title="Bỏ qua AI chấm điểm, dùng keyword matching. Tiết kiệm 1 API call/bài.">?</span>
  </span>
</label>

<!-- Min Length -->
<label for="minLength">
  Độ dài tối thiểu
  <span class="fbs-hint-icon" title="Chỉ tóm tắt bài viết có ít nhất số ký tự này. Bỏ qua bài ngắn.">?</span>
</label>

<!-- Custom Instructions -->
<label for="customInstructions">
  Hướng dẫn bổ sung
  <span class="fbs-hint-icon" title="Thêm yêu cầu riêng cho AI. VD: 'Ưu tiên số liệu', 'Bỏ ví dụ'">?</span>
</label>

<!-- Blocked Domains -->
<label for="blockedDomains">
  Tắt extension trên
  <span class="fbs-hint-icon" title="Extension sẽ không hoạt động trên các URL chứa chuỗi này.">?</span>
</label>

<!-- Source Template -->
<label for="sourceTemplate">
  Template nguồn
  <span class="fbs-hint-icon" title="Dùng {author}, {platform}, {source}, {link} để tùy chỉnh format.">?</span>
</label>
```

**Test:**
- [ ] Hover vào `?` → tooltip hiện
- [ ] Tooltip không bị cắt ở edge của popup
- [ ] Tooltip text dễ đọc
- [ ] Hover ra → tooltip biến mất

---

## 🧪 TESTING CHECKLIST (Sau mỗi wave)

### Functional Testing
- [ ] Tóm tắt bài viết vẫn hoạt động
- [ ] Viết status vẫn hoạt động
- [ ] Chế affiliate vẫn hoạt động
- [ ] Dịch từ vẫn hoạt động
- [ ] Agent mode vẫn hoạt động
- [ ] Multi-image vẫn hoạt động
- [ ] API key rotation vẫn hoạt động

### Visual Testing
- [ ] Dark mode hiển thị đúng
- [ ] Light mode hiển thị đúng
- [ ] Responsive trên 320px, 768px, 1024px
- [ ] Không có layout shift
- [ ] Animations mượt mà

### Accessibility Testing
- [ ] Contrast ratio ≥ 4.5:1
- [ ] Keyboard navigation hoạt động
- [ ] Focus states rõ ràng
- [ ] Screen reader friendly (aria-labels)

### Performance Testing
- [ ] Popup mở < 100ms
- [ ] Panel tóm tắt mở < 200ms
- [ ] Không có memory leak
- [ ] DOM scan không lag

---

## 📦 DEPLOYMENT STRATEGY

### After Wave 1 (CSS/Design)
```bash
# Version bump: 2.2.0 → 2.3.0
# Changelog: "Improved typography, spacing, and color accessibility"
git add popup.css content.css popup.js popup.html
git commit -m "feat(ui): improve typography, spacing, and accessibility"
git tag v2.3.0
```

### After Wave 2 (UI Enhancements)
```bash
# Version bump: 2.3.0 → 2.4.0
# Changelog: "Added tooltips, better errors, loading states, responsive design"
git commit -m "feat(ux): add tooltips, improve error messages, responsive panel"
git tag v2.4.0
```

### After Wave 3 (Logic Improvements)
```bash
# Version bump: 2.4.0 → 2.5.0
# Changelog: "Export/import settings, progress bar, undo/redo, simplified settings"
git commit -m "feat(core): add export/import, progress tracking, edit history"
git tag v2.5.0
```

### After Wave 4 (Architecture Changes)
```bash
# Version bump: 2.5.0 → 3.0.0 (major)
# Changelog: "Unified entry point, template library, setup wizard"
git commit -m "feat(major): unified UX, template library, onboarding wizard"
git tag v3.0.0
```

---

## 🚨 ROLLBACK PLAN

Nếu có regression nghiêm trọng:

1. **Immediate:** Revert commit gần nhất
```bash
git revert HEAD
```

2. **Restore previous version:**
```bash
git checkout v2.2.0
```

3. **Hotfix branch:**
```bash
git checkout -b hotfix/regression-fix
# Fix issue
git commit -m "fix: regression in X"
git checkout main
git merge hotfix/regression-fix
```

---

## 📊 SUCCESS CRITERIA

### Wave 1
- [ ] Typography scale áp dụng consistent
- [ ] Spacing system áp dụng consistent
- [ ] Contrast ratio ≥ 4.5:1 (WCAG AA)
- [ ] Auto theme detection hoạt động
- [ ] Tooltips hiển thị đúng

### Wave 2
- [ ] Shortcut hints hiển thị trong UI
- [ ] Error messages có actionable buttons
- [ ] Loading skeleton hiển thị khi fetch
- [ ] Panel responsive trên mobile
- [ ] Agent widget hiện stats luôn

### Wave 3
- [ ] Export/import settings hoạt động
- [ ] Progress bar hiện % chính xác
- [ ] Undo/redo hoạt động (Ctrl+Z)
- [ ] Simple mode ẩn advanced settings

### Wave 4
- [ ] Floating button có dropdown menu
- [ ] Template library lưu/load được
- [ ] Setup wizard chạy lần đầu install

---

## 🎯 NEXT STEPS

1. ✅ Review plan này với user
2. ⏳ Bắt đầu Wave 1 — Task 1 (Typography Scale)
3. ⏳ Test sau mỗi task
4. ⏳ Commit sau mỗi task hoàn thành
5. ⏳ Deploy sau mỗi wave

**Estimated total time:** 35 giờ (4-5 ngày làm việc)

---

**Ready to start?** 🚀
