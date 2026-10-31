import { createHmac, timingSafeEqual } from 'node:crypto';

export function qrToken(id) {
  return createHmac('sha256', process.env.STRIPE_SECRET_KEY).update('promptpay:' + id).digest('hex');
}

export function validQrToken(id, token) {
  return /^pi_[A-Za-z0-9]+$/.test(id) && /^[a-f0-9]{64}$/.test(token)
    && timingSafeEqual(Buffer.from(qrToken(id), 'hex'), Buffer.from(token, 'hex'));
}

export async function createQrPayment({ metadata, totalPrice, orderRef, customerName, customerEmail }) {
  // PromptPay requires a billing email. Do not invent a customer's email address.
  if (!customerEmail) throw new Error('กรุณาระบุอีเมลสำหรับชำระเงิน PromptPay');
  const params = new URLSearchParams({
    amount: String(Math.round(totalPrice * 100)), currency: 'thb', confirm: 'true',
    'allowed_payment_method_types[0]': 'promptpay',
    'automatic_payment_methods[enabled]': 'true',
    'automatic_payment_methods[allow_redirects]': 'never',
    'payment_method_data[type]': 'promptpay',
    'payment_method_data[billing_details][name]': customerName,
    'payment_method_data[billing_details][email]': customerEmail,
    description: `[#${orderRef}] ${metadata.product}`
  });
  Object.entries({ ...metadata, payment_flow: 'downloadable_promptpay' }).forEach(([key, value]) => params.set(`metadata[${key}]`, value));
  const response = await fetch('https://api.stripe.com/v1/payment_intents', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': '2026-09-30.endive', 'Idempotency-Key': `promptpay-${orderRef}` }, body: params.toString()
  });
  const intent = await response.json();
  if (!response.ok || !intent.id || (!intent.next_action?.promptpay_display_qr_code && intent.status !== 'succeeded')) {
    throw new Error('ไม่สามารถสร้าง QR PromptPay ได้');
  }
  return { ...intent, url: `/pay-promptpay.html?id=${encodeURIComponent(intent.id)}&token=${qrToken(intent.id)}` };
}
