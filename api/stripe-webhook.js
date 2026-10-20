import { createHmac, timingSafeEqual } from 'node:crypto';
import { fulfillPayment } from '../lib/payment-orders.js';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: 'Payment webhook is not configured' });
  const signature = req.headers?.['stripe-signature'];
  if (typeof signature !== 'string') return res.status(400).json({ error: 'Invalid signature' });
  let raw;
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > 1024 * 1024) throw new Error('Too large');
      chunks.push(buffer);
    }
    raw = Buffer.concat(chunks);
  } catch (_) { return res.status(413).json({ error: 'Unable to read webhook' }); }
  const parts = signature.split(',').map(part => part.trim().split('='));
  const timestamp = parts.find(([key]) => key === 't')?.[1];
  if (!/^\d+$/.test(timestamp || '') || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return res.status(400).json({ error: 'Invalid signature' });
  const expected = createHmac('sha256', secret).update(timestamp + '.').update(raw).digest();
  const verified = parts.some(([key, value]) => {
    if (key !== 'v1' || !/^[a-f0-9]{64}$/i.test(value || '')) return false;
    return timingSafeEqual(expected, Buffer.from(value, 'hex'));
  });
  if (!verified) return res.status(400).json({ error: 'Invalid signature' });
  let event;
  try { event = JSON.parse(raw.toString('utf8')); }
  catch (_) { return res.status(400).json({ error: 'Invalid event' }); }
  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) return res.status(200).json({ received: true });
  const session = event.data?.object;
  if (session?.payment_status !== 'paid') return res.status(200).json({ received: true });
  // Ignore sessions belonging to other integrations on the same Stripe account.
  if (!['retail', 'wholesale'].includes(session.metadata?.order_channel)) return res.status(200).json({ received: true });
  try {
    // Acknowledge durable payment persistence. Notification retries belong to the
    // stored queue, including when a channel is intentionally disabled.
    await fulfillPayment(session,{background:true});
    return res.status(200).json({ received: true });
  } catch (_) { return res.status(503).json({ error: 'Order pending retry' }); }
}
