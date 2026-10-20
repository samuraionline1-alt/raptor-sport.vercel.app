import { recordAndNotify } from '../lib/order-store.js';
import { makeOrder, limitRequest, errorResponse } from '../lib/order-security.js';
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if (req.method !== 'POST') { res.setHeader('Allow','POST'); return res.status(405).json({error:'Method not allowed'}); }
  try {
    if (req.body?.payment_method !== 'COD' || req.body?.is_wholesale === true) return res.status(400).json({error:'วิธีชำระเงินไม่ถูกต้อง'});
    const order = makeOrder(req.body,'COD');
    await limitRequest(req,'order',order.phone);
    const delivery = await recordAndNotify(order,{background:true});
    return res.status(200).json({ok:true,order_ref:order.order_ref,...delivery});
  } catch(error) { return errorResponse(res,error,'ยังบันทึกคำสั่งซื้อไม่ได้ กรุณาลองอีกครั้ง หรือติดต่อร้านค้า'); }
}
