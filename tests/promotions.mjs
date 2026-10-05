import assert from 'node:assert/strict';
import config from '../promo-config.js';
import checkout from '../api/create-checkout-session.js';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
assert.equal(config.calculate(250, 'tier_2', ' raptor20 ').totalPrice, 230);
assert.equal(config.calculate(249, 'tier_2', 'RAPTOR20').discount_amount, 0);
assert.equal(config.calculate(450, 'tier_3', 'raptor50').totalPrice, 400);
assert.equal(config.calculate(449, 'tier_3', 'RAPTOR50').discount_amount, 0);
assert.equal(config.calculate(140, 'tier_1', 'freegel').free_gifts, config.coupons.FREEGEL.extraGift);
assert.equal(config.calculate(139, 'tier_1', 'freegel').free_gifts, '');
assert.equal(config.calculate(329, 'tier_2', 'FREEGEL').free_gifts, config.bundleGifts.tier_2.giftText + ' | ' + config.coupons.FREEGEL.extraGift);
assert.equal(config.calculate(499, 'tier_3', 'bad').coupon_code, '');
assert.equal(config.calculate(179, 'tier_1', '').free_gifts, '');
let params;
process.env.STRIPE_SECRET_KEY = 'mock-key';
global.fetch = async (_, options) => { params = new URLSearchParams(options.body); return { ok: true, json: async () => ({ url: 'https://checkout.stripe.com/test' }) }; };
function response() { return { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; }
for (const code of ['raptor20', 'FREEGEL', '']) {
 const promo = config.calculate(329, 'tier_2', code);
 const res = response();
 await checkout({ method: 'POST', body: { product: 'Test', quantity: 2, bundleTier: 'tier_2', ...promo, total_price: promo.totalPrice, order_ref: 'RPT-promo', customer_name: 'Test' } }, res);
 assert.equal(res.code, 200);
 assert.equal(params.get('line_items[0][price_data][unit_amount]'), String(promo.totalPrice * 100));
 assert.equal(params.get('metadata[free_gifts]'), promo.free_gifts);
 assert.equal(params.get('metadata[coupon_code]'), promo.coupon_code);
 assert.ok(params.get('line_items[0][price_data][product_data][description]').includes(promo.free_gifts));
}
const invalid = response();
await checkout({ method: 'POST', body: { product: 'Test', subtotal: 329, quantity: 2, bundleTier: 'tier_2', coupon_code: 'RAPTOR20', total_price: 1, order_ref: 'RPT-promo' } }, invalid);
assert.equal(invalid.code, 400);
for (const path of ['index.html', ...readdirSync('products').map(dir => `products/${dir}/index.html`)]) {
 const html = readFileSync(path, 'utf8');
 assert.ok(html.includes('/promo-config.js?v=promotions-20261005'));
 for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) if (match[1].includes('function getOrderPricing') || match[1].includes('// Formspree integration')) new vm.Script(match[1]);
}
console.log('Promotion checks passed: coupon thresholds, normalization, gifts, exact Stripe totals, mismatched-total rejection, and all retail scripts.');
