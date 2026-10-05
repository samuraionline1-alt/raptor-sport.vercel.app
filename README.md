# Raptor retail storefront

Edit `promo-config.js` to change the announcement, bundle gifts, and coupons. Coupon codes are case-insensitive; `minOrder` applies to the bundle subtotal before the coupon. Only one coupon applies at a time. Existing bundle discounts remain 8% for two pieces, 15% for three, and 20% for six. Gifts for other tiers can be added to `bundleGifts` using the matching `tier_N` key.

Deploy config edits with the site so browser and checkout API use the same promotions. Promotion scripts revalidate their cache on each visit. Retail COD, pending online, and verified paid Formspree notifications include coupon and gift details. Wholesale orders do not use retail coupons.

Run `node tests/order-flow.mjs` and `node tests/promotions.mjs` to verify order and promotion behavior without making live payments or sending notifications.
