import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import webhook from '../api/line-webhook.js';
import { pushLine, lineRecipients } from '../lib/line-notifications.js';

process.env.LINE_CHANNEL_SECRET = 'test-secret';
process.env.LINE_CHANNEL_ACCESS_TOKEN = 'mock-token';
process.env.LINE_ADMIN_USER_ID = 'personal-admin';
delete process.env.LINE_GROUP_ID;
const groupId = `C${'a'.repeat(32)}`;
const roomId = `R${'b'.repeat(32)}`;
const event = { type: 'message', mode: 'active', replyToken: 'reply-token',
  source: { type: 'group', groupId }, message: { type: 'text', text: '/groupid' } };
let sends = [];
global.fetch = async (url, options) => {
  sends.push({ url, ...options, body: JSON.parse(options.body) });
  return { ok: true };
};
async function call(payload, { method = 'POST', signature, signedBody } = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const req = Readable.from([Buffer.from(body)]);
  req.method = method;
  req.headers = { 'x-line-signature': signature ?? createHmac('sha256', 'test-secret')
    .update(signedBody ?? body).digest('base64') };
  const res = { setHeader() {}, status(code) { this.code = code; return this; },
    json(value) { this.body = value; return this; } };
  await webhook(req, res);
  return res;
}
assert.equal((await call({ events: [] })).code, 200); // LINE Verify request
assert.equal((await call({ events: [event] }, { method: 'GET' })).code, 405);
assert.equal((await call({ events: [event] }, { signature: 'forged' })).code, 401);
assert.equal((await call({ events: [event] }, { signedBody: '{}' })).code, 401);
assert.equal((await call('{')).code, 400);
assert.equal((await call(null)).code, 400);
assert.equal((await call({ events: {} })).code, 400);
assert.equal(sends.length, 0);
assert.equal((await call({ events: [event] })).code, 200);
assert.equal(sends.length, 1);
assert.equal(sends[0].url, 'https://api.line.me/v2/bot/message/reply');
assert.equal(sends[0].body.replyToken, 'reply-token');
assert.ok(sends[0].body.messages[0].text.includes(groupId));
assert.match(sends[0].body.messages[0].text, /ยังไม่ได้เปิดแจ้งเตือน/);
assert.deepEqual(lineRecipients(), ['personal-admin']); // no auto-enrollment
sends = [];
assert.equal((await call({ events: [
  { ...event, message: { type: 'text', text: 'ข้อมูลส่วนตัวของลูกค้า' } },
  { ...event, source: { type: 'user', userId: 'private-user' } },
  { ...event, type: 'join' },
  { ...event, mode: 'standby' },
  { ...event, deliveryContext: { isRedelivery: true } },
  { ...event, source: { type: 'group', groupId: 'bad-id' } }, null
] })).code, 200);
assert.equal(sends.length, 0);
const spaced = JSON.stringify({ events: [event] }, null, 2);
assert.equal((await call(spaced)).code, 200); // signature uses exact bytes
assert.equal((await call({ events: [{ ...event, source: { type: 'room', roomId } }] })).code, 200);
assert.ok(sends.at(-1).body.messages[0].text.includes(roomId));
process.env.LINE_GROUP_ID = ` ${groupId}, ${roomId}, ${groupId},personal-admin`;
assert.deepEqual(lineRecipients(), ['personal-admin', groupId, roomId]);
await call({ events: [event] });
assert.match(sends.at(-1).body.messages[0].text, /ตั้งค่าปลายทางกลุ่มนี้แล้ว/);
sends = [];
await pushLine({ order_ref: 'mock-order', event_type: 'order_created' });
assert.deepEqual(sends.map(send => send.body.to), ['personal-admin', groupId, roomId]);
delete process.env.LINE_ADMIN_USER_ID;
process.env.LINE_GROUP_ID = `${groupId},${roomId}`;
assert.deepEqual(lineRecipients(), [groupId, roomId]);
global.fetch = async () => ({ ok: false, status: 500 });
assert.equal((await call({ events: [event] })).code, 502);
assert.equal((await call('x'.repeat(1024 * 1024 + 1))).code, 413);
delete process.env.LINE_CHANNEL_SECRET;
assert.equal((await call({ events: [event] })).code, 503);
console.log('LINE group checks passed: exact-byte signatures, Verify, explicit setup replies, no auto-enrollment, room support, recipient deduplication, and group-only notifications.');
