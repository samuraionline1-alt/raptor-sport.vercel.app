# Raptor retail storefront

Edit `promo-config.js` to change the announcement, bundle gifts, and coupons. Coupon codes are case-insensitive; `minOrder` applies to the bundle subtotal before the coupon. Only one coupon applies at a time. Existing bundle discounts remain 8% for two pieces, 15% for three, and 20% for six. Gifts for other tiers can be added to `bundleGifts` using the matching `tier_N` key.

Deploy config edits with the site so browser and checkout API use the same promotions. Promotion scripts revalidate their cache on each visit. Retail COD, pending online, and verified paid Supabase orders and LINE notifications include coupon and gift details. Wholesale orders do not use retail coupons.

## Supabase order migration (prepare database before deploying)

### Order email notifications

Resend is installed through Vercel Marketplace and the sender domain must be
verified. Production uses integration-provided `RESEND_API_KEY` and
`RESEND_EMAIL_DOMAIN`, plus `ORDER_NOTIFICATION_EMAIL` for the owner's recipient.
The sender is `RAPTOR Orders <orders@<verified-domain>>`. COD, online checkout,
and verified paid events each have distinct subjects and idempotency keys.
Email and LINE run independently after database persistence.

`ORDER_NOTIFICATIONS_FROM` is a fixed ISO timestamp marking when new notifications
were enabled. Orders created before it are excluded from both channels, including
old Stripe sessions delivered later. Do not move this timestamp during redeploys.
Historical Formspree orders have already been handled manually; do not replay them.

The existing `raptor_line_events.payload.email_delivery` stores the provider ID
and `sent_at`, or a sanitized `last_error`. No further SQL migration is needed.
The sent marker records provider acceptance, not confirmed inbox delivery.
For a manual retry use `node scripts/retry-email.mjs` with the original cutoff
and production service credentials on a trusted server. No scheduled email retry
job is configured. Resend idempotency protects concurrent retries within its
24-hour window; inspect ambiguous deliveries older than that before retrying.

`ORDER_EMAIL_SEND_TEST=1` enables a single setup email during a production build.
Remove that temporary variable after confirming provider acceptance. Never send
real customer data in setup checks. Run `node tests/email-notifications.mjs` for
recipient, failure independence, deduplication, and historical-cutoff checks.

1. In the existing Supabase project, open SQL Editor and run
   `supabase/migrations/20261017_orders.sql` once. It creates `raptor_orders`,
   `raptor_line_events`, and a transactional recording function. Both tables use
   RLS with no anonymous/authenticated access. Only the server service role can
   access customer data. The existing reviews table is untouched.
2. In Vercel project **raptor-sport**, configure Production `SUPABASE_URL` and
   Secret `SUPABASE_SERVICE_ROLE_KEY`. The latter accepts a new `sb_secret_`
   secret key or the legacy service_role JWT. Never expose it to the browser.
3. In the existing Stripe account, create an event destination for
   `https://www.raptorthailand.com/api/stripe-webhook`. Select
   `checkout.session.completed` and `checkout.session.async_payment_succeeded`.
   Save its signing secret as Secret `STRIPE_WEBHOOK_SECRET` in Vercel Production.
   Keep the existing Stripe and LINE credentials. Checkout now uses the payment
   methods enabled in Stripe Dashboard; ensure cards and PromptPay are enabled.
4. Deploy only after the SQL and configuration are ready. Verify a clearly
   identified COD order appears in Supabase and its notification arrives in LINE.
   Test online payments in a Stripe sandbox, including a paid webhook delivered
   without opening the success page. Mock checks alone do not verify live keys,
   database setup, LINE membership or LINE quota.

The server commits the order and LINE queue entry before acknowledging COD or
returning a Stripe payment URL. LINE failures do not erase or reject saved
orders. Inspect `raptor_line_events.status`, `attempts`, and `last_error` in
Supabase. HTTP_401 suggests LINE credentials; HTTP_429 can indicate quota/rate
limits; HTTP_400 can indicate a request/recipient issue. These codes require
further investigation, not automatic credential replacement.

Stripe retries paid webhooks when LINE delivery fails. COD/pending notifications
can be retried using `node scripts/retry-line.mjs` on a trusted server configured
with the Supabase and LINE environment variables. This script is **manual**;
no recurring retry job is configured. LINE deduplicates matching retry keys for
24 hours; a retry after that window, or an uncertain delivery followed by a
database outage, can produce a duplicate. Inspect long-pending events first.

Order flows no longer use Formspree. The contact form still uses Formspree, and
the nine historical Over Limit submissions must be exported/recovered separately;
this migration does not retrieve them.

Run `node tests/supabase-orders.mjs`, `node tests/order-flow.mjs`,
`node tests/line-notifications.mjs`, `node tests/line-webhook.mjs`,
`node tests/promotions.mjs`, and `node tests/product-scripts.mjs` for mocked
regression checks. The SQL still needs validation against the target Supabase
database before production deployment.

Run `node tests/order-flow.mjs` and `node tests/promotions.mjs` to verify order and promotion behavior without making live payments or sending notifications.

## LINE order notifications in a group

The server sends notifications to `LINE_ADMIN_USER_ID` and `LINE_GROUP_ID`.
Each accepts comma-separated recipient IDs; duplicates are removed. To notify
only a group, set `LINE_GROUP_ID` and remove `LINE_ADMIN_USER_ID`. Joining a group
does not automatically subscribe it to customer order information.

1. In the Vercel project serving **www.raptorthailand.com**, set
   `LINE_CHANNEL_SECRET` in the Production environment to the existing Channel
   secret from LINE Developers → the same Messaging API channel → Basic settings.
   Keep the existing `LINE_CHANNEL_ACCESS_TOKEN`. Enter secrets directly into
   Vercel, never in chat or source control. Deploy the updated code.
2. Set the channel's Webhook URL to
   `https://www.raptorthailand.com/api/line-webhook`, enable **Use webhook**, and
   press **Verify**. The handler verifies LINE's signature using the original
   request bytes, including requests with an empty events array.
3. With that OA in the intended group, send **/groupid**. The bot replies with
   the group ID (or room ID for an older multi-person chat). Ordinary messages
   and invitations do not trigger setup replies or automatic enrollment.
4. Set `LINE_GROUP_ID` in Vercel Production to the returned ID. Redeploy so the
   new setting reaches running functions. Sending `/groupid` again reports
   whether this group is a configured recipient; it does not test order delivery.
5. Test a clearly identified COD order and confirm the notification arrives in
   the intended group. Check pending/paid online notifications separately without
   charging a real card just for a setup test.

If webhook verification fails, check that the Channel secret belongs to the same
channel, the production deployment includes `api/line-webhook.js`, and deployment
protection does not block LINE. A bot reply with an ID is not confirmation that
order notifications are enabled until step 4 is deployed.

Run `node tests/line-webhook.mjs` and `node tests/line-notifications.mjs` for mocked
group setup and order delivery checks. These tests do not send live messages.

## Article system

The storefront is a static Vercel site, not a Next.js application. Article routes
are generated at build time from individual JSON files. There is no article copy
in HTML templates and no manually maintained route list. The existing URLs remain
`/articles/` and `/articles/<slug>/`, with full HTML and JSON-LD available to crawlers
without browser JavaScript. Unknown slugs use the host's normal 404 behavior.

### Add an article

1. Copy `data/articles/sample-energy-gel-guide.json` to
   `data/articles/your-article-slug.json`.
2. Set `slug` to `your-article-slug` (lowercase letters/numbers separated by hyphens)
   and edit the metadata and content. The filename must match the slug.
3. Choose `targetProductLink`, such as `/products/raptor-go-energy-gel/`, and an
   existing local image for `thumbnail`. Set meaningful `thumbnailAlt` text.
4. Keep `draft: true` while writing. Set it to `false` or remove it when ready.
5. Run `npm run build` and `npm run test:articles`, then commit and push the changes
   to the production branch `main`. Vercel builds the routes, cards, metadata,
   schemas and sitemap automatically on deployment.

The sample is a draft and never appears in published routes, index or sitemap.
Keep articles in `data/articles/`; never edit generated `articles/*/index.html`.
Adding a file requires a build/deployment before it becomes live.

### JSON fields

| Field | Purpose |
| --- | --- |
| `slug` | Unique route identifier; must match filename |
| `draft` | Optional boolean; `true` excludes the post from publication |
| `title`, `description` | Page title, description and social metadata |
| `excerpt` | Short text on the article card |
| `category` | Visible category and Article schema section |
| `published`, `modified` | Valid YYYY-MM-DD dates; modification cannot precede publication |
| `targetProductLink` | Existing `/products/<slug>/` route used for contextual links and product entity |
| `thumbnail`, `thumbnailAlt` | Local PNG/JPG/WebP/AVIF image path and descriptive alt text |
| `summary` | Answer summary at the top of the article |
| `sections` | Array of `{id, title, paragraphs}`; optional `items` produces a semantic list |
| `sections[].productLink` | Optional boolean adding an in-body link to the selected product |
| `sections[].articleLink` | Optional slug of another published article |
| `faqData` | Optional array of `{question, answer}`; omit or use `[]` for no FAQ |

FAQ data generates both visible Q&A and FAQPage JSON-LD in the head. Article
JSON-LD is always generated, including canonical URL, dates, publisher, thumbnail
and the selected product's entity reference. Titles, descriptions and body text
are escaped; input is plain text, not executable HTML or MDX. Put new verified
formulation facts in the corresponding product page, not in a global blog template.
The camphor-free fact remains specific to RAPTOR cooling spray and is never added
to unrelated products automatically.

### Backend and scaling

`lib/articles.mjs` exports `getAllArticles({root?, includeDrafts?})` and
`getArticleBySlug(slug, options?)`. The loader validates article files, images,
product routes, dates and related links. It reads Product metadata from each
selected product page and caches repeated product reads during the load. There
is no catalog size limit or SKU switch statement: adding another product page
with valid Product JSON-LD allows articles to target it immediately.

`scripts/build-articles.mjs` renders all published routes and a dark/orange
responsive card grid. Related articles prioritize the same product and are limited
to three. Removed or newly drafted posts have their generated pages and sitemap
entries removed; existing non-article sitemap entries remain intact. Layout lives
in the generator and `articles.css`, independently of article content.

`npm run test:articles` verifies per-file discovery, additional products, optional
FAQs, visible/schema consistency, draft exclusion, route links, thumbnails, safe
escaping and repeatable sitemap updates. Formula or regulatory claims still need
supporting evidence. No medical reviewer credentials are asserted, and structured
data does not guarantee Google rich results or AI Overview inclusion.

## Storefront performance

`npm run build` now compiles Tailwind CSS locally into `assets/site.css`; the retail
pages do not compile styles in visitors' browsers. Keep complete utility class
names in HTML/JS so Tailwind can discover dynamically inserted checkout styles.

Retail image variants live in `assets/optimized/` (480, 960 and 1600 pixels wide).
The original images remain available for social previews. Update `srcset`, image
width/height and `data/image-optimization.json` when replacing product images;
keep the 960px variants below 200 kB. Product zoom uses the largest variant.
Run `npm run test:performance` after rebuilding CSS.

`performance.js` loads Chart.js when a visible chart approaches the viewport and
loads subsequent home backgrounds one at a time. It pauses the background slider
when the page is hidden or the hero is offscreen, and respects reduced motion.
Bump the asset query versions in affected HTML when changing cached CSS/JS.

### Lighthouse accessibility and first-load follow-up (2026-10-19)

- Kanit and the Font Awesome glyphs used by retail templates are self-hosted in `assets/vendor/`; their license files are included. `scripts/vendor-fonts.py` optionally regenerates them (Python fontTools + brotli). Normal builds do not fetch fonts.
- Static navigation logos replace decorative video downloads; product demos retain controls and load only when requested. Mobile decorative animations/background autoplay are disabled, with the desktop carousel retained.
- Menu controls expose their name and expanded state. Rating graphics have an image role; hidden-focusable admin shortcuts are named. Review, checkout, badge and footer colors meet the automated contrast checks.
- Non-fingerprinted assets revalidate after a day; content-hashed font files retain immutable caching. Shared stylesheet/script references are versioned for this release.
- Verification: build, article/performance checks, product-script parsing, promotion/order-flow tests; Lighthouse accessibility passed on the homepage and cooling-spray page. Cloud Lighthouse blocks analytics domains at its proxy, so console-related Best Practices results from that environment do not represent a production analytics failure.

### Draft: tracking workers (not yet released)

`@qwik.dev/partytown` 1.0.1 moves the GTM container, its Google tag, and the Meta Pixel into a worker. Checkout scripts remain on the main thread. Page-specific IDs/events remain in their templates. Canonical adapters are in `tracking-queue.js` and `tracking-meta.js`; `npm run build:tracking` refreshes their inline copies and emits the versioned same-origin worker assets/bootstrap.

Early events are queued before the bridge loads. `dataLayer.push` and `fbq` preserve their native behavior as well as forwarding into the worker. The native fallback replays early Meta events after initializing the pixel. The thank-you page now explicitly initializes the same Meta Pixel so its queued Purchase has a receiver. The service worker is scoped only to `/~partytown/1.0.1/`; it does not control storefront navigation or checkout APIs.

`/api/tracking-script` proxies only public Google/Meta JavaScript at validated hosts/paths. It does not proxy event collection, cookies, arbitrary URLs, redirects or POSTs. It uses a 1 MiB limit and short vendor-script freshness. Do not increase freshness to a year: tag/config changes must still propagate.

Verification:
- `npm run test:tracking` covers proxy validation, redirect/content/size rejection, early-event forwarding, native fallback and duplicate prevention.
- `python tests/tracking-browser-fixture.py` serves a localhost-only fixture at `http://127.0.0.1:8767/test-tracking`. It uses local mock vendors that each do 500 ms of work and record mock events in `work/tracking-mock-events.jsonl` or `/__test/results`. No real analytics events are sent. A Lighthouse run of this fixture delivered Google purchase and Meta PageView/Purchase once, with TBT 10 ms. This is an integration test, **not a storefront performance score**.
- Build, image/reference budgets, articles, product scripts and order/promotion tests also pass.

Before production release, validate the preview with actual GTM/GA4 and Meta Test Events. The cloud test network blocks these vendors, so it cannot prove real vendor receipt or produce a representative full-tracking performance score. Do not publish solely on the mock Lighthouse result. Partytown documents that GA4's automatic page-exit `user_engagement` event is unreliable in a worker; click/form tags relying on synchronous preventDefault also need review. Those trade-offs must be accepted or those tags kept on the main thread. See https://partytown.qwik.dev/trade-offs/.
