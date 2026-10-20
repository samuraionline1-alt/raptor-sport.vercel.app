import assert from 'node:assert/strict';
import {withOrderDatabase,response,fixture,requests} from './helpers/order-database.mjs';
import reviews from '../api/reviews.js';
import {makeOrder} from '../lib/order-security.js';
import {database} from '../lib/order-store.js';
let res=response();await withOrderDatabase(()=>reviews({method:'POST',body:{product_slug:'raptor-cooling-spray',reviewer_name:'Test',rating:5,comment:'Review',is_verified:true,is_approved:true}},res));assert.equal(res.code,200);
let row=JSON.parse(requests.at(-1).body);assert.equal(row.is_verified,false);assert.equal(row.is_approved,false);
await withOrderDatabase(async()=>{
 const order=makeOrder(fixture({order_ref:'RPT-review'}),'STRIPE');await database('rpc/raptor_record_order',{method:'POST',body:{p_order:{...order,event_type:'payment_succeeded'}}});
 res=response();await reviews({method:'POST',body:{product_slug:'raptor-cooling-spray',reviewer_name:'Test',rating:5,comment:'Review',order_ref:order.order_ref,receipt_token:'a'.repeat(64)}},res);assert.equal(res.code,200);row=JSON.parse(requests.at(-1).body);assert.equal(row.is_verified,true);assert.equal(row.verified_order_ref,order.order_ref);
 res=response();await reviews({method:'POST',body:{product_slug:'raptor-warming-spray',reviewer_name:'Test',rating:5,comment:'Review',order_ref:order.order_ref,receipt_token:'a'.repeat(64)}},res);assert.equal(res.code,200);row=JSON.parse(requests.at(-1).body);assert.equal(row.is_verified,false);
 res=response();await reviews({method:'POST',body:{product_slug:'raptor-cooling-spray',reviewer_name:'Test',rating:5,comment:'Review',order_ref:order.order_ref,receipt_token:'b'.repeat(64)}},res);assert.equal(res.code,403);
});
console.log('PASS: client cannot self-approve/verify, proof binds to paid order and purchased SKU');
