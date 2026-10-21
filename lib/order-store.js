import { pushLine } from './line-notifications.js';
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
  const rows = await database(`raptor_line_events?${eventFilter(order)}&select=payload,created_at`);
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

export async function deliverEmailEvent(order) {
  if (!process.env.RESEND_API_KEY || !process.env.ORDER_NOTIFICATION_EMAIL) return { email_status: 'not_configured' };
  const { row, eligible } = await eventContext(order);
  if (!eligible) return { email_status: 'skipped' };
  if (row.payload.email_delivery?.sent_at) return { email_status: 'sent' };
  try {
    const id = await sendOrderEmail(row.payload);
    await database(`raptor_line_events?${eventFilter(order)}`, { method: 'PATCH', body: {
      payload: { ...row.payload, email_delivery: { id, sent_at: new Date().toISOString() } }
    } });
    return { email_status: 'sent' };
  } catch (error) {
    const reason = /^EMAIL [A-Z_0-9]+$/.test(error.message) ? error.message : 'EMAIL DELIVERY_OR_STATUS_UPDATE_FAILED';
    console.error(reason);
    await database(`raptor_line_events?${eventFilter(order)}`, { method: 'PATCH', body: {
      payload: { ...row.payload, email_delivery: { last_error: reason } }
    } });
    return { email_status: 'failed' };
  }
}

export async function deliverEvent(order) {
  if (process.env.ORDER_NOTIFICATIONS_FROM && !(await eventContext(order)).eligible) return { line_status: 'skipped' };
  const filter = eventFilter(order);
  const now = new Date().toISOString();
  const rows = await database(`raptor_line_events?${filter}&or=(status.in.(pending,failed),and(status.eq.sending,lease_until.lt.${now}))`, {
    method: 'PATCH', prefer: 'return=representation',
    body: { status: 'sending', lease_until: new Date(Date.now() + 60000).toISOString() }
  });
  if (!rows?.length) {
    const existing = await database(`raptor_line_events?${filter}&select=status`);
    return { line_status: existing?.[0]?.status === 'sent' ? 'sent' : 'pending' };
  }
  const row = rows[0];
  try {
    await pushLine(row.payload);
  } catch (error) {
    const reason = /^LINE [A-Z_0-9, ()-]+$/.test(error.message) ? error.message : 'LINE DELIVERY_FAILED';
    await database(`raptor_line_events?${filter}`, { method: 'PATCH',
      body: { status: 'failed', lease_until: null, attempts: row.attempts + 1, last_error: reason } });
    console.error(reason);
    return { line_status: 'failed' };
  }
  await database(`raptor_line_events?${filter}`, { method: 'PATCH',
    body: { status: 'sent', lease_until: null, sent_at: new Date().toISOString(), attempts: row.attempts + 1, last_error: null } });
  return { line_status: 'sent' };
}

export async function recordAndNotify(order) {
  await database('rpc/raptor_record_order', { method: 'POST', body: { p_order: order } });
  // Saving an order is authoritative. A delivery or status-update failure must
  // not tell a customer that their saved order was rejected.
  const [line, email] = await Promise.allSettled([deliverEvent(order), deliverEmailEvent(order)]);
  if (line.status === 'rejected') console.error('LINE DELIVERY_OR_STATUS_UPDATE_FAILED');
  if (email.status === 'rejected') console.error('EMAIL DELIVERY_OR_STATUS_UPDATE_FAILED');
  return { ...(line.status === 'fulfilled' ? line.value : { line_status: 'pending' }),
    ...(email.status === 'fulfilled' ? email.value : { email_status: 'pending' }) };
}
