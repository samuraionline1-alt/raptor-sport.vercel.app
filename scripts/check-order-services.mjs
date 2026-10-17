// Read-only production build check: never print keys or customer records.
if (process.env.VERCEL_ENV === 'production') {
  const { database } = await import('../lib/order-store.js');
  for (const table of ['raptor_orders', 'raptor_line_events']) {
    await database(`${table}?select=order_ref&limit=0`);
    console.log(`Order service check: ${table} accessible`);
  }
  const schema = await database('');
  if (!schema.paths?.['/rpc/raptor_record_order']) throw new Error('Order recording function is missing');
  console.log('Order service check: recording function available');
  if (!process.env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_')) throw new Error('Stripe webhook signing secret is missing or invalid');
  console.log('Order service check: Stripe webhook secret configured');
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error('LINE token is missing');
  for (const endpoint of ['quota', 'quota/consumption']) {
    const response = await fetch(`https://api.line.me/v2/bot/message/${endpoint}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) console.warn(`Order service check: LINE ${endpoint} HTTP_${response.status}`);
    else {
      const result = await response.json();
      console.log(`Order service check: LINE ${endpoint} ${JSON.stringify(result)}`);
    }
  }
}
