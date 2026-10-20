export async function stripeRequest(path, { method = 'GET', params, idempotencyKey } = {}) {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('Stripe is not configured');
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method, headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'Stripe-Version': '2026-08-26.dahlia',
      ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
    ...(params ? { body: params.toString() } : {}), signal: AbortSignal.timeout(12000)
  });
  const data = await response.json();
  if (!response.ok) { const error = new Error('Payment service unavailable'); error.status = response.status === 409 ? 409 : 502; throw error; }
  return data;
}
