import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const load = async path => (await import('data:text/javascript;base64,' + Buffer.from(readFileSync(path)).toString('base64'))).default;
const checkout = await load('api/create-checkout-session.js');
const confirm = await load('api/confirm-payment.js');
process.env.STRIPE_SECRET_KEY = 'test-mocked-key';
function response() { return {setHeader(){}, status(code){this.code=code;return this;}, json(body){this.body=body;return this;}}; }
let params;
global.fetch = async (_, options) => { params = new URLSearchParams(options.body); return {ok:true,json:async()=>({url:'https://checkout.stripe.com/test'})}; };
for (const wholesale of [false,true]) {
 const res=response();
 await checkout({method:'POST',body:{product:'สินค้า & Test',quantity:3,totalPrice:499,customer_name:'คุณ A & B',phone:'081-234-5678',address:'Bangkok',is_wholesale:wholesale,order_ref:'RPT-test'}},res);
 assert.equal(res.code,200);
 assert.equal(params.get('metadata[order_ref]'),'RPT-test');
 assert.equal(params.get('payment_intent_data[metadata][order_ref]'),'RPT-test');
 assert.equal(params.get('line_items[0][price_data][product_data][name]'),'สินค้า & Test (จำนวน 3 ชิ้น)');
 assert.ok(params.get('payment_intent_data[description]').includes('[#RPT-test]'));
 const url=new URL(params.get('success_url'));
 assert.equal(url.pathname,wholesale?'/wholesale/':'/thank-you.html');
 for (const [key,value] of Object.entries({order_ref:'RPT-test',phone:'0812345678',customer_name:'คุณ A & B',session_id:'{CHECKOUT_SESSION_ID}',product:'สินค้า & Test'})) assert.equal(url.searchParams.get(key),value);
}
const missing=response();
await checkout({method:'POST',body:{product:'Test',totalPrice:10,phone:'0812345678'}},missing);
assert.equal(missing.code,400);
const exact=response();
await checkout({method:'POST',body:{product:'Test',totalPrice:10,phone:'0899999999',order_ref:'RPT-1234-5678'}},exact);
assert.equal(params.get('metadata[order_ref]'),'RPT-1234-5678');
assert.ok(params.get('line_items[0][price_data][product_data][description]').includes('#RPT-1234-5678'));
for (const paid of [true,false]) {
 global.fetch=async()=>({ok:true,json:async()=>({status:'complete',payment_status:paid?'paid':'unpaid',amount_total:49900,metadata:{order_ref:'RPT-test',order_channel:'retail',phone:'0812345678'}})});
 const res=response();await confirm({method:'GET',query:{session_id:'cs_test_123'}},res);assert.equal(res.code,paid?200:409);
}
const storage=new Map();const label={};let calls=[];let fail=false;
const context={window:{},sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},URLSearchParams,location:{search:'?payment=stripe_success&session_id=cs_test_123&order_ref=RPT-test&value=1&customer_name=Forged'},document:{getElementById:()=>label},console:{error(){}},
 fetch:async(url,options)=>{calls.push({url,options});if(url.startsWith('/api/'))return{ok:true,json:async()=>({payment_status:'paid',order_ref:'RPT-test',order_channel:'retail',customer_name:'Verified Name',phone:'0812345678',product:'Test',total_price:499,address:'Verified Address'})};return{ok:!fail};}};
vm.runInNewContext(readFileSync('order-context.js','utf8'),context);
const orders=context.window.RaptorOrders;
orders.save({order_ref:'RPT-test',address:'Local Address'});
orders.save({order_ref:'RPT-other',address:'Wrong Address'});
assert.equal(JSON.parse(storage.get('raptor_order_RPT-test')).address,'Local Address');
fail=true;await orders.confirm('retail');assert.ok(!storage.has('paid_notified_cs_test_123'));
fail=false;await orders.confirm('retail');assert.equal(storage.get('paid_notified_cs_test_123'),'1');
const payload=JSON.parse(calls.at(-1).options.body);assert.equal(payload.customer_name,'Verified Name');assert.equal(payload.total_price,499);assert.equal(payload.address,'Verified Address');
const count=calls.length;await orders.confirm('retail');assert.equal(calls.length,count);
assert.equal(label.textContent,'รหัสคำสั่งซื้อ: RPT-test');
context.location.search='?payment=stripe_success&session_id=cs_test_456&order_ref=RPT-test';calls=[];await orders.confirm('wholesale');assert.equal(calls.length,1);
context.location.search='';calls=[];await orders.confirm('retail');assert.equal(calls.length,0);
for(const directory of readdirSync('products')) {
 const html=readFileSync(`products/${directory}/index.html`,'utf8');
 if(html.includes('<form')&&html.includes('raptor-order-form'))assert.ok(html.includes('/order-context.js?v=order-ref-20261005'));

}
for(const file of ['wholesale/index.html','thank-you.html']) {
 const html=readFileSync(file,'utf8');
 for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))if(match[1].trim())new vm.Script(match[1]);
}
new vm.Script(readFileSync('checkout.js','utf8'));
// Exercise the capture handler for both COD and Stripe submissions.
let handler;
const fields = {quantity:{value:'3'},price:{value:'179'},total_price:{value:'499'},product:{value:'Test'},customer_name:{value:'Name'},phone:{value:'081-234-5678'},address:{value:'Address'},bundle_tier:{value:'Bundle'}};
let payment = 'COD';
const form = {dataset:{price:'฿179'},addEventListener:(event,fn)=>{if(event==='formdata')form.serialize=fn;},matches:()=>true,querySelector:selector=>{
 if(selector.includes(':checked'))return{value:payment};
 const name=selector.match(/name="([^"\]]+)"/);return name?fields[name[1]]:null;
},appendChild:input=>{fields[input.name]=input;}};
context.document={addEventListener:(event,fn)=>{if(event==='submit')handler=fn;},createElement:()=>({})};
context.RaptorOrders=orders;context.window.dataLayer=[];
context.FormData=class{set(){}};
context.fetch=async(url)=>({ok:true,json:async()=>({url:'https://checkout.stripe.com/test'})});
context.window.location={};context.location.pathname='/products/test/';
vm.runInNewContext(readFileSync('checkout.js','utf8'),context);
await handler({target:form,preventDefault(){},stopImmediatePropagation(){}});
assert.ok(fields.order_ref.value.startsWith('RPT-'));assert.equal(fields.phone.value,'0812345678');
assert.equal(JSON.parse(storage.get('raptor_last_order')).total_price,'฿499');
const email=new Map();form.serialize({formData:email});
assert.equal(email.get('bundle_tier_choice'),'เซ็ต 3 ชิ้น (฿499)');
assert.ok(email.get('order_details').includes('#'+fields.order_ref.value));
assert.equal(fields.price.value,fields.total_price.value);
payment='STRIPE';await handler({target:form,preventDefault(){},stopImmediatePropagation(){}});
assert.equal(context.window.location.href,'https://checkout.stripe.com/test');
console.log('Order flow checks passed (Stripe payloads, verified payment, retry and duplicate guard, cross-order storage, retail coverage, inline script syntax).');
