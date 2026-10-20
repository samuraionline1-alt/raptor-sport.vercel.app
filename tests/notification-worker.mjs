import {createHmac} from 'node:crypto';
import assert from 'node:assert/strict';
import { withOrderDatabase,events,orders,response } from './helpers/order-database.mjs';
import {database,recordAndNotify,deliverEvent} from '../lib/order-store.js';
import {retryNotifications} from '../lib/notification-worker.js';
import worker from '../api/retry-notifications.js';
process.env.RESEND_API_KEY='mock';process.env.ORDER_NOTIFICATION_EMAIL='orders@example.com';process.env.RESEND_EMAIL_DOMAIN='example.com';process.env.ORDER_NOTIFICATIONS_FROM=new Date(Date.now()-10000).toISOString();
const delivered=[];global.fetch=async(url,options)=>{if(String(url).startsWith('https://api.resend.com/')){delivered.push(JSON.parse(options.body).subject);return Response.json({id:'mock'})}return{ok:true}};
await withOrderDatabase(async()=>{
 for(let i=0;i<65;i++)await database('rpc/raptor_record_order',{method:'POST',body:{p_order:{order_ref:'RPT-worker-'+i,event_type:'order_created',payment_method:'COD',product:'Product',customer_name:'Test',phone:'0812345678',address:'BKK',quantity:1,total_price:179}}});
 for(const e of events.values())e.status='sent';
 const result=await retryNotifications({channel:'email',budgetMs:40000});assert.equal(result.processed,65);assert.equal(delivered.length,65);assert.ok([...events.values()].every(e=>e.email_status==='sent'),'Rows after the original first 50 must be delivered');
 await retryNotifications({channel:'email'});assert.equal(delivered.length,65,'Sent rows are not delivered twice');
});
process.env.CRON_SECRET='a-long-private-test-secret';let res=response();await worker({method:'GET',headers:{}},res);assert.equal(res.code,401);
res=response();await withOrderDatabase(()=>worker({method:'GET',headers:{authorization:'Bearer '+process.env.CRON_SECRET}},res));assert.equal(res.code,200);
const timestamp=String(Math.floor(Date.now()/1000));
const signature=createHmac('sha256',process.env.CRON_SECRET).update(`${timestamp}:GET:/api/retry-notifications`).digest('hex');
res=response();await withOrderDatabase(()=>worker({method:'GET',headers:{'x-raptor-cron-timestamp':timestamp,'x-raptor-cron-signature':signature}},res));assert.equal(res.code,200);
for(const headers of [ {'x-raptor-cron-timestamp':timestamp,'x-raptor-cron-signature':'f'.repeat(64)}, {'x-raptor-cron-timestamp':String(Number(timestamp)-120),'x-raptor-cron-signature':signature} ]) {res=response();await worker({method:'GET',headers},res);assert.equal(res.code,401);}
console.log('PASS: email backlog beyond 50, sent-row exclusion, protected cron and independent channel recovery');

// An exhausted LINE quota must not affect email-only ordering or retries.
process.env.LINE_ORDER_NOTIFICATIONS_ENABLED='false';
let lineCalls=0,emailCalls=0;
global.fetch=async(url)=>{
 if(String(url).startsWith('https://api.line.me/')) {lineCalls++;throw new Error('LINE must be paused');}
 if(String(url).startsWith('https://api.resend.com/')) {emailCalls++;return Response.json({id:'email-only'});}
 return {ok:true};
};
await withOrderDatabase(async()=>{
 const order={order_ref:'RPT-email-only',event_type:'order_created',payment_method:'COD',product:'Product',customer_name:'Test',phone:'0812345678',address:'BKK',quantity:1,total_price:179};
 const delivery=await recordAndNotify(order);
 assert.equal(delivery.line_status,'disabled');assert.equal(delivery.email_status,'sent');
 const event=events.get(order.order_ref+':'+order.event_type);
 event.status='manual_review';
 event.email_status='failed';event.email_next_attempt_at=new Date(0).toISOString();
 const retried=await retryNotifications({});
 assert.equal(retried.processed,1);assert.equal(retried.backlog,false,'Paused LINE backlog must not raise an active channel alarm');
 assert.equal(event.email_status,'sent');assert.equal(event.status,'manual_review');
 assert.equal((await deliverEvent(order)).line_status,'disabled');
 assert.equal((await retryNotifications({channel:'line'})).processed,0);
 await recordAndNotify(order);assert.equal(emailCalls,2,'Saved/sent orders must not resend email');
 assert.equal(lineCalls,0,'Neither new orders nor retry workers call LINE');
});
delete process.env.LINE_ORDER_NOTIFICATIONS_ENABLED;
console.log('PASS: email-only orders and recovery, no LINE requests or false LINE backlog alarms');
