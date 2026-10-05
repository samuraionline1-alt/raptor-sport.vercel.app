export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const sessionId = String(req.query?.session_id || '');
  if (!/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(sessionId)) return res.status(400).json({ error: 'Invalid session ID' });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Stripe is not configured' });
  try {
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(sessionId), {
      headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` }
    });
    const session = await response.json();
    if (!response.ok) return res.status(502).json({ error: 'Unable to verify payment' });
    if (session.status !== 'complete' || session.payment_status !== 'paid' || !session.metadata?.order_ref) {
      return res.status(409).json({ error: 'Payment is not confirmed' });
    }
    const metadata = session.metadata;
    return res.status(200).json({ payment_status: 'paid', order_ref: metadata.order_ref,
      order_channel: metadata.order_channel, customer_name: metadata.customer_name,
      phone: metadata.phone, address: metadata.address, product: metadata.product,
      quantity: metadata.quantity, coupon_code: metadata.coupon_code || "",
      discount_amount: Number(metadata.discount_amount || 0), free_gifts: metadata.free_gifts || "",
      order_details: metadata.order_details || "", total_price: session.amount_total / 100 });
  } catch (_) { return res.status(502).json({ error: 'Unable to connect to Stripe' }); }
}
