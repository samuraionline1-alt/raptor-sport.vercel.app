const STRIPE_ENDPOINT = 'https://api.stripe.com/v1/checkout/sessions';
const SITE_ORIGIN = 'https://www.raptorthailand.com';

function safeText(value, maxLength = 500) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function cancelUrl(pageUrl) {
  try {
    const url = new URL(pageUrl, SITE_ORIGIN);
    if (url.origin === SITE_ORIGIN || url.hostname.endsWith('.vercel.app')) return url.toString();
  } catch (_) {
    // Fall through to the storefront when an invalid URL is supplied.
  }
  return SITE_ORIGIN + '/';
}

function successUrl(body, totalPrice, product, quantity) {
  if (body.is_wholesale === true) {
    return `${SITE_ORIGIN}/wholesale/?payment=stripe_success&value=${encodeURIComponent(totalPrice)}&qty=${encodeURIComponent(quantity)}&session_id={CHECKOUT_SESSION_ID}`;
  }
  if (body.success_url) {
    try {
      const url = new URL(body.success_url, SITE_ORIGIN);
      if (url.origin === SITE_ORIGIN || url.hostname.endsWith('.vercel.app')) return url.toString();
    } catch (_) {
      // Ignore unsafe or invalid overrides and use the standard receipt page.
    }
  }
  return `${SITE_ORIGIN}/thank-you.html?payment=stripe_success&value=${encodeURIComponent(totalPrice)}&product=${encodeURIComponent(product)}&qty=${quantity}&session_id={CHECKOUT_SESSION_ID}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'Stripe is not configured' });
  }

  const body = req.body || {};
  const product = safeText(body.product, 200);
  const quantity = Math.max(1, Math.floor(Number(body.quantity)) || 1);
  const totalPrice = Number(body.totalPrice);
  if (!product || !Number.isFinite(totalPrice) || totalPrice <= 0) {
    return res.status(400).json({ error: 'Invalid product or total price' });
  }

  const metadata = {
    customer_name: safeText(body.customer_name, 200),
    phone: safeText(body.phone, 50),
    address: safeText(body.address, 500),
    product,
    quantity: String(quantity),
    order_details: safeText(body.order_details, 500),
    bundle_tier: safeText(body.bundleTier, 100)
  };
  const params = new URLSearchParams({
    mode: 'payment',
    'payment_method_types[0]': 'promptpay',
    'payment_method_types[1]': 'card',
    'line_items[0][price_data][currency]': 'thb',
    'line_items[0][price_data][product_data][name]': product,
    // The line item represents the complete bundle so Stripe charges the exact discounted total.
    'line_items[0][price_data][unit_amount]': String(Math.round(totalPrice * 100)),
    'line_items[0][quantity]': '1',
    success_url: successUrl(body, totalPrice, product, quantity),
    cancel_url: cancelUrl(body.page_url)
  });
  const customerEmail = safeText(body.email, 254);
  if (customerEmail) params.set('customer_email', customerEmail);
  Object.entries(metadata).forEach(([key, value]) => {
    params.set(`metadata[${key}]`, value);
    params.set(`payment_intent_data[metadata][${key}]`, value);
  });

  try {
    const stripeResponse = await fetch(STRIPE_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });
    const session = await stripeResponse.json();
    if (!stripeResponse.ok || !session.url) {
      return res.status(stripeResponse.status || 502).json({ error: session.error?.message || 'Unable to create checkout session' });
    }
    return res.status(200).json({ url: session.url });
  } catch (_) {
    return res.status(502).json({ error: 'Unable to connect to Stripe' });
  }
}
