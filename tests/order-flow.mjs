import assert from 'node:assert/strict';
import {withOrderDatabase,orders,events,response,fixture,rateLimits} from './helpers/order-database.mjs';
import checkout from '../api/create-checkout-session.js';
import confirm from '../api/confirm-payment.js';
import cod from '../api/orders.js';
import {tokenHash} from '../lib/order-security.js';
process.env.STRIPE_SECRET_KEY='mock';
let params,paid=false,stripeCreates=0;
global.fetch=async(url,options)=>{
 if(url.startsWith('https://api.stripe.com/')) {
  assert.ok(options.signal,'Stripe fetch is bounded');
  if(options.method==='POST') {params=new URLSearchParams(options.body);stripeCreates++;assert.ok(orders.has(params.get('metadata[order_ref]')),'Order is durable before payment URL creation');}
  return Response.json({id:'cs_test_match',url:'https://checkout.stripe.com/test',status:paid?'complete':'open',payment_status:paid?'paid':'unpaid',currency:'thb',amount_total:32900,metadata:{order_ref:'RPT-stripe',order_channel:'retail'}});
 }
 return {ok:true};
};
let res=response();await withOrderDatabase(()=>checkout({method:'POST',body:fixture({order_ref:'RPT-stripe',success_url:'https://attacker.vercel.app',page_url:'https://attacker.vercel.app'})},res));assert.equal(res.code,200);
assert.equal(params.get('line_items[0][price_data][unit_amount]'),'32900');
assert.equal(params.get('cancel_url'),'https://www.raptorthailand.com/');
const success=new URL(params.get('success_url'));assert.equal(success.origin,'https://www.raptorthailand.com');
assert.deepEqual([...success.searchParams.keys()],['payment','order_ref','session_id']);
assert.deepEqual([...params.keys()].filter(k=>k.startsWith('metadata[')),['metadata[order_ref]','metadata[order_channel]']);
assert.equal(orders.get('RPT-stripe').payload.receipt_token_hash,tokenHash('a'.repeat(64)));
assert.equal(orders.get('RPT-stripe').payload.stripe_session_id,'cs_test_match');
res=response();await withOrderDatabase(()=>checkout({method:'POST',body:fixture({order_ref:'RPT-stripe'})},res));assert.equal(res.code,200);assert.equal(stripeCreates,1,'Retry retrieves the bound checkout session');
for(const token of [undefined,'b'.repeat(64)]){res=response();await withOrderDatabase(()=>confirm({method:'GET',query:{order_ref:'RPT-stripe',session_id:'cs_test_match'},headers:{'x-order-token':token}},res));assert.equal(res.code,403);}
res=response();await withOrderDatabase(()=>confirm({method:'GET',query:{order_ref:'RPT-stripe',session_id:'cs_test_other'},headers:{'x-order-token':'a'.repeat(64)}},res));assert.equal(res.code,400);
res=response();await withOrderDatabase(()=>confirm({method:'GET',query:{order_ref:'RPT-stripe',session_id:'cs_test_match'},headers:{'x-order-token':'a'.repeat(64)}},res));assert.equal(res.code,409);
paid=true;res=response();await withOrderDatabase(()=>confirm({method:'GET',query:{order_ref:'RPT-stripe',session_id:'cs_test_match'},headers:{'x-order-token':'a'.repeat(64)}},res));assert.equal(res.code,200);assert.equal(res.body.payment_status,'paid');
for(const key of ['customer_name','phone','address','note','receipt_token_hash','email'])assert.equal(res.body[key],undefined,'Receipt omits PII');
assert.equal(orders.get('RPT-stripe').payment_status,'paid');assert.ok(events.has('RPT-stripe:payment_succeeded'));
res=response();await withOrderDatabase(()=>cod({method:'POST',body:fixture({order_ref:'RPT-cod'})},res));assert.equal(res.code,200);
res=response();await withOrderDatabase(()=>confirm({method:'GET',query:{order_ref:'RPT-cod'},headers:{'x-order-token':'a'.repeat(64)}},res));assert.equal(res.body.payment_status,'cod');
res=response();await withOrderDatabase(()=>cod({method:'POST',body:fixture({order_ref:'RPT-origin'}),headers:{origin:'https://attacker.example'}},res));assert.equal(res.code,403);
rateLimits.clear();
for(let i=0;i<9;i++){res=response();await withOrderDatabase(()=>cod({method:'POST',body:fixture({order_ref:'RPT-limit-'+i})},res));assert.equal(res.code,i<8?200:429);}
console.log('PASS: durable server-priced checkout, retry/session binding, safe redirects/metadata, receipt proof/privacy, COD/paid confirmation, origin and distributed limits');
