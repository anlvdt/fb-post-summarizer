# Text Presentation Improvements — Analysis & Proposals

**Date:** 2026-05-18  
**Focus:** Cải tiến cách trình bày văn bản của ứng dụng FeedWriter

---

## 📊 CURRENT STATE ANALYSIS

### Existing Text Formatting

**Current Implementation (content.js lines 1130-1162):**

```javascript
function fmt(html) {
  const paras = html.split(/\n{2,}/);
  if (paras.length > 1) {
    const title = paras[0].trim();
    if (title.length < 200 && !title.includes('· ')) {
      // Extract title as .fbs-title-line
      // Process remaining paragraphs:
      // - Glossary sections → .fbs-glossary
      // - Bullet points (·) → .fbs-bullet
      // - Regular paragraphs → .fbs-para
    }
  }
  // Fallback: convert \n\n to .fbs-para-break
}
```

**Current CSS Styles (content.css):**

```css
.fbs-result {
  font-size: 15px;
  line-height: 1.75;
  letter-spacing: 0.2px;
  color: #e4e6eb;
}

.fbs-title-line {
  font-size: 15px;
  font-weight: 800;
  color: #f0e6ff;
  margin-bottom: 2px;
}

.fbs-para {
  margin-bottom: 2px;
  line-height: 1.65;
}

.fbs-bullet {
  padding-left: 12px;
  text-indent: -12px;
  margin-bottom: 3px;
}

.fbs-glossary {
  margin-top: 12px;
  padding: 10px 14px;
  background: rgba(168, 85, 247, 0.06);
  border-left: 3px solid rgba(168, 85, 247, 0.35);
}
```

---

## 🎯 IDENTIFIED ISSUES

### 1. Typography Issues
- **Title too small:** 15px same as body text, only weight differentiates
- **Line height inconsistent:** 1.75 for body, 1.65 for paragraphs, 1.6 for bullets
- **Letter spacing:** Only applied to body, not to title or bullets
- **No hierarchy:** Title doesn't stand out enough

### 2. Spacing Issues
- **Tight margins:** Title margin-bottom only 2px
- **Paragraph spacing:** Only 2px between paragraphs (too tight)
- **Bullet spacing:** 3px between bullets (inconsistent with paragraphs)
- **No breathing room:** Content feels cramped

### 3. Visual Hierarchy Issues
- **Weak title emphasis:** Only bold weight, no size/color contrast
- **Flat structure:** All paragraphs look the same
- **No section breaks:** Hard to distinguish different sections
- **Glossary blends in:** Not visually distinct enough

### 4. Readability Issues
- **Long lines:** No max-width constraint on text
- **Dense text:** Tight line-height makes scanning difficult
- **No emphasis patterns:** Bold/italic not styled distinctly
- **Bullet alignment:** Text-indent method is fragile

### 5. Responsive Issues
- **Fixed font sizes:** No scaling for mobile
- **No mobile optimization:** Same layout on all screens
- **Tight mobile spacing:** Even more cramped on small screens

---

## 💡 PROPOSED IMPROVEMENTS

### Wave 5: Text Presentation Enhancements

**Estimated Time:** 4 hours  
**Complexity:** Level 2 (Medium)  
**Risk:** Low (CSS-only changes, no logic changes)

---

## Task 19: Typography Scale Enhancement

**Time:** 1.5h  
**Goal:** Establish clear visual hierarchy with proper typography scale

### Changes

**1. Title Hierarchy**
```css
.fbs-title-line {
  font-size: 18px;           /* Was: 15px */
  font-weight: 800;
  line-height: 1.3;          /* Was: inherited 1.75 */
  letter-spacing: -0.02em;   /* Tighter for large text */
  color: #f0e6ff;
  margin-bottom: 16px;       /* Was: 2px */
  display: block;
}
```

**2. Body Text Optimization**
```css
.fbs-result {
  font-size: 15px;
  line-height: 1.7;          /* Was: 1.75 */
  letter-spacing: 0.01em;    /* Was: 0.2px */
  color: #e4e6eb;
  max-width: 65ch;           /* NEW: Optimal reading width */
}
```

**3. Paragraph Spacing**
```css
.fbs-para {
  margin-bottom: 12px;       /* Was: 2px */
  line-height: 1.7;          /* Was: 1.65 */
}

.fbs-para:last-child {
  margin-bottom: 0;
}
```

**4. Bullet Points**
```css
.fbs-bullet {
  display: flex;             /* NEW: Better alignment */
  gap: 8px;                  /* NEW: Space between bullet and text */
  margin-bottom: 8px;        /* Was: 3px */
  line-height: 1.7;          /* Was: 1.6 */
  padding-left: 0;           /* Remove old method */
  text-indent: 0;            /* Remove old method */
}

.fbs-bullet::before {
  content: "•";              /* NEW: Proper bullet character */
  color: #a855f7;
  font-weight: 700;
  flex-shrink: 0;
}
```

**5. Emphasis Styles**
```css
.fbs-result strong {
  font-weight: 700;
  color: #f0e6ff;            /* Was: #d4b5ff (brighter) */
}

.fbs-result em {
  font-style: italic;
  color: #d4b5ff;            /* Was: #c8d0e0 (more purple) */
}
```

### Benefits
✅ Clear visual hierarchy  
✅ Better readability  
✅ Consistent spacing  
✅ Professional appearance

---

## Task 20: Section Structure Enhancement

**Time:** 1h  
**Goal:** Add visual structure for different content sections

### Changes

**1. Section Headings**
```css
.fbs-section-heading {
  font-size: 14px;
  font-weight: 700;
  color: #c9b8ff;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-top: 20px;
  margin-bottom: 12px;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}
```

**2. Glossary Enhancement**
```css
.fbs-glossary {
  margin-top: 20px;          /* Was: 12px */
  padding: 16px 18px;        /* Was: 10px 14px */
  background: rgba(168, 85, 247, 0.08);  /* Was: 0.06 (more visible) */
  border-radius: 12px;       /* Was: 10px */
  border-left: 3px solid rgba(168, 85, 247, 0.5);  /* Was: 0.35 (stronger) */
}

.fbs-glossary-heading {
  font-size: 13px;           /* Was: 12px */
  font-weight: 700;
  color: #e0d0f5;            /* Was: #d4b5ff (brighter) */
  text-transform: uppercase;
  letter-spacing: 0.05em;    /* Was: 0.4px */
  margin-bottom: 10px;       /* Was: 6px */
}

.fbs-glossary-item {
  font-size: 14px;           /* Was: 13px */
  line-height: 1.6;          /* Was: 1.55 */
  color: #d0d4dc;            /* Was: #c0c4cc (brighter) */
  padding: 4px 0;            /* Was: 2px 0 */
  padding-left: 0;           /* Remove old method */
  text-indent: 0;            /* Remove old method */
  display: flex;
  gap: 8px;
}

.fbs-glossary-item::before {
  content: "·";
  color: #a855f7;
  font-weight: 700;
  flex-shrink: 0;
}
```

**3. Source Footer Enhancement**
```css
.fbs-source-footer {
  margin-top: 20px;          /* Was: 12px */
  padding-top: 12px;         /* Was: 8px */
  border-top: 1px solid rgba(255, 255, 255, 0.1);  /* Was: 0.08 (more visible) */
  font-size: 13px;           /* Was: 12px */
  color: #999;               /* Was: #888 (brighter) */
  font-style: italic;
  line-height: 1.5;
}
```

**4. Paragraph Break**
```css
.fbs-para-break {
  height: 16px;              /* Was: 10px */
}
```

### Benefits
✅ Clear section separation  
✅ Better content organization  
✅ Enhanced glossary visibility  
✅ Professional structure

---

## Task 21: Responsive Typography

**Time:** 1h  
**Goal:** Optimize text presentation for mobile devices

### Changes

**1. Mobile Typography Scale**
```css
@media (max-width: 767px) {
  .fbs-title-line {
    font-size: 16px;         /* Was: 18px on desktop */
    line-height: 1.3;
    margin-bottom: 12px;     /* Was: 16px on desktop */
  }

  .fbs-result {
    font-size: 14px;         /* Was: 15px on desktop */
    line-height: 1.65;       /* Slightly tighter for mobile */
  }

  .fbs-para {
    margin-bottom: 10px;     /* Was: 12px on desktop */
  }

  .fbs-bullet {
    font-size: 14px;
    margin-bottom: 6px;      /* Was: 8px on desktop */
  }

  .fbs-glossary {
    padding: 12px 14px;      /* Was: 16px 18px on desktop */
    margin-top: 16px;        /* Was: 20px on desktop */
  }

  .fbs-glossary-heading {
    font-size: 12px;         /* Was: 13px on desktop */
  }

  .fbs-glossary-item {
    font-size: 13px;         /* Was: 14px on desktop */
  }

  .fbs-source-footer {
    font-size: 12px;         /* Was: 13px on desktop */
    margin-top: 16px;        /* Was: 20px on desktop */
  }
}
```

**2. Tablet Optimization**
```css
@media (min-width: 768px) and (max-width: 1023px) {
  .fbs-title-line {
    font-size: 17px;         /* Between mobile and desktop */
  }

  .fbs-result {
    font-size: 14px;
  }
}
```

### Benefits
✅ Optimized for small screens  
✅ Better mobile readability  
✅ Consistent experience across devices  
✅ Reduced eye strain on mobile

---

## Task 22: Advanced Text Features

**Time:** 0.5h  
**Goal:** Add polish and advanced typography features

### Changes

**1. Text Selection Styling**
```css
.fbs-result ::selection {
  background: rgba(168, 85, 247, 0.3);
  color: #fff;
}

.fbs-result ::-moz-selection {
  background: rgba(168, 85, 247, 0.3);
  color: #fff;
}
```

**2. Link Styling (if AI output contains links)**
```css
.fbs-result a {
  color: #a855f7;
  text-decoration: none;
  border-bottom: 1px solid rgba(168, 85, 247, 0.3);
  transition: all 0.2s;
}

.fbs-result a:hover {
  color: #c9b8ff;
  border-bottom-color: rgba(168, 85, 247, 0.6);
}
```

**3. Code/Monospace Text (if needed)**
```css
.fbs-result code {
  font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace;
  font-size: 0.9em;
  padding: 2px 6px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
  color: #ffa502;
}
```

**4. Smooth Scrolling**
```css
.fbs-panel-body {
  scroll-behavior: smooth;
}
```

### Benefits
✅ Better text selection UX  
✅ Clickable links (if present)  
✅ Code formatting support  
✅ Smooth scroll experience

---

## 📊 IMPLEMENTATION SUMMARY

### Total Changes
- **Files to modify:** 1 (content.css)
- **Lines to add:** ~150 lines
- **Lines to remove:** ~20 lines
- **Net change:** +130 lines

### Time Breakdown
| Task | Time | Complexity |
|------|------|------------|
| 19. Typography Scale | 1.5h | Level 2 |
| 20. Section Structure | 1h | Level 2 |
| 21. Responsive Typography | 1h | Level 2 |
| 22. Advanced Features | 0.5h | Level 1 |
| **Total** | **4h** | **Level 2** |

### Risk Assessment
- **Low Risk:** CSS-only changes
- **No breaking changes:** Existing HTML structure unchanged
- **Backward compatible:** Old content still renders correctly
- **Easy rollback:** Can revert CSS changes instantly

---

## 🎨 BEFORE & AFTER COMPARISON

### Before
```
TIÊU ĐỀ BÀI VIẾT (15px, bold, 2px margin)
Đoạn văn thứ nhất với khoảng cách 2px. (15px, 1.65 line-height)
Đoạn văn thứ hai với khoảng cách 2px.
· Bullet point với padding-left 12px (3px margin)
· Bullet point thứ hai
```

### After
```
TIÊU ĐỀ BÀI VIẾT (18px, bold, 16px margin)

Đoạn văn thứ nhất với khoảng cách 12px. (15px, 1.7 line-height, max 65ch)

Đoạn văn thứ hai với khoảng cách 12px.

• Bullet point với flex layout (8px margin)
• Bullet point thứ hai
```

---

## ✅ EXPECTED OUTCOMES

### User Experience
1. **Easier to read** — Better spacing and hierarchy
2. **Faster scanning** — Clear visual structure
3. **Less eye strain** — Optimized line length and spacing
4. **Professional look** — Polished typography

### Technical Benefits
1. **Maintainable** — Clean CSS structure
2. **Responsive** — Works on all screen sizes
3. **Accessible** — Better contrast and spacing
4. **Performant** — CSS-only, no JS overhead

---

## 🚀 NEXT STEPS

1. **Review proposal** — Get user approval
2. **Implement Task 19** — Typography scale (1.5h)
3. **Implement Task 20** — Section structure (1h)
4. **Implement Task 21** — Responsive typography (1h)
5. **Implement Task 22** — Advanced features (0.5h)
6. **Test on real content** — Verify improvements
7. **Create changelog** — Document changes

---

**Status:** ⏳ AWAITING APPROVAL  
**Estimated Time:** 4 hours  
**Risk Level:** Low  
**Impact:** High (Better UX)
