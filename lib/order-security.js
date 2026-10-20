import { createHash, timingSafeEqual } from 'node:crypto';
import { database } from './order-store.js';
import { OrderError, priceOrder } from './order-pricing.js';
// Only deployment configuration may select a preview origin; request bodies never can.
export const SITE_ORIGIN = process.env.VERCEL_ENV === 'preview' && /^[a-z0-9-]+\.vercel\.app$/.test(process.env.VERCEL_URL || '')
  ? `https://${process.env.VERCEL_URL}` : 'https://www.raptorthailand.com';
export function safePage(value, fallback = '/') {
  try {
    const url = new URL(value || fallback, SITE_ORIGIN);
    if (url.origin === SITE_ORIGIN && !url.username && !url.password && /^\/(?:products\/[a-z0-9-]+\/|wholesale\/)?$/.test(url.pathname)) return SITE_ORIGIN + url.pathname;
  } catch (_) {}
  return SITE_ORIGIN + fallback;
}
export function tokenHash(token) { return createHash('sha256').update(token).digest('hex'); }
export function authorized(order, token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) || !/^[a-f0-9]{64}$/.test(order?.receipt_token_hash || '')) return false;
  return timingSafeEqual(Buffer.from(tokenHash(token),'hex'), Buffer.from(order.receipt_token_hash,'hex'));
}
export function makeOrder(body, method) {
  const price = priceOrder(body);
  function text(key, max, required = true) {
    const value = typeof body[key] === 'string' ? body[key].trim() : '';
    if ((required && !value) || value.length > max) throw new OrderError('ข้อมูลผู้รับไม่ครบถ้วนหรือยาวเกินกำหนด');
    return value;
  }
  const ref = text('order_ref',80);
  const phone = text('phone',30).replace(/[^0-9]/g,'');
  if (!/^RPT-[A-Za-z0-9-]+$/.test(ref) || !/^0[689]\d{8}$/.test(phone)) throw new OrderError('รหัสออเดอร์หรือเบอร์มือถือไม่ถูกต้อง');
  const receiptToken = text('receipt_token',64);
  if (!/^[a-f0-9]{64}$/.test(receiptToken)) throw new OrderError('กรุณาโหลดหน้าสินค้าใหม่เพื่อสั่งซื้ออย่างปลอดภัย');
  const email = text('email',254,false);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new OrderError('อีเมลไม่ถูกต้อง');
  return { ...price, order_ref: ref, customer_name: text('customer_name',200), phone, address: text('address',500),
    email, note: text('note',500,false), page_url: safePage(body.page_url,price.order_channel === 'wholesale' ? '/wholesale/' : '/'),
    receipt_token_hash: tokenHash(receiptToken), payment_method: method,
    payment_status: method === 'COD' ? 'รอเก็บเงินปลายทาง' : 'รอชำระเงิน', event_type: method === 'COD' ? 'order_created' : 'checkout_initiated' };
}
export async function loadOrder(ref) {
  if (typeof ref !== 'string' || !/^RPT-[A-Za-z0-9-]{1,76}$/.test(ref)) return null;
  const rows = await database(`raptor_orders?order_ref=eq.${encodeURIComponent(ref)}&select=payload,payment_status,created_at`);
  return rows?.[0] ? { ...rows[0].payload, stored_status: rows[0].payment_status, order_created_at: rows[0].created_at } : null;
}
export async function limitRequest(req, scope, phone) {
  const origin = req.headers?.origin;
  const localOrigin = process.env.VERCEL !== '1' && process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '') && new URL(origin).host === req.headers?.host;
  if (origin && !localOrigin && ![SITE_ORIGIN,'https://raptorthailand.com'].includes(origin)) throw new OrderError('Origin is not allowed',403);
  // Vercel overwrites x-real-ip at its edge. Never trust arbitrary forwarded-for chains.
  const ip = req.headers?.['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
  for (const [identity,limit] of [[`ip:${ip}`,30],...(phone ? [[`phone:${phone}`,8]] : [])]) {
    const allowed = await database('rpc/raptor_rate_limit',{method:'POST',body:{p_key:tokenHash(`${scope}:${identity}`),p_limit:limit,p_window_seconds:600}});
    if (allowed !== true) throw new OrderError('ส่งคำขอถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',429);
  }
}
export function errorResponse(res,error,fallback) {
  const status = error instanceof OrderError ? error.status : error.status === 409 ? 409 : 503;
  if (status === 429) res.setHeader('Retry-After','600');
  return res.status(status).json({error:error instanceof OrderError ? error.message : status === 409 ? 'ข้อมูลออเดอร์เปลี่ยนแปลง กรุณาเริ่มสั่งซื้อใหม่' : fallback});
}
