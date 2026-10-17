import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { withOrderDatabase, events, requests } from './helpers/order-database.mjs';
import orders from '../api/orders.js';
import webhook from '../api/stripe-webhook.js';
import checkout from '../api/create-checkout-session.js';
const response = () => ({ setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const order = { order_ref: 'RPT-recovery', customer_name: 'Test', phone: '0812345678', address: 'Test address', product: 'Test product', quantity: 1, total_price: 179, payment_method: 'COD' };
process.env.LINE_CHANNEL_ACCESS_TOKEN = 'mock';
process.env.LINE_ADMIN_USER_ID = 'admin';
process.env.STRIPE_SECRET_KEY = 'mock';
let pushes = 0;
global.fetch = async () => { pushes++; return { ok: false, status: 429 }; };
let res = response();
await withOrderDatabase(() => orders({ method: 'POST', body: { ...order, payment_status: 'paid' } }, res));
assert.equal(res.code, 200, 'A LINE quota failure must not reject a saved order');
assert.equal(res.body.line_status, 'failed');
assert.equal(events.get('RPT-recovery:order_created').payload.payment_status, 'รอเก็บเงินปลายทาง');
assert.equal(events.get('RPT-recovery:order_created').last_error, 'LINE HTTP_429');
global.fetch = async () => { pushes++; return { ok: true }; };
res = response(); await withOrderDatabase(() => orders({ method: 'POST', body: order }, res));
assert.equal(res.body.line_status, 'sent');
const sentCount = pushes;
res = response(); await withOrderDatabase(() => orders({ method: 'POST', body: order }, res));
assert.equal(pushes, sentCount, 'Repeated order requests must not send a delivered event again');
assert.equal(events.get('RPT-recovery:order_created').attempts, 2);
global.fetch = async () => ({ ok: false, status: 503 });
res = response(); await orders({ method: 'POST', body: { ...order, order_ref: 'RPT-db-down' } }, res);
assert.equal(res.code, 503);
assert.equal(res.body.ok, undefined, 'No successful order acknowledgement before database persistence');
res = response(); await orders({ method: 'POST', body: { ...order, payment_method: 'STRIPE' } }, res);
assert.equal(res.code, 400);
let checkoutCalls = 0;
global.fetch = async url => {
  if (url.startsWith('https://api.stripe.com/')) { checkoutCalls++; return { ok: true, json: async () => ({ url: 'https://checkout.stripe.com/test' }) }; }
  return { ok: false, status: 503 };
};
res = response(); await checkout({ method: 'POST', body: { ...order, payment_method: 'STRIPE', order_ref: 'RPT-online-db-down' } }, res);
assert.equal(checkoutCalls, 1);
assert.equal(res.code, 502);
assert.equal(res.body.url, undefined, 'Do not send a buyer to payment while order persistence is unavailable');

process.env.STRIPE_WEBHOOK_SECRET = 'whsec_mock';
const event = { type: 'checkout.session.completed', data: { object: { id: 'cs_test_paid123', currency: 'thb', amount_total: 17900, payment_status: 'paid', metadata: { ...order, order_ref: 'RPT-webhook', order_channel: 'retail' } } } };
function request(payload, { timestamp = Math.floor(Date.now() / 1000), tamper = false } = {}) {
  const raw = JSON.stringify(payload);
  const signature = createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(timestamp + '.' + raw).digest('hex');
  const req = Readable.from([Buffer.from(tamper ? raw + ' ' : raw)]);
  req.method = 'POST'; req.headers = { 'stripe-signature': `t=${timestamp},v1=${signature}` };
  return req;
}
global.fetch = async () => ({ ok: true });
for (const settings of [{ tamper: true }, { timestamp: Math.floor(Date.now() / 1000) - 600 }]) {
  res = response(); await withOrderDatabase(() => webhook(request(event, settings), res));
  assert.equal(res.code, 400);
  assert.ok(!events.has('RPT-webhook:payment_succeeded'));
}
res = response(); await withOrderDatabase(() => webhook(request(event), res));
assert.equal(res.code, 200);
assert.equal(events.get('RPT-webhook:payment_succeeded').payload.payment_method, 'STRIPE');
const recorded = requests.length;
const unpaid = structuredClone(event); unpaid.data.object.payment_status = 'unpaid';
res = response(); await withOrderDatabase(() => webhook(request(unpaid), res));
assert.equal(res.code, 200); assert.equal(requests.length, recorded);
const delayed = structuredClone(event); delayed.type = 'checkout.session.async_payment_succeeded'; delayed.data.object.metadata.order_ref = 'RPT-delayed';
global.fetch = async () => ({ ok: false, status: 401 });
res = response(); await withOrderDatabase(() => webhook(request(delayed), res));
assert.equal(res.code, 503, 'Stripe should retry failed notifications without a buyer returning to the page');
global.fetch = async () => ({ ok: true });
res = response(); await withOrderDatabase(() => webhook(request(delayed), res)); assert.equal(res.code, 200);
console.log('Supabase order checks passed: durable acknowledgement, LINE failure/retry/deduplication, DB failure, paid-status trust, and signed completed/asynchronous payment webhooks.');
