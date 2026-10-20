import { database, deliverEvent, deliverEmailEvent } from './order-store.js';
export async function retryNotifications({ budgetMs = 40000, channel } = {}) {
  const started = Date.now();
  let processed = 0;
  const cutoff = Date.parse(process.env.ORDER_NOTIFICATIONS_FROM || '');
  if (!Number.isFinite(cutoff)) throw new Error('Notification cutoff is required');
  // Failed rows get a future due time and sent rows leave the query. No first-page starvation.
  for (const kind of channel ? [channel] : ['line','email']) {
    if (kind === 'email' && (!process.env.RESEND_API_KEY || !process.env.ORDER_NOTIFICATION_EMAIL || !process.env.RESEND_EMAIL_DOMAIN)) continue;
    const prefix = kind === 'email' ? 'email_' : '';
    const channelStarted = Date.now(), channelBudget = channel ? budgetMs : budgetMs / 2;
    let channelProcessed = 0;
    while (Date.now() - started < budgetMs && Date.now() - channelStarted < channelBudget && channelProcessed < 100) {
      const now = new Date().toISOString();
      const rows = await database(`raptor_line_events?select=order_ref,event_type&created_at=gte.${encodeURIComponent(new Date(cutoff).toISOString())}&or=(and(${prefix}status.in.(pending,failed),${prefix}next_attempt_at.lte.${now}),and(${prefix}status.eq.sending,${prefix}lease_until.lt.${now}))&order=${prefix}next_attempt_at.asc,order_ref.asc,event_type.asc&limit=10`);
      if (!rows?.length) break;
      let progressed = false;
      for (const row of rows) {
        if (Date.now() - started >= budgetMs || Date.now() - channelStarted >= channelBudget || channelProcessed >= 100) break;
        const result = await (kind === 'email' ? deliverEmailEvent(row) : deliverEvent(row));
        processed++; channelProcessed++;
        if (!Object.values(result).includes('pending')) progressed = true;
      }
      if (!progressed) break; // Another worker owns the leases.
    }
  }
  await database(`raptor_rate_limits?window_start=lt.${encodeURIComponent(new Date(Date.now()-86400000).toISOString())}`, {method:'DELETE'});
  // Counts only; no customer data in the worker response/logs.
  const stale = new Date(Date.now()-15*60000).toISOString();
  const emailEnabled = Boolean(process.env.RESEND_API_KEY && process.env.ORDER_NOTIFICATION_EMAIL && process.env.RESEND_EMAIL_DOMAIN);
  const conditions = `status.eq.manual_review,and(status.neq.sent,status.neq.skipped,created_at.lt.${stale})`
    + (emailEnabled ? `,email_status.eq.manual_review,and(email_status.neq.sent,email_status.neq.skipped,created_at.lt.${stale})` : '');
  const backlog = await database(`raptor_line_events?select=order_ref&or=(${conditions})&limit=1`);
  if (backlog?.length) console.error('ORDER_NOTIFICATION_BACKLOG: inspect private order queue');
  return { processed, backlog: Boolean(backlog?.length) };
}
