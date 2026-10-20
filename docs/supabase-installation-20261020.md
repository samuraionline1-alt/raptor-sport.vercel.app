# Supabase migration installation — 20 October 2026

Target verified through the connected Supabase account: **RAPTOR-SPORT**, project
`jktnltfbyuvurhqmzhww`, status ACTIVE_HEALTHY. This is the project referenced by
the RAPTOR storefront. The inactive raptor-7side/dev projects were not changed.

## Applied and verified on the real database

| Supabase migration version | Name | Source |
|---|---|---|
| 20261020151817 | raptor_checkout_security | supabase/migrations/20261020_checkout_security.sql |
| 20261020151835 | raptor_review_permissions | supabase/migrations/20261020_review_permissions.sql |
| 20261020152037 | raptor_review_order_index | SQL below |

The third migration fixes the foreign-key index advisory observed after installing
review permissions. Its SQL is recorded here and in Supabase migration history:

```sql
create index product_reviews_verified_order_ref_idx
  on public.product_reviews (verified_order_ref);
```

The original orders schema already existed but was not recorded in migration
history. It was inspected, not recreated. Do not run the original CREATE TABLE
migration or the 20261020 files again on this project. The local legacy migration
filenames are source artifacts, not the automatic version IDs assigned by the
Supabase migration tool; do not blindly run CLI db push without reconciling the
existing baseline/history first.

## Verification evidence

- Existing orders: 17 before and after. Notification events: 18 before and after.
- Existing reviews: 27 before and after; all 27 retained approval.
- Unbacked verified-purchase flags were cleared, as specified by the review migration.
- Orders, order items, notification events and rate limits have RLS enabled;
  anon/authenticated cannot read private tables. Service role retains access.
- All four raptor RPCs use SECURITY INVOKER; anon/authenticated cannot execute them.
- Public reviews allow only approved rows and explicit public columns; public
  INSERT/UPDATE/DELETE and access to verified_order_ref are denied.
- The new verified_order_ref index exists. The missing-FK-index advisory is resolved.
- No orders, payments, reviews or notifications were created as installation tests;
  verification used schema/permission metadata and aggregate counts only.

Supabase security advisor now reports only informational notices that private
RLS-enabled order tables have no public policies. This is intentional: access is
server-only. See [RLS without public policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
The new index is temporarily reported as [unused](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)
because the matching application release has not run against it yet; it was
retained to support the foreign key and future queries.

## Remaining application activation

PR #87 has not been merged or deployed by this installation. The old browser
review form no longer has direct write access, and its wildcard read must be
replaced by the new explicit-column client/API from that PR. Deploy the matching
release to restore the review flow. The old order tables remain intact.

Still required for the complete checkout-security release: configure CRON_SECRET,
activate five-minute retry scheduling on a supported plan/external scheduler,
preserve ORDER_NOTIFICATIONS_FROM, verify real staging Stripe/webhook/LINE/email
flows and deploy the matching application. This database installation alone does
not activate those application features.
