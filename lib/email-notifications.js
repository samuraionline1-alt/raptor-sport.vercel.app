import { createHash } from 'node:crypto';
import { lineMessage, orderPageLink } from './line-notifications.js';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

export function orderEmailHtml(order) {
  const content = escapeHtml(lineMessage({ ...order, page_url: '' })).replace(/\n/g, '<br>');
  let link = '';
  try {
    const url = new URL(orderPageLink(order.page_url));
    if (['https:', 'http:'].includes(url.protocol)) link = `<p><a href="${escapeHtml(url.href)}">เปิดหน้าสั่งซื้อ</a></p>`;
  } catch (_) { /* A missing or invalid page URL must not block the order email. */ }
  return `<div style="font-family:Tahoma,Arial,sans-serif;font-size:14px;line-height:1.7;color:#222">${content}${link}</div>`;
}

export async function sendOrderEmail(order) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.ORDER_NOTIFICATION_EMAIL;
  const domain = process.env.RESEND_EMAIL_DOMAIN;
  if (!key || !to || !domain) throw new Error('EMAIL NOT_CONFIGURED');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) throw new Error('EMAIL INVALID_DOMAIN');
  const title = order.event_type === 'payment_succeeded' ? 'ชำระเงินสำเร็จ'
    : order.payment_method === 'COD' ? 'ออเดอร์ใหม่ COD' : 'ออเดอร์ใหม่ รอชำระออนไลน์';
  const idempotencyKey = createHash('sha256').update(`${to}:${order.order_ref}:${order.event_type}`).digest('hex');
  const response = await fetch('https://api.resend.com/emails', {
    method:'POST', headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','Idempotency-Key':idempotencyKey},
    body:JSON.stringify({from:`RAPTOR Orders <orders@${domain}>`,to:[to],subject:`[RAPTOR] ${title} #${order.order_ref}`,
      text:lineMessage(order),html:orderEmailHtml(order)}), signal:AbortSignal.timeout(10000)
  });
  // Do not parse or log provider error bodies, including in preview/local environments.
  if (!response.ok) throw new Error(`EMAIL HTTP_${response.status}`);
  const data = await response.json();
  if (!data?.id) throw new Error('EMAIL INVALID_RESPONSE');
  return data.id;
}
