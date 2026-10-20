import { createHash } from 'node:crypto';
import { database, recordAndNotify } from '../lib/order-store.js';
import { makeOrder, limitRequest, errorResponse, SITE_ORIGIN, loadOrder } from '../lib/order-security.js';
import { OrderError } from '../lib/order-pricing.js';
import { stripeRequest } from '../lib/stripe-client.js';
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if (req.method !== 'POST') { res.setHeader('Allow','POST'); return res.status(405).json({error:'Method not allowed'}); }
  try {
    const order = makeOrder(req.body,'STRIPE');
    if (order.total_cents > 99999999) throw new OrderError('ยอดนี้เกินวงเงินชำระออนไลน์ กรุณาติดต่อ LINE @raptor เพื่อสั่งซื้อ');
    await limitRequest(req,'order',order.phone);
    // Persist the complete immutable catalog quote before creating a payable session.
    await database('rpc/raptor_record_order',{method:'POST',body:{p_order:order}});
    const stored = await loadOrder(order.order_ref);
    if (!stored || stored.stored_status === 'paid') return res.status(409).json({error:'ออเดอร์นี้ชำระเงินแล้ว กรุณาตรวจสอบใบรับคำสั่งซื้อ'});
    const destination = SITE_ORIGIN + (order.order_channel === 'wholesale' ? '/wholesale/' : '/thank-you/');
    const integrationSuffix = createHash('sha256').update(order.order_ref).digest('hex').slice(0,8).replace(/[0-9]/g,n => String.fromCharCode(97+Number(n)));
    const params = new URLSearchParams({mode:'payment', integration_identifier:`raptor_${integrationSuffix}`,
      'line_items[0][price_data][currency]':'thb',
      'line_items[0][price_data][product_data][name]':`RAPTOR ${order.order_channel === 'wholesale' ? 'ราคาส่ง' : 'สินค้า'} (${order.quantity} ชิ้น)`,
      'line_items[0][price_data][product_data][description]':`รหัสสั่งซื้อ: ${order.order_ref}`,
      'line_items[0][price_data][unit_amount]':String(order.total_cents),'line_items[0][quantity]':'1',
      success_url:`${destination}?payment=stripe_success&order_ref=${encodeURIComponent(order.order_ref)}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:order.page_url,
      'metadata[order_ref]':order.order_ref,'metadata[order_channel]':order.order_channel,
      'payment_intent_data[metadata][order_ref]':order.order_ref,'payment_intent_data[metadata][order_channel]':order.order_channel
    });
    if (order.email) params.set('customer_email',order.email);
    let session;
    if (stored.stripe_session_id) {
      session = await stripeRequest(`checkout/sessions/${encodeURIComponent(stored.stripe_session_id)}`);
    } else {
      session = await stripeRequest('checkout/sessions',{method:'POST',params,idempotencyKey:`checkout-v2-${order.order_ref}`});
    }
    if (session.status === 'expired') return res.status(409).json({error:'หน้าชำระเงินหมดอายุ กรุณาเริ่มคำสั่งซื้อใหม่',code:'CHECKOUT_EXPIRED'});
    if (!session.url || !/^cs_(?:test_|live_)?[A-Za-z0-9]+$/.test(session.id || '')) throw new Error('Invalid checkout session');
    const paymentUrl = new URL(session.url);
    if (paymentUrl.origin !== 'https://checkout.stripe.com') throw new Error('Invalid checkout URL');
    await database('rpc/raptor_attach_checkout',{method:'POST',body:{p_ref:order.order_ref,p_session_id:session.id}});
    const delivery = await recordAndNotify({...stored,stripe_session_id:session.id,event_type:'checkout_initiated'},{background:true});
    return res.status(200).json({url:session.url,order_ref:order.order_ref,...delivery});
  } catch(error) { return errorResponse(res,error,'ไม่สามารถเปิดหน้าชำระเงินได้ กรุณาลองอีกครั้ง'); }
}
