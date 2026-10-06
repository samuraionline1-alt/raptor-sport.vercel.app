import { waitUntil } from '@vercel/functions';
import { pushLine } from '../lib/line-notifications.js';
import promoConfig from '../promo-config.js';
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

function successUrl(body, totalPrice, product, quantity, orderRef, customerName, phone) {
  let destination = SITE_ORIGIN + (body.is_wholesale === true ? '/wholesale/' : '/thank-you.html');
  if (!body.is_wholesale && body.success_url) {
    try {
      const override = new URL(body.success_url, SITE_ORIGIN);
      if (override.origin === SITE_ORIGIN || override.hostname.endsWith('.vercel.app')) destination = override.toString();
    } catch (_) {}
  }
  const url = new URL(destination);
  Object.entries({ payment: 'stripe_success', paid: '1', value: totalPrice, product, qty: quantity,
    order_ref: orderRef, customer_name: customerName, phone }).forEach(([key, value]) => url.searchParams.set(key, value));
  url.searchParams.delete('session_id');
  return url.toString() + '&session_id={CHECKOUT_SESSION_ID}';
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
  const totalPrice = Number(body.total_price ?? body.totalPrice);
  let promotion = { coupon_code: '', discount_amount: 0, free_gifts: '' };
  if (body.is_wholesale !== true && body.subtotal != null) {
    const subtotal = Number(body.subtotal);
    const tier = body.bundleTier === 'custom' ? 'tier_' + quantity : body.bundleTier;
    promotion = promoConfig.calculate(subtotal, tier, body.coupon_code);
    if (!Number.isFinite(subtotal) || subtotal <= 0 || promotion.couponError || Math.abs(promotion.totalPrice - totalPrice) > 0.001) {
      return res.status(400).json({ error: 'Invalid promotion or discounted total' });
    }
  } else if (body.is_wholesale !== true && body.coupon_code) {
    return res.status(400).json({ error: 'Missing bundle subtotal' });
  }
  if (!product || !Number.isFinite(totalPrice) || totalPrice <= 0) {
    return res.status(400).json({ error: 'Invalid product or total price' });
  }

  const cleanPhone = safeText(body.phone, 50).replace(/[^0-9]/g, "");
  const customerName = safeText(body.customer_name, 200);
  if (typeof body.order_ref !== 'string' || !body.order_ref || body.order_ref.length > 200) {
    return res.status(400).json({ error: 'Missing or invalid order reference' });
  }
  const orderRef = body.order_ref;
  const metadata = {
    coupon_code: promotion.coupon_code,
    discount_amount: String(promotion.discount_amount),
    free_gifts: safeText(promotion.free_gifts, 500),
    order_ref: orderRef,
    order_channel: body.is_wholesale === true ? "wholesale" : "retail",
    customer_name: customerName,
    phone: cleanPhone,
    address: safeText(body.address, 500),
    product,
    quantity: String(quantity),
    order_details: safeText(body.order_details, 500),
    note: safeText(body.note, 500),
    page_url: safeText(body.page_url, 500),
    bundle_tier: `เซ็ต ${quantity} ชิ้น (฿${totalPrice})`
  };
  const params = new URLSearchParams({
    mode: 'payment',
    'payment_method_types[0]': 'promptpay',
    'payment_method_types[1]': 'card',
    'line_items[0][price_data][currency]': 'thb',
    'line_items[0][price_data][product_data][name]': `${product} (จำนวน ${quantity} ชิ้น)`,
    'line_items[0][price_data][product_data][description]': `รหัสสั่งซื้อ: #${orderRef} | ผู้รับ: ${customerName} (${cleanPhone})${promotion.free_gifts ? " | ของแถม: " + promotion.free_gifts : ""}${promotion.coupon_code ? " | คูปอง: " + promotion.coupon_code : ""}`,
    'payment_intent_data[description]': `[#${orderRef}] ${product} (${quantity} ชิ้น) - ลูกค้า: ${customerName} (${cleanPhone})`,
    // The line item represents the complete bundle so Stripe charges the exact discounted total.
    'line_items[0][price_data][unit_amount]': String(Math.round(totalPrice * 100)),
    'line_items[0][quantity]': '1',
    success_url: successUrl(body, totalPrice, product, quantity, orderRef, customerName, cleanPhone),
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
    // Keep delivery alive after the response without delaying Stripe checkout.
    waitUntil(pushLine({ ...metadata, total_price: totalPrice, event_type: 'checkout_initiated', payment_method: 'STRIPE', payment_status: 'รอสแกนชำระเงิน' })
      .catch(() => console.error('LINE checkout notification could not be delivered')));
    return res.status(200).json({ url: session.url });
  } catch (_) {
    return res.status(502).json({ error: 'Unable to connect to Stripe' });
  }
}
