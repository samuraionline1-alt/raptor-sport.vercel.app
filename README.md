# Raptor retail storefront

Edit `promo-config.js` to change the announcement, bundle gifts, and coupons. Coupon codes are case-insensitive; `minOrder` applies to the bundle subtotal before the coupon. Only one coupon applies at a time. Existing bundle discounts remain 8% for two pieces, 15% for three, and 20% for six. Gifts for other tiers can be added to `bundleGifts` using the matching `tier_N` key.

Deploy config edits with the site so browser and checkout API use the same promotions. Promotion scripts revalidate their cache on each visit. Retail COD, pending online, and verified paid Supabase orders and LINE notifications include coupon and gift details. Wholesale orders do not use retail coupons.

## Checkout security release — database first

Pricing is authoritative on the server (`lib/order-pricing.js`). The shared
`product-catalog.js` retains the published retail and wholesale prices. Clients
send SKU/quantities/coupon and the displayed total; mismatched totals are rejected,
never silently charged. Wholesale shipping and 7% VAT retain the existing rules.
Retail bundle discounts are rounded to whole baht as before. Amounts are stored
and compared in integer satang. Stock availability is not managed by this catalog.
Online payments above THB 999,999.99 require contacting the store rather than
creating an unsupported Stripe session.

Prepare these changes in a staging environment with separate Stripe sandbox keys
and test notification recipients. Production activation order:

1. Apply `supabase/migrations/20261017_orders.sql` only on a new database. On the
   existing project it is already installed; do not rerun table creation.
2. Apply `20261020_checkout_security.sql`, then `20261020_review_permissions.sql`.
   They add private order line items, notification leases/retry fields, atomic
   rate limits, and review permissions. Existing customer orders are preserved.
   Old reviews retain content/approval but lose a verified-buyer badge unless
   backed by an order. Anonymous direct review writes are disabled; deploy the
   matching `/api/reviews` client at the same release.
3. Preserve server-only `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`,
   and `LINE_ADMIN_USER_ID`/`LINE_GROUP_ID`. Keep the original fixed ISO timestamp
   `ORDER_NOTIFICATIONS_FROM`; never move it forward on redeploy.
4. Configure a random server-only `CRON_SECRET` of at least 32 characters.
   Production uses Supabase Cron (`pg_cron` + `pg_net`) every five minutes to call
   `/api/retry-notifications`. The same token is encrypted in Supabase Vault;
   the scheduled SQL references its name, never a literal token. Requests use
   short-lived HMAC signatures, so the reusable secret never enters the HTTP queue. Vercel Hobby
   does not support five-minute cron jobs, so `vercel.json` has no native cron
   entry. Keep the Supabase job disabled until the matching deployment is READY,
   then enable it and inspect the HTTP response status. Set runtime log alerts
   for `ORDER_NOTIFICATION_BACKLOG` and `ORDER_NOTIFICATION_WORKER_FAILED`.
5. For independent email delivery retain `RESEND_API_KEY`, verified
   `RESEND_EMAIL_DOMAIN`, and `ORDER_NOTIFICATION_EMAIL`. Build checks are
   read-only and no longer send a setup email. Email errors never log provider
   bodies, including in preview/local environments.
6. Keep the Stripe destination at `/api/stripe-webhook` subscribed to both
   `checkout.session.completed` and `checkout.session.async_payment_succeeded`.
   Fulfillment uses the stored order, expected amount/currency and the bound
   session, not browser-supplied payment fields. Payment methods remain dynamic;
   enable cards/PromptPay in Stripe Dashboard. API requests pin version
   `2026-08-26.dahlia`; verify sandbox compatibility before promotion.
7. Deploy only after staging acceptance. Check COD, online success/cancel/delay,
   replayed webhooks without a browser return, a 10-SKU wholesale order, and
   notification outage/recovery. Confirm live provider settings separately; mock
   browser tests do not make payments or verify production secrets.

The production build refuses to deploy when required order schema/RPCs, webhook
secret, notification cutoff or cron secret are absent. Preview redirects use only
Vercel's configured exact `VERCEL_URL`; production uses the store's canonical www
origin, with an apex-to-www redirect before checkout. Caller-supplied success URLs
are ignored. Checkout metadata contains only order reference/channel, not PII.

Orders and structured SKU lines are saved before Checkout creation. Notification
sending runs after persistence with Vercel `waitUntil`; the retry job independently
recovers both channels with leases and backoff. The private queue uses `status`
for LINE and `email_status` for email, plus channel-specific attempts/due/lease
fields. Sent markers mean provider acceptance, not inbox delivery. At 8 attempts
or after 23 hours of ambiguity jobs become `manual_review`, avoiding blind sends
outside the providers' 24-hour idempotency windows. Inspect delivery receipts
before manually resending these jobs. Do not reset historical sent/ambiguous rows
or replay historical Formspree orders.

Manual recovery uses `node scripts/retry-line.mjs` or `node scripts/retry-email.mjs`
with service credentials on a trusted server. Both skip sent rows and drain more
than the former first 50 rows. Logs and worker responses contain no customer data.

The receipt proof is a random 256-bit token kept in the ordering tab; only its
hash is saved on the server. Receipt APIs require that proof and return status,
items and totals without name/address/phone/tax ID. Opening a receipt on another
device or from a pre-release session may require contacting the store. Do not
rollback to the old webhook while new sessions remain open: the old receiver
cannot interpret the new minimal metadata. Prefer a forward fix and retain the
new receiver until sessions are settled. Never drop order tables to roll back.

Browser protections enforce a script CSP with SHA-256 hashes for reviewed inline
scripts and event handlers; arbitrary inline scripts and eval are blocked. GTM,
Meta and documented Google analytics hosts are explicitly allowed. Run
`npm run security:headers` after changing inline HTML/handlers and commit
`vercel.json`; production build checks prevent stale hashes from going live.
Only browser assets are copied into `_site`, the Vercel output directory. Server
libraries, SQL, tests, documentation, draft article JSON and configuration are
excluded from the static deployment. API functions remain separate server routes.
Verified Stripe webhooks acknowledge payment after durable persistence; email/LINE
outages and disabled channels recover through the existing queue, without asking
Stripe to replay an already saved payment.

Run `npm test` for isolated regression tests, including real PostgreSQL semantics
through PGlite. Run `npm run test:browser` with Chromium installed (defaults to
`/usr/bin/chromium`; override `CHROMIUM_PATH`) for the local browser/API/service-mock
flow. `npm run build` builds assets and performs extra read-only service checks
when `VERCEL_ENV=production`. No test sends real customer orders or notifications.

## Email-only order alerts

Production uses the installed Vercel Resend integration and the existing
`ORDER_NOTIFICATION_EMAIL` recipient. Set `LINE_ORDER_NOTIFICATIONS_ENABLED=false`
to pause LINE order alerts, including retries and LINE backlog monitoring. Email
receives the full worker budget and its own retries. Existing LINE credentials,
webhook, historical queue and delivery markers are preserved. No historical emails
are replayed. Redeploy after changing the flag; remove it or set `true` to resume
LINE order alerts. Production build checks require Resend configuration while LINE
is paused and do not call the LINE quota API.

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

API routing deliberately leaves global `trailingSlash` unset: Stripe/LINE webhooks
and retry calls must not receive a 308 redirect. Existing directory page URLs
remain available; `/thank-you/` rewrites internally to the clean receipt URL.

## General contact form

The homepage contact form posts JSON to `/api/contact`. Messages are stored in
`public.raptor_contact_messages`, with RLS enabled and no anon/authenticated table
privileges. View messages in the RAPTOR-SPORT Supabase Table Editor. Server-only
service credentials perform writes; browser clients cannot list messages.
Apply `supabase/sql/contact_messages.sql` before deploying this code (remote
migration name `raptor_contact_messages`; CLI unavailable during installation).
The form validates name, email/phone and message; the API enforces length/origin
and IP limits, ignores honeypot spam and deduplicates retries by random submission
ID. Success requires database persistence. Resend sends contact alerts to the
existing configured notification email, with independent leases, idempotency and
retry through the existing five-minute worker; no LINE messages are sent.
After eight attempts or 23 hours, inspect `email_status=manual_review`. Contact
submissions emit a Contact analytics event without contact details, never Purchase.

## Logo motion and product charts

`performance.js` lazily loads the pinned local Chart.js 4.5.1 bundle from
`assets/vendor/chart.umd-4.5.1.min.js`; its MIT license is shipped alongside it.
Source: https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js
SHA-256: 48444a82d4edcb5bec0f1965faacdde18d9c17db3063d042abada2f705c9f54a
Chart loading stays within the enforced self script policy. A failed chart has a
visible retry action instead of a silent blank canvas. All eleven existing product
charts are covered by `npm run test:visual`, which uses the real vendored library.

The homepage brand logo uses a 240-pixel H.264 copy of the original animation,
without audio (about 121 kB), with muted inline single-pass playback and the existing
black-and-white dinosaur poster (`assets/optimized/raptor-logo-cover.png`, copied
from the original `Capture4646 (1).png`). Hidden/offscreen logos pause, reduced-motion preferences are
respected, and an autoplay denial uses a small CSS fallback effect. A user gesture
retries playback for mobile autoplay restrictions. Performance asset query versions
are updated so returning browsers fetch the corrected loader and styles.

Run `npm run build`, then `npm run test:visual` and `npm run test:browser`
sequentially: public-build tests recreate `_site`, so do not run them concurrently
with browser tests serving that directory. The visual suite checks actual chart
pixels/animation completion, logo progress, completion and Home/reload restart, responsive behavior, menu,
reduced motion, autoplay denial and chart retry. Mobile viewport Chromium is not a
substitute for testing on a physical iPhone with its current power/motion settings.

The logo plays once per homepage visit, then stays stopped even after generic
clicks, viewport changes or returning to the tab. Refresh, an explicit Home/logo
link, hash-history return to `#home`, or browser Back restoring the homepage starts
a fresh single pass. The fallback CSS effect is also finite.

On completion the logo returns to the original still cover. Retail bundle choices
update quantity and prices synchronously. Custom quantities show an enabled,
required numeric field (minimum 4); preset bundles disable that field so a hidden
invalid value cannot block checkout. Customer name/address typing does not rebuild
price summaries. Browser coverage repeatedly switches every product form on mobile
and desktop, checks custom quantities and exact prices, and carries a custom
7-item order plus coupon through real local checkout handlers and receipt storage.

`form-inputs.css` keeps mobile/touch text controls at least 16px to avoid Safari's
focus auto-zoom while preserving normal user pinch zoom. Controls fit their
containers; wholesale product grid items can shrink to fit narrow screens.

Analytics recovery (2026-10-21): receipt pages explicitly initialize the existing
Meta Pixel 462184846324554 before ecommerce confirmation. Verified receipts restore
Lead, Purchase and their legacy product-specific custom names plus
RaptorOrderSubmitted; valid retail submissions restore RaptorFormSubmitStarted.
Product page views restore RaptorProductView now that navigation uses pages rather
than modal handlers. GTM remains GTM-TW2P4VN5; existing view_item, begin_checkout and
purchase data-layer contracts are retained. Google and Meta conversion guards are
independent; refreshing a receipt does not count it again. Purchase remains tied
to server-confirmed receipts, never arbitrary URL parameters or contact messages.
The CSP explicitly permits Meta/Google collection and conversion-frame endpoints
while still blocking unreviewed inline scripts and eval. GTM Custom HTML/Custom JS
container configuration requires a separate authenticated container inspection.

`npm run test:tracking` runs actual storefront/receipt scripts under deployed CSP
with mocked provider scripts/collectors, validates legacy events across all12
product pages, social clicks, submission, conversion and duplicate suppression.
It does not establish that Meta Events Manager or Google reports received events.
