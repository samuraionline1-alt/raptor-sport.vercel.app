# RAPTOR follow-up security and reliability review — 2026-10-20

Scope: GitHub main, Vercel raptor-sport production at www.raptorthailand.com,
server APIs, retail/wholesale checkout, receipts, Stripe/LINE webhooks, Resend
notification queues, homepage contact, reviews, static publication and Supabase
permissions. No real test orders, messages or payments were created. Existing
customer records and historical queue states were preserved.

## Findings fixed in this release

| Priority | Finding | Resolution |
| --- | --- | --- |
| P1 | Stripe webhook responded 503 when LINE was deliberately disabled, even after payment persistence | Acknowledge a verified payment after its order/event is saved. Notification failures recover independently through the durable queue. Persistence failure still returns 503 for Stripe retry. |
| P1 | Production served server libraries, SQL, tests and internal docs as static downloads | Publish an allowlist of browser assets to `_site`. Exclude API/library sources, SQL, test fixtures, docs, draft JSON and configuration. No secret-pattern matches were found in tracked production source files during this review. |
| P2 | Script CSP was report-only | Enforce SHA-256 allowlists for reviewed inline scripts/handlers, explicit external script hosts, no arbitrary inline scripts or eval. Build fails on stale hashes. |
| P2 | Legacy per-product contact/order fallback scripts retained inaccurate Purchase tracking and redundant submission logic | Remove the unused fallback scripts; the authoritative checkout handler and verified receipt tracking remain. |
| P2 | Reusing a contact submission ID with edited fields silently accepted the old message | Compare the stored message before acknowledging; reject differing content with 409, retain input and generate a fresh ID for the next retry. Identical retries remain deduplicated. |
| P2 | Contact phone validation accepted punctuation-only strings | Require at least eight digits when contact is a phone number. |
| P2 | Production build checked existence of a Stripe key but not API connectivity/version | Perform a read-only Checkout API request; log only successful connectivity, never session/customer data. |

## Verification

- GitHub main and the starting production deployment matched 04c49a0.
- 15 regression suites passed, including real PostgreSQL semantics for private
  grants, immutable orders, rate limits, claim leases and retry ceilings.
- Mobile Chromium passed retail COD/Stripe, ten-SKU wholesale, receipt proof,
  lost acknowledgement, replay/deduplication, analytics failures and contact retry.
- Every product route and content template was checked for first-party CSP script
  violations. A deliberately injected inline script was blocked.
- Built site crawl retained every local linked page/asset, while private source
  paths were absent. Production verification is recorded in the deployment report.
- npm audit reported zero known dependency vulnerabilities at review time.
- Supabase private customer tables have RLS and no anon/authenticated table grants.
  Public reviews retain only approved-row/explicit-public-column access; no public
  writes or access to the private order reference. All five application RPCs are
  security invoker and inaccessible to anon/authenticated roles.
- LINE order alerts remain paused; Resend and the five-minute signed retry job
  remain in use. Review totals may change with legitimate customer activity.

## Platform notice and limits

Supabase reports pg_net's extension namespace as public. Its installed extension
is non-relocatable; its actual HTTP functions/queue live in the separate net
schema and no pg_net functions are exposed through public application RPCs.
Changing system catalogs or dropping the running scheduler extension to silence
this notice would risk the live notification worker, so this review preserves it.
A supported relocation/reinstallation can be planned with Supabase if required:
https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public

RLS-with-no-policy notices on private customer tables are intentional: client
roles have no access and service-role server code performs controlled writes.
GTM, Meta and Google script hosts remain trusted external integrations. Tests do
not verify a real bank/card charge or inbox delivery. This review covers the
listed checks and does not establish that every possible vulnerability is absent.

## Visual regression follow-up

The first security browser checks visited product pages without scrolling far
enough to trigger deferred charts. This missed a CSP conflict with the Chart.js
CDN loader. Charts now use a pinned, locally served Chart.js bundle under the
same enforced policy. `npm run test:visual` scrolls to every existing chart and
checks real rendered pixels and completed dataset animation, including failed
load/retry recovery. It also checks the restored homepage logo video (the earlier
performance release had replaced it with a still image), playback progress/loop,
mobile/desktop visibility, reduced motion and blocked-autoplay fallback. Existing
checkout/contact browser tests continue to run separately.
