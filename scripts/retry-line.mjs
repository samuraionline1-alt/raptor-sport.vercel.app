// Run only on a trusted server with SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// LINE_CHANNEL_ACCESS_TOKEN, and the existing recipient environment variables.
import { database, deliverEvent } from '../lib/order-store.js';
const now = new Date().toISOString();
const rows = await database(`raptor_line_events?select=order_ref,event_type&or=(status.in.(pending,failed),and(status.eq.sending,lease_until.lt.${now}))&order=created_at.asc&limit=50`);
for (const row of rows) {
  const result = await deliverEvent(row);
  console.log(`${row.order_ref} ${row.event_type}: ${result.line_status}`);
}
