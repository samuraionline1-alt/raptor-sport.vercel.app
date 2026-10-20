import catalog from '../product-catalog.js';
import { database } from '../lib/order-store.js';
import { authorized, loadOrder, limitRequest, errorResponse } from '../lib/order-security.js';
import { OrderError } from '../lib/order-pricing.js';
const wholesaleSku = {p1:'raptor-cooling-spray',p2:'raptor-warming-spray',p3:'raptor-herbal-roll-on',p4:'raptor-cool-patch',p5:'raptor-go-energy-gel',p6:'raptor-v-mix',p7:'raptor-sport-therapy-oil',p8:'raptor-herbal-cooling-gel',p9:'raptor-sport-foot-spray',p10:'raptor-ice-defense-sport-shampoo'};
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if (req.method !== 'POST') return res.status(405).json({error:'Method not allowed'});
  try {
    await limitRequest(req,'review');
    const body = req.body || {};
    const name = typeof body.reviewer_name === 'string' ? body.reviewer_name.trim() : '';
    const comment = typeof body.comment === 'string' ? body.comment.trim() : '';
    if (!catalog.retail.some(p => p.sku === body.product_slug) || !name || name.length>100 || !comment || comment.length>2000
      || !Number.isInteger(body.rating) || body.rating<1 || body.rating>5) throw new OrderError('ข้อมูลรีวิวไม่ถูกต้อง');
    let verified = false, ref = null;
    if (body.order_ref || body.receipt_token) {
      const order = await loadOrder(body.order_ref);
      if (!authorized(order,body.receipt_token)) throw new OrderError('ไม่สามารถยืนยันออเดอร์สำหรับรีวิว',403);
      verified = order.stored_status === 'paid' && order.items?.some(l => (wholesaleSku[l.sku] || l.sku) === body.product_slug);
      if (verified) ref = order.order_ref;
    }
    await database('product_reviews',{method:'POST',prefer:'return=minimal',body:{product_slug:body.product_slug,reviewer_name:name,rating:body.rating,comment,
      source_platform:'Official Website',is_verified:Boolean(verified),is_approved:false,verified_order_ref:ref}});
    return res.status(200).json({ok:true});
  } catch(error) { return errorResponse(res,error,'ยังส่งรีวิวไม่ได้ กรุณาลองอีกครั้ง'); }
}
