import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { withOrderDatabase, events } from './helpers/order-database.mjs';
import checkout from '../api/create-checkout-session.js';
import qr from '../api/promptpay.js';
import confirm from '../api/confirm-payment.js';
import webhook from '../api/stripe-webhook.js';
import { qrToken } from '../lib/promptpay.js';

process.env.STRIPE_SECRET_KEY = 'mock-key';
process.env.STRIPE_WEBHOOK_SECRET = 'mock-webhook';
process.env.LINE_CHANNEL_ACCESS_TOKEN = 'mock-line';
process.env.LINE_ADMIN_USER_ID = 'U' + '1'.repeat(32);
function response() { return { headers: {}, setHeader(k,v) { this.headers[k]=v; }, status(code) { this.code=code;return this; }, json(body) { this.body=body;return this; }, send(body) { this.body=body;return this; } }; }
const order = { order_ref:'RPT-qr-test', product:'Test', quantity:1, totalPrice:299,
  customer_name:'Test Customer', phone:'0812345678', address:'Bangkok', email:'test@example.com', payment_method:'PROMPTPAY' };
let intent = { id:'pi_QrTest', created:Math.floor(Date.now()/1000), currency:'thb', amount:29900,
  status:'requires_action', metadata:{}, next_action:{ promptpay_display_qr_code:{ expires_at:Math.floor(Date.now()/1000)+3600, image_url_png:'https://qr.stripe.com/test.png' } } };
let creation;
const qrDetails = intent.next_action.promptpay_display_qr_code;
global.fetch = async (url, options={}) => {
  if (String(url).startsWith('https://api.line.me/')) return { ok:true, status:200, json:async()=>({}) };
  if (options.method === 'POST') {
    creation = new URLSearchParams(options.body);
    intent.metadata = Object.fromEntries([...creation].filter(([k])=>k.startsWith('metadata[')).map(([k,v])=>[k.slice(9,-1),v]));
  }
  if (String(url).startsWith('https://qr.stripe.com/')) return { ok:true, headers:new Headers({'content-type':'image/png'}), arrayBuffer:async()=>new Uint8Array([137,80,78,71]).buffer };
  return { ok:true, json:async()=>structuredClone(intent) };
};
let res=response();
await withOrderDatabase(()=>checkout({method:'POST', body:order},res));
assert.equal(res.code,200); assert.match(res.body.url,/pay-promptpay.html/);
assert.equal(creation.get('amount'),'29900');
assert.equal(creation.get('payment_method_data[type]'),'promptpay');
assert.equal(creation.get('allowed_payment_method_types[0]'),null);
assert.equal(creation.get('automatic_payment_methods[allow_redirects]'),'never');
assert.equal(events.get('RPT-qr-test:checkout_initiated').payload.payment_status,'รอสแกนชำระเงิน');
res=response(); await checkout({method:'POST',body:{...order,email:''}},res);assert.equal(res.code,400);
const query={id:intent.id,token:qrToken(intent.id)};
// Actual Stripe PromptPay responses can omit expires_at while the QR is valid.
delete qrDetails.expires_at;
res=response();await qr({method:'GET',query},res);
assert.equal(res.code,200);assert.equal(res.body.expires_at,null);assert.equal(res.body.qr_available,true);
res=response();await qr({method:'GET',query:{...query,image:'1'}},res);assert.equal(res.code,200);

res=response();await qr({method:'GET',query:{...query,token:'0'.repeat(64)}},res);assert.equal(res.code,403);
res=response();await qr({method:'GET',query:{...query,image:'1',download:'1'}},res);assert.equal(res.code,200);assert.match(res.headers['Content-Disposition'],/^attachment/);
res=response();await confirm({method:'GET',query:{session_id:intent.id}},res);assert.equal(res.code,409);
intent.next_action.promptpay_display_qr_code.expires_at=1;
res=response();await qr({method:'GET',query:{...query,image:'1'}},res);assert.equal(res.code,410);
intent.status='succeeded';intent.amount_received=29900;
res=response();await confirm({method:'GET',query:{session_id:intent.id}},res);assert.equal(res.code,200);assert.equal(res.body.total_price,299);
// A signed payment event persists payment even when the buyer closes the page.
const raw=Buffer.from(JSON.stringify({type:'payment_intent.succeeded',data:{object:intent}}));
const timestamp=Math.floor(Date.now()/1000);
const signature=createHmac('sha256',process.env.STRIPE_WEBHOOK_SECRET).update(timestamp+'.').update(raw).digest('hex');
const req=Readable.from([raw]);req.method='POST';req.headers={'stripe-signature':`t=${timestamp},v1=${signature}`};
res=response();await withOrderDatabase(()=>webhook(req,res));assert.equal(res.code,200);
assert.equal(events.get('RPT-qr-test:payment_succeeded').payload.total_price,299);
console.log('PromptPay checks passed: creation, email, token, download, expiry, unpaid rejection, verified amount and signed webhook.');
