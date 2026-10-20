import { database, recordAndNotify } from './order-store.js';
import { loadOrder } from './order-security.js';
export async function paidOrder(session) {
  const order = await loadOrder(session?.metadata?.order_ref);
  if (!order) throw new Error('Order not found');
  const expected = order.total_cents ?? Math.round(order.total_price * 100);
  if (session.currency !== 'thb' || session.payment_status !== 'paid' || order.payment_method !== 'STRIPE'
    || session.metadata.order_channel !== order.order_channel || session.amount_total !== expected
    || order.stripe_session_id !== session.id) throw new Error('Payment/order mismatch');
  return {...order,event_type:'payment_succeeded',payment_status:'ชำระเงินสำเร็จ (PAID)'};
}
export async function fulfillPayment(session, options) {
  const order = await paidOrder(session);
  // This is also called by the authenticated receipt path as a recovery; RPC is idempotent.
  return recordAndNotify(order,options);
}
export function publicReceipt(order) {
  // No name, phone, address, tax ID or note is returned to a browser receipt.
  return {order_ref:order.order_ref,order_channel:order.order_channel,payment_status:order.payment_method === 'COD' ? 'cod' : 'paid',
    product:order.product,quantity:order.quantity,total_price:order.total_price,items:order.items || [],
    subtotal:order.subtotal,shipping_cost:order.shipping_cost,vat_amount:order.vat_amount,
    coupon_code:order.coupon_code || '',discount_amount:order.discount_amount || 0,free_gifts:order.free_gifts || ''};
}
