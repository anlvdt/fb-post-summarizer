"use strict";

// --- DOM EXTRACTION & UTILS ---

const SITE = location.hostname.includes("facebook")
  ? "facebook"
  : location.hostname.includes("threads")
    ? "threads"
    : location.hostname.includes("x.com") ||
        location.hostname.includes("twitter")
      ? "x"
      : location.hostname.includes("linkedin")
        ? "linkedin"
        : location.hostname.includes("reddit")
          ? "reddit"
          : "other";

const IS_MOBILE_WEB = location.hostname === "m.facebook.com" ||
                      location.hostname === "mobile.facebook.com";

const SEE_MORE_KEYWORDS = {
  facebook: [
    "xem thêm",
    "see more",
    "voir plus",
    "mehr anzeigen",
    "もっと見る",
    "더 보기",
    "ver más",
    "ver mais",
  ],
  threads: ["more", "xem thêm"],
  x: ["show more"],
  linkedin: ["see more", "xem thêm", "...more"],
  reddit: [],
  other: ["see more", "xem thêm"],
};


const SPONSORED_KEYWORDS = [
  // Vietnamese
  "được tài trợ", "quảng cáo", "tài trợ", "nội dung được tài trợ",
  // English
  "sponsored", "paid partnership", "promoted", "paid ad",
  // Other languages
  "publicité", "gesponsert", "gesponsord", "sponsorisé",
  "patrocinado", "sponsorizzato", "rekommenderat",
  "реклама", "рекламная запись", "広告", "スポンサー",
  "光告", "赞助内容", "贊助", "광고", "협찬",
];

const CLUTTER_LABELS = [
  // Vietnamese — gợi ý / đề xuất
  "gợi ý cho bạn", "video gợi ý", "reels gợi ý", "nhóm gợi ý",
  "trang gợi ý", "sự kiện gợi ý", "bài viết gợi ý", "có thể bạn quan tâm",
  "khám phá thêm", "người bạn có thể biết", "tin tức gợi ý",
  "dành cho bạn", "được đề xuất", "nội dung liên quan",
  "được xem nhiều", "xu hướng", "trending",
  // Vietnamese — reel / memory noise
  "kỷ niệm", "memories", "trong ngày này",
  // English — suggested / recommended
  "suggested for you", "suggested reels", "suggested groups",
  "suggested events", "pages you might like", "videos you might like",
  "people you may know", "you might also like", "suggested",
  "recommended", "recommended for you", "on this day",
  "reels and short videos", "friend suggestions",
  // French/German/Spanish
  "suggéré pour vous", "vorgeschlagen", "sugerido para ti",
  "recommandé pour vous", "empfohlen", "recomendado",
];

const CLUTTER_STOP_ROLES = new Set(["complementary", "banner", "navigation", "dialog"]);

let _lastExtractedImages = [];

let hiddenClutterCount = 0;

const SEE_MORE = SEE_MORE_KEYWORDS[SITE] || SEE_MORE_KEYWORDS.other;

const fbAllPostInjected = new WeakSet();

// Cache for performance optimization
const _permalinkCache = new Map(); // key: container element, value: { url, timestamp }
const _containerCache = new WeakMap(); // element → container
const _sharedPostCache = new WeakMap(); // container → sharedArticle
const CACHE_TTL = 60000; // 1 minute



function _findPostContainer(element) {
  // Check cache first
  if (_containerCache.has(element)) {
    return _containerCache.get(element);
  }

  let p = element;
  for (let i = 0; i < 25; i++) {
    p = p.parentElement;
    if (!p || p === document.body) {
      _containerCache.set(element, null);
      return null;
    }
    if (p.getAttribute("role") === "article") {
      _containerCache.set(element, p);
      return p;
    }
  }

  _containerCache.set(element, null);
  return null;
}

function findFeedWrapper(el) {
  let cur = el;
  for (let i = 0; i < 30; i++) {
    const parent = cur.parentElement;
    if (!parent || parent === document.body) return null;
    const role = parent.getAttribute("role") || "";
    if (CLUTTER_STOP_ROLES.has(role)) return null; // sidebar/nav — wrong area
    // data-virtualized = Facebook's virtual-scroll individual post wrapper
    if (parent.hasAttribute("data-virtualized")) return parent;
    // div[role="feed"] → cur is a single feed item
    if (role === "feed") return cur;
    // Legacy: article[role="article"] whose parent is feed/article
    if (role === "article") {
      const pRole = (parent.parentElement?.getAttribute("role")) || "";
      if (pRole === "feed" || pRole === "article") return parent;
    }
    cur = parent;
  }
  return null; // could not find a reliable individual post boundary — don't hide
}

function isSponsored(el) {
  if (SITE !== "facebook") return false;
  // Get the containing post (wrapper or article)
  const container = findFeedWrapper(el) ||
    (el.getAttribute && el.getAttribute("role") === "article" ? el : _findPostContainer(el));
  if (!container) return false;

  // 1. href to Facebook ads about page (strong signal)
  if (container.querySelector(
    'a[href*="/ads/about"], a[href*="about_ads"], a[href*="adchoices"], a[href*="/ads/preferences"]'
  )) return true;

  // 2. "Why am I seeing this?" / "Tại sao tôi thấy" link (FB ad disclosure)
  if (container.querySelector(
    'a[aria-label*="Why am I seeing"], a[aria-label*="Tại sao tôi"], a[aria-label*="Vì sao"], span[aria-label*="Why am I"]'
  )) return true;

  // 3. Portal-based detection
  const SPONSORED_NORM = SPONSORED_KEYWORDS.map(kw => kw.replace(/\s+/g, "").toLowerCase());
  const ariaRefs = container.querySelectorAll("[aria-describedby],[aria-labelledby]");
  for (const ref of ariaRefs) {
    const ids = ((ref.getAttribute("aria-describedby") || "") + " " + (ref.getAttribute("aria-labelledby") || "")).trim().split(/\s+/);
    for (const id of ids) {
      if (!id) continue;
      const portal = document.getElementById(id);
      if (!portal) continue;
      const tcNorm = (portal.textContent || "").replace(/\s+/g, "").toLowerCase();
      if (SPONSORED_NORM.some(kw => tcNorm === kw || tcNorm.startsWith(kw))) return true;
    }
  }

  // 4. aria-label substring scan (for buttons/spans with sponsored label)
  const ariaLabelEls = container.querySelectorAll("[aria-label]");
  for (const el of ariaLabelEls) {
    const lbl = (el.getAttribute("aria-label") || "").replace(/\s+/g, "").toLowerCase();
    if (lbl.length < 3 || lbl.length > 120) continue;
    if (SPONSORED_NORM.some(kw => lbl.includes(kw))) return true;
  }

  // 5. text scan fallback (non-portal / other structures)
  const candidates = container.querySelectorAll('a, span, div[dir="auto"]');
  for (const node of candidates) {
    const tc = node.textContent || "";
    const tcNorm = tc.replace(/\s+/g, "").toLowerCase();
    if (tcNorm.length < 2 || tcNorm.length > 40) continue;
    if (SPONSORED_NORM.some(kw => tcNorm === kw || tcNorm.startsWith(kw))) return true;
  }
  return false;
}

function isInNonPostArea(el) {
  let p = el;
  for (let i = 0; i < 20; i++) {
    p = p.parentElement;
    if (!p || p === document.body) return false;
    const role = p.getAttribute("role") || "";
    if (["navigation", "banner", "dialog", "complementary"].includes(role))
      return true;
    // Skip comment areas on Facebook.
    // Old FB structure: post=article, comment=article inside post (1 ancestor article = comment).
    // New FB structure: feed=article, post=article inside feed, comment=article inside post.
    // Now need 2+ ancestor articles to be a comment (post has 1 ancestor article = feed container).
    if (SITE === "facebook" && role === "article") {
      let articleAncestors = 0;
      let ancestor = p.parentElement;
      for (let j = 0; j < 15; j++) {
        if (!ancestor || ancestor === document.body) break;
        if (ancestor.getAttribute("role") === "article") articleAncestors++;
        ancestor = ancestor.parentElement;
      }
      if (articleAncestors >= 2) return true; // deeply nested = comment/reply
    }
    // Only check computed style for elements that might be fixed/sticky (cheaper than always calling getComputedStyle)
    if (p.style.position === "fixed" || p.style.position === "sticky")
      return true;
    if (p.classList.contains("fixed") || p.classList.contains("sticky"))
      return true;
  }
  return false;
}

function _findSharedPostArticle(postContainer) {
  if (!postContainer) return null;

  // Method 1: Look for nested article with own header
  const nestedArticles = postContainer.querySelectorAll('[role="article"]');
  for (const nested of nestedArticles) {
    if (nested === postContainer) continue;

    // Must have parent article
    const parentArticle = nested.closest('[role="article"]');
    if (parentArticle && parentArticle !== postContainer) continue;

    // Skip comments
    if (nested.closest("form")) continue;

    // Skip list items (reactions, comments list)
    let el = nested.parentElement;
    let isInList = false;
    for (let i = 0; i < 10 && el && el !== postContainer; i++) {
      const role = (el.getAttribute("role") || "").toLowerCase();
      if (role === "list" || role === "listitem" || el.tagName === "UL") {
        isInList = true;
        break;
      }
      el = el.parentElement;
    }
    if (isInList) continue;

    // Must have own header with link
    const headers = nested.querySelectorAll("h2, h3, h4");
    for (const h of headers) {
      if (h.closest('[role="article"]') !== nested) continue;
      if (h.querySelector("a[href]")) return nested;
    }
  }

  // Method 2: Look for "shared a post" text
  const allText = postContainer.innerText || postContainer.textContent || "";
  const sharedPatterns = [
    "shared a post", "chia sẻ bài viết", "đã chia sẻ",
    "shared a memory", "chia sẻ kỷ niệm",
    "shared a video", "chia sẻ video",
    "shared a reel", "chia sẻ reel"
  ];
  const hasSharedText = sharedPatterns.some(p =>
    allText.toLowerCase().includes(p.toLowerCase())
  );

  if (hasSharedText) {
    // Find the nested article after "shared" text
    const nestedArticles = postContainer.querySelectorAll('[role="article"]');
    if (nestedArticles.length > 1) {
      return nestedArticles[1]; // Second article is usually the shared content
    }
  }

  return null;
}

function _cleanFbUrl(rawUrl) {
  if (!rawUrl) return "";
  try {
    const u = new URL(rawUrl);
    const TRACKING_PARAMS = ["fbclid", "ref", "comment_id", "reply_comment_id",
      "notif_id", "notif_t", "mibextid", "_rdr", "_rdc", "rdid", "share_scenario",
      "hoisted_section_header_type"];
    for (const k of [...u.searchParams.keys()]) {
      if (k.startsWith("__") || k.startsWith("utm_") || TRACKING_PARAMS.includes(k)) {
        u.searchParams.delete(k);
      }
    }
    const clean = u.searchParams.toString()
      ? u.origin + u.pathname + "?" + u.searchParams.toString()
      : u.origin + u.pathname;
    return clean.replace(/\/$/, "");
  } catch (_) {
    return rawUrl;
  }
}

function _resolveFbRedirect(rawUrl) {
  if (!rawUrl) return "";
  try {
    if (rawUrl.includes("l.facebook.com/l.php") || rawUrl.includes("lm.facebook.com/l.php")) {
      const u = new URL(rawUrl);
      const target = u.searchParams.get("u");
      if (target) return decodeURIComponent(target);
    }
  } catch (_) {}
  return rawUrl;
}

// Helper function: Extract post ID from container using 5 methods
function _extractPostIdFromContainer(container) {
  if (!container) return null;

  // Method 1: data-ft (legacy)
  const dataFtEl = container.querySelector("[data-ft]");
  if (dataFtEl) {
    try {
      const ft = JSON.parse(dataFtEl.getAttribute("data-ft"));
      if (ft.top_level_post_id) return ft.top_level_post_id;
      if (ft.mf_story_key) return ft.mf_story_key;
    } catch (_) {}
  }

  // Method 2: aria-posinset (post position in feed)
  const ariaPosinset = container.getAttribute("aria-posinset");
  if (ariaPosinset) {
    const links = container.querySelectorAll("a[href]");
    for (const link of links) {
      const href = link.href || "";
      if (href.includes(ariaPosinset)) {
        const match = href.match(/(\d{10,})/);
        if (match) return match[1];
      }
    }
  }

  // Method 3: data-testid attributes
  const testIdEl = container.querySelector("[data-testid*='post']");
  if (testIdEl) {
    const testId = testIdEl.getAttribute("data-testid") || "";
    const match = testId.match(/(\d{10,})/);
    if (match) return match[1];
  }

  // Method 4: Scan all data-* attributes
  const allDataAttrs = [];
  for (const attr of container.attributes) {
    if (attr.name.startsWith("data-")) {
      allDataAttrs.push(attr.value);
    }
  }
  const dataStr = allDataAttrs.join(" ");
  const dataMatch = dataStr.match(/(\d{15,})/); // Facebook post IDs are 15+ digits
  if (dataMatch) return dataMatch[1];

  // Method 5: Look for hidden inputs with post ID
  const hiddenInputs = container.querySelectorAll("input[type='hidden']");
  for (const input of hiddenInputs) {
    const val = input.value || "";
    const match = val.match(/(\d{15,})/);
    if (match) return match[1];
  }

  // Method 6: aria attributes and id
  const idSources = [
    container.getAttribute("aria-describedby"),
    container.getAttribute("aria-labelledby"),
    container.id,
    container.getAttribute("data-story-id"),
    container.getAttribute("data-post-id"),
  ].filter(Boolean).join(" ");
  const idMatch = idSources.match(/(\d{10,})/);
  if (idMatch) return idMatch[1];

  return null;
}

function _findPermalinkInContainer(container) {
  if (!container) return "";

  // Check cache first
  const cached = _permalinkCache.get(container);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.url;
  }

  const allLinks = container.querySelectorAll("a[href]");
  const candidates = [];

  for (const link of allLinks) {
    let href = link.href || "";
    if (!href) continue;

    // Resolve l.facebook.com redirects
    href = _resolveFbRedirect(href);

    // Add reel/video/story permalink detection
    if (href.includes("/reel/") || href.includes("/videos/")) {
      const reelMatch = href.match(/\/reel\/(\d+|[a-zA-Z0-9_-]+)/);
      const videoMatch = href.match(/\/videos\/(\d+)/);
      if (reelMatch || videoMatch) {
        const result = _cleanFbUrl(href);
        _permalinkCache.set(container, { url: result, timestamp: Date.now() });
        return result;
      }
    }

    if (href.includes("/stories/")) {
      const storyMatch = href.match(/\/stories\/(\d+|[a-zA-Z0-9_-]+)/);
      if (storyMatch) {
        const result = _cleanFbUrl(href);
        _permalinkCache.set(container, { url: result, timestamp: Date.now() });
        return result;
      }
    }

    // Bỏ qua link rõ ràng không phải permalink
    if (href.includes("/photo") || href.includes("/hashtag/") ||
        href.includes("/events/") || href.includes("/marketplace/") ||
        href.includes("facebook.com/policies") || href.includes("facebook.com/help") ||
        href.includes("/groups/") && !href.includes("/posts/") && !href.includes("pfbid") && !href.includes("/permalink") ||
        href.includes("/share") ||
        href === "https://www.facebook.com/" || href === "https://www.facebook.com") continue;

    const isPermalink =
      href.includes("/posts/") ||
      href.includes("/permalink") ||
      href.includes("story_fbid") ||
      href.includes("pfbid") ||
      href.includes("multi_permalinks");

    if (isPermalink) {
      candidates.push({ href, priority: 1, reason: "permalink_pattern" });
      continue;
    }

    // Mobile web specific patterns
    if (IS_MOBILE_WEB) {
      if (href.includes("story.php") && (href.includes("story_fbid") || href.includes("id="))) {
        candidates.push({ href, priority: 1, reason: "mobile_story" });
        continue;
      }
    }

    // Link có text ngắn giống timestamp
    const text = (link.textContent || "").trim();
    const ariaLabel = (link.getAttribute("aria-label") || "").trim();
    const isTimestamp =
      /^\d+\s*(giờ|phút|ngày|giây|tháng|năm|h|m|d|w|s|hr|min|tuần|week)/i.test(text) ||
      /^(hôm qua|yesterday|just now|vừa xong|hôm kia)/i.test(text) ||
      /\d+\s*(giờ|phút|ngày|hour|minute|day|month|year)/i.test(ariaLabel);

    if (isTimestamp && text.length < 30 && href.includes("facebook.com")) {
      candidates.push({ href, priority: 2, reason: "timestamp:" + text });
      continue;
    }

    // Link ngắn trỏ đến user profile + post (dạng /username/posts/ hoặc /username/pfbid)
    try {
      const u = new URL(href);
      if (u.hostname.includes("facebook.com") && u.pathname.length > 5) {
        const parts = u.pathname.split("/").filter(Boolean);
        // Pattern: /username/posts/id hoặc /username/pfbidXXX
        if (parts.length >= 2 && (parts[1] === "posts" || parts[1].startsWith("pfbid"))) {
          candidates.push({ href, priority: 1, reason: "path_pattern:" + u.pathname });
        }
      }
    } catch (_) {}
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => a.priority - b.priority);
    const result = _cleanFbUrl(candidates[0].href);
    _permalinkCache.set(container, { url: result, timestamp: Date.now() });
    return result;
  }

  // === FALLBACK: Bài trong Group — tìm group permalink ===
  let groupUrl = "";
  let groupId = "";
  for (const link of allLinks) {
    const href = link.href || "";
    const match = href.match(/facebook\.com\/groups\/([^\/?]+)/);
    if (match) {
      groupId = match[1];
      groupUrl = "https://www.facebook.com/groups/" + groupId;
      break;
    }
  }

  if (groupUrl) {
    // Enhanced post ID extraction with 5 methods
    const postId = _extractPostIdFromContainer(container);
    if (postId) {
      const result = groupUrl + "/posts/" + postId;
      _permalinkCache.set(container, { url: result, timestamp: Date.now() });
      return result;
    }

    // Fallback: chỉ trả về group URL
    _permalinkCache.set(container, { url: groupUrl, timestamp: Date.now() });
    return groupUrl;
  }

  // === FALLBACK: Bài trên Page — tìm page URL ===
  // Page posts thường có link về page, dạng /pageusername hoặc /pages/Name/ID
  for (const link of allLinks) {
    const href = link.href || "";
    // Pattern page: /pages/Name/12345 hoặc /pagename (single path)
    const pageMatch = href.match(/facebook\.com\/pages\/[^\/]+\/(\d+)/);
    if (pageMatch) {
      // Thử tìm post ID trong container
      const postId = _extractPostIdFromContainer(container);
      if (postId) {
        const result = "https://www.facebook.com/" + pageMatch[1] + "/posts/" + postId;
        _permalinkCache.set(container, { url: result, timestamp: Date.now() });
        return result;
      }
      const result = "https://www.facebook.com/pages/" + pageMatch[0].split("/pages/")[1];
      _permalinkCache.set(container, { url: result, timestamp: Date.now() });
      return result;
    }
  }

  // === FALLBACK CUỐI: Link profile tác giả ===
  for (const link of allLinks) {
    const href = link.href || "";
    if (href.includes("facebook.com") && (href.includes("/user/") || href.includes("/profile.php"))) {
      const result = _cleanFbUrl(href);
      _permalinkCache.set(container, { url: result, timestamp: Date.now() });
      return result;
    }
  }

  return "";
}

function extractPostPermalink(element) {
  const url = location.href;
  if (SITE === "facebook") {
    // Nếu đang xem bài đơn lẻ → dùng URL trang
    if (/\/posts\/|\/permalink\/|story_fbid|multi_permalinks|pfbid/.test(url))
      return _cleanFbUrl(url);

    // Đang ở newsfeed → tìm permalink trong article
    if (!element) return "";

    // Tìm post container (supports both old role="article" and new data-virtualized)
    const postContainer = _findPostContainer(element);

    // === ƯU TIÊN 1: Nếu là BÀI SHARE → lấy link bài GỐC ===
    // Khi ai đó share bài, ta muốn link đến bài gốc (của người được share),
    // không phải link đến bài share. Bài gốc nằm trong nested article.
    const sharedInner = _findSharedPostArticle(postContainer);
    if (sharedInner) {
      // Tìm permalink bên trong nested article
      const innerPermalink = _findPermalinkInContainer(sharedInner);
      if (innerPermalink) return innerPermalink;
    }

    // === ƯU TIÊN 2: Tìm permalink trong post container (bài thường) ===
    const directPermalink = _findPermalinkInContainer(postContainer);
    if (directPermalink) return directPermalink;

    return "";
  }

  // Non-Facebook platforms
  if (!element) return url;
  const postContainer = _findPostContainer(element);
  const platformLinks = {
    threads: 'a[href*="/post/"]',
    x: 'a[href*="/status/"]',
    linkedin: 'a[href*="/feed/update/"]',
    reddit: 'a[href*="/comments/"]',
  };
  const selector = platformLinks[SITE];
  if (selector) {
    const link = postContainer.querySelector(selector);
    if (link && link.href) {
      try {
        return new URL(link.href).origin + new URL(link.href).pathname;
      } catch (_) {}
    }
  }
  return url;
}

function _isAvatar(img) {
    const w = img.naturalWidth || img.width || 0;
    const h = img.naturalHeight || img.height || 0;
    if (w > 0 && w === h && w <= 60) return true;
    try { if (getComputedStyle(img).borderRadius === "50%") return true; } catch (_) {}
    // Avatar thường trong link profile
    const parentLink = img.closest("a");
    if (parentLink) {
      const href = parentLink.href || "";
      // Profile pattern: /username hoặc /profile.php?id=
      if (href.includes("/profile.php") ||
          (href.includes("facebook.com") && /facebook\.com\/[^/?]+\/?$/.test(href) &&
           !href.includes("/posts/") && !href.includes("/photo") && !href.includes("/pages/"))) {
        return true;
      }
    }
    return false;
  }

function extractPostSource(element) {
  if (!element) return "";

  const postContainer = _findPostContainer(element);

  if (SITE === "facebook") {
    // 1. Nếu post là BÀI SHARE → source là nguồn bài gốc (group/page được share)
    const sharedInner = _findSharedPostArticle(postContainer);
    const containers = sharedInner ? [sharedInner, postContainer] : [postContainer];

    for (const container of containers) {
      // 2. Tìm pattern "Author › Group" hoặc "Author in Group"
      // trong header: nếu có ≥2 link trong h2/h3/h4 thì link thứ 2 thường là group/page
      const headers = container.querySelectorAll("h2, h3, h4");
      for (const h of headers) {
        // Header phải thuộc container này
        if (h.closest('[role="article"]') && h.closest('[role="article"]') !== container && container.getAttribute("role") === "article") continue;
        const links = h.querySelectorAll("a[href]");
        if (links.length >= 2) {
          for (let i = 1; i < links.length; i++) {
            const link = links[i];
            const href = link.href || "";
            const name = (link.innerText || link.textContent || "").trim();
            if (!_validateSourceName(name)) continue;
            // Chỉ lấy nếu link trỏ đến group hoặc page
            if (href.includes("/groups/") || href.match(/facebook\.com\/[^/?]+\/?$/)) {
              return name;
            }
          }
        }
      }

      // 3. Tìm direct group link trong container (trừ link avatar/author)
      const groupLinks = container.querySelectorAll('a[href*="/groups/"]');
      for (const link of groupLinks) {
        // Bỏ qua link rỗng / chỉ có ảnh
        const name = (link.innerText || link.textContent || "").trim();
        if (_validateSourceName(name)) {
          return name;
        }
      }
    }

    // 4. Fallback: nếu URL trang là group → lấy từ page title
    if (location.href.includes("/groups/")) {
      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle && ogTitle.content) return ogTitle.content.trim();
    }
  }

  return "";
}

// Helper function: Validate source/group name
function _validateSourceName(name) {
  if (!name || name.length < 3 || name.length > 100) return false;

  // Reject hex strings (anti-scraping)
  if (/[a-f0-9]{10,}/i.test(name)) return false;

  // Reject long number sequences
  if (/\d{8,}/.test(name)) return false;

  // Reject pure numbers
  if (/^\d+$/.test(name)) return false;

  // Reject common noise patterns
  const noise = [
    "sponsored", "được tài trợ", "quảng cáo",
    "suggested for you", "gợi ý cho bạn",
    "recommended", "đề xuất"
  ];
  const lower = name.toLowerCase();
  if (noise.some(n => lower.includes(n))) return false;

  return true;
}

function extractPostAuthor(element) {
  if (!element) return "";

  // Walk up to the outermost post article
  let postContainer = element;
  for (let i = 0; i < 20; i++) {
    if (
      !postContainer.parentElement ||
      postContainer.parentElement === document.body
    )
      break;
    postContainer = postContainer.parentElement;
    if (postContainer.getAttribute("role") === "article") break;
  }

  if (SITE === "facebook") {
    // Mobile web specific extraction
    if (IS_MOBILE_WEB) {
      const authorH3 = postContainer.querySelector("h3 a");
      if (authorH3) {
        const name = (authorH3.innerText || authorH3.textContent || "").trim();
        if (_validateAuthorName(name)) return name;
      }
    }

    // 1. Try to find original author from a shared/embedded post inside this article.
    //    This handles: personal share, group share, page share — all cases where
    //    someone shares another person's post. The outer header = sharer, inner = author.
    const originalAuthor = _fbFindOriginalAuthor(postContainer);
    if (originalAuthor && _validateAuthorName(originalAuthor)) return originalAuthor;

    // 2. Not a shared post → author is in this article's own header.
    //    This handles: personal post, page post, group post (original, not shared).
    const author = _fbExtractAuthorFromContainer(postContainer);
    if (_validateAuthorName(author)) return author;
  }

  // X/Threads
  const nameEl = postContainer.querySelector(
    '[data-testid="User-Name"], [data-testid="tweetAuthorName"]',
  );
  if (nameEl) return (nameEl.textContent || "").split("@")[0].trim();

  // LinkedIn
  const liAuthor = postContainer.querySelector(
    ".feed-shared-actor__name, .update-components-actor__name",
  );
  if (liAuthor) return (liAuthor.textContent || "").trim();

  // Reddit
  const redditAuthor = postContainer.querySelector(
    '[data-testid="post_author_link"], a[href*="/user/"]',
  );
  if (redditAuthor) return (redditAuthor.textContent || "").trim();

  return "";
}

// Helper function: Validate author name
function _validateAuthorName(name) {
  if (!name || name.length < 2 || name.length > 100) return false;

  // Reject hex strings (anti-scraping)
  if (/[a-f0-9]{10,}/i.test(name)) return false;

  // Reject long number sequences
  if (/\d{8,}/.test(name)) return false;

  // Reject too many words (likely not a name)
  if (name.split(/\s+/).length > 10) return false;

  // Reject common noise patterns
  const noise = [
    "sponsored", "được tài trợ", "quảng cáo",
    "suggested for you", "gợi ý cho bạn",
    "recommended", "đề xuất"
  ];
  const lower = name.toLowerCase();
  if (noise.some(n => lower.includes(n))) return false;

  return true;
}

function extractPostImages(element) {
  if (!element) return [];
  const postContainer = _findPostContainer(element);

  // Helper: get best src from img element
  function _imgSrc(img) {
    const srcset = img.getAttribute("srcset") || img.getAttribute("data-srcset") || "";
    if (srcset) {
      const parts = srcset.split(",").map(s => s.trim().split(/\s+/)).filter(p => p[0]);
      if (parts.length > 0) {
        let best = parts[parts.length - 1];
        let bestW = 0;
        for (const p of parts) {
          const w = parseInt(p[1] || "0");
          if (w > bestW) { bestW = w; best = p; }
        }
        if (best[0]) return best[0];
      }
    }
    return img.getAttribute("data-src") || img.currentSrc || img.src || "";
  }

  function _isAvatar(img) {
    if (img.width > 0 && img.width < 80) return true;
    try { if (getComputedStyle(img).borderRadius === "50%") return true; } catch (_) {}
    return false;
  }

  function _isHeaderImg(img, container) {
    const headerEl = container.querySelector("h2, h3, h4, [data-testid='story-subtitle'], [data-testid='post-header']");
    if (headerEl && headerEl.contains(img)) return true;
    const parentLink = img.closest("a");
    if (parentLink) {
      const href = parentLink.href || "";
      if (href.includes("/user/") || href.includes("/profile.php") ||
          (href.includes("facebook.com") && /facebook\.com\/[^/?]+$/.test(href) &&
           !href.includes("/posts/") && !href.includes("/photo") && !href.includes("/reel"))) {
        return true;
      }
    }
    return false;
  }

  function _extractAllImagesFromContainer(container) {
    const collected = [];
    const seenSrcs = new Set();
    function _normalizeSrc(src) {
      try { const u = new URL(src); return u.origin + u.pathname; } catch (_) { return src; }
    }
    function _addIfUnique(src, area, priority) {
      if (!src || src.startsWith("data:")) return;
      if (src.includes("/rsrc.php/") || src.includes("emoji")) return;
      const key = _normalizeSrc(src);
      if (seenSrcs.has(key)) return;
      seenSrcs.add(key);
      collected.push({ src, area, priority });
    }

    // Strategy 1: Explicit photo links
    const photoLinks = container.querySelectorAll('a[href*="/photo"], a[href*="/photos/"], a[href*="fbid="], a[href*="/reel/"], a[href*="/videos/"]');
    for (const link of photoLinks) {
      const img = link.querySelector("img");
      if (!img) continue;
      const src = _imgSrc(img);
      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      if (w > 0 && w < 80) continue;
      _addIfUnique(src, w * h, 1);
    }
    // Strategy 2: Background image
    const bgElements = container.querySelectorAll('[style*="background-image"]');
    for (const bgEl of bgElements) {
      const rect = bgEl.getBoundingClientRect();
      if (rect.width < 150 || rect.height < 150) continue;
      try { if (getComputedStyle(bgEl).borderRadius === "50%") continue; } catch (_) {}
      const style = bgEl.getAttribute("style") || "";
      const match = style.match(/background-image:\s*url\(["']?([^"']+)["']?\)/);
      if (match && match[1]) _addIfUnique(match[1], rect.width * rect.height, 2);
    }
    // Strategy 3: Large images
    const allImgs = container.querySelectorAll("img");
    for (const img of allImgs) {
      const src = _imgSrc(img);
      if (!src || src.startsWith("data:")) continue;
      if (_isAvatar(img)) continue;
      if (_isHeaderImg(img, container)) continue;
      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      if (w > 0 && w < 200 && h < 200) continue;
      _addIfUnique(src, w * h, 3);
    }
    collected.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return b.area - a.area;
    });
    return collected.map(c => c.src);
  }

  function _collectImages() {
    if (SITE === "facebook") {
      const results = [];
      const seen = new Set();
      const push = (arr) => {
        for (const url of arr) {
          try {
            const key = new URL(url).origin + new URL(url).pathname;
            if (!seen.has(key)) { seen.add(key); results.push(url); }
          } catch (_) {
            if (!seen.has(url)) { seen.add(url); results.push(url); }
          }
        }
      };
      const sharedInner = _findSharedPostArticle(postContainer);
      if (sharedInner) push(_extractAllImagesFromContainer(sharedInner));
      push(_extractAllImagesFromContainer(postContainer));
      return results;
    } else {
      const results = [];
      const images = postContainer.querySelectorAll("img");
      for (const img of images) {
        const src = _imgSrc(img);
        if (!src || src.startsWith("data:")) continue;
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        if (w < 200 && h < 200) continue;
        if (src.includes("emoji") || src.includes("static")) continue;
        if (src.includes("profile") || src.includes("avatar")) continue;
        try { if (getComputedStyle(img).borderRadius === "50%") continue; } catch (_) {}
        results.push(src);
      }
      return results;
    }
  }

  let allImages = _collectImages();
  if (allImages.length === 0) {
    const ogImage = document.querySelector('meta[property="og:image"]');
    if (ogImage && ogImage.content) allImages = [ogImage.content];
  }
  _lastExtractedImages = allImages;
  return allImages;
}

function extractPostImage(element) {
  const images = extractPostImages(element);
  return images.length > 0 ? images[0] : "";
}

async function fetchImageBlob(imgSrc, filename = "image.png") {
  if (!imgSrc) return null;

  // Attempt 1: Via Canvas (fastest but fails on cross-origin taint)
  // Tìm img element theo src OR currentSrc OR srcset (srcset có thể là URL chúng ta lấy)
  let imgEl = null;
  try {
    imgEl = document.querySelector(`img[src="${CSS.escape(imgSrc)}"]`);
    if (!imgEl) {
      // Fallback: scan tất cả img để tìm element có currentSrc match hoặc srcset chứa url
      const allImgs = document.querySelectorAll("img");
      for (const img of allImgs) {
        if (img.currentSrc === imgSrc || img.src === imgSrc) {
          imgEl = img; break;
        }
        const srcset = img.srcset || "";
        if (srcset && srcset.includes(imgSrc)) {
          imgEl = img; break;
        }
      }
    }
  } catch (_) {}

  if (imgEl && imgEl.naturalWidth > 0) {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = imgEl.naturalWidth;
      canvas.height = imgEl.naturalHeight;
      canvas.getContext("2d").drawImage(imgEl, 0, 0);
      const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
      if (blob) return new File([blob], filename, { type: "image/png" });
    } catch (_) {
      // Cross-origin taint — fall through to network fetch
    }
  }

  // Attempt 2: Via Background.js fetch (bypasses CORS)
  try {
    const resp = await new Promise((resolve) =>
      chrome.runtime.sendMessage(
        { action: "fetch-image", url: imgSrc },
        resolve,
      ),
    );
    if (resp && resp.base64) {
      const fetchResp = await fetch(resp.base64);
      const blob = await fetchResp.blob();
      if (blob) {
        const ext = blob.type.includes("jpeg") ? "jpg" :
                   blob.type.includes("webp") ? "webp" :
                   blob.type.includes("png") ? "png" : "jpg";
        return new File([blob], filename.replace(/\.\w+$/, "." + ext), { type: blob.type || "image/jpeg" });
      }
    }
  } catch (_) {}

  return null;
}

async function fetchImageBlobs(imgSrcs, maxCount = 10) {
  if (!imgSrcs || imgSrcs.length === 0) return [];
  // Facebook limit 10 ảnh/post; giới hạn maxCount
  const targets = imgSrcs.slice(0, maxCount);
  const results = await Promise.all(
    targets.map((src, i) => fetchImageBlob(src, `image_${i + 1}.png`))
  );
  return results.filter(f => f !== null);
}

function _matchesClutterLabelNorm(normText) {
  return ALL_CLUTTER_LABELS_NORM.some(kw => normText === kw || normText.startsWith(kw));
}

function injectClutterCSS() {
  if (document.getElementById("fbs-clutter-css")) return;
  const style = document.createElement("style");
  style.id = "fbs-clutter-css";
  // Các selector ẩn bằng CSS (không cần MutationObserver vì chúng là structural)
  style.textContent = [
    // Stories row (thanh story trên đầu feed)
    'div[data-pagelet="Stories"]',
    'div[data-pagelet*="Stories"]',
    'div[aria-label="Stories"]',
    'div[aria-label="Tin"]',
    // Reels shelf trong feed
    'div[data-pagelet*="Reels"]',
    'div[aria-label="Reels"]',
    'div[aria-label="Thước phim ngắn"]',
    // Watch / Video suggestions
    'div[aria-label="Facebook Watch"]',
    'div[aria-label="Video gợi ý"]',
    // Right rail (sidebar contacts, sponsored, birthdays, etc.)
    'div[data-pagelet="RightRail"]',
    'div[data-pagelet="RightRail2"]',
    'div[data-pagelet="BirthdayNotifications"]',
    'div[data-pagelet="LeftRail"] div[data-pagelet*="sponsored"]',
    // Chat sidebar
    'div[data-pagelet*="Chat"]',
    'div[aria-label="Chat"]',
    'div[aria-label="Danh sách trò chuyện"]',
    // Marketplace widget trong feed
    'div[data-pagelet*="Marketplace"]',
    'div[aria-label="Marketplace"]',
    // Groups you should join widget
    'div[data-pagelet*="GroupsYouShouldJoin"]',
    // "People you may know" widget
    'div[data-pagelet*="PeopleYouMayKnow"]',
  ].join(",\n") + " { display: none !important; }";
  (document.head || document.documentElement).appendChild(style);
}

function hideFeedClutter() {
  if (SITE !== "facebook") return;
  injectClutterCSS();

  let newlyHidden = 0;

  // ── Strategy 1: React portal detection (primary for Facebook) ────────────
  // Facebook renders "Được tài trợ" / clutter labels as React portals:
  //   <div class="__fb-light-mode">
  //     <span id="_r_a2_">Được tài trợ</span>
  //   </div>
  // These portals live directly under <body>, completely detached from the
  // feed DOM. The feed post references them via aria-describedby on a <span>
  // inside a DIV[data-virtualized] post wrapper:
  //   SPAN[aria-describedby="_r_a2_"] → A[role=link] → DIV[data-virtualized]
  // So we: (1) find portals with clutter text, (2) get their span IDs,
  // (3) find the feed element with aria-describedby pointing to that ID,
  // (4) walk up to find DIV[data-virtualized] via findFeedWrapper.
  // Sponsored signals: exact label OR substring inside longer aria text
  // e.g. "Mở menu cho nội dung được tài trợ của Kính Hải Triều Vietnam"
  const SPONSORED_NORM_LIST = SPONSORED_KEYWORDS.map(kw => kw.replace(/\s+/g, "").toLowerCase());
  function _portalIsSponsored(tcNorm) {
    // exact clutter label match
    if (_matchesClutterLabelNorm(tcNorm)) return true;
    // substring: portal text contains a sponsored keyword anywhere
    return SPONSORED_NORM_LIST.some(kw => tcNorm.includes(kw));
  }

  // Scan .__fb-light-mode portals — these are small detached React portals.
  // Match both exact labels ("Được tài trợ") AND portals whose text contains
  // a sponsored keyword as substring, e.g.:
  //   "Mở menu cho nội dung được tài trợ của Kính Hải Triều Vietnam"
  // That portal's ID is on the ··· button inside the sponsored post.
  const portals = document.querySelectorAll(".__fb-light-mode");
  for (const portal of portals) {
    if (portal.dataset.fbsPortalChecked) continue;
    const tcNorm = (portal.textContent || "").replace(/\s+/g, "").toLowerCase();
    // Mark non-sponsored portals immediately so we skip them next scan
    if (tcNorm.length < 2 || !_portalIsSponsored(tcNorm)) {
      portal.dataset.fbsPortalChecked = "1";
      continue;
    }
    // Sponsored portal: try to find the feed post referencing it.
    // Do NOT mark as checked until we successfully hide — the post may not
    // be in the DOM yet (virtual scroll) and we need to retry on next scan.
    const idEls = portal.querySelectorAll("[id]");
    let didHide = false;
    for (const idEl of idEls) {
      if (!idEl.id) continue;
      const qid = JSON.stringify(idEl.id);
      const sel = "[aria-describedby~=" + qid + "],[aria-labelledby~=" + qid + "]";
      let ref;
      try { ref = document.querySelector(sel); } catch (e) { continue; }
      if (!ref) continue;
      const wrapper = findFeedWrapper(ref);
      if (!wrapper) continue; // post not in DOM yet — retry next scan
      if (wrapper.dataset.fbsHidden === "1") { didHide = true; break; } // already hidden
      wrapper.dataset.fbsHidden = "1";
      _hideWrapper(wrapper);
      hiddenClutterCount++;
      newlyHidden++;
      didHide = true;
      break;
    }
    if (didHide) portal.dataset.fbsPortalChecked = "1";
  }

  // ── Strategy 2: aria-label substring scan on elements in the feed ───────
  const SPKW_NORM = SPONSORED_KEYWORDS.map(kw => kw.replace(/\s+/g, "").toLowerCase());
  const roots = (typeof visiblePosts !== "undefined" && visiblePosts.size > 0) ? Array.from(visiblePosts) : [document];
  for (const root of roots) {
    root.querySelectorAll("[aria-label]").forEach(el => {
      if (el.dataset.fbsClutterChecked) return;
      const lbl = (el.getAttribute("aria-label") || "").replace(/\s+/g, "").toLowerCase();
      if (lbl.length < 3 || lbl.length > 120) return;
      if (!SPKW_NORM.some(kw => lbl.includes(kw))) return;
      el.dataset.fbsClutterChecked = "1";
      if (isInNonPostArea(el)) return;
      const wrapper = findFeedWrapper(el);
      if (!wrapper || wrapper.dataset.fbsHidden === "1") return;
      wrapper.dataset.fbsHidden = "1";
      _hideWrapper(wrapper);
      hiddenClutterCount++;
      newlyHidden++;
    });
  }

  // ── Strategy 3: ad link detection ───────────────────────────────────────
  for (const root of roots) {
    const adLinks = root.querySelectorAll(
      'a[href*="/ads/about"], a[href*="about_ads"], a[href*="adchoices"], a[href*="/ads/preferences"]'
    );
    for (const link of adLinks) {
      if (link.dataset.fbsAdLinkChecked) continue;
      link.dataset.fbsAdLinkChecked = "1";
      if (isInNonPostArea(link)) continue;
      const wrapper = findFeedWrapper(link);
      if (!wrapper || wrapper.dataset.fbsHidden === "1") continue;
      wrapper.dataset.fbsHidden = "1";
      _hideWrapper(wrapper);
      hiddenClutterCount++;
      newlyHidden++;
    }
  }

  // ── Strategy 4: CLUTTER_LABELS (Gợi ý, Reels, People you may know, ...) ─
  // Quét text label ngắn trong header của các item feed
  const CLUTTER_LABELS_NORM = CLUTTER_LABELS.map(kw => kw.replace(/\s+/g, "").toLowerCase());
  function _matchesClutter(tcNorm) {
    return CLUTTER_LABELS_NORM.some(kw => tcNorm === kw || tcNorm.startsWith(kw));
  }
  // Check spans/divs trong article headers (h2, h3, h4) hoặc dir="auto" labels
  // Giới hạn scope: chỉ quét trong feed container
  const feed = document.querySelector('[role="feed"]') || document.querySelector('[role="main"]');
  if (feed) {
    const headerCandidates = feed.querySelectorAll('h2 span[dir="auto"], h3 span[dir="auto"], h4 span[dir="auto"], h2 > span, h3 > span, h4 > span');
    for (const el of headerCandidates) {
      if (el.dataset.fbsLabelChecked) continue;
      const text = (el.textContent || "").trim();
      if (text.length < 3 || text.length > 60) continue;
      const tcNorm = text.replace(/\s+/g, "").toLowerCase();
      if (!_matchesClutter(tcNorm)) continue;
      el.dataset.fbsLabelChecked = "1";
      if (isInNonPostArea(el)) continue;
      const wrapper = findFeedWrapper(el);
      if (!wrapper || wrapper.dataset.fbsHidden === "1") continue;
      wrapper.dataset.fbsHidden = "1";
      _hideWrapper(wrapper);
      hiddenClutterCount++;
      newlyHidden++;
    }
  }

  if (newlyHidden > 0) showClutterToast(hiddenClutterCount);
}


// === UNIFIED DETECTION ENGINE ===
// Consolidates all ad/affiliate detection signals into a single pipeline.
// Used by both UI hiding (content.js) and auto-pilot skipping (auto-pilot.js).

const AFFILIATE_DOMAINS = [
  "shope.ee", "shopee.vn", "lazada.vn", "tiki.vn", "tiktok.com/@shop",
  "sendo.vn", "accesstrade.vn", "go.isclix.com", "invol.co",
];

const SHORTENER_DOMAINS = [
  "bit.ly", "tinyurl.com", "cutt.ly", "s.id", "bom.so", "rb.gy",
  "shorturl.at", "linktr.ee", "beacons.ai", "lnk.bio", "solo.to",
];

const AFFILIATE_URL_PARAMS = ["aff", "ref", "utm_source", "utm_medium", "subid", "clickid", "affiliate_id"];

const IMAGE_CLICKOUT_SELECTORS = [
  '[data-ad-rendering-role="image"] a[href]',
  'a[href] img',
  'a[href][target="_blank"]:has(img)',
];

function _resolveFbRedirectUrl(href) {
  if (!href) return "";
  try {
    if (href.includes("l.facebook.com/l.php") || href.includes("lm.facebook.com/l.php")) {
      const u = new URL(href);
      const target = u.searchParams.get("u");
      if (target) return decodeURIComponent(target);
    }
  } catch (_) {}
  return href;
}

function _detectAffiliateUrl(href) {
  if (!href) return null;
  const resolved = _resolveFbRedirectUrl(href);
  const lower = (resolved || href).toLowerCase();

  // Direct affiliate domains
  for (const domain of AFFILIATE_DOMAINS) {
    if (lower.includes(domain)) {
      return { reason: "affiliate_domain", domain };
    }
  }

  // URL shorteners
  for (const short of SHORTENER_DOMAINS) {
    if (lower.includes(short)) {
      return { reason: "shortener_link", domain: short };
    }
  }

  // Affiliate URL parameters
  try {
    const u = new URL(resolved || href);
    for (const param of AFFILIATE_URL_PARAMS) {
      if (u.searchParams.has(param)) {
        return { reason: "affiliate_param", param };
      }
    }
  } catch (_) {}

  // Facebook redirect wrapper
  if (lower.includes("l.facebook.com/l.php") || lower.includes("lm.facebook.com/l.php")) {
    return { reason: "redirect_wrapper" };
  }

  return null;
}

function _detectImageClickout(container) {
  for (const selector of IMAGE_CLICKOUT_SELECTORS) {
    const nodes = container.querySelectorAll(selector);
    for (const node of nodes) {
      const anchor = node.tagName === "A" ? node : node.closest("a[href]");
      if (!anchor) continue;
      const href = anchor.href;
      if (!href) continue;

      // Skip internal Facebook links
      if (href.includes("facebook.com/") && !href.includes("l.php")) continue;

      const affiliate = _detectAffiliateUrl(href);
      if (affiliate) {
        return { detected: true, ...affiliate };
      }
    }
  }
  return null;
}

function _detectAffiliateText(container) {
  const text = (container.innerText || container.textContent || "").toLowerCase();

  for (const domain of AFFILIATE_DOMAINS) {
    if (text.includes(domain)) {
      return { reason: "affiliate_text", domain };
    }
  }

  // Common affiliate call-to-action patterns require a concrete outbound/link signal.
  const affiliatePatterns = ["mua ngay", "đặt hàng", "shop ngay", "link sản phẩm"];
  const hasOutboundSignal = /https?:\/\/|www\.|shope\.ee|s\.lazada|tiki\.vn|vt\.tiktok\.com/i.test(text);
  for (const pattern of affiliatePatterns) {
    if (text.includes(pattern) && hasOutboundSignal) {
      return { reason: "affiliate_cta", pattern };
    }
  }

  return null;
}

function evaluatePostSignals(postEl) {
  if (!postEl) return { isSponsored: false, isAffiliate: false, reasons: [], confidence: 0 };

  const result = {
    isSponsored: false,
    isAffiliate: false,
    reasons: [],
    confidence: 0,
    details: {},
  };

  // === SPONSORED DETECTION ===
  const container = findFeedWrapper(postEl) ||
    (postEl.getAttribute && postEl.getAttribute("role") === "article" ? postEl : findPostArticle(postEl));

  if (container && SITE === "facebook") {
    // 1. Ads about link (strongest signal, confidence 95)
    if (container.querySelector('a[href*="/ads/about"], a[href*="about_ads"], a[href*="adchoices"], a[href*="/ads/preferences"]')) {
      result.isSponsored = true;
      result.reasons.push("ads_about_link");
      result.confidence = Math.max(result.confidence, 95);
    }

    // 2. "Why am I seeing this?" link (confidence 90)
    if (container.querySelector('a[aria-label*="Why am I seeing"], a[aria-label*="Tại sao tôi"], a[aria-label*="Vì sao"]')) {
      result.isSponsored = true;
      result.reasons.push("why_am_i_seeing");
      result.confidence = Math.max(result.confidence, 90);
    }

    // 3. Portal-based detection (confidence 85-95)
    const SPONSORED_NORM = SPONSORED_KEYWORDS.map(kw => kw.replace(/\s+/g, "").toLowerCase());
    const ariaRefs = container.querySelectorAll("[aria-describedby],[aria-labelledby]");
    for (const ref of ariaRefs) {
      const ids = ((ref.getAttribute("aria-describedby") || "") + " " + (ref.getAttribute("aria-labelledby") || "")).trim().split(/\s+/);
      for (const id of ids) {
        if (!id) continue;
        const portal = document.getElementById(id);
        if (!portal) continue;
        const tcNorm = (portal.textContent || "").replace(/\s+/g, "").toLowerCase();
        if (SPONSORED_NORM.some(kw => tcNorm === kw || tcNorm.startsWith(kw))) {
          result.isSponsored = true;
          result.reasons.push("portal_label");
          result.confidence = Math.max(result.confidence, 90);
          result.details.portalText = portal.textContent;
          break;
        }
      }
      if (result.isSponsored) break;
    }

    // 4. aria-label substring scan (confidence 70-85)
    if (!result.isSponsored) {
      const ariaLabelEls = container.querySelectorAll("[aria-label]");
      for (const el of ariaLabelEls) {
        const lbl = (el.getAttribute("aria-label") || "").replace(/\s+/g, "").toLowerCase();
        if (lbl.length < 3 || lbl.length > 120) continue;
        if (SPONSORED_NORM.some(kw => lbl.includes(kw))) {
          result.isSponsored = true;
          result.reasons.push("aria_label");
          result.confidence = Math.max(result.confidence, 75);
          break;
        }
      }
    }

    // 5. Text scan fallback (confidence 50-70)
    if (!result.isSponsored) {
      const candidates = container.querySelectorAll('a, span, div[dir="auto"]');
      for (const node of candidates) {
        const tc = node.textContent || "";
        const tcNorm = tc.replace(/\s+/g, "").toLowerCase();
        if (tcNorm.length < 2 || tcNorm.length > 40) continue;
        if (SPONSORED_NORM.some(kw => tcNorm === kw || tcNorm.startsWith(kw))) {
          result.isSponsored = true;
          result.reasons.push("sponsored_keyword");
          result.confidence = Math.max(result.confidence, 60);
          break;
        }
      }
    }
  }

  // === AFFILIATE DETECTION ===
  if (container) {
    // 1. Image click-out with affiliate/shortener link (confidence 70-85)
    const imageClickout = _detectImageClickout(container);
    if (imageClickout) {
      result.isAffiliate = true;
      result.reasons.push(imageClickout.reason);
      result.confidence = Math.max(result.confidence, imageClickout.reason === "affiliate_domain" ? 85 : 70);
      result.details.imageClickout = imageClickout;
    }

    // 2. Direct affiliate links in text (confidence 80-90)
    const links = container.querySelectorAll('a[href]');
    for (const link of links) {
      const affiliate = _detectAffiliateUrl(link.href);
      if (affiliate) {
        result.isAffiliate = true;
        result.reasons.push(affiliate.reason);
        result.confidence = Math.max(result.confidence, affiliate.reason === "affiliate_domain" ? 85 : 70);
        result.details.affiliateLink = affiliate;
        break;
      }
    }

    // 3. Affiliate text detection (confidence 50-65)
    if (!result.isAffiliate) {
      const textAffiliate = _detectAffiliateText(container);
      if (textAffiliate) {
        result.isAffiliate = true;
        result.reasons.push(textAffiliate.reason);
        result.confidence = Math.max(result.confidence, 55);
        result.details.affiliateText = textAffiliate;
      }
    }
  }

  // Dedupe reasons
  result.reasons = [...new Set(result.reasons)];

  return result;
}

// Display modes for blocked content
const DISPLAY_MODES = {
  HIDE: "hide",       // Completely hidden
  COLLAPSE: "collapse", // Show indicator with reason
  MARK: "mark",       // Just highlight, don't hide
};

window.fbsExtractPermalink = extractPostPermalink;
window.fbsExtractAuthor = extractPostAuthor;
window.fbsExtractImage = extractPostImage;
window.fbsExtractImages = extractPostImages;
window.fbsEvaluatePostSignals = evaluatePostSignals;
window.fbsDisplayModes = DISPLAY_MODES;

