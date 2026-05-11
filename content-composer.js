"use strict";

// --- COMPOSER & AUTO-POST ---

function openFacebookComposer(text, sourceUrl, imageUrl, author, source, allImages) {
  const preview = document.createElement("div");
  preview.className = "fbs-status-preview";

  // Normalize allImages: ensure it's an array with primary imageUrl first
  const imageList = Array.isArray(allImages) && allImages.length > 0
    ? allImages.slice(0, 10)
    : (imageUrl ? [imageUrl] : []);
  // Ensure primary imageUrl luôn ở đầu để backward compat với old code
  if (imageUrl && !imageList.includes(imageUrl)) imageList.unshift(imageUrl);

  // Validate author/source — bỏ nếu chứa ký tự rác (FB anti-scraping)
  const isValidName = (n) =>
    n &&
    n.length >= 2 &&
    n.length < 80 &&
    !/[a-f0-9]{10,}/i.test(n) &&
    !/\d{8,}/.test(n) &&
    n.split(/\s+/).length <= 10;
  const cleanAuthor = isValidName(author) ? author : "";
  const cleanSource = isValidName(source) ? source : "";

  // Ảnh preview: nếu có nhiều ảnh → gallery lưới; nếu 1 ảnh → single preview
  let imgHtml = "";
  if (imageList.length > 1) {
    // Multi-image gallery — tất cả ảnh checked by default, user có thể uncheck
    const thumbsHtml = imageList.map((url, i) =>
      '<label class="fbs-sp-thumb"><input type="checkbox" class="fbs-sp-thumb-cb" data-url="' +
      esc(url) + '" checked><img src="' + esc(url) + '" loading="lazy" onerror="this.parentElement.style.display=\'none\'"></label>'
    ).join("");
    imgHtml =
      '<div class="fbs-sp-image fbs-sp-multi">' +
      '<div class="fbs-sp-multi-header">' + imageList.length + ' ảnh — bỏ tick ảnh không muốn đăng</div>' +
      '<div class="fbs-sp-thumbs">' + thumbsHtml + '</div>' +
      '</div>';
  } else if (imageList.length === 1) {
    imgHtml = '<div class="fbs-sp-image"><img src="' +
      esc(imageList[0]) +
      '" crossorigin="anonymous" onerror="this.parentElement.style.display=\'none\'"><button class="fbs-sp-copy-img"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> Copy ảnh</button></div>';
  }

  preview.innerHTML =
    '<div class="fbs-sp-header"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Preview Status <span class="fbs-sp-charcount">' +
    text.length +
    " ký tự</span></div>" +
    imgHtml +
    '<div class="fbs-sp-text">' +
    esc(text).replace(/\n/g, "<br>") +
    "</div>" +
    '<div class="fbs-sp-link-input">' +
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;opacity:0.5"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>' +
    '<input type="text" class="fbs-sp-link-field" placeholder="Paste link bài gốc (ghi nguồn ở comment đầu)" value="' +
    esc(sourceUrl || "") +
    '">' +
    "</div>" +
    (cleanAuthor
      ? '<div class="fbs-sp-detected-source"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> ' +
        esc(cleanAuthor) +
        (cleanSource && cleanSource !== cleanAuthor
          ? ' <span class="fbs-sp-source-group">(' +
            esc(cleanSource) +
            ")</span>"
          : "") +
        "</div>"
      : "") +
    '<div class="fbs-sp-comment" style="display:none">' +
    '<div class="fbs-sp-comment-label">Comment đầu tiên (ghi nguồn):</div>' +
    '<div class="fbs-sp-comment-text"></div>' +
    '<button class="fbs-sp-copy-comment"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy nguồn</button>' +
    "</div>" +
    '<div class="fbs-sp-actions">' +
    '<button class="fbs-sp-open-fb"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg> Đăng status</button>' +
    "</div>";

  panelBody.appendChild(preview);
  panelBody.scrollTop = panelBody.scrollHeight;

  const footer = panel.querySelector(".fbs-panel-footer");
  if (footer) footer.style.display = "none";

  const linkField = preview.querySelector(".fbs-sp-link-field");
  const commentSection = preview.querySelector(".fbs-sp-comment");
  const commentText = preview.querySelector(".fbs-sp-comment-text");

  // Generate comment content từ link — ghi nguồn kèm tên tác giả nếu có
  // LUÔN hiển thị section comment (kể cả khi chưa có URL) để user biết
  // cần paste link. Nếu thiếu link mà có author/source → vẫn show "Nguồn: X"
  function updateComment(url) {
    // Luôn hiện section comment — giúp user thấy rõ cần ghi nguồn
    commentSection.style.display = "block";
    // Build source line: "Nguồn: Tên tác giả — link" hoặc "Nguồn: link"
    let sourceLine = "Nguồn: ";
    if (cleanAuthor) {
      sourceLine += cleanAuthor;
      if (cleanSource && cleanSource !== cleanAuthor)
        sourceLine += " (" + cleanSource + ")";
      if (url) sourceLine += "\n" + url;
    } else if (cleanSource) {
      sourceLine += cleanSource;
      if (url) sourceLine += "\n" + url;
    } else if (url) {
      sourceLine += url;
    } else {
      // Không có gì cả → hint user paste link
      sourceLine = "Nguồn: (chưa có — paste link vào ô phía trên)";
    }
    commentText.textContent = sourceLine;
  }

  // LUÔN render section comment ngay khi mở composer — kể cả khi chưa có link
  updateComment(sourceUrl || "");

  // Normalize Facebook URL
  function normalizeFbUrl(raw) {
    try {
      const u = new URL(raw);
      if (u.hostname.includes("facebook.com")) {
        const mp = u.searchParams.get("multi_permalinks");
        if (mp && u.pathname.includes("/groups/")) {
          return (
            u.origin + u.pathname.replace(/\/$/, "") + "/posts/" + mp + "/"
          );
        }
        const sfid = u.searchParams.get("story_fbid");
        const uid = u.searchParams.get("id");
        if (sfid && uid) {
          return u.origin + "/" + uid + "/posts/" + sfid + "/";
        }
        return u.origin + u.pathname;
      }
      // Non-FB: strip tracking
      for (const k of [...u.searchParams.keys()]) {
        if (
          k.startsWith("utm_") ||
          k.startsWith("__") ||
          ["fbclid", "gclid", "ref"].includes(k)
        )
          u.searchParams.delete(k);
      }
      return u.toString().replace(/\?$/, "");
    } catch (_) {
      return raw;
    }
  }

  // Auto-normalize khi paste link
  linkField.addEventListener("paste", () => {
    setTimeout(() => {
      const url = linkField.value.trim();
      if (!url) return;
      const clean = normalizeFbUrl(url);
      linkField.value = clean;
      updateComment(clean);
    }, 50);
  });

  // Cũng update khi user gõ tay
  linkField.addEventListener("input", () => {
    const url = linkField.value.trim();
    updateComment(url);
  });

  function autoPasteToLexical(element, text, file = null) {
    element.focus();
    const dataTransfer = new DataTransfer();
    dataTransfer.setData("text/plain", text);
    if (file) dataTransfer.items.add(file);
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  }

  // Copy comment (ghi nguồn)
  preview
    .querySelector(".fbs-sp-copy-comment")
    .addEventListener("click", async () => {
      const btn = preview.querySelector(".fbs-sp-copy-comment");
      const content = commentText.textContent;
      if (!content) return;
      await navigator.clipboard.writeText(content);

      btn.innerHTML =
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> ...';

      let posted = false;
      if (SITE === "facebook") {
        const commentBoxes = Array.from(
          document.querySelectorAll(
            'div[role="textbox"][contenteditable="true"]',
          ),
        ).filter((el) => {
          const label = (el.getAttribute("aria-label") || "").toLowerCase();
          return (
            label.includes("viết bình luận") ||
            label.includes("comment") ||
            label.includes("trả lời")
          );
        });

        let targetBox = commentBoxes[0];
        if (lastSummarizeParams && lastSummarizeParams._element) {
          const postEl =
            lastSummarizeParams._element.closest('[role="article"]');
          if (postEl) {
            const boxInPost = postEl.querySelector(
              'div[role="textbox"][contenteditable="true"]',
            );
            if (boxInPost) targetBox = boxInPost;
          }
        }

        if (targetBox) {
          autoPasteToLexical(targetBox, content);
          setTimeout(() => {
            targetBox.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "Enter",
                code: "Enter",
                keyCode: 13,
                which: 13,
                bubbles: true,
              }),
            );
          }, 500);
          posted = true;
        }
      }

      if (posted) {
        btn.innerHTML =
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Đã tự cmt!';
      } else {
        btn.innerHTML =
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Đã copy!';
      }
      setTimeout(() => {
        btn.innerHTML =
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy nguồn';
      }, 2500);
    });

  // Copy ảnh
  const copyImgBtn = preview.querySelector(".fbs-sp-copy-img");
  if (copyImgBtn) {
    copyImgBtn.addEventListener("click", async () => {
      try {
        copyImgBtn.innerHTML =
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> ...';
        const imgEl = preview.querySelector(".fbs-sp-image img");
        const canvas = document.createElement("canvas");
        canvas.width = imgEl.naturalWidth;
        canvas.height = imgEl.naturalHeight;
        canvas.getContext("2d").drawImage(imgEl, 0, 0);
        const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob }),
        ]);
        copyImgBtn.innerHTML =
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Đã copy!';
        setTimeout(() => {
          copyImgBtn.innerHTML =
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> Copy ảnh';
        }, 2500);
      } catch (_) {
        window.open(imageUrl, "_blank");
        copyImgBtn.innerHTML =
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg> Mở tab mới';
        setTimeout(() => {
          copyImgBtn.innerHTML =
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> Copy ảnh';
        }, 2000);
      }
    });
  }

  // Đăng status — chỉ tự động hóa: mở composer + paste text + paste ảnh.
  // User tự click "Đăng" và tự comment nguồn (đã copy sẵn vào clipboard).
  preview
    .querySelector(".fbs-sp-open-fb")
    .addEventListener("click", async () => {
      const btn = preview.querySelector(".fbs-sp-open-fb");
      if (SITE !== "facebook") {
        await navigator.clipboard.writeText(text);
        btn.innerHTML =
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied (FB only supported)';
        return;
      }

      btn.disabled = true;
      btn.innerHTML =
        '<div class="fbs-spinner" style="width:14px;height:14px;border-width:2px"></div> Mở Composer...';

      const setStatus = (msg) => {
        btn.innerHTML = '<div class="fbs-spinner" style="width:14px;height:14px;border-width:2px"></div> ' + msg;
      };
      const setDone = (msg) => {
        btn.disabled = false;
        btn.innerHTML =
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> ' + msg;
      };
      const setFail = (msg) => {
        btn.disabled = false;
        btn.innerHTML =
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> ' + msg;
      };

      try {
        // Prep comment text để copy vào clipboard (user tự paste khi cmt)
        let sourceLine = "Nguồn: ";
        if (cleanAuthor) {
          sourceLine += cleanAuthor;
          if (cleanSource && cleanSource !== cleanAuthor) sourceLine += " (" + cleanSource + ")";
          if (sourceUrl) sourceLine += "\n" + sourceUrl;
        } else if (cleanSource) {
          sourceLine += cleanSource;
          if (sourceUrl) sourceLine += "\n" + sourceUrl;
        } else if (sourceUrl) {
          sourceLine += sourceUrl;
        } else {
          sourceLine = "";
        }

        // Bước 1: Xác định ảnh user muốn đăng
        let selectedUrls = [];
        const thumbCheckboxes = preview.querySelectorAll(".fbs-sp-thumb-cb");
        if (thumbCheckboxes.length > 0) {
          selectedUrls = Array.from(thumbCheckboxes)
            .filter(cb => cb.checked)
            .map(cb => cb.dataset.url)
            .filter(Boolean);
        } else if (imageList.length > 0) {
          selectedUrls = imageList;
        }

        // Bước 2: Tìm và click nút "Bạn đang nghĩ gì?"
        const allButtons = document.querySelectorAll('div[role="main"] div[role="button"]');
        let composerBtn = null;
        for (const b of allButtons) {
          const t = (b.textContent || "").toLowerCase();
          if (t.includes("bạn đang nghĩ gì") ||
              t.includes("what's on your mind") ||
              t.includes("write something") ||
              t.includes("viết gì đó")) {
            composerBtn = b;
            break;
          }
        }
        if (!composerBtn) {
          window.scrollTo({ top: 0, behavior: "smooth" });
          setFail("Không thấy ô 'Bạn đang nghĩ gì?' — cuộn lên đầu feed rồi thử lại");
          return;
        }
        composerBtn.click();

        // Bước 3: Chờ editor xuất hiện
        setStatus("Chờ dialog mở...");
        let editor = null;
        for (let i = 0; i < 25 && !editor; i++) {
          editor = document.querySelector(
            'div[role="dialog"] div[role="textbox"][contenteditable="true"]'
          );
          if (!editor) await new Promise(r => setTimeout(r, 200));
        }
        if (!editor) {
          setFail("Không tìm thấy editor");
          return;
        }
        editor.click();
        editor.focus();
        await new Promise(r => setTimeout(r, 600));

        // Bước 4: Fetch ảnh parallel
        let imgFiles = [];
        if (selectedUrls.length > 0) {
          setStatus("Tải " + selectedUrls.length + " ảnh...");
          imgFiles = await fetchImageBlobs(selectedUrls, 10);
          console.log("[Manual Post] Fetched", imgFiles.length, "/", selectedUrls.length, "images");
        }

        // Bước 5: Paste text + ảnh
        setStatus("Dán nội dung...");
        const cleanedText = text.replace(
          /\s*(?:[—-]\s*\n\s*)?Nguồn\s+dưới\s+cmt\s+đầu\s*$/gi,
          ""
        ).trim();
        const textWithFooter = cleanedText + "\n\n—\nNguồn dưới cmt đầu";
        pasteToLexical(editor, textWithFooter, imgFiles.length > 0 ? imgFiles : null);

        // Chờ upload hoàn tất (để user thấy ảnh đã render trước khi bấm Đăng)
        const uploadWait = imgFiles.length > 1 ? 1500 + imgFiles.length * 1000 :
                          imgFiles.length === 1 ? 2000 : 800;
        await new Promise(r => setTimeout(r, uploadWait));

        // Bước 6: Copy câu "Nguồn:" vào clipboard để user paste khi comment
        // User TỰ bấm "Đăng" và TỰ comment.
        if (sourceLine) {
          try {
            await navigator.clipboard.writeText(sourceLine);
            setDone("Sẵn sàng — bấm Đăng, rồi Ctrl+V ở cmt");
          } catch (_) {
            setDone("Sẵn sàng — bấm Đăng (Copy nguồn thủ công)");
          }
        } else {
          setDone("Sẵn sàng — bấm Đăng");
        }
      } catch (err) {
        console.error("[Manual Post] Error:", err);
        setFail("Lỗi: " + (err.message || err));
      }
    });
}

function pasteToLexical(element, text, file = null) {
  element.focus();
  // Paste text trước (không kèm file — Facebook sẽ bỏ text nếu có file)
  if (text) {
    const dtText = new DataTransfer();
    dtText.setData("text/plain", text);
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: dtText,
        bubbles: true,
        cancelable: true,
      }),
    );
  }
  // Paste file riêng sau (nếu có). Hỗ trợ cả single file và array of files.
  if (file) {
    const files = Array.isArray(file) ? file : [file];
    if (files.length === 0) return;
    setTimeout(() => {
      element.focus();
      const dtFile = new DataTransfer();
      for (const f of files) {
        if (f) dtFile.items.add(f);
      }
      if (dtFile.files.length === 0) return;
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: dtFile,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, 500);
  }
}

window.fbsAgentPost = async function (summaryText, imageUrl, rawSourceUrl, postElement) {
  if (SITE !== "facebook") return { ok: false, reason: "not_facebook" };

  const cleanUrl = cleanSourceUrl(rawSourceUrl);
  // Lấy author + source (group/page name) từ DOM
  const postAuthor =
    postElement && typeof window.fbsExtractAuthor === "function"
      ? window.fbsExtractAuthor(postElement)
      : "";
  const postSource =
    postElement && typeof extractPostSource === "function"
      ? extractPostSource(postElement)
      : "";

  // LUÔN tạo commentText — bắt buộc comment nguồn
  let commentText = "";
  // URL hữu ích: phải có permalink pattern (không chỉ là homepage FB hoặc URL ngắn)
  // Giảm threshold từ 30 → 25 để bắt được group URL có slug ngắn
  const hasPostPattern = cleanUrl && (
    cleanUrl.includes("/posts/") ||
    cleanUrl.includes("/permalink") ||
    cleanUrl.includes("story_fbid") ||
    cleanUrl.includes("pfbid") ||
    cleanUrl.includes("multi_permalinks") ||
    cleanUrl.includes("/videos/") ||
    cleanUrl.includes("/photos/")
  );
  const isUsefulUrl = cleanUrl &&
    cleanUrl !== "https://www.facebook.com" &&
    cleanUrl !== "https://www.facebook.com/" &&
    (hasPostPattern || cleanUrl.length > 30);

  if (isUsefulUrl) {
    // Có link chính xác → dùng link + tên tác giả
    commentText = buildCommentText(cleanUrl, postAuthor, postSource);
  } else {
    // Không có link chính xác → build comment từ thông tin có sẵn
    // Sử dụng buildCommentText để format nhất quán
    let fallbackUrl = "";
    if (cleanUrl && cleanUrl.length > 20) {
      fallbackUrl = cleanUrl;
    } else {
      // Dùng URL trang hiện tại nếu có ý nghĩa (group/page/profile)
      const pageUrl = location.href;
      if (pageUrl.includes("/groups/") || pageUrl.includes("/pages/") || pageUrl.match(/facebook\.com\/[^\/?]+\/?$/)) {
        fallbackUrl = pageUrl.split("?")[0];
      }
    }

    if (fallbackUrl) {
      commentText = buildCommentText(fallbackUrl, postAuthor, postSource);
    } else {
      // Không có URL nào → vẫn build comment với author/source (không link)
      const isValidName = (n) => n && n.length >= 2 && n.length < 80 && !/[a-f0-9]{10,}/i.test(n) && !/\d{8,}/.test(n);
      const a = isValidName(postAuthor) ? postAuthor : "";
      const s = isValidName(postSource) ? postSource : "";
      if (a) {
        commentText = "Nguồn: " + a + (s && s !== a ? " (" + s + ")" : "");
      } else if (s) {
        commentText = "Nguồn: " + s;
      } else {
        commentText = "Nguồn: Facebook";
      }
    }
  }
  console.log("[Agent] Comment text prepared:", commentText);
  console.log("[Agent] Author:", postAuthor || "(unknown)", "| Source:", postSource || "(unknown)", "| URL:", cleanUrl || "(none)");

  // Build final post text
  // AI thường đã include "—\nNguồn dưới cmt đầu" theo prompt yêu cầu.
  // Strip mọi instance có sẵn (nhiều format) rồi append đúng 1 lần.
  let postText = summaryText.trim();
  // Regex: match "—\nNguồn dưới cmt đầu" hoặc "-\nNguồn dưới cmt đầu" hoặc
  // chỉ "Nguồn dưới cmt đầu" ở cuối (có thể có/không dấu gạch), case-insensitive
  postText = postText.replace(
    /\s*(?:[—-]\s*\n\s*)?Nguồn\s+dưới\s+cmt\s+đầu\s*$/gi,
    ""
  ).trim();
  // Append đúng 1 lần footer chuẩn
  postText += "\n\n—\nNguồn dưới cmt đầu";

  console.log("[Agent] fbsAgentPost called:", {
    textLength: postText.length,
    textPreview: postText.substring(0, 80),
    hasImage: !!imageUrl,
    sourceUrl: cleanUrl || "(none)",
    hasComment: !!commentText,
  });

  // Step 1: Mở FB Composer (click "Bạn đang nghĩ gì?")
  const mainArea = document.querySelector('div[role="main"]');
  if (!mainArea) return { ok: false, reason: "no_main_area" };

  const allButtons = mainArea.querySelectorAll('div[role="button"]');
  let composerBtn = null;
  for (const b of allButtons) {
    const t = (b.textContent || "").toLowerCase();
    if (
      t.includes("bạn đang nghĩ gì") ||
      t.includes("what's on your mind") ||
      t.includes("write something") ||
      t.includes("viết gì đó") ||
      t.includes("chia sẻ điều gì") ||
      t.includes("say something")
    ) {
      composerBtn = b;
      break;
    }
  }
  if (!composerBtn) return { ok: false, reason: "no_composer_btn" };
  composerBtn.click();

  // Step 2: Chờ dialog mở, tìm editor (poll trong 5s)
  let editor = null;
  for (let i = 0; i < 25; i++) {
    editor = document.querySelector(
      'div[role="dialog"] div[role="textbox"][contenteditable="true"]',
    );
    if (editor) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!editor) {
    console.error("[Agent] Không tìm thấy Editor TextBox.");
    return { ok: false, reason: "no_editor" };
  }

  // Kích hoạt Lexical bằng cách click & focus trước khi paste
  editor.click();
  editor.focus();
  await new Promise((r) => setTimeout(r, 1000));

  // Step 3: Fetch image blobs — agent cố lấy TẤT CẢ ảnh từ bài gốc
  // để post giống bài gốc nhất có thể. Fetch song song để tiết kiệm thời gian.
  let imgFiles = [];
  try {
    // Lấy danh sách tất cả ảnh từ postElement (bao gồm bài share gốc)
    let allImages = [];
    if (postElement && typeof window.fbsExtractImages === "function") {
      allImages = window.fbsExtractImages(postElement);
    } else if (imageUrl) {
      allImages = [imageUrl];
    }
    // Ensure imageUrl (primary) là ảnh đầu tiên nếu có
    if (imageUrl && !allImages.includes(imageUrl)) {
      allImages.unshift(imageUrl);
    }
    if (allImages.length > 0) {
      console.log("[Agent] Fetching", allImages.length, "image(s) in parallel...");
      imgFiles = await fetchImageBlobs(allImages, 10);
      console.log("[Agent] Fetched", imgFiles.length, "image file(s) successfully");
    }
  } catch (imgErr) {
    console.warn("[Agent] Multi-image fetch failed, fallback to single:", imgErr.message);
    const singleFile = await fetchImageBlob(imageUrl);
    if (singleFile) imgFiles = [singleFile];
  }

  // Step 4: Paste text (+ images) — giả lập gõ chậm
  console.log("[Agent] Pasting text...", { length: postText.length, images: imgFiles.length });
  pasteToLexical(editor, postText, imgFiles.length > 0 ? imgFiles : null);
  // Chờ text render + image upload (multi-image cần nhiều thời gian hơn)
  const uploadWaitMs = imgFiles.length > 1 ? 3000 + imgFiles.length * 1500 :
                      imgFiles.length === 1 ? 5000 : 3000;
  await new Promise((r) => setTimeout(r, uploadWaitMs));

  // Step 5: Chờ nút Tiếp hoặc Đăng native không bị disabled (đợi upload ảnh)
  let fbPostBtn = null;
  let isNextBtn = false;
  for (let i = 0; i < 20; i++) {
    fbPostBtn = document.querySelector(
      'div[aria-label="Tiếp"][role="button"], div[aria-label="Next"][role="button"], div[aria-label="Đăng"][role="button"], div[aria-label="Post"][role="button"]',
    );
    if (fbPostBtn && fbPostBtn.getAttribute("aria-disabled") !== "true") {
      const label = fbPostBtn.getAttribute("aria-label");
      isNextBtn = label === "Tiếp" || label === "Next";
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!fbPostBtn) {
    console.error("[Agent] Không tìm thấy nút Đăng/Tiếp.");
    return { ok: false, reason: "no_post_btn" };
  }
  // Giả lập review trước khi đăng (2-4s)
  await new Promise((r) => setTimeout(r, 2000 + Math.random() * 2000));
  console.log("[Agent] Clicking post button...");
  fbPostBtn.click();

  // Nếu phải qua bước "Tiếp" (Next), chờ màn hình tiếp theo và bấm "Đăng"
  if (isNextBtn) {
    await new Promise((r) => setTimeout(r, 1000 + Math.random() * 500));
    let finalPostBtn = null;
    for (let i = 0; i < 15; i++) {
      finalPostBtn = document.querySelector(
        'div[aria-label="Đăng"][role="button"], div[aria-label="Post"][role="button"]',
      );
      if (
        finalPostBtn &&
        finalPostBtn.getAttribute("aria-disabled") !== "true"
      )
        break;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (finalPostBtn) {
      finalPostBtn.click();
    } else {
      console.error(
        "[Agent] Mắc kẹt sau khi bấm Tiếp, không tìm thấy nút Đăng.",
      );
      return { ok: false, reason: "no_final_post_btn" };
    }
  }

  // Step 6: Chờ post xuất hiện trên Feed
  console.log("[Agent] === STEP 6: Bài đã đăng, chờ feed refresh ===");
  console.log("[Agent] commentText:", commentText.substring(0, 80));
  await new Promise((r) => setTimeout(r, 10000));

  // Step 7: Comment nguồn — bài vừa đăng nằm ngay đầu feed
  {
    try {
      console.log("[Agent] === STEP 7: Comment nguồn ===");

      // Tìm nút "Viết bình luận" trực tiếp bằng aria-label (chính xác nhất)
      let commentBtn = null;
      let commentBox = null;

      // Tăng thời gian poll lên 20s (40 * 500ms) — bài vừa đăng có thể cần
      // thời gian để render xong trong feed, đặc biệt khi có ảnh
      for (let poll = 0; poll < 40 && !commentBtn && !commentBox; poll++) {
        // Ưu tiên: tìm aria-label="Viết bình luận" hoặc "Write a comment"
        commentBtn = document.querySelector('[aria-label="Viết bình luận"][role="button"]') ||
                     document.querySelector('[aria-label="Write a comment"][role="button"]') ||
                     document.querySelector('[aria-label="Comment"][role="button"]') ||
                     // Variant: "Bình luận" only (không có "Viết")
                     document.querySelector('[aria-label="Bình luận"][role="button"]:not([aria-label*="Xem"])');
        // Hoặc comment box đã mở sẵn
        if (!commentBtn) {
          commentBox = document.querySelector('div[role="textbox"][contenteditable="true"][aria-label*="bình luận"]') ||
                       document.querySelector('div[role="textbox"][contenteditable="true"][aria-label*="comment"]') ||
                       document.querySelector('div[role="textbox"][contenteditable="true"][aria-label*="Bình luận"]');
        }
        if (!commentBtn && !commentBox) await new Promise((r) => setTimeout(r, 500));
      }

      if (commentBox) {
        console.log("[Agent] Comment box already open!");
      } else if (commentBtn) {
        console.log("[Agent] Found 'Viết bình luận' button, clicking...");
        commentBtn.scrollIntoView({ behavior: "smooth", block: "center" });
        await new Promise((r) => setTimeout(r, 1000));
        commentBtn.click();
        await new Promise((r) => setTimeout(r, 3000));

        // Poll tìm comment textbox sau khi click (có thể trong dialog) — 15s
        for (let poll = 0; poll < 30 && !commentBox; poll++) {
          // Chính xác nhất: data-lexical-editor textbox
          commentBox = document.querySelector('[data-lexical-editor="true"][role="textbox"][contenteditable="true"]');
          // Fallback: aria-label chứa "Bình luận dưới tên"
          if (!commentBox) {
            commentBox = document.querySelector('[aria-label*="Bình luận dưới tên"][contenteditable="true"]') ||
                         document.querySelector('[aria-label*="Comment as"][contenteditable="true"]');
          }
          // Fallback: bất kỳ textbox contenteditable trong dialog
          if (!commentBox) {
            commentBox = document.querySelector('div[role="dialog"] div[contenteditable="true"][role="textbox"]');
          }
          // Fallback cuối: textbox cuối cùng trong document (thường là comment box mới mở)
          if (!commentBox) {
            const allBoxes = document.querySelectorAll('div[contenteditable="true"][role="textbox"]');
            if (allBoxes.length > 0) commentBox = allBoxes[allBoxes.length - 1];
          }
          if (!commentBox) await new Promise((r) => setTimeout(r, 500));
        }
      } else {
        console.warn("[Agent] ✗ Không tìm thấy nút 'Viết bình luận' sau 20s");
        console.warn("[Agent] ✗ Comment NGUỒN KHÔNG ĐƯỢC ĐĂNG — copy thủ công:", commentText);
        // Copy comment text vào clipboard để user có thể paste thủ công
        try {
          await navigator.clipboard.writeText(commentText);
          console.log("[Agent] Đã copy commentText vào clipboard để user paste thủ công");
        } catch (_) {}
      }

      if (commentBox) {
        console.log("[Agent] ✓ Comment box found! Pasting...");
        commentBox.click();
        commentBox.focus();
        await new Promise((r) => setTimeout(r, 1000));
        pasteToLexical(commentBox, commentText);
        await new Promise((r) => setTimeout(r, 2500));

        // Verify paste thành công — nếu commentBox rỗng thì retry 1 lần
        const pastedText = (commentBox.innerText || commentBox.textContent || "").trim();
        if (pastedText.length < 5) {
          console.warn("[Agent] Paste lần 1 thất bại, retry...");
          commentBox.click();
          commentBox.focus();
          await new Promise((r) => setTimeout(r, 500));
          pasteToLexical(commentBox, commentText);
          await new Promise((r) => setTimeout(r, 2000));
        }

        // Verify lần cuối — chỉ gửi Enter nếu có text
        const finalText = (commentBox.innerText || commentBox.textContent || "").trim();
        if (finalText.length >= 5) {
          // Gửi bằng Enter
          commentBox.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }),
          );
          await new Promise((r) => setTimeout(r, 2000));
          console.log("[Agent] ✓ Comment nguồn đã gửi!");
        } else {
          console.error("[Agent] ✗ Paste commentText failed sau 2 lần retry");
          console.error("[Agent] ✗ Comment NGUỒN KHÔNG ĐƯỢC ĐĂNG — copy thủ công:", commentText);
          try { await navigator.clipboard.writeText(commentText); } catch (_) {}
        }
      } else {
        console.warn("[Agent] ✗ Không tìm thấy ô comment");
      }
    } catch (commentErr) {
      console.error("[Agent] Lỗi khi comment:", commentErr.message);
    }
  }

  // Step 8: Đóng modal "Bài viết" mà Facebook mở sau khi đăng/comment
  // Facebook tự mở post dialog sau khi đăng — agent cần đóng để tiếp tục scroll feed.
  {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      // Ưu tiên: nút Đóng trong dialog (aria-label tiếng Việt và tiếng Anh)
      const closeBtn =
        document.querySelector('div[role="dialog"] [aria-label="Đóng"][role="button"]') ||
        document.querySelector('div[role="dialog"] [aria-label="Close"][role="button"]') ||
        document.querySelector('[aria-label="Đóng"][role="button"]') ||
        document.querySelector('[aria-label="Close"][role="button"]');
      if (closeBtn) {
        console.log("[Agent] Step 8: Đóng modal FB post");
        closeBtn.click();
        await new Promise((r) => setTimeout(r, 800));
      } else {
        // Fallback: Escape key
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }),
        );
        await new Promise((r) => setTimeout(r, 500));
      }
    } catch (_) {}
  }

  // Notify background → browser notification
  try {
    chrome.runtime.sendMessage({
      action: "agent-posted",
      preview: summaryText.substring(0, 100),
    });
  } catch (_) {}

  return { ok: true };
};

