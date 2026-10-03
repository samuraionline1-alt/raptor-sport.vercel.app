import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://jktnltfbyuvurhqmzhww.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_d1vo34cUZUX5F5PetGyVBg_rpEwqBbF";
const PRODUCT_SLUGS = [
  "raptor-warming-spray", "raptor-cooling-spray", "raptor-go-energy-gel",
  "raptor-dual-action-pack", "raptor-sport-therapy-oil", "raptor-speed-water-charge",
  "raptor-herbal-cooling-gel", "raptor-sport-foot-spray", "raptor-herbal-roll-on",
  "raptor-cool-patch", "raptor-ice-defense-sport-shampoo"
];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const seedFile = path.join(root, "data", "verified-reviews-seed.json");
const START = "<!-- reviews-seo:start -->";
const END = "<!-- reviews-seo:end -->";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function findProduct(value) {
  if (Array.isArray(value)) return value.map(findProduct).find(Boolean);
  if (!value || typeof value !== "object") return null;
  const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
  if (types.includes("Product")) return value;
  return value["@graph"] ? findProduct(value["@graph"]) : null;
}

function reviewDate(review) {
  return review.reviewed_at || review.created_at;
}

function thaiDate(value) {
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "long", timeZone: "Asia/Bangkok" }).format(new Date(value));
}

function renderReviews(reviews) {
  const cards = reviews.map((review) => {
    const rating = Math.max(1, Math.min(5, Number(review.rating) || 5));
    const date = reviewDate(review);
    return `        <article class="review-card">
          <div class="review-card__top"><strong>${escapeHtml(review.reviewer_name)}</strong><span class="review-stars" aria-label="${rating} จาก 5 ดาว">${"★".repeat(rating)}${"☆".repeat(5 - rating)}</span></div>
          <span class="inline-flex items-center gap-1 text-[11px] text-orange-600 font-semibold bg-orange-50 px-2 py-0.5 rounded-full border border-orange-200">✓ ผู้ซื้อจริงผ่าน Shopee Official Store</span>
          <p>${escapeHtml(review.comment)}</p>
          <time datetime="${escapeHtml(date)}">${escapeHtml(thaiDate(date))}</time>
        </article>`;
  }).join("\n");
  const average = reviews.length
    ? reviews.reduce((sum, review) => sum + Number(review.rating), 0) / reviews.length
    : 0;
  const summary = reviews.length
    ? `⭐ ${average.toFixed(1)}/5.0 จากรีวิวผู้ซื้อจริง ${reviews.length} รายการ`
    : "ยังไม่มีรีวิวที่เผยแพร่ เป็นคนแรกที่แบ่งปันประสบการณ์กับสินค้านี้";
  return `${START}
  <section id="customer-reviews" class="reviews-section" aria-labelledby="customer-reviews-title">
    <div class="reviews-inner">
      <h2 id="customer-reviews-title">รีวิวจากผู้ซื้อจริง</h2>
      <p class="reviews-summary" aria-live="polite">${summary}</p>
      <div class="reviews-list">${cards ? `\n${cards}\n      ` : ""}</div>
      <div class="review-form-host"></div>
    </div>
  </section>
${END}`;
}

function updateVisibleReviews(html, reviews) {
  const section = renderReviews(reviews);
  const current = new RegExp(`${START}[\\s\\S]*?${END}`);
  if (current.test(html)) return html.replace(current, section);
  const anchor = /<aside\b[^>]*aria-labelledby=["']related-products-title["']/i;
  if (anchor.test(html)) return html.replace(anchor, `${section}\n$&`);
  return html.replace(/<footer\b/i, `${section}\n<footer`);
}

function updateProductJsonLd(html, reviews, slug) {
  let found = false;
  const updated = html.replace(/(<script\b[^>]*type=["']application\/ld\+json["'][^>]*>)([\s\S]*?)(<\/script>)/gi, (whole, open, json, close) => {
    if (found) return whole;
    let data;
    try { data = JSON.parse(json); } catch { return whole; }
    const product = findProduct(data);
    if (!product) return whole;
    found = true;
    delete product.aggregateRating;
    delete product.review;
    if (reviews.length) {
      const average = reviews.reduce((sum, review) => sum + Number(review.rating), 0) / reviews.length;
      product.aggregateRating = {
        "@type": "AggregateRating", ratingValue: average.toFixed(1), reviewCount: String(reviews.length),
        bestRating: "5", worstRating: "1"
      };
      product.review = reviews.map((review) => ({
        "@type": "Review",
        author: { "@type": "Person", name: review.reviewer_name },
        datePublished: reviewDate(review),
        reviewBody: review.comment,
        reviewRating: { "@type": "Rating", ratingValue: String(review.rating), bestRating: "5", worstRating: "1" }
      }));
    }
    return `${open}\n${JSON.stringify(data, null, 2)}\n${close}`;
  });
  if (!found) throw new Error(`No Product JSON-LD found for ${slug}`);
  return updated;
}

const endpoint = `${SUPABASE_URL}/rest/v1/product_reviews?is_approved=eq.true&order=reviewed_at.desc`;
let approvedReviews;
let usingSeed = false;
try {
  const response = await fetch(endpoint, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  approvedReviews = await response.json();
} catch (error) {
  usingSeed = true;
  approvedReviews = JSON.parse(await readFile(seedFile, "utf8"));
  console.warn(`Supabase review sync unavailable (${error.message}); using ${path.relative(root, seedFile)}.`);
}
if (!Array.isArray(approvedReviews)) throw new Error("Supabase returned an unexpected reviews response");

const grouped = approvedReviews.reduce((map, review) => {
  const items = map.get(review.product_slug) || [];
  items.push(review);
  map.set(review.product_slug, items);
  return map;
}, new Map());

let changed = 0;
const slugsToUpdate = usingSeed ? [...grouped.keys()] : PRODUCT_SLUGS;
for (const slug of slugsToUpdate) {
  const filename = path.join(root, "products", slug, "index.html");
  const html = await readFile(filename, "utf8");
  const reviews = grouped.get(slug) || [];
  const updated = updateVisibleReviews(updateProductJsonLd(html, reviews, slug), reviews);
  if (updated !== html) {
    await writeFile(filename, updated);
    changed += 1;
  }
}
console.log(`SEO review sync complete: ${approvedReviews.length} approved review(s), ${changed} product page(s) updated.`);
