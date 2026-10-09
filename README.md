# Raptor retail storefront

Edit `promo-config.js` to change the announcement, bundle gifts, and coupons. Coupon codes are case-insensitive; `minOrder` applies to the bundle subtotal before the coupon. Only one coupon applies at a time. Existing bundle discounts remain 8% for two pieces, 15% for three, and 20% for six. Gifts for other tiers can be added to `bundleGifts` using the matching `tier_N` key.

Deploy config edits with the site so browser and checkout API use the same promotions. Promotion scripts revalidate their cache on each visit. Retail COD, pending online, and verified paid Formspree notifications include coupon and gift details. Wholesale orders do not use retail coupons.

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
