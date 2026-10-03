import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SUPABASE_URL = "https://jktnltfbyuvurhqmzhww.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_d1vo34cUZUX5F5PetGyVBg_rpEwqBbF";
const PRODUCT_SLUGS = [
  "raptor-warming-spray", "raptor-cooling-spray", "raptor-go-energy-gel",
  "raptor-dual-action-pack", "raptor-sport-therapy-oil", "raptor-speed-water-charge",
  "raptor-herbal-cooling-gel", "raptor-sport-foot-spray", "raptor-herbal-roll-on",
  "raptor-cool-patch", "raptor-ice-defense-sport-shampoo"
];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

function updateProductJsonLd(html, reviews, slug) {
  let found = false;
  const updated = html.replace(/(<script\b[^>]*type=["']application\/ld\+json["'][^>]*>)([\s\S]*?)(<\/script>)/gi, (whole, open, json, close) => {
    if (found) return whole;
    let data;
    try { data = JSON.parse(json); } catch { return whole; }
    const product = findProduct(data);
    if (!product) return whole;
    found = true;
    const average = reviews.reduce((sum, review) => sum + Number(review.rating), 0) / reviews.length;
    product.aggregateRating = { "@type": "AggregateRating", ratingValue: average.toFixed(1), reviewCount: reviews.length, bestRating: 5, worstRating: 1 };
    product.review = reviews.slice(0, 5).map((review) => ({
      "@type": "Review",
      author: { "@type": "Person", name: review.reviewer_name },
      datePublished: reviewDate(review),
      reviewBody: review.comment,
      reviewRating: { "@type": "Rating", ratingValue: Number(review.rating), bestRating: 5, worstRating: 1 }
    }));
    return `${open}\n${JSON.stringify(data, null, 2)}\n${close}`;
  });
  if (!found) throw new Error(`No Product JSON-LD found for ${slug}`);
  return updated;
}

const endpoint = `${SUPABASE_URL}/rest/v1/product_reviews?is_approved=eq.true&select=*&order=reviewed_at.desc,created_at.desc`;
const response = await fetch(endpoint, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } });
if (!response.ok) throw new Error(`Supabase review sync failed: ${response.status} ${await response.text()}`);
const approvedReviews = await response.json();
if (!Array.isArray(approvedReviews)) throw new Error("Supabase returned an unexpected reviews response");

const grouped = Map.groupBy ? Map.groupBy(approvedReviews, (review) => review.product_slug) : approvedReviews.reduce((map, review) => {
  const items = map.get(review.product_slug) || [];
  items.push(review); map.set(review.product_slug, items); return map;
}, new Map());

let changed = 0;
for (const slug of PRODUCT_SLUGS) {
  const reviews = grouped.get(slug) || [];
  if (!reviews.length) continue;
  const filename = path.join(root, "products", slug, "index.html");
  const html = await readFile(filename, "utf8");
  const updated = updateProductJsonLd(html, reviews, slug);
  if (updated !== html) { await writeFile(filename, updated); changed += 1; }
}
console.log(`SEO review sync complete: ${approvedReviews.length} approved review(s), ${changed} product page(s) updated.`);
