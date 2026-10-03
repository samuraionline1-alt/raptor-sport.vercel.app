(function () {
  "use strict";

  const SUPABASE_URL = "https://jktnltfbyuvurhqmzhww.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_d1vo34cUZUX5F5PetGyVBg_rpEwqBbF";
  const API_URL = `${SUPABASE_URL}/rest/v1/product_reviews`;
  const PRODUCT_SLUGS = new Set([
    "raptor-warming-spray", "raptor-cooling-spray", "raptor-go-energy-gel",
    "raptor-dual-action-pack", "raptor-sport-therapy-oil", "raptor-speed-water-charge",
    "raptor-herbal-cooling-gel", "raptor-sport-foot-spray", "raptor-herbal-roll-on",
    "raptor-cool-patch", "raptor-ice-defense-sport-shampoo"
  ]);
  const BADGES = {
    Shopee: "✓ ผู้ซื้อจริงจาก Shopee Official Store",
    "TikTok Shop": "✓ ผู้ซื้อจริงจาก TikTok Shop",
    Website: "✓ ผู้สั่งซื้อจริงผ่านเว็บไซต์ทางการ",
    Lazada: "✓ ผู้ซื้อจริงจาก Lazada"
  };
  const headers = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

  function productSlug() {
    const match = location.pathname.match(/^\/products\/([^/]+)/);
    return match && PRODUCT_SLUGS.has(match[1]) ? match[1] : null;
  }

  function sanitizeReviewComment(slug, comment) {
    const text = String(comment ?? "");
    if (slug !== "raptor-cool-patch") return text;
    return text
      .replaceAll("แก้ปวดลดเมื่อย", "ช่วยผ่อนคลายความเมื่อยล้า")
      .replaceAll("สินค้าสรรพคุณดี", "สินค้าคุณภาพดี")
      .replaceAll("ลดอาการปวดได้ดีมาก", "ช่วยให้รู้สึกเย็นสบาย ผ่อนคลายความเมื่อยล้าได้ดีมาก");
  }

  function findProduct(value) {
    if (Array.isArray(value)) return value.map(findProduct).find(Boolean);
    if (!value || typeof value !== "object") return null;
    if (value["@type"] === "Product" || (Array.isArray(value["@type"]) && value["@type"].includes("Product"))) return value;
    return value["@graph"] ? findProduct(value["@graph"]) : null;
  }

  function syncJsonLd(reviews) {
    const script = [...document.querySelectorAll('script[type="application/ld+json"]')].find((node) => {
      try { return Boolean(findProduct(JSON.parse(node.textContent))); } catch (_) { return false; }
    });
    if (!script || !reviews.length) return;
    const data = JSON.parse(script.textContent);
    const product = findProduct(data);
    const average = reviews.reduce((sum, item) => sum + Number(item.rating), 0) / reviews.length;
    product.aggregateRating = { "@type": "AggregateRating", ratingValue: average.toFixed(1), reviewCount: reviews.length, bestRating: 5, worstRating: 1 };
    product.review = reviews.map((item) => ({
      "@type": "Review",
      author: { "@type": "Person", name: item.reviewer_name },
      datePublished: item.reviewed_at || item.created_at,
      reviewBody: item.comment,
      reviewRating: { "@type": "Rating", ratingValue: Number(item.rating), bestRating: 5, worstRating: 1 }
    }));
    script.textContent = JSON.stringify(data, null, 2);
  }

  function makeReviewCard(review) {
    const article = document.createElement("article");
    article.className = "review-card";
    const top = document.createElement("div");
    top.className = "review-card__top";
    const name = document.createElement("strong");
    name.textContent = review.reviewer_name;
    const stars = document.createElement("span");
    stars.className = "review-stars";
    stars.setAttribute("aria-label", `${review.rating} จาก 5 ดาว`);
    stars.textContent = "★".repeat(Number(review.rating)) + "☆".repeat(5 - Number(review.rating));
    top.append(name, stars);
    const badge = document.createElement("div");
    badge.className = "review-badge";
    badge.textContent = BADGES[review.source_platform] || "✓ รีวิวจากผู้ซื้อจริง";
    const comment = document.createElement("p");
    comment.textContent = review.comment;
    const date = document.createElement("time");
    const rawDate = review.reviewed_at || review.created_at;
    date.dateTime = rawDate;
    date.textContent = rawDate ? new Intl.DateTimeFormat("th-TH", { dateStyle: "long" }).format(new Date(rawDate)) : "";
    article.append(top, badge, comment, date);
    return article;
  }

  function sectionMarkup() {
    const section = document.createElement("section");
    section.id = "customer-reviews";
    section.className = "reviews-section";
    section.setAttribute("aria-labelledby", "customer-reviews-title");
    section.innerHTML = `
      <div class="reviews-inner">
        <div class="reviews-header">
          <h2 id="customer-reviews-title">รีวิวจากผู้ซื้อจริง</h2>
          <p class="reviews-summary" aria-live="polite">กำลังโหลดรีวิว...</p>
        </div>
        <div class="reviews-list"></div>
        <div class="review-form-host"></div>
      </div>`;
    return section;
  }

  function formMarkup() {
    const formArea = document.createElement("div");
    formArea.className = "review-form-area";
    formArea.innerHTML = `
          <button class="review-form-toggle" type="button" aria-expanded="false" aria-controls="review-submission-form">✍️ เขียนรีวิวสินค้า</button>
          <div class="review-form-card" id="review-submission-form" hidden>
          <h3>เขียนรีวิวสินค้า (ร่วมแบ่งปันประสบการณ์ใช้งานจริง)</h3>
          <form class="review-form">
            <div class="review-form-grid">
              <label>ชื่อผู้รีวิว<input name="reviewer_name" required maxlength="100" autocomplete="name"></label>
              <label>สั่งซื้อผ่านช่องทาง<select name="source_platform" required>
                <option value="Website">เว็บไซต์ทางการ</option>
                <option value="Shopee">Shopee</option>
                <option value="TikTok Shop">TikTok Shop</option>
                <option value="Lazada">Lazada</option>
              </select></label>
            </div>
            <fieldset><legend>เลือกคะแนน 1–5 ดาว</legend><div class="star-picker" role="radiogroup" aria-label="เลือกคะแนน 1–5 ดาว"></div></fieldset>
            <label>ข้อความรีวิว<textarea name="comment" rows="3" required maxlength="2000"></textarea></label>
            <div class="review-form-actions"><button type="submit">ส่งรีวิว</button><p class="review-form-status" role="status"></p></div>
          </form>
          </div>`;
    return formArea;
  }

  function setupFormToggle(section) {
    const toggle = section.querySelector(".review-form-toggle");
    const card = section.querySelector(".review-form-card");
    const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    toggle.addEventListener("click", () => {
      const opening = card.hidden;
      toggle.setAttribute("aria-expanded", String(opening));
      toggle.textContent = opening ? "✕ ปิดฟอร์มรีวิว" : "✍️ เขียนรีวิวสินค้า";
      if (opening) {
        card.hidden = false;
        if (!reduceMotion) card.animate(
          [{ opacity: 0, transform: "translateY(-8px)" }, { opacity: 1, transform: "translateY(0)" }],
          { duration: 200, easing: "ease-out" }
        );
      } else if (reduceMotion) {
        card.hidden = true;
      } else {
        const animation = card.animate(
          [{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(-8px)" }],
          { duration: 160, easing: "ease-in" }
        );
        animation.addEventListener("finish", () => { card.hidden = true; }, { once: true });
      }
    });
  }

  function setupStars(section) {
    const picker = section.querySelector(".star-picker");
    for (let rating = 5; rating >= 1; rating -= 1) {
      const input = document.createElement("input");
      input.type = "radio"; input.name = "rating"; input.value = rating; input.id = `review-rating-${rating}`;
      input.required = true; input.checked = rating === 5;
      const label = document.createElement("label");
      label.htmlFor = input.id; label.title = `${rating} ดาว`; label.textContent = "★";
      picker.append(input, label);
    }
  }

  async function init() {
    const slug = productSlug();
    if (!slug) return;
    let section = document.querySelector("#customer-reviews");
    if (!section) {
      section = sectionMarkup();
      const anchor = document.querySelector("aside[aria-labelledby='related-products-title']") || document.querySelector("footer");
      (anchor || document.body).insertAdjacentElement(anchor ? "beforebegin" : "beforeend", section);
    }
    const host = section.querySelector(".review-form-host") || section.querySelector(".reviews-inner");
    host.replaceChildren(formMarkup());
    setupStars(section);
    setupFormToggle(section);

    const summary = section.querySelector(".reviews-summary");
    try {
      const query = `?product_slug=eq.${encodeURIComponent(slug)}&is_approved=eq.true&order=reviewed_at.desc,created_at.desc`;
      const response = await fetch(API_URL + query, { headers });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const fetchedReviews = await response.json();
      const reviews = fetchedReviews.map((review) => ({
        ...review,
        comment: sanitizeReviewComment(slug, review.comment)
      }));
      const list = section.querySelector(".reviews-list");
      list.replaceChildren();
      if (reviews.length) {
        const average = reviews.reduce((sum, item) => sum + Number(item.rating), 0) / reviews.length;
        summary.textContent = `⭐ ${average.toFixed(1)}/5.0 จากรีวิวผู้ซื้อจริง ${reviews.length} รายการ`;
        reviews.forEach((review) => list.append(makeReviewCard(review)));
        syncJsonLd(reviews);
      } else {
        summary.textContent = "ยังไม่มีรีวิวที่เผยแพร่ เป็นคนแรกที่แบ่งปันประสบการณ์กับสินค้านี้";
      }
    } catch (error) {
      console.error("Unable to load product reviews", error);
      summary.textContent = "ไม่สามารถโหลดรีวิวได้ในขณะนี้ กรุณาลองใหม่ภายหลัง";
    }

    section.querySelector(".review-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector("button");
      const status = form.querySelector(".review-form-status");
      const fields = new FormData(form);
      button.disabled = true; status.textContent = "กำลังส่งรีวิว...";
      try {
        const response = await fetch(API_URL, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify({ product_slug: slug, reviewer_name: fields.get("reviewer_name").trim(), rating: Number(fields.get("rating")), comment: fields.get("comment").trim(), source_platform: fields.get("source_platform"), is_verified: true, is_approved: false })
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        form.reset(); form.querySelector('[value="5"]').checked = true;
        status.className = "review-form-status success";
        status.textContent = "ขอบคุณสำหรับรีวิวครับ! ระบบได้รับข้อมูลเรียบร้อยแล้ว รีวิวของคุณจะแสดงผลบนหน้าเว็บหลังผ่านการตรวจสอบ";
      } catch (error) {
        console.error("Unable to submit product review", error);
        status.className = "review-form-status error";
        status.textContent = "ขออภัย ไม่สามารถส่งรีวิวได้ กรุณาลองใหม่อีกครั้ง";
      } finally { button.disabled = false; }
    });
  }

  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", init) : init();
})();
