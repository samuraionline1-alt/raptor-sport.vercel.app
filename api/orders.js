import { recordAndNotify } from '../lib/order-store.js';
import promoConfig from '../promo-config.js';

export function validOrder(order) {
  return order && typeof order === 'object' && !Array.isArray(order)
    && ['order_ref', 'customer_name', 'phone', 'address', 'product'].every(key =>
      typeof order[key] === 'string' && order[key].trim().length > 0 && order[key].length <= (key === 'product' ? 4000 : 500))
    && /^RPT-[A-Za-z0-9-]+$/.test(order.order_ref)
    && /^\d{8,15}$/.test(order.phone)
    && Number.isInteger(Number(order.quantity)) && Number(order.quantity) > 0 && Number(order.quantity) <= 100000
    && Number.isFinite(Number(order.total_price)) && Number(order.total_price) > 0 && Number(order.total_price) <= 10000000;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const body = req.body;
  if (!validOrder(body) || body.payment_method !== 'COD') return res.status(400).json({ error: 'ข้อมูลคำสั่งซื้อไม่ครบถ้วน' });
  let promotion = {};
  if (body.subtotal != null) {
    promotion = promoConfig.calculate(Number(body.subtotal), body.bundleTier === 'custom' ? 'tier_' + body.quantity : body.bundleTier, body.coupon_code);
    if (!Number.isFinite(Number(body.subtotal)) || Number(body.subtotal) <= 0 || promotion.couponError
      || Math.abs(promotion.totalPrice - Number(body.total_price)) > 0.001) return res.status(400).json({ error: 'ยอดเงินหรือคูปองไม่ถูกต้อง' });
  } else if (body.coupon_code) return res.status(400).json({ error: 'ไม่พบยอดก่อนส่วนลด' });
  const order = Object.fromEntries(['order_ref', 'customer_name', 'phone', 'address', 'product', 'note', 'page_url', 'order_details', 'bundle_tier']
    .map(key => [key, String(body[key] || '').slice(0, key === 'product' || key === 'order_details' ? 4000 : 500)]));
  Object.assign(order, { quantity: Number(body.quantity), total_price: Number(body.total_price),
    coupon_code: promotion.coupon_code || '', discount_amount: promotion.discount_amount || 0, free_gifts: promotion.free_gifts || '',
    event_type: 'order_created', payment_method: 'COD', payment_status: 'รอเก็บเงินปลายทาง', order_channel: 'retail' });
  try {
    const delivery = await recordAndNotify(order);
    return res.status(200).json({ ok: true, order_ref: order.order_ref, ...delivery });
  } catch (_) { return res.status(503).json({ error: 'ยังบันทึกคำสั่งซื้อไม่ได้ กรุณาลองอีกครั้ง หรือติดต่อร้านค้า' }); }
}
