import assert from 'node:assert/strict';
import catalog from '../product-catalog.js';
import promo from '../promo-config.js';
import { priceOrder } from '../lib/order-pricing.js';
import {fixture} from './helpers/order-database.mjs';
import fs from 'node:fs';
for(const p of catalog.retail)for(const [tier,count,rate] of [['tier_1',1,1],['tier_2',2,.92],['tier_3',3,.85],['tier_6',6,.8],['custom',7,1]]) {
 const subtotal=Math.round(p.price*count*rate);
 for(const code of ['',...Object.keys(promo.coupons)]) {
  const result=promo.calculate(subtotal,tier==='custom'?'tier_7':tier,code);
  const body=fixture({sku:p.sku,quantity:count,bundleTier:tier,subtotal,total_price:result.totalPrice,coupon_code:code});
  if(result.couponError) {assert.throws(()=>priceOrder(body));continue;}
  const priced=priceOrder(body);assert.equal(priced.total_cents,result.totalPrice*100);assert.equal(priced.free_gifts,result.free_gifts);
 }
 const html=fs.readFileSync(`products/${p.sku}/index.html`,'utf8');assert.ok(html.includes(`data-sku="${p.sku}"`));assert.ok(html.includes(`data-price="฿${p.price}"`));
}
for(const change of [{total_price:1},{total_price:1,subtotal:1},{quantity:100,total_price:1,subtotal:1,bundleTier:'custom'},{sku:'unknown'},{quantity:-1},{quantity:2.5},{bundleTier:'tier_6'},{coupon_code:'invalid'},{subtotal:'invalid'}])assert.throws(()=>priceOrder(fixture(change)));
for(const n of [50,100,101,200,201,300,301,400,401,500,501,1000,10000]) {
 const p=catalog.wholesale[0];const unit=p.tiers.reduce((v,t)=>n>=t.min?t.price:v,p.defaultPrice);
 const shipping=n<=100?150:n<=200?350:n<=300?500:n<=400?850:n<=500?1000:1500;
 const total=Number(((unit*n+shipping)*1.07).toFixed(2));
 const q=priceOrder({is_wholesale:true,items:[{id:p.id,qty:n,unitPrice:1}],total_price:total});assert.equal(q.total_price,total);assert.equal(q.items[0].unit_price_cents,unit*100);
}
for(const items of [[],[{id:'p1',qty:49}],[{id:'fake',qty:50}],[{id:'p1',qty:50},{id:'p1',qty:50}]])assert.throws(()=>priceOrder({is_wholesale:true,items,total_price:1}));
console.log('PASS: every retail product/tier/coupon, storefront catalog parity, price manipulation rejection, wholesale thresholds/shipping/VAT/duplicate SKU validation');
