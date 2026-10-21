import { createHmac } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ORIGINS = new Set(['https://www.raptorthailand.com','https://raptorthailand.com']);
function fail(message,status=400) { return Object.assign(new Error(message),{status}); }

export function createContactHandler(request=globalThis.fetch) {
 async function database(path,method,body) {
  const base=process.env.SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!base || !key) throw fail('ระบบติดต่อยังไม่พร้อม กรุณาลองใหม่ภายหลัง',503);
  const headers={apikey:key,'Content-Type':'application/json',Prefer:'return=minimal'};
  if(!key.startsWith('sb_secret_'))headers.Authorization='Bearer '+key;
  const response=await request(base.replace(/\/$/,'')+'/rest/v1/'+path,{method,headers,body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  if(!response.ok) {
   const error=await response.json().catch(()=>({}));
   if(error.code==='P0001' && error.message==='contact_rate_limit')throw fail('ส่งข้อความหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่',429);
   if(error.code==='23505')throw fail('ข้อมูลการส่งไม่ตรงกัน กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง',409);
   throw fail('ยังบันทึกข้อความไม่ได้ กรุณาลองใหม่อีกครั้ง',503);
  }
  return response.status===204 ? null : response.json();
 }
 async function notify(row) {
  const key=process.env.RESEND_API_KEY, to=process.env.ORDER_NOTIFICATION_EMAIL, domain=process.env.RESEND_EMAIL_DOMAIN;
  if(!key || !to || !domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain))return;
  try {
   const response=await request('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','Idempotency-Key':'raptor-contact-'+row.id},body:JSON.stringify({
    from:'RAPTOR Contact <contact@'+domain+'>',to:[to],subject:'[RAPTOR] ข้อความติดต่อใหม่',
    text:'ชื่อ: '+row.customer_name+'\nอีเมล/โทรศัพท์: '+row.contact+'\n\n'+row.message,
    ...(EMAIL.test(row.contact)?{reply_to:row.contact}:{})
   }),signal:AbortSignal.timeout(8000)});
   if(!response.ok)throw new Error('provider');
   await database('raptor_contact_messages?id=eq.'+row.id,'PATCH',{email_status:'sent',email_sent_at:new Date().toISOString()});
  } catch(_) {
   // The message is already durable; email failure must never invite a duplicate.
   try {await database('raptor_contact_messages?id=eq.'+row.id,'PATCH',{email_status:'failed'});}catch(_){}
   console.error('CONTACT_NOTIFICATION_FAILED');
  }
 }
 return async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Method not allowed'});}
  try {
   if(req.headers?.origin && !ORIGINS.has(req.headers.origin))throw fail('กรุณาส่งข้อมูลจากเว็บไซต์ RAPTOR',403);
   if(req.headers?.['sec-fetch-site']==='cross-site')throw fail('กรุณาส่งข้อมูลจากเว็บไซต์ RAPTOR',403);
   if(!String(req.headers?.['content-type']||'').toLowerCase().startsWith('application/json'))throw fail('กรุณาส่งข้อมูลผ่านฟอร์มบนเว็บไซต์',415);
   const body=req.body;
   if(!body || typeof body!=='object' || Array.isArray(body))throw fail('ข้อมูลติดต่อไม่ถูกต้อง');
   if(Buffer.byteLength(JSON.stringify(body))>32768)throw fail('ข้อความยาวเกินไป',413);
   if(body.website)return res.status(200).json({ok:true});
   const text=(key,max)=>{const value=typeof body[key]==='string'?body[key].trim():'';if(!value || value.length>max || value.includes('\u0000'))throw fail('กรุณากรอกชื่อ ช่องทางติดต่อ และข้อความให้ครบถ้วน');return value;};
   if(typeof body.submission_id!=='string' || !UUID.test(body.submission_id))throw fail('กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง');
   const row={id:body.submission_id,customer_name:text('customer_name',200),contact:text('contact',254),message:text('message',5000)};
   if(!EMAIL.test(row.contact) && !/^\+?[\d ()-]{8,30}$/.test(row.contact))throw fail('กรุณาระบุอีเมลหรือเบอร์โทรศัพท์ที่ถูกต้อง');
   const secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
   if(!secret)throw fail('ระบบติดต่อยังไม่พร้อม กรุณาลองใหม่ภายหลัง',503);
   const ip=String(req.headers?.['x-vercel-forwarded-for'] || req.headers?.['x-real-ip'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
   row.request_fingerprint=createHmac('sha256',secret).update('contact:'+ip).digest('hex');
   const result=await database('rpc/raptor_submit_contact','POST',{p_message:row});
   if(result?.email_status!=='sent')await notify(row);
   return res.status(200).json({ok:true});
  }catch(error){
   const known=Number.isInteger(error.status);
   return res.status(known?error.status:503).json({error:known?error.message:'ยังส่งข้อความไม่ได้ กรุณาลองใหม่อีกครั้ง'});
  }
 };
}
export default createContactHandler();
