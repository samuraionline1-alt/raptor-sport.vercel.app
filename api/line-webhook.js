import { createHmac, timingSafeEqual } from 'node:crypto';
import { lineRecipients } from '../lib/line-notifications.js';

export const config = { api: { bodyParser: false } };
const MAX_BODY_BYTES = 1024 * 1024;

async function rawBody(req) {
  // Never serialize a parsed body: LINE signs the original request bytes.
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('Request too large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) return res.status(503).json({ error: 'LINE webhook is not configured' });
  const signature = req.headers?.['x-line-signature'];
  if (typeof signature !== 'string') return res.status(401).json({ error: 'Invalid signature' });
  let body;
  try { body = await rawBody(req); }
  catch (_) { return res.status(413).json({ error: 'Unable to read webhook body' }); }
  const expected = createHmac('sha256', secret).update(body).digest('base64');
  const received = Buffer.from(signature);
  const digest = Buffer.from(expected);
  if (received.length !== digest.length || !timingSafeEqual(received, digest)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  let payload;
  try { payload = JSON.parse(body.toString('utf8')); }
  catch (_) { return res.status(400).json({ error: 'Invalid webhook payload' }); }
  if (!Array.isArray(payload?.events)) return res.status(400).json({ error: 'Invalid webhook events' });

  // Reply only to an explicit setup command; never store customer conversations
  // or enroll every group that invites the bot.
  const commands = payload.events.filter(event => event?.type === 'message'
    && event.message?.type === 'text' && typeof event.message.text === 'string'
    && event.message.text.trim().toLowerCase() === '/groupid'
    && ['group', 'room'].includes(event.source?.type) && event.mode !== 'standby'
    && typeof event.replyToken === 'string' && event.replyToken
    && !event.deliveryContext?.isRedelivery);
  try {
    for (const event of commands) {
      const id = event.source.type === 'group' ? event.source.groupId : event.source.roomId;
      if (typeof id !== 'string' || !/^[CR][a-f0-9]{32}$/i.test(id)) continue;
      const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
      if (!token) throw new Error('Missing LINE access token');
      const configured = lineRecipients().includes(id);
      const response = await fetch('https://api.line.me/v2/bot/message/reply', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ replyToken: event.replyToken, messages: [{ type: 'text', text:
          `รหัสกลุ่มสำหรับแจ้งเตือน RAPTOR:\n${id}\n\n${configured
            ? 'ตั้งค่าปลายทางกลุ่มนี้แล้ว'
            : 'ยังไม่ได้เปิดแจ้งเตือนกลุ่มนี้ ให้ผู้ดูแลตั้งค่า LINE_GROUP_ID บน Vercel เป็นรหัสด้านบน แล้ว Redeploy เว็บไซต์'}` }] }),
        signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) throw new Error('LINE reply failed');
    }
    return res.status(200).json({ ok: true });
  } catch (_) { return res.status(502).json({ error: 'Unable to reply to LINE setup command' }); }
}
