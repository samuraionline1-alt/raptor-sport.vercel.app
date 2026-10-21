// Real, vendored Chart.js and logo video under the deployed CSP; no production writes.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const root=path.resolve('_site'), config=JSON.parse(fs.readFileSync('vercel.json','utf8'));
const server=http.createServer((req,res)=>{
 try {
  const pathname=decodeURIComponent(new URL(req.url,'http://local').pathname);
  let file=path.resolve(root,'.'+pathname);
  if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(404).end();return;}
  if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
  if(!fs.existsSync(file)&&!path.extname(file))file+='.html';
  if(!fs.existsSync(file)){res.writeHead(404).end();return;}
  for(const h of config.headers[0].headers)res.setHeader(h.key,h.value);
  res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.mp4':'video/mp4','.webp':'image/webp','.woff2':'font/woff2'}[path.extname(file)]||'application/octet-stream'));
  const size=fs.statSync(file).size,range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
  if(range){const start=Number(range[1]),end=Math.min(range[2]?Number(range[2]):size-1,size-1);res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${size}`,'Accept-Ranges':'bytes','Content-Length':end-start+1});fs.createReadStream(file,{start,end}).pipe(res);}
  else {res.setHeader('Content-Length',size);fs.createReadStream(file).pipe(res);}
 }catch(_){res.writeHead(500).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],violations=[],externalCharts=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('recordScriptViolation',value=>violations.push(value));
 await page.addInitScript(()=>document.addEventListener('securitypolicyviolation',e=>{if(e.effectiveDirective.startsWith('script-src'))window.recordScriptViolation(e.blockedURI)}));

 const collected=[],pixels=[];
 await page.exposeFunction('recordPixel',args=>pixels.push(args));
 await page.route('**/*',route=>{
  const url=route.request().url();
  if(url.startsWith(origin))return route.continue();
  if(url.startsWith('https://connect.facebook.net/en_US/fbevents.js'))return route.fulfill({contentType:'text/javascript',body:`fbq.callMethod=function(){const a=Array.from(arguments);window.recordPixel(a);if(a[0]==='track'||a[0]==='trackCustom')fetch('https://www.facebook.com/tr?ev='+encodeURIComponent(a[1]),{mode:'no-cors'});};fbq.queue.splice(0).forEach(a=>fbq.callMethod.apply(null,a));`});
  if(url.startsWith('https://www.googletagmanager.com/gtm.js'))return route.fulfill({contentType:'text/javascript',body:`window.__testGtmLoaded=true;`});
  if(url.startsWith('https://www.facebook.com/tr')||url.startsWith('https://www.google.com/ccm/collect')||url.startsWith('https://connect.facebook.net/signals/config/')||url.startsWith('https://region1.google-analytics.com/g/collect')){collected.push(url);return route.fulfill({status:204,headers:{'access-control-allow-origin':'*'}});}
  return route.abort();
 });
 for(const slug of fs.readdirSync(path.join(root,'products'))){
  pixels.length=0;await page.goto(origin+'/products/'+slug+'/');
  await page.waitForFunction(()=>typeof fbq?.callMethod==='function'&&window.__testGtmLoaded);
  assert.ok(pixels.some(e=>e[0]==='init'&&e[1]==='462184846324554'));
  assert.ok(pixels.some(e=>e[1]==='PageView'));
  assert.ok(pixels.some(e=>e[1]==='ViewContent'));
  assert.ok(pixels.some(e=>e[0]==='trackCustom'&&e[1].startsWith('Viewcontent_')));
  assert.equal(await page.evaluate(()=>dataLayer.filter(e=>e.event==='view_item').length),1);
  assert.ok(pixels.some(e=>e[0]==='trackCustom'&&e[1].startsWith('RaptorProductView_')));
 }

 await page.route('**/api/orders',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Test intentionally stops before persistence'})}));
 await page.evaluate(()=>{window.alert=()=>{}});
 const form=page.locator('.raptor-order-form');
 await form.locator('[name="customer_name"]').fill('Tracking test');await form.locator('[name="phone"]').fill('0812345678');await form.locator('[name="address"]').fill('Test address');
 pixels.length=0;await form.locator('button[type="submit"]').click();
 await page.waitForFunction(()=>document.querySelector('.raptor-order-form').dataset.submitting==='0');
 assert.ok(pixels.some(e=>e[1]==='InitiateCheckout'));
 assert.ok(pixels.some(e=>e[1].startsWith('InitiateCheckout_')));
 assert.ok(pixels.some(e=>e[1].startsWith('RaptorFormSubmitStarted_')));
 assert.equal(pixels.filter(e=>e[1]==='Purchase').length,0,'Failed checkout never converts');
 await page.goto(origin+'/');
 await page.waitForFunction(()=>typeof fbq?.callMethod==='function');pixels.length=0;
 await page.evaluate(()=>document.querySelectorAll('[data-contact-pixel-button]').forEach(e=>e.addEventListener('click',event=>event.preventDefault())));
 for(const link of await page.locator('[data-contact-pixel-button]').all())await link.click();
 for(const name of ['press button tiktok','press button facebook','press button line chat'])assert.ok(pixels.some(e=>e[1]===name),name);
 await page.goto(origin+'/thank-you.html');
 await page.waitForFunction(()=>typeof fbq?.callMethod==='function');
 pixels.length=0;
 const receipt={order_ref:'RPT-TEST-TRACKING',payment_status:'cod',total_price:329,quantity:2,product:'RAPTOR SPORTS ICE COLD SPRAY × 2',items:[{sku:'raptor-cooling-spray',name:'RAPTOR SPORTS ICE COLD SPRAY',quantity:2,line_total_cents:32900}]};
 await page.evaluate(r=>{document.dispatchEvent(new CustomEvent('raptor:order-confirmed',{detail:r}));document.dispatchEvent(new CustomEvent('raptor:order-confirmed',{detail:r}));},receipt);
 await page.waitForFunction(()=>sessionStorage.getItem('raptorMetaPurchase:RPT-TEST-TRACKING')==='1');
 for(const name of ['Lead','Lead_RAPTOR_SPORTS_ICE_COLD_SPRAY','Purchase','Purchase_RAPTOR_SPORTS_ICE_COLD_SPRAY','RaptorOrderSubmitted_RAPTOR_SPORTS_ICE_COLD_SPRAY'])assert.equal(pixels.filter(e=>e[1]===name).length,1,name+' once');
 assert.equal(await page.evaluate(()=>dataLayer.filter(e=>e.event==='purchase').length),1);
 await page.evaluate(async()=>{
  await Promise.all(['https://www.google.com/ccm/collect?en=policy_probe','https://region1.google-analytics.com/g/collect?en=policy_probe','https://connect.facebook.net/signals/config/462184846324554'].map(url=>fetch(url,{mode:'no-cors'})));
 });
 for(const host of ['www.google.com','region1.google-analytics.com','connect.facebook.net'])assert.ok(collected.some(url=>new URL(url).hostname===host),host+' CSP transport');
 assert.deepEqual(violations,[]);assert.deepEqual(errors,[]);
 await page.unrouteAll({behavior:'wait'});
 console.log('PASS: actual storefront bootstraps, all12 product view and legacy custom events, receipt Pixel initialization, legacy conversion names, duplicate guards, GA/Ads/Meta CSP transport. Provider scripts/collectors are mocked; no real analytics traffic.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
