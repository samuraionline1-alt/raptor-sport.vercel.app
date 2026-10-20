import createOrder from './orders.js';
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  // Legacy COD callers still pass through the same pricing, access and abuse controls.
  if (req.method === 'POST' && req.body?.payment_method === 'COD' && req.body?.event_type === 'order_created') return createOrder(req,res);
  return res.status(410).json({error:'Payment notifications are handled by the verified Stripe webhook'});
}
