import { authorized, loadOrder, limitRequest, errorResponse } from '../lib/order-security.js';
import { stripeRequest } from '../lib/stripe-client.js';
import { fulfillPayment, publicReceipt, paidOrder } from '../lib/payment-orders.js';
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if (req.method !== 'GET') { res.setHeader('Allow','GET'); return res.status(405).json({error:'Method not allowed'}); }
  try {
    await limitRequest(req,'receipt');
    const order = await loadOrder(req.query?.order_ref);
    if (!order || !authorized(order,req.headers?.['x-order-token'])) return res.status(403).json({error:'ไม่สามารถยืนยันสิทธิ์ดูออเดอร์ กรุณาเปิดจากเครื่องที่สั่งซื้อหรือติดต่อร้านค้า'});
    if (order.payment_method === 'COD') return res.status(200).json(publicReceipt(order));
    const sessionId = String(req.query?.session_id || '');
    if (!/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(sessionId) || order.stripe_session_id !== sessionId) return res.status(400).json({error:'Invalid session ID'});
    const session = await stripeRequest('checkout/sessions/' + encodeURIComponent(sessionId));
    if (session.status !== 'complete' || session.payment_status !== 'paid') return res.status(409).json({error:'ยังยืนยันการชำระเงินไม่ได้ กรุณารอสักครู่แล้วตรวจสอบอีกครั้ง'});
    const verified = await paidOrder(session);
    await fulfillPayment(session,{background:true});
    return res.status(200).json(publicReceipt(verified));
  } catch(error) { return errorResponse(res,error,'ยังตรวจสอบสถานะไม่ได้ กรุณาลองอีกครั้ง'); }
}
