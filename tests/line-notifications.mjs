import assert from 'node:assert/strict';
import { pushLine, lineMessage } from '../lib/line-notifications.js';
import notify from '../api/notify-line.js';
import checkout from '../api/create-checkout-session.js';
const order = {order_ref:'RPT-line-test',event_type:'order_created',payment_method:'COD',payment_status:'รอเก็บเงินปลายทาง',product:'RAPTOR',quantity:2,total_price:309,coupon_code:'RAPTOR20',discount_amount:20,free_gifts:'Gel 1 ซอง',customer_name:'ทดสอบ',phone:'0812345678',address:'กรุงเทพ',note:'ภาษี 123',page_url:'https://www.raptorthailand.com/'};
const productUrl = 'https://www.raptorthailand.com/products/raptor-cooling-spray/';
const trackedOrder = {...order, page_url: `${productUrl}?fbclid=long-facebook-id&utm_source=fb&utm_medium=paid&utm_campaign=campaign`};
assert.ok(lineMessage(trackedOrder).endsWith(`หน้าสั่งซื้อ: ${productUrl}`));
assert.ok(lineMessage({...order, page_url: `${productUrl}?variant=spray&utm_source=fb&fbclid=tracking#checkout`}).endsWith(`หน้าสั่งซื้อ: ${productUrl}?variant=spray#checkout`));
assert.ok(lineMessage({...order, page_url: 'invalid-url'}).endsWith('หน้าสั่งซื้อ: invalid-url'));
assert.equal(trackedOrder.page_url, `${productUrl}?fbclid=long-facebook-id&utm_source=fb&utm_medium=paid&utm_campaign=campaign`);
function res(){return{setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}}}
process.env.LINE_CHANNEL_ACCESS_TOKEN='mock-line-token';process.env.LINE_ADMIN_USER_ID='admin-a, admin-b,admin-a';process.env.STRIPE_SECRET_KEY='mock-stripe';
let pushes=[];
global.fetch=async(url,opts)=>{pushes.push({url,...opts});return{ok:true}};
await pushLine(order);assert.equal(pushes.length,2);
assert.equal(pushes[0].headers.Authorization,'Bearer mock-line-token');
const firstKey=pushes[0].headers['X-Line-Retry-Key'];await pushLine(order);assert.equal(pushes[2].headers['X-Line-Retry-Key'],firstKey);
assert.match(lineMessage(order),/🛒 มีออเดอร์ใหม่/);for(const value of ['#RPT-line-test','Gel 1 ซอง','RAPTOR20','฿309','ทดสอบ','0812345678','กรุงเทพ','ภาษี 123'])assert.ok(lineMessage(order).includes(value));
const cod=res();await notify({method:'POST',body:order},cod);assert.equal(cod.code,200);
const method=res();await notify({method:'GET'},method);assert.equal(method.code,405);
const bad=res();await notify({method:'POST',body:{}},bad);assert.equal(bad.code,400);
global.fetch=async()=>({ok:true,json:async()=>({status:'complete',payment_status:'unpaid'})});
const unpaid=res();await notify({method:'POST',body:{...order,event_type:'payment_succeeded',stripe_session_id:'cs_test_123'}},unpaid);assert.equal(unpaid.code,409);
pushes=[];global.fetch=async(url,opts)=>{
 if(url.startsWith('https://api.stripe.com/'))return{ok:true,json:async()=>({status:'complete',payment_status:'paid',amount_total:30900,metadata:{...order,note:'Verified tax'}})};
 pushes.push(JSON.parse(opts.body));return{ok:true};
};
const paid=res();await notify({method:'POST',body:{...order,total_price:1,event_type:'payment_succeeded',stripe_session_id:'cs_test_123',note:'Forged tax'}},paid);assert.equal(paid.code,200);assert.match(pushes[0].messages[0].text,/ยอดสุทธิ: ฿309/);assert.match(pushes[0].messages[0].text,/Verified tax/);assert.match(pushes[0].messages[0].text,/✅ ชำระเงินออนไลน์สำเร็จ/);
for(const wholesale of [false,true]){
 pushes=[];global.fetch=async(url,opts)=>{
  if(url.startsWith('https://api.stripe.com/'))return{ok:true,json:async()=>({url:'https://checkout.stripe.com/test'})};
  pushes.push(JSON.parse(opts.body));return{ok:true};
 };
 const result=res();await checkout({method:'POST',body:{...order,is_wholesale:wholesale,...(wholesale?{}:{subtotal:329,bundleTier:'tier_2'})}},result);
 await new Promise(resolve => setImmediate(resolve));
 assert.equal(result.code,200);assert.equal(pushes.length,2);assert.match(pushes[0].messages[0].text,/⏳ ลูกค้ากำลังสแกนจ่ายออนไลน์/);assert.match(pushes[0].messages[0].text,/0812345678/);
}
global.fetch=async(url)=>url.startsWith('https://api.stripe.com/')?{ok:true,json:async()=>({url:'https://checkout.stripe.com/test'})}:{ok:false,status:500};
const failure=res();await checkout({method:'POST',body:{...order,is_wholesale:true}},failure);assert.equal(failure.code,200);
delete process.env.LINE_CHANNEL_ACCESS_TOKEN;await assert.rejects(pushLine(order),/not configured/);
console.log('LINE checks passed: Thai messages, multiple admins, retry keys, COD, verified PAID, retail/wholesale initiation, and non-blocking checkout failures.');
