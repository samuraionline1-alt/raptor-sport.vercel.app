import { lineOrderNotificationsEnabled } from './line-notifications.js';
import { database, deliverEvent, deliverEmailEvent } from './order-store.js';
export async function retryNotifications({ budgetMs = 40000, channel } = {}) {
  const started = Date.now();
  let processed = 0;
  const cutoff = Date.parse(process.env.ORDER_NOTIFICATIONS_FROM || '');
  if (!Number.isFinite(cutoff)) throw new Error('Notification cutoff is required');
  const enabledChannels = [
    ...(lineOrderNotificationsEnabled() ? ['line'] : []),
    ...(process.env.RESEND_API_KEY && process.env.ORDER_NOTIFICATION_EMAIL && process.env.RESEND_EMAIL_DOMAIN ? ['email'] : [])
  ];
  const channels = channel ? enabledChannels.filter(kind => kind === channel) : enabledChannels;
  // Failed rows get a future due time and sent rows leave the query. No first-page starvation.
  for (const kind of channels) {
    const prefix = kind === 'email' ? 'email_' : '';
    const channelStarted = Date.now(), channelBudget = budgetMs / channels.length;
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
  const conditions = enabledChannels.map(kind => {
    const field = kind === 'email' ? 'email_status' : 'status';
    return `${field}.eq.manual_review,and(${field}.neq.sent,${field}.neq.skipped,created_at.lt.${stale})`;
  }).join(',');
  const backlog = conditions ? await database(`raptor_line_events?select=order_ref&or=(${conditions})&limit=1`) : [];
  if (backlog?.length) console.error('ORDER_NOTIFICATION_BACKLOG: inspect private order queue');
  return { processed, backlog: Boolean(backlog?.length) };
}
