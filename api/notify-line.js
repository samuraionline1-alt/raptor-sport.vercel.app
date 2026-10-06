import { pushLine } from '../lib/line-notifications.js';
import confirmPayment from './confirm-payment.js';
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  let order = req.body || {};
  if (!order.order_ref || !order.product || !Number.isInteger(Number(order.quantity)) || Number(order.quantity) < 1 || !Number.isFinite(Number(order.total_price)) || Number(order.total_price) <= 0 || !order.customer_name || !order.phone || !order.address) {
    return res.status(400).json({ error: 'Invalid order payload' });
  }
  if (order.event_type === 'payment_succeeded') {
    let code, receipt;
    await confirmPayment({ method: 'GET', query: { session_id: order.stripe_session_id } }, {
      setHeader() {}, status(value) { code = value; return this; }, json(value) { receipt = value; return this; }
    });
    if (code !== 200 || receipt.order_ref !== order.order_ref) return res.status(409).json({ error: 'Payment is not confirmed' });
    order = { ...receipt, event_type: 'payment_succeeded', payment_method: 'STRIPE', payment_status: 'ชำระเงินสำเร็จ (PAID)', note: receipt.note || '', page_url: receipt.page_url || '' };
  } else if (order.payment_method === 'STRIPE' && order.event_type === 'checkout_initiated') {
    order = { ...order, payment_status: 'รอสแกนชำระเงิน' };
  } else if (order.payment_method !== 'COD' || order.event_type !== 'order_created') {
    return res.status(400).json({ error: 'Invalid order event' });
  } else order = { ...order, payment_status: 'รอเก็บเงินปลายทาง' };
  try { await pushLine(order); return res.status(200).json({ ok: true }); }
  catch (_) { return res.status(502).json({ error: 'Unable to deliver LINE notification' }); }
}
