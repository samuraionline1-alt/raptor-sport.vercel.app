import { waitUntil } from '@vercel/functions';
import { pushLine, lineOrderNotificationsEnabled } from './line-notifications.js';
import { sendOrderEmail } from './email-notifications.js';

export async function database(path, { method = 'GET', body, prefer } = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase is not configured');
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  // New Supabase secret keys belong in apikey, not in a JWT bearer header.
  if (!key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`;
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${path}`, {
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) {
    // Never log the database response: it can contain customer data.
    const error = new Error(`Order database request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

function eventFilter(order) {
  return `order_ref=eq.${encodeURIComponent(order.order_ref)}&event_type=eq.${encodeURIComponent(order.event_type)}`;
}

async function eventContext(order) {
  const rows = await database(`raptor_line_events?${eventFilter(order)}&select=*`);
  const row = rows?.[0];
  if (!row) throw new Error('Order event missing');
  const cutoff = Date.parse(process.env.ORDER_NOTIFICATIONS_FROM || '');
  if (!Number.isFinite(cutoff)) return { row, eligible: true };
  // The order timestamp, not the paid-event timestamp, identifies old orders.
  const orders = await database(`raptor_orders?order_ref=eq.${encodeURIComponent(order.order_ref)}&select=created_at`);
  const dates = [orders?.[0]?.created_at, row.created_at, row.payload.order_created_at]
    .map(value => Date.parse(value || '')).filter(Number.isFinite);
  return { row, eligible: dates.length > 0 && Math.min(...dates) >= cutoff };
}

async function deliverNotification(order, channel) {
  const email = channel === 'email';
  if (!email && !lineOrderNotificationsEnabled()) return { line_status: 'disabled' };
  const field = name => email ? 'email_' + name : name;
  const result = status => ({[email ? 'email_status' : 'line_status']: status});
  if (email && (!process.env.RESEND_API_KEY || !process.env.ORDER_NOTIFICATION_EMAIL || !process.env.RESEND_EMAIL_DOMAIN)) return result('not_configured');
  const { row, eligible } = await eventContext(order);
  const filter = eventFilter(order);
  if (!eligible) {
    await database(`raptor_line_events?${filter}`, { method: 'PATCH', body: { [field('status')]: 'skipped' } });
    return result('skipped');
  }
  if (row[field('status')] === 'sent' || (email && row.payload.email_delivery?.sent_at)) return result('sent');
  const rows = await database('rpc/raptor_claim_notification', { method: 'POST', body: {
    p_ref: order.order_ref, p_type: order.event_type, p_channel: channel
  } });
  if (!rows?.length) return result(row[field('status')] === 'manual_review' ? 'manual_review' : 'pending');
  const claimed = rows[0];
  try {
    if (email) await sendOrderEmail(claimed.payload); else await pushLine(claimed.payload);
    await database(`raptor_line_events?${filter}`, { method: 'PATCH', body: {
      [field('status')]: 'sent', [field('lease_until')]: null,
      [field('sent_at')]: new Date().toISOString(), [field('last_error')]: null
    } });
    return result('sent');
  } catch (error) {
    const reason = /^(LINE|EMAIL) [A-Z_0-9, ()-]+$/.test(error.message) ? error.message : `${channel.toUpperCase()} DELIVERY_OR_STATUS_UPDATE_FAILED`;
    console.error(reason);
    const attempts = claimed[field('attempts')];
    await database(`raptor_line_events?${filter}`, { method: 'PATCH', body: {
      [field('status')]: attempts >= 8 ? 'manual_review' : 'failed', [field('lease_until')]: null,
      [field('next_attempt_at')]: new Date(Date.now() + Math.min(3600000, 60000 * 2 ** attempts)).toISOString(),
      [field('last_error')]: reason
    } });
    return result('failed');
  }
}
export const deliverEmailEvent = order => deliverNotification(order, 'email');
export const deliverEvent = order => deliverNotification(order, 'line');

export async function recordAndNotify(order, { background = false } = {}) {
  await database('rpc/raptor_record_order', { method: 'POST', body: { p_order: order } });
  // Saving an order is authoritative. A delivery or status-update failure must
  // not tell a customer that their saved order was rejected.
  const delivery = Promise.allSettled([deliverEvent(order), deliverEmailEvent(order)]);
  if (background && process.env.VERCEL === '1') {
    waitUntil(delivery);
    return { line_status:'pending',email_status:'pending' };
  }
  const [line, email] = await delivery;
  if (line.status === 'rejected') console.error('LINE DELIVERY_OR_STATUS_UPDATE_FAILED');
  if (email.status === 'rejected') console.error('EMAIL DELIVERY_OR_STATUS_UPDATE_FAILED');
  return { ...(line.status === 'fulfilled' ? line.value : { line_status: 'pending' }),
    ...(email.status === 'fulfilled' ? email.value : { email_status: 'pending' }) };
}
