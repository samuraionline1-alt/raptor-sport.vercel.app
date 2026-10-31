import { validQrToken } from '../lib/promptpay.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  const id = String(req.query?.id || ''), token = String(req.query?.token || '');
  if (!process.env.STRIPE_SECRET_KEY || !validQrToken(id, token)) return res.status(403).json({ error: 'ลิงก์ชำระเงินไม่ถูกต้อง' });
  try {
    const response = await fetch('https://api.stripe.com/v1/payment_intents/' + id, {
      headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` }
    });
    const intent = await response.json();
    if (!response.ok || intent.metadata?.payment_flow !== 'downloadable_promptpay') return res.status(404).json({ error: 'ไม่พบรายการชำระเงิน' });
    const qr = intent.next_action?.promptpay_display_qr_code;
    if (req.query?.image === '1') {
      if (!qr?.image_url_png || intent.status !== 'requires_action' || qr.expires_at * 1000 <= Date.now()) return res.status(410).json({ error: 'QR หมดอายุหรือชำระแล้ว' });
      const imageUrl = new URL(qr.image_url_png);
      if (imageUrl.protocol !== 'https:' || !imageUrl.hostname.endsWith('.stripe.com')) throw new Error('Invalid QR image');
      const image = await fetch(imageUrl, { redirect: 'error' });
      if (!image.ok || !image.headers.get('content-type')?.startsWith('image/png')) throw new Error('Unable to load QR');
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="RAPTOR-PromptPay.png"`);
      return res.status(200).send(Buffer.from(await image.arrayBuffer()));
    }
    return res.status(200).json({ status: intent.status, amount: intent.amount / 100,
      order_ref: intent.metadata.order_ref, expires_at: qr?.expires_at || null,
      wholesale: intent.metadata.order_channel === 'wholesale' });
  } catch (_) { return res.status(502).json({ error: 'เชื่อมต่อระบบชำระเงินไม่ได้ กรุณาลองอีกครั้ง' }); }
}
