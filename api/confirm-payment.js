export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const sessionId = String(req.query?.session_id || '');
  const isIntent = /^pi_[A-Za-z0-9]+$/.test(sessionId);
  if (!isIntent && !/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(sessionId)) return res.status(400).json({ error: 'Invalid session ID' });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Stripe is not configured' });
  try {
    const response = await fetch('https://api.stripe.com/v1/' + (isIntent ? 'payment_intents/' : 'checkout/sessions/') + encodeURIComponent(sessionId), {
      headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` }
    });
    let session = await response.json();
    if (isIntent) {
      if (session.metadata?.payment_flow !== 'downloadable_promptpay' || session.currency !== 'thb') return res.status(409).json({ error: 'Invalid payment' });
      session = { ...session, status: session.status === 'succeeded' ? 'complete' : session.status,
        payment_status: session.status === 'succeeded' ? 'paid' : 'unpaid', amount_total: session.amount_received };
    }
    if (!response.ok) return res.status(502).json({ error: 'Unable to verify payment' });
    if (session.status !== 'complete' || session.payment_status !== 'paid' || !session.metadata?.order_ref) {
      return res.status(409).json({ error: 'Payment is not confirmed' });
    }
    const metadata = session.metadata;
    return res.status(200).json({ payment_status: 'paid', order_ref: metadata.order_ref,
      ...(session.created ? { order_created_at: new Date(session.created * 1000).toISOString() } : {}),
      order_channel: metadata.order_channel, customer_name: metadata.customer_name,
      phone: metadata.phone, address: metadata.address, product: metadata.product,
      quantity: metadata.quantity, coupon_code: metadata.coupon_code || "",
      discount_amount: Number(metadata.discount_amount || 0), free_gifts: metadata.free_gifts || "",
      note: metadata.note || "", page_url: metadata.page_url || "",
      order_details: metadata.order_details || "", total_price: session.amount_total / 100 });
  } catch (_) { return res.status(502).json({ error: 'Unable to connect to Stripe' }); }
}
