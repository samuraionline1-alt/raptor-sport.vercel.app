// Read-only production build check: never print keys or customer records.
import { lineOrderNotificationsEnabled } from '../lib/line-notifications.js';
if (process.env.VERCEL_ENV === 'production') {
  const { database } = await import('../lib/order-store.js');
  for (const table of ['raptor_orders', 'raptor_line_events', 'raptor_order_items', 'raptor_contact_messages']) {
    await database(`${table}?select=${table === 'raptor_contact_messages' ? 'id' : 'order_ref'}&limit=0`);
    console.log(`Order service check: ${table} accessible`);
  }
  const schema = await database('');
  for (const rpc of ['raptor_record_order','raptor_attach_checkout','raptor_claim_notification','raptor_rate_limit','raptor_claim_contact_email']) {
    if (!schema.paths?.['/rpc/' + rpc]) throw new Error('Required order migration is missing: ' + rpc);
  }
  if (!process.env.CRON_SECRET || process.env.CRON_SECRET.length < 32) throw new Error('Set a strong CRON_SECRET before enabling notification retries');
  if (!Number.isFinite(Date.parse(process.env.ORDER_NOTIFICATIONS_FROM || ''))) throw new Error('Original notification cutoff is missing');
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('Stripe API key is missing');
  console.log('Order service check: recording function available');
  if (!process.env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_')) throw new Error('Stripe webhook signing secret is missing or invalid');
  console.log('Order service check: Stripe webhook secret configured');
  if (process.env.RESEND_API_KEY) {
    if (!process.env.ORDER_NOTIFICATION_EMAIL || !process.env.RESEND_EMAIL_DOMAIN || !process.env.ORDER_NOTIFICATIONS_FROM) throw new Error('Email recipient or notification cutoff is missing');
  }
  if (!lineOrderNotificationsEnabled()) {
    if (!process.env.RESEND_API_KEY || !process.env.ORDER_NOTIFICATION_EMAIL || !process.env.RESEND_EMAIL_DOMAIN) throw new Error('Email-only order alerts require the Resend integration, domain and recipient');
    console.log('Order service check: email-only alerts configured; LINE alerts paused');
  } else {
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
}
