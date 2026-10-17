import { createHash } from 'node:crypto';
import { Resend } from 'resend';
import { lineMessage } from './line-notifications.js';

export async function sendOrderEmail(order) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.ORDER_NOTIFICATION_EMAIL;
  const domain = process.env.RESEND_EMAIL_DOMAIN;
  if (!key || !to || !domain) throw new Error('EMAIL NOT_CONFIGURED');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) throw new Error('EMAIL INVALID_DOMAIN');
  const title = order.event_type === 'payment_succeeded' ? 'ชำระเงินสำเร็จ'
    : order.payment_method === 'COD' ? 'ออเดอร์ใหม่ COD' : 'ออเดอร์ใหม่ รอชำระออนไลน์';
  const idempotencyKey = createHash('sha256').update(`${to}:${order.order_ref}:${order.event_type}`).digest('hex');
  const { data, error } = await new Resend(key).emails.send({
    from: `RAPTOR Orders <orders@${domain}>`, to: [to],
    subject: `[RAPTOR] ${title} #${order.order_ref}`,
    text: lineMessage(order)
  }, { idempotencyKey, signal: AbortSignal.timeout(10000) });
  // Provider error messages may include addresses; retain only the status code.
  if (error || !data?.id) throw new Error(`EMAIL HTTP_${error?.statusCode || 'UNKNOWN'}`);
  return data.id;
}
