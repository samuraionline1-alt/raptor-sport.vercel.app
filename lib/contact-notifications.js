import { database } from './order-store.js';
export async function deliverContactEmail(id) {
  const rows = await database('rpc/raptor_claim_contact_email',{method:'POST',body:{p_id:id}});
  if (!rows?.length) return;
  const row = rows[0], filter = `id=eq.${encodeURIComponent(id)}`;
  try {
    const key=process.env.RESEND_API_KEY, to=process.env.ORDER_NOTIFICATION_EMAIL, domain=process.env.RESEND_EMAIL_DOMAIN;
    if (!key || !to || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain || '')) throw new Error('Email not configured');
    const response=await fetch('https://api.resend.com/emails',{
      method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','Idempotency-Key':`raptor-contact-${id}`},
      body:JSON.stringify({from:`RAPTOR Contact <orders@${domain}>`,to:[to],subject:'[RAPTOR] ข้อความติดต่อใหม่',
        text:`ชื่อ: ${row.customer_name}\nติดต่อกลับ: ${row.contact}\n\n${row.message}`}),signal:AbortSignal.timeout(10000)
    });
    if (!response.ok || !(await response.json())?.id) throw new Error('Email delivery failed');
    await database(`raptor_contact_messages?${filter}`,{method:'PATCH',body:{email_status:'sent',email_lease_until:null,email_sent_at:new Date().toISOString()}});
  } catch (_) {
    console.error('CONTACT_EMAIL_DELIVERY_FAILED');
    await database(`raptor_contact_messages?${filter}`,{method:'PATCH',body:{email_status:row.email_attempts>=8?'manual_review':'failed',email_lease_until:null,
      email_next_attempt_at:new Date(Date.now()+Math.min(3600000,60000*2**row.email_attempts)).toISOString()}});
  }
}
export async function retryContactEmails() {
  // A single message per invocation keeps this queue within the function budget.
  const now=new Date().toISOString();
  const rows=await database(`raptor_contact_messages?select=id&or=(and(email_status.in.(pending,failed),email_next_attempt_at.lte.${now}),and(email_status.eq.sending,email_lease_until.lt.${now}))&order=email_next_attempt_at.asc&limit=1`);
  if (rows?.length) await deliverContactEmail(rows[0].id);
  return {processed:rows?.length || 0};
}
