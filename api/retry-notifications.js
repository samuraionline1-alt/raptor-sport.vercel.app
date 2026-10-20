import { timingSafeEqual } from 'node:crypto';
import { retryNotifications } from '../lib/notification-worker.js';
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`;
  const actual = String(req.headers?.authorization || '');
  if (!process.env.CRON_SECRET || Buffer.byteLength(actual) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(actual),Buffer.from(expected))) return res.status(401).json({error:'Unauthorized'});
  if (req.method !== 'GET') return res.status(405).json({error:'Method not allowed'});
  try { return res.status(200).json(await retryNotifications({})); }
  catch (_) { console.error('ORDER_NOTIFICATION_WORKER_FAILED'); return res.status(503).json({error:'Retry worker failed'}); }
}
