# Raptor retail storefront

Edit `promo-config.js` to change the announcement, bundle gifts, and coupons. Coupon codes are case-insensitive; `minOrder` applies to the bundle subtotal before the coupon. Only one coupon applies at a time. Existing bundle discounts remain 8% for two pieces, 15% for three, and 20% for six. Gifts for other tiers can be added to `bundleGifts` using the matching `tier_N` key.

Deploy config edits with the site so browser and checkout API use the same promotions. Promotion scripts revalidate their cache on each visit. Retail COD, pending online, and verified paid Supabase orders and LINE notifications include coupon and gift details. Wholesale orders do not use retail coupons.

## Supabase order migration (prepare database before deploying)

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
