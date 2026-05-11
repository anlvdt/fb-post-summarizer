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



function findPostArticle(el) {
  let p = el;
  for (let i = 0; i < 25; i++) {
    p = p.parentElement;
    if (!p || p === document.body) return null;
    if (p.getAttribute("role") === "article") return p;
  }
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
    (el.getAttribute && el.getAttribute("role") === "article" ? el : findPostArticle(el));
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
  const nestedArticles = postContainer.querySelectorAll('[role="article"]');
  for (const nested of nestedArticles) {
    if (nested === postContainer) continue;
    // Phải là nested article trực tiếp (không phải comment hay reply sâu hơn)
    const parentArticle = nested.parentElement?.closest('[role="article"]');
    if (parentArticle && parentArticle !== postContainer) continue;
    // Bỏ qua comment (dùng _fbIsCommentArticle nếu có, nếu không có thì check form)
    if (nested.closest("form")) continue;
    let el = nested.parentElement;
    let isInList = false;
    for (let i = 0; i < 10 && el && el !== postContainer; i++) {
      const role = (el.getAttribute("role") || "").toLowerCase();
      if (role === "list" || role === "listitem" || el.tagName === "UL") { isInList = true; break; }
      el = el.parentElement;
    }
    if (isInList) continue;
    // Nested article phải có header riêng (h2/h3/h4 with a link) — mới coi là shared post
    const headers = nested.querySelectorAll("h2, h3, h4");
    for (const h of headers) {
      if (h.closest('[role="article"]') !== nested) continue;
      if (h.querySelector("a[href]")) return nested;
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

function _findPermalinkInContainer(container) {
  if (!container) return "";
  const allLinks = container.querySelectorAll("a[href]");
  const candidates = [];

  for (const link of allLinks) {
    let href = link.href || "";
    if (!href) continue;

    // Resolve l.facebook.com redirects
    href = _resolveFbRedirect(href);

    // Bỏ qua link rõ ràng không phải permalink
    if (href.includes("/photo") || href.includes("/reel/") || href.includes("/hashtag/") ||
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
    return _cleanFbUrl(candidates[0].href);
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
    // Tìm post ID từ data-ft (Facebook legacy data attribute)
    const dataFtEl = container.querySelector("[data-ft]");
    if (dataFtEl) {
      try {
        const ft = JSON.parse(dataFtEl.getAttribute("data-ft"));
        if (ft.top_level_post_id) {
          return groupUrl + "/posts/" + ft.top_level_post_id;
        }
        if (ft.mf_story_key) {
          return groupUrl + "/posts/" + ft.mf_story_key;
        }
      } catch (_) {}
    }

    // Tìm post ID từ aria attributes, id, hoặc data-*
    const idSources = [
      container.getAttribute("aria-describedby"),
      container.getAttribute("aria-labelledby"),
      container.id,
      container.getAttribute("data-story-id"),
      container.getAttribute("data-post-id"),
    ].filter(Boolean).join(" ");
    const idMatch = idSources.match(/(\d{10,})/);
    if (idMatch) {
      return groupUrl + "/posts/" + idMatch[1];
    }

    // Tìm hidden inputs có post ID
    const hiddenInputs = container.querySelectorAll(
      "input[type='hidden'], [data-story-id], [data-post-id], [data-testid*='post']"
    );
    for (const el of hiddenInputs) {
      const val = el.value ||
        el.getAttribute("data-story-id") ||
        el.getAttribute("data-post-id") ||
        el.getAttribute("data-testid") || "";
      const vMatch = val.match(/(\d{10,})/);
      if (vMatch) {
        return groupUrl + "/posts/" + vMatch[1];
      }
    }

    // Fallback: chỉ trả về group URL
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
      const idSources = [
        container.getAttribute("aria-describedby") || "",
        container.getAttribute("aria-labelledby") || "",
        container.id || "",
      ].join(" ");
      const postIdMatch = idSources.match(/(\d{10,})/);
      if (postIdMatch) {
        return "https://www.facebook.com/" + pageMatch[1] + "/posts/" + postIdMatch[1];
      }
      return "https://www.facebook.com/pages/" + pageMatch[0].split("/pages/")[1];
    }
  }

  // === FALLBACK CUỐI: Link profile tác giả ===
  for (const link of allLinks) {
    const href = link.href || "";
    if (href.includes("facebook.com") && (href.includes("/user/") || href.includes("/profile.php"))) {
      return _cleanFbUrl(href);
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
            if (name.length < 3 || name.length > 100) continue;
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
        if (name.length >= 3 && name.length < 100 && !/^\d+$/.test(name)) {
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
    // 1. Try to find original author from a shared/embedded post inside this article.
    //    This handles: personal share, group share, page share — all cases where
    //    someone shares another person's post. The outer header = sharer, inner = author.
    const originalAuthor = _fbFindOriginalAuthor(postContainer);
    if (originalAuthor) return originalAuthor;

    // 2. Not a shared post → author is in this article's own header.
    //    This handles: personal post, page post, group post (original, not shared).
    return _fbExtractAuthorFromContainer(postContainer);
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

function _extractAllImagesFromContainer(container) {
    const collected = []; // { src, area, priority }
    const seenSrcs = new Set();

    // Dedup helper: 2 URL là cùng 1 ảnh nếu sau khi strip size params chúng giống nhau
    // Facebook URL pattern: scontent-*.fbcdn.net/v/t1.../IMG_HASH_n.jpg?...
    function _normalizeSrc(src) {
      try {
        const u = new URL(src);
        // Giữ origin + pathname, bỏ query params (thường chứa thumbnail size)
        return u.origin + u.pathname;
      } catch (_) {
        return src;
      }
    }

    function _addIfUnique(src, area, priority) {
      if (!src || src.startsWith("data:")) return;
      if (src.includes("/rsrc.php/") || src.includes("emoji")) return;
      const key = _normalizeSrc(src);
      if (seenSrcs.has(key)) return;
      seenSrcs.add(key);
      collected.push({ src, area, priority });
    }

    // Strategy 1 (priority 1): images inside explicit photo/video link containers
    const photoLinks = container.querySelectorAll(
      'a[href*="/photo"], a[href*="/photos/"], a[href*="fbid="], a[href*="/reel/"], a[href*="/videos/"]',
    );
    for (const link of photoLinks) {
      const img = link.querySelector("img");
      if (!img) continue;
      const src = _imgSrc(img);
      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      if (w > 0 && w < 80) continue; // skip rất nhỏ
      _addIfUnique(src, w * h, 1);
    }

    // Strategy 2 (priority 2): background-image trong inline style
    const bgElements = container.querySelectorAll('[style*="background-image"]');
    for (const bgEl of bgElements) {
      const rect = bgEl.getBoundingClientRect();
      if (rect.width < 150 || rect.height < 150) continue;
      try {
        if (getComputedStyle(bgEl).borderRadius === "50%") continue;
      } catch (_) {}
      const style = bgEl.getAttribute("style") || "";
      const match = style.match(/background-image:\s*url\(["']?([^"')]+)["']?\)/);
      if (match && match[1]) {
        _addIfUnique(match[1], rect.width * rect.height, 2);
      }
    }

    // Strategy 3 (priority 3): large images not in avatar/header position
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

    // Sort: priority asc (1 = best), then area desc (larger first)
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
      // ƯU TIÊN 1: Bài share → ảnh bài gốc (nested article)
      const sharedInner = _findSharedPostArticle(postContainer);
      if (sharedInner) push(_extractAllImagesFromContainer(sharedInner));
      // ƯU TIÊN 2: Lấy tất cả ảnh từ post container chính
      push(_extractAllImagesFromContainer(postContainer));
      return results;
    } else {
      // Non-Facebook: original logic (single best)
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

function extractPostImage(element) {
  if (!element) return "";

  const postContainer = _findPostContainer(element);

  // Helper: get best src from img element (handles lazy-loaded srcset/data-src)
  function _imgSrc(img) {
    // Ưu tiên srcset (responsive) → dùng URL cuối (thường là highest res)
    const srcset = img.getAttribute("srcset") || img.getAttribute("data-srcset") || "";
    if (srcset) {
      const parts = srcset.split(",").map(s => s.trim().split(/\s+/)).filter(p => p[0]);
      if (parts.length > 0) {
        // Lấy URL có descriptor lớn nhất (w, x) hoặc cuối cùng
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

  // Helper: is this img likely an avatar/icon (circular or tiny)?
  

  // Helper: is this img inside the post header (avatar row)?
  function _isHeaderImg(img, container) {
    const headerEl = container.querySelector(
      "h2, h3, h4, [data-testid='story-subtitle'], [data-testid='post-header']"
    );
    if (headerEl && headerEl.contains(img)) return true;
    // Also skip profile-href links near top of post
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

  // Helper: extract ALL images from a specific container, sorted by area desc.
  // Returns an array of unique image URLs (highest quality variant each).
  

  // Internal helper returning array of URLs. extractPostImage() wraps this
  // and returns only the first for backward compat. extractPostImages() (plural)
  // is exposed for callers that need multi-image support.
  

  const allImages = _collectImages();
  if (allImages.length > 0) {
    // Attach to the function's returned string as expando for callers that can use it
    const primary = allImages[0];
    // Primary as return value (string) — backward compat
    // Expose all via a module-level variable for the same call
    _lastExtractedImages = allImages;
    return primary;
  }
  _lastExtractedImages = [];

  // Fallback: og:image
  const ogImage = document.querySelector('meta[property="og:image"]');
  if (ogImage && ogImage.content) return ogImage.content;

  return "";
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


window.fbsExtractPermalink = extractPostPermalink;
window.fbsExtractAuthor = extractPostAuthor;
window.fbsExtractImage = extractPostImage;
window.fbsExtractImages = extractPostImages;

