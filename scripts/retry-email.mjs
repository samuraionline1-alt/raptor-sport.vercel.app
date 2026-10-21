import { database, deliverEmailEvent } from '../lib/order-store.js';
if (!process.env.ORDER_NOTIFICATIONS_FROM) throw new Error('Set the original notification cutoff before retrying');
const rows = await database(`raptor_line_events?select=order_ref,event_type&created_at=gte.${encodeURIComponent(process.env.ORDER_NOTIFICATIONS_FROM)}&order=created_at.asc&limit=50`);
for (const row of rows) {
  const result = await deliverEmailEvent(row);
  console.log(`${row.order_ref} ${row.event_type}: ${result.email_status}`);
}
