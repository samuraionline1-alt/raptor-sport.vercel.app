// Read-only production build check: never print keys or customer records.
if (process.env.VERCEL_ENV === 'production') {
  const { database } = await import('../lib/order-store.js');
  for (const table of ['raptor_orders', 'raptor_line_events']) {
    await database(`${table}?select=order_ref&limit=0`);
    console.log(`Order service check: ${table} accessible`);
  }
  const schema = await database('');
  if (!schema.paths?.['/rpc/raptor_record_order']) throw new Error('Order recording function is missing');
  console.log('Order service check: recording function available');
  if (!process.env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_')) throw new Error('Stripe webhook signing secret is missing or invalid');
  console.log('Order service check: Stripe webhook secret configured');
  if (process.env.RESEND_API_KEY) {
    if (!process.env.ORDER_NOTIFICATION_EMAIL || !process.env.ORDER_NOTIFICATIONS_FROM) throw new Error('Email recipient or notification cutoff is missing');
    if (process.env.ORDER_EMAIL_SEND_TEST === '1') {
      const { Resend } = await import('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      const { data, error } = await resend.emails.send({
        from: `RAPTOR Orders <orders@${process.env.RESEND_EMAIL_DOMAIN}>`,
        to: [process.env.ORDER_NOTIFICATION_EMAIL], subject: '[RAPTOR] ทดสอบแจ้งเตือนออเดอร์ทางอีเมล',
        text: 'อีเมลทดสอบระบบแจ้งเตือน RAPTOR เท่านั้น ไม่มีออเดอร์และไม่ต้องจัดส่งสินค้า\n\nตั้งค่าให้ส่งแจ้งเตือนออเดอร์ใหม่มาที่อีเมลนี้ โดยไม่ส่งออเดอร์เก่าย้อนหลัง\nกรุณาตรวจสอบว่าได้รับอีเมลฉบับนี้แล้ว'
      }, { idempotencyKey: `raptor-email-setup-${process.env.ORDER_NOTIFICATIONS_FROM}` });
      if (error || !data?.id) throw new Error(`Email setup test failed: HTTP_${error?.statusCode || 'UNKNOWN'}`);
      console.log(`Order service check: test email accepted, id=${data.id}`);
      await new Promise(resolve => setTimeout(resolve, 1500));
      const receipt = await resend.emails.get(data.id);
      if (receipt.data?.last_event) console.log(`Order service check: test email event=${receipt.data.last_event}`);
    }
  }
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error('LINE token is missing');
  for (const endpoint of ['quota', 'quota/consumption']) {
    const response = await fetch(`https://api.line.me/v2/bot/message/${endpoint}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) console.warn(`Order service check: LINE ${endpoint} HTTP_${response.status}`);
    else {
      const result = await response.json();
      console.log(`Order service check: LINE ${endpoint} ${JSON.stringify(result)}`);
    }
  }
}
