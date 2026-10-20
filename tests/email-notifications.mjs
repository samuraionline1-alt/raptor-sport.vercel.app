import { orderEmailHtml } from '../lib/email-notifications.js';
import assert from 'node:assert/strict';
import { recordAndNotify, deliverEmailEvent } from '../lib/order-store.js';
import { withOrderDatabase, events, orders } from './helpers/order-database.mjs';
process.env.RESEND_API_KEY = 're_mock';
process.env.RESEND_EMAIL_DOMAIN = 'raptorthailand.com';
process.env.ORDER_NOTIFICATION_EMAIL = 'samurai-top1@hotmail.com';
process.env.ORDER_NOTIFICATIONS_FROM = new Date(Date.now() - 10000).toISOString();
process.env.LINE_CHANNEL_ACCESS_TOKEN = 'mock';
process.env.LINE_ADMIN_USER_ID = 'admin';
const order = { order_ref: 'RPT-email-test', event_type: 'order_created', payment_method: 'COD', customer_name: 'Test buyer', phone: '0812345678', address: 'Test address', product: 'Test product', quantity: 2, total_price: 329 };
let mail = [];
global.fetch = async (url, options) => {
  if (String(url).startsWith('https://api.resend.com/')) {
    mail.push({ body: JSON.parse(options.body), headers: options.headers });
    return Response.json({ id: 'email-mock-id' });
  }
  return { ok: false, status: 429 };
};
let result = await withOrderDatabase(() => recordAndNotify(order));
assert.equal(result.line_status, 'failed');
assert.equal(result.email_status, 'sent', 'LINE quota must not block email');
assert.equal(mail.length, 1);
assert.deepEqual(mail[0].body.to, ['samurai-top1@hotmail.com']);
assert.equal(mail[0].body.from, 'RAPTOR Orders <orders@raptorthailand.com>');
for (const field of ['RPT-email-test', 'Test buyer', '0812345678', 'Test address', 'Test product', '329']) assert.ok(mail[0].body.text.includes(field));
assert.ok(mail[0].headers['Idempotency-Key']);
const html = orderEmailHtml({ ...order, customer_name: '<img src=x onerror=alert(1)>', page_url: 'https://www.raptorthailand.com/products/test/?utm_source=fb&fbclid=tracking' });
assert.ok(html.includes('>เปิดหน้าสั่งซื้อ</a>'));
assert.ok(html.includes('href="https://www.raptorthailand.com/products/test/"'));
assert.ok(!html.includes('<img'));
assert.ok(!html.includes('fbclid'));
assert.ok(!orderEmailHtml({ ...order, page_url: 'javascript:alert(1)' }).includes('<a '));
await withOrderDatabase(() => recordAndNotify(order));
assert.equal(mail.length, 1, 'Persistent sent marker must prevent duplicate email');
const oldOrder = { ...order, order_ref: 'RPT-historical' };
await withOrderDatabase(async () => {
  const { database } = await import('../lib/order-store.js');
  await database('rpc/raptor_record_order', { method: 'POST', body: { p_order: oldOrder } });
  events.get('RPT-historical:order_created').created_at = '2026-01-01T00:00:00Z'; orders.get('RPT-historical').created_at = '2026-01-01T00:00:00Z';
  result = await recordAndNotify(oldOrder);
});
assert.equal(result.email_status, 'skipped'); assert.equal(result.line_status, 'skipped'); assert.equal(mail.length, 1);
const oldPaid = { ...order, order_ref: 'RPT-old-stripe', payment_method: 'STRIPE', event_type: 'payment_succeeded', order_created_at: '2026-01-01T00:00:00Z' };
result = await withOrderDatabase(() => recordAndNotify(oldPaid));
assert.equal(result.email_status, 'skipped', 'An old Stripe session arriving today is still an old order');
const retry = { ...order, order_ref: 'RPT-email-retry' };
let logged = []; const originalError = console.error; console.error = (...args) => logged.push(args.join(' '));
global.fetch = async url => String(url).startsWith('https://api.resend.com/')
  ? Response.json({ name: 'validation_error', message: 'Sensitive provider response', statusCode: 403 }, { status: 403 })
  : { ok: false, status: 429 };
result = await withOrderDatabase(() => recordAndNotify(retry));
assert.equal(result.email_status, 'failed');
assert.equal(events.get('RPT-email-retry:order_created').email_last_error, 'EMAIL HTTP_403');
global.fetch = async () => Response.json({ id: 'retried-email' });
events.get('RPT-email-retry:order_created').email_next_attempt_at = new Date(0).toISOString();
result = await withOrderDatabase(() => deliverEmailEvent(retry)); assert.equal(result.email_status, 'sent');
console.error = originalError; assert.ok(!logged.join(' ').includes('Sensitive provider response'));
console.log('Email checks passed: recipient, Thai order content, independent LINE/email delivery, persistent deduplication, historical-order cutoff, and failed-email recovery.');
