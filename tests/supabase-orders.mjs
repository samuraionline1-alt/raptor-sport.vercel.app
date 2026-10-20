import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {Readable} from 'node:stream';
import {withOrderDatabase,orders,events,response,fixture} from './helpers/order-database.mjs';
import cod from '../api/orders.js';
import checkout from '../api/create-checkout-session.js';
import webhook from '../api/stripe-webhook.js';
process.env.LINE_CHANNEL_ACCESS_TOKEN='mock';process.env.LINE_ADMIN_USER_ID='admin';process.env.STRIPE_SECRET_KEY='mock';process.env.STRIPE_WEBHOOK_SECRET='whsec_mock';
let lineCalls=0;
global.fetch=async()=>{lineCalls++;return{ok:false,status:429}};
let res=response();await withOrderDatabase(()=>cod({method:'POST',body:fixture({order_ref:'RPT-cod-fail',payment_status:'paid'})},res));assert.equal(res.code,200);assert.equal(res.body.line_status,'failed');assert.equal(orders.get('RPT-cod-fail').payment_status,'cod');
const event=events.get('RPT-cod-fail:order_created');event.next_attempt_at=new Date(0).toISOString();
global.fetch=async()=>{lineCalls++;return{ok:true}};
res=response();await withOrderDatabase(()=>cod({method:'POST',body:fixture({order_ref:'RPT-cod-fail'})},res));assert.equal(res.body.line_status,'sent');
const count=lineCalls;res=response();await withOrderDatabase(()=>cod({method:'POST',body:fixture({order_ref:'RPT-cod-fail'})},res));assert.equal(lineCalls,count);
global.fetch=async()=>({ok:false,status:503});res=response();await cod({method:'POST',body:fixture({order_ref:'RPT-down'})},res);assert.equal(res.code,503);
let checkoutCalls=0;global.fetch=async url=>{if(url.startsWith('https://api.stripe.com/'))checkoutCalls++;return{ok:false,status:503}};
res=response();await checkout({method:'POST',body:fixture({order_ref:'RPT-down-stripe'})},res);assert.equal(checkoutCalls,0,'Never create a payable session before durable persistence');
global.fetch=async url=>url.startsWith('https://api.stripe.com/')?Response.json({id:'cs_test_webhook',url:'https://checkout.stripe.com/test'}):{ok:true};
res=response();await withOrderDatabase(()=>checkout({method:'POST',body:fixture({order_ref:'RPT-webhook'})},res));assert.equal(res.code,200);
const session={id:'cs_test_webhook',currency:'thb',amount_total:32900,payment_status:'paid',metadata:{order_ref:'RPT-webhook',order_channel:'retail'}};
function request(object,{timestamp=Math.floor(Date.now()/1000),tamper=false,type='checkout.session.completed'}={}) {
 const raw=JSON.stringify({type,data:{object}});const signature=createHmac('sha256','whsec_mock').update(timestamp+'.'+raw).digest('hex');
 const req=Readable.from([Buffer.from(tamper?raw+' ':raw)]);req.method='POST';req.headers={'stripe-signature':`t=${timestamp},v1=${signature}`};return req;
}
for(const options of [{tamper:true},{timestamp:Math.floor(Date.now()/1000)-600}]){res=response();await withOrderDatabase(()=>webhook(request(session,options),res));assert.equal(res.code,400);}
for(const change of [{amount_total:1},{currency:'usd'},{id:'cs_test_other'}]){res=response();await withOrderDatabase(()=>webhook(request({...session,...change}),res));assert.equal(res.code,503);assert.equal(orders.get('RPT-webhook').payment_status,'pending');}
res=response();await withOrderDatabase(()=>webhook(request({...session,payment_status:'unpaid'}),res));assert.equal(res.code,200);assert.equal(orders.get('RPT-webhook').payment_status,'pending');
res=response();await withOrderDatabase(()=>webhook(request(session,{type:'checkout.session.async_payment_succeeded'}),res));assert.equal(res.code,200);assert.equal(orders.get('RPT-webhook').payment_status,'paid');assert.ok(events.has('RPT-webhook:payment_succeeded'));
const eventCount=events.size;res=response();await withOrderDatabase(()=>webhook(request(session),res));assert.equal(events.size,eventCount);assert.equal(res.code,200);
// Email-only operation must acknowledge a verified durable payment even when
// the mail provider is down; the stored queue owns notification recovery.
process.env.LINE_ORDER_NOTIFICATIONS_ENABLED='false';
process.env.RESEND_API_KEY='mock';process.env.ORDER_NOTIFICATION_EMAIL='orders@example.com';process.env.RESEND_EMAIL_DOMAIN='example.com';
let mailAttempts=0;global.fetch=async()=>{mailAttempts++;return {ok:false,status:503}};
const paidEvent=events.get('RPT-webhook:payment_succeeded');paidEvent.email_status='pending';paidEvent.email_next_attempt_at=new Date(0).toISOString();
res=response();await withOrderDatabase(()=>webhook(request(session),res));
assert.equal(res.code,200,'Paused LINE and a temporary email outage cannot reject a saved Stripe payment');
assert.equal(paidEvent.email_status,'failed');assert.equal(orders.get('RPT-webhook').payment_status,'paid');assert.equal(mailAttempts,1);
global.fetch=async()=>({ok:false,status:503});res=response();await webhook(request(session),res);assert.equal(res.code,503,'Persistence failure must still ask Stripe to retry');
delete process.env.LINE_ORDER_NOTIFICATIONS_ENABLED;
console.log('PASS: durable COD under notification outage, retry/deduplication, fail-closed DB outage, signed webhooks without browser return, paid/currency/amount/session validation, asynchronous success and replay');
