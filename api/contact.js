import { waitUntil } from '@vercel/functions';
import { database } from '../lib/order-store.js';
import { limitRequest, errorResponse } from '../lib/order-security.js';
import { OrderError } from '../lib/order-pricing.js';
import { deliverContactEmail } from '../lib/contact-notifications.js';
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if (req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  try {
    if (!String(req.headers?.['content-type'] || '').toLowerCase().startsWith('application/json')) throw new OrderError('กรุณาส่งข้อมูลผ่านฟอร์มติดต่อ',415);
    await limitRequest(req,'contact');
    const body=req.body;
    if (!body || typeof body!=='object' || Array.isArray(body)) throw new OrderError('ข้อมูลติดต่อไม่ถูกต้อง');
    if (body.website) return res.status(200).json({ok:true}); // Honeypot, no persistence or email.
    const text=(key,max)=>{const value=typeof body[key]==='string'?body[key].trim():'';if(!value || value.length>max || value.includes('\u0000'))throw new OrderError('กรุณากรอกชื่อ ช่องทางติดต่อ และข้อความให้ครบถ้วน');return value;};
    const id=body.submission_id;
    if (typeof id!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new OrderError('กรุณาโหลดหน้าเว็บใหม่แล้วลองอีกครั้ง');
    const row={id,customer_name:text('customer_name',200),contact:text('contact',254),message:text('message',5000)};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.contact) && !(/^\+?[\d ()-]{8,30}$/.test(row.contact) && row.contact.replace(/\D/g,'').length>=8)) throw new OrderError('กรุณาระบุอีเมลหรือเบอร์โทรศัพท์ที่ถูกต้อง');
    // A browser retry after a lost response must not overwrite or duplicate a message.
    await database('raptor_contact_messages?on_conflict=id',{method:'POST',prefer:'resolution=ignore-duplicates,return=minimal',body:row});
    const saved=await database(`raptor_contact_messages?id=eq.${encodeURIComponent(id)}&select=customer_name,contact,message`);
    if (!saved?.[0] || ['customer_name','contact','message'].some(key=>saved[0][key]!==row[key])) throw new OrderError('ข้อมูลข้อความเปลี่ยนแปลง กรุณากดส่งอีกครั้ง',409);
    const delivery=deliverContactEmail(id).catch(()=>console.error('CONTACT_EMAIL_WORKER_FAILED'));
    if (process.env.VERCEL==='1') waitUntil(delivery); else await delivery;
    return res.status(200).json({ok:true});
  } catch(error) {return errorResponse(res,error,'ยังส่งข้อความไม่ได้ กรุณาลองอีกครั้ง');}
}
