import { createHash } from 'node:crypto';
export function lineMessage(order) {
  const title = order.event_type === 'payment_succeeded' ? '✅ ชำระเงินออนไลน์สำเร็จแล้ว (PAID)!'
    : order.payment_method === 'COD' ? '🛒 มีออเดอร์ใหม่ (เก็บเงินปลายทาง COD)!'
    : '⏳ ลูกค้ากำลังสแกนจ่ายออนไลน์ (Stripe)!';
  const text = value => String(value ?? '').trim() || '-';
  return [title, `รหัสออเดอร์: #${text(order.order_ref)}`, `สินค้า: ${text(order.product)} (${order.quantity} ชิ้น)`,
    `ของแถม: ${text(order.free_gifts)}`, `คูปอง: ${text(order.coupon_code)}`,
    `ส่วนลด: ฿${Number(order.discount_amount) || 0}`, `ยอดสุทธิ: ฿${order.total_price}`,
    `วิธีชำระ: ${text(order.payment_method)} (${text(order.payment_status)})`, '',
    `ชื่อผู้รับ: ${text(order.customer_name)}`, `เบอร์โทร: ${text(order.phone)}`,
    `ที่อยู่จัดส่ง: ${text(order.address)}`, `หมายเหตุ/ภาษี: ${text(order.note)}`,
    ...(order.page_url ? [`หน้าสั่งซื้อ: ${text(order.page_url)}`] : [])].join('\n').slice(0, 5000);
}
export async function pushLine(order) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const admins = [...new Set(String(process.env.LINE_ADMIN_USER_ID || '').split(',').map(id => id.trim()).filter(Boolean))];
  if (!token || !admins.length) throw new Error('LINE is not configured');
  const results = await Promise.allSettled(admins.map(async to => {
    // LINE deduplicates retries of the same order event for each recipient.
    const hex = createHash('sha256').update(`${to}:${order.order_ref}:${order.event_type}`).digest('hex');
    const retryKey = `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Line-Retry-Key': retryKey },
      body: JSON.stringify({ to, messages: [{ type: 'text', text: lineMessage(order) }] }),
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok && !(response.status === 409 && response.headers?.get('x-line-accepted-request-id'))) throw new Error('LINE push failed');
  }));
  if (results.some(result => result.status === 'rejected')) throw new Error('LINE delivery failed');
}
