import { createHmac, timingSafeEqual } from 'node:crypto';
import { retryContactEmails } from '../lib/contact-notifications.js';
import { retryNotifications } from '../lib/notification-worker.js';
function equal(actual, expected) {
  return Buffer.byteLength(actual) === Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(actual),Buffer.from(expected));
}
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  const secret = process.env.CRON_SECRET;
  const actual = String(req.headers?.authorization || '');
  const timestamp = req.headers?.['x-raptor-cron-timestamp'];
  const signature = req.headers?.['x-raptor-cron-signature'];
  // Supabase sends a time-bound signature, never the reusable secret in pg_net's HTTP queue.
  const fresh = typeof timestamp === 'string' && /^\d{10}$/.test(timestamp) && Math.abs(Date.now()/1000-Number(timestamp)) <= 60;
  const signed = secret && fresh && typeof signature === 'string' && /^[a-f0-9]{64}$/.test(signature)
    && equal(signature,createHmac('sha256',secret).update(`${timestamp}:GET:/api/retry-notifications`).digest('hex'));
  const bearer = secret && equal(actual,`Bearer ${secret}`);
  if (!signed && !bearer) return res.status(401).json({error:'Unauthorized'});
  if (req.method !== 'GET') return res.status(405).json({error:'Method not allowed'});
  try {
    const [orders,contact] = await Promise.all([retryNotifications({}),retryContactEmails()]);
    return res.status(200).json({...orders,contact_processed:contact.processed});
  }
  catch (_) { console.error('ORDER_NOTIFICATION_WORKER_FAILED'); return res.status(503).json({error:'Retry worker failed'}); }
}
