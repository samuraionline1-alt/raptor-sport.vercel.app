// Browser + real route handlers + a local mocked service boundary. No production writes.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { withOrderDatabase, orders, rateLimits } from './helpers/order-database.mjs';
const playwright = process.env.PLAYWRIGHT_MODULE || 'playwright-core';
const { chromium } = await import(playwright.startsWith('/') ? pathToFileURL(playwright).href : playwright);
process.env.STRIPE_SECRET_KEY='mock';process.env.LINE_CHANNEL_ACCESS_TOKEN='mock';process.env.LINE_ADMIN_USER_ID='test-admin';
const sessions=new Map();
global.fetch=async(url,options)=>{
 if(url.startsWith('https://api.stripe.com/')) {
  if(options.method==='POST') {
   const params=new URLSearchParams(options.body),ref=params.get('metadata[order_ref]');
   const session={id:'cs_test_'+ref.replace(/[^A-Za-z0-9]/g,''),url:'https://checkout.stripe.com/test',status:'open',payment_status:'unpaid',currency:'thb',amount_total:Number(params.get('line_items[0][price_data][unit_amount]')),metadata:{order_ref:ref,order_channel:params.get('metadata[order_channel]')},success_url:params.get('success_url')};
   sessions.set(session.id,session);return Response.json(session);
  }
  return Response.json(sessions.get(url.split('/').at(-1)));
 }
 return {ok:true};
};
const root=process.cwd(),staticRoot=path.join(root,'_site'), vercel=JSON.parse(fs.readFileSync('vercel.json','utf8'));
const apiCalls=[]; let loseAcknowledgement=true;
const server=http.createServer(async(req,res)=>{
 try {
  const url=new URL(req.url,'http://local');
  if(url.pathname.startsWith('/api/')) {
   apiCalls.push(url.pathname);
   const chunks=[];for await(const c of req)chunks.push(c);
   req.body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined;req.query=Object.fromEntries(url.searchParams);
   const name=url.pathname.slice(5);const {default:handler}=await import(pathToFileURL(path.join(root,'api',name+'.js')).href);
   res.status=code=>{res.statusCode=code;return res};res.json=body=>{if(url.pathname==='/api/orders' && loseAcknowledgement && body.ok){loseAcknowledgement=false;res.statusCode=503;body={error:'Simulated acknowledgement loss'};}res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));return res};
   await withOrderDatabase(()=>handler(req,res));return;
  }
  let target=path.resolve(staticRoot,'.'+decodeURIComponent(url.pathname));if(!target.startsWith(staticRoot+path.sep))target=path.join(staticRoot,'index.html');
  if(fs.existsSync(target)&&fs.statSync(target).isDirectory())target=path.join(target,'index.html');
  if(!fs.existsSync(target)&&!path.extname(target))target=target.replace(/\/$/,'')+'.html';
  if(!fs.existsSync(target)){res.statusCode=404;res.end();return;}
  for(const header of vercel.headers[0].headers)res.setHeader(header.key,header.value);
  res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2'}[path.extname(target)]||'application/octet-stream'));
  fs.createReadStream(target).pipe(res);
 }catch(error){console.error(error);res.statusCode=500;res.end('Test server failure');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
try {
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
 await page.addInitScript(()=>{window.scriptViolations=[];document.addEventListener('securitypolicyviolation',e=>{if(e.effectiveDirective.startsWith('script-src'))window.scriptViolations.push(e.blockedURI)});});
 page.on('pageerror',error=>{errors.push(error.message);console.error('BROWSER ERROR',error.message)});
 page.on('dialog',async dialog=>{console.error('DIALOG',dialog.message());await dialog.dismiss()});

 await page.route('**/*',async route=>{
  const url=route.request().url();
  if(url.startsWith(origin))return route.continue();
  if(url.startsWith('https://checkout.stripe.com/')){
   const session=[...sessions.values()].at(-1);session.status='complete';session.payment_status='paid';
   const success=new URL(session.success_url);success.searchParams.set('session_id',session.id);
   return route.fulfill({contentType:'text/html',body:`<script>location.href=${JSON.stringify(origin+success.pathname+success.search)}</script>`});
  }
  return route.abort();
 });
 await page.goto(origin+'/products/raptor-cooling-spray/');
 // Modal helpers are part of the actual storefront; force visibility only to reach the form without scrolling the hero.
 await page.evaluate(()=>{const form=document.querySelector('.raptor-order-form');for(let n=form;n&&n!==document.body;n=n.parentElement){n.classList.remove('hidden');n.style.display=n===form?'block':n.style.display;}document.body.style.overflow='auto';window.fbq=()=>{throw Error('Simulated analytics failure')};});
 const form=page.locator('.raptor-order-form');
 await form.locator('[name="customer_name"]').fill('Browser buyer');await form.locator('[name="phone"]').fill('0812345678');await form.locator('[name="address"]').fill('Test address');

 await form.evaluate(f=>f.requestSubmit());
 await page.waitForFunction(()=>document.querySelector('.raptor-order-form').dataset.submitting==='0');
 assert.equal(orders.size,1);
 await form.evaluate(f=>f.requestSubmit());
 await page.waitForURL(/thank-you/);await page.waitForFunction(()=>document.getElementById('order-status')?.textContent.includes('ปลายทาง'));
 assert.ok(apiCalls.includes('/api/orders'));assert.ok(await page.locator('#receipt-title').textContent());
 const ref=new URL(page.url()).searchParams.get('order_ref');assert.equal(orders.get(ref).payload.total_price,329);assert.equal(orders.size,1,'Retry never creates a duplicate COD order');
 const storage=await page.evaluate(()=>JSON.stringify(sessionStorage));assert.ok(!storage.includes('Test address'));assert.ok(!storage.includes('0812345678'));
 const purchaseCount=await page.evaluate(()=>dataLayer.filter(x=>x.event==='purchase').length);assert.equal(purchaseCount,1);
 await page.reload();await page.waitForFunction(()=>document.getElementById('order-status')?.textContent.includes('ปลายทาง'));assert.equal(await page.evaluate(()=>dataLayer.filter(x=>x.event==='purchase').length),0,'Receipt reload never counts a second purchase');
 await page.goto(origin+'/wholesale/?paid=1');assert.ok(!(await page.locator('#receipt-title').textContent()).includes('ชำระเงินสำเร็จ'));assert.equal(await page.evaluate(()=>dataLayer.filter(x=>x.event==='purchase').length),0);
 rateLimits.clear();await page.goto(origin+'/products/raptor-cooling-spray/');
 await page.evaluate(()=>{const f=document.querySelector('.raptor-order-form');for(let n=f;n&&n!==document.body;n=n.parentElement)n.classList.remove('hidden');});
 const online=page.locator('.raptor-order-form');
 await online.locator('[name="customer_name"]').fill('Online buyer');await online.locator('[name="phone"]').fill('0812345678');await online.locator('[name="address"]').fill('Online test address');
 await online.locator('[name="payment_method"][value="STRIPE"]').check({force:true});await online.evaluate(f=>f.requestSubmit());
 await page.waitForURL(/thank-you.*payment=stripe_success/);await page.waitForFunction(()=>document.getElementById('order-status')?.textContent.includes('ชำระเงินสำเร็จ'));
 const onlineRef=new URL(page.url()).searchParams.get('order_ref');assert.equal(orders.get(onlineRef).payment_status,'paid');
 rateLimits.clear();await page.goto(origin+'/wholesale/');
 // Every SKU is retained through frontend -> API -> order store -> paid receipt.
 for(let i=1;i<=10;i++){await page.locator('#qty-p'+i).fill('5');await page.locator('[data-add="p'+i+'"]').click();}
 await page.locator('#checkout-btn').click();
 await page.locator('#orderForm [name="name"]').fill('Wholesale buyer');await page.locator('#orderForm [name="phone"]').fill('0812345678');await page.locator('#orderForm [name="address"]').fill('Wholesale test address');await page.locator('#orderForm [name="email"]').fill('buyer@example.com');
 await page.evaluate(()=>{window.fbq=()=>{throw Error('Simulated analytics failure')}});
 await page.locator('#submitOrder').click();await page.waitForURL(/payment=stripe_success/);await page.waitForFunction(()=>document.getElementById('receipt-title')?.textContent==='ชำระเงินสำเร็จ');
 const wholesaleRef=new URL(page.url()).searchParams.get('order_ref');assert.equal(orders.get(wholesaleRef).payload.items.length,10);assert.equal(orders.get(wholesaleRef).payment_status,'paid');assert.ok(orders.get(wholesaleRef).payload.product.length>200);
 assert.equal(await page.evaluate(()=>dataLayer.filter(x=>x.event==='purchase').length),1);
 // Contact UI preserves input/id after failure and never counts a purchase.
 let contactAttempts=[];
 await page.route('**/api/contact',async route=>{
   contactAttempts.push(route.request().postDataJSON());
   await route.fulfill({status:contactAttempts.length===1?503:200,contentType:'application/json',body:JSON.stringify(contactAttempts.length===1?{error:'ลองอีกครั้ง'}:{ok:true})});
 });
 await page.goto(origin+'/');
 await page.evaluate(()=>{window.trackRaptorPixel=()=>{throw Error('Tracking unavailable')}});
 const contact=page.locator('.raptor-contact-form');
 await contact.locator('[name="customer_name"]').fill('Contact buyer');
 await contact.locator('[name="contact"]').fill('buyer@example.com');
 await contact.locator('[name="message"]').fill('General enquiry');
 await contact.evaluate(f=>f.requestSubmit());
 await page.waitForFunction(()=>document.querySelector('.raptor-contact-form [role="status"]').textContent==='ลองอีกครั้ง');
 assert.equal(await contact.locator('[name="message"]').inputValue(),'General enquiry');
 await contact.evaluate(f=>f.requestSubmit());
 await page.waitForFunction(()=>document.querySelector('.raptor-contact-form [role="status"]').textContent.includes('ส่งข้อความเรียบร้อย'));
 assert.equal(contactAttempts[0].submission_id,contactAttempts[1].submission_id);
 assert.equal(await contact.locator('[name="message"]').inputValue(),'');
 assert.equal(await page.evaluate(()=>dataLayer.filter(x=>x.event==='purchase').length),0);
 // Exercise every published product and content template under the enforced policy.
 for(const route of [...fs.readdirSync(path.join(staticRoot,'products')).map(slug=>'/products/'+slug+'/'),'/articles/','/articles/sports-first-aid/','/policies/privacy-policy.html']) {
   if(route.startsWith('/policies/') && !fs.existsSync(path.join(staticRoot,route)))continue;
   await page.goto(origin+route,{waitUntil:'domcontentloaded'});
   assert.deepEqual(await page.evaluate(()=>window.scriptViolations),[],route+' must not block first-party scripts');
 }
 await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
 // The enforced policy permits the real storefront but rejects arbitrary inline code.
 assert.deepEqual(await page.evaluate(()=>window.scriptViolations),[],'Legitimate contact/home scripts must satisfy CSP');
 await page.evaluate(()=>{const script=document.createElement('script');script.textContent='window.__untrustedScriptRan=true';document.head.appendChild(script);});
 await page.waitForFunction(()=>window.scriptViolations.length>0);
 assert.equal(await page.evaluate(()=>window.__untrustedScriptRan),undefined,'Injected inline script must be blocked');
 for(const privatePath of ['/lib/order-store.js','/supabase/sql/contact_messages.sql','/tests/contact.mjs'])assert.equal((await page.request.get(origin+privatePath)).status(),404);
 // Only errors from blocked optional third-party providers may be ignored.
 assert.deepEqual(errors,[]);
 console.log('PASS: mobile Chromium retail COD/Stripe and 10-SKU wholesale Stripe return, real handlers, tracking failures, lost-ack retry, verified receipts, no PII storage, no reload duplicates, fake-paid rejection');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
