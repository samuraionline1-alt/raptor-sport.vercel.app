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
 await page.route('**/*',route=>{
  const url=route.request().url();if(url.startsWith(origin))return route.continue();
  if(/chart\.js|chart\.umd/i.test(url))externalCharts.push(url);
  return route.abort();
 });
 await page.goto(origin+'/');
 const logo=page.locator('video.logo-premium-video:visible');
 const isPlaying=()=>page.waitForFunction(()=>[...document.querySelectorAll('video.logo-premium-video')].some(v=>v.getClientRects().length&&!v.paused&&v.currentTime>.1));
 const finish=async()=>{
  await page.locator('video.logo-premium-video:visible').evaluate(v=>{v.currentTime=v.duration-.1});
  await page.waitForFunction(()=>[...document.querySelectorAll('video.logo-premium-video')].every(v=>v.paused)&&!!document.querySelector('[data-logo-state="completed"]'));
 };
 await isPlaying();assert.equal(await logo.evaluate(v=>v.muted&&!v.loop&&v.playsInline),true);
 await finish();
 assert.equal(await logo.evaluate(v=>v.currentTime<.05&&getComputedStyle(v).opacity==='0'&&getComputedStyle(v.parentElement).backgroundImage.includes('raptor-logo-cover.png')),true,'Completed logo shows its original cover');
 await page.locator('#mobile-menu-btn').click();assert.equal(await page.locator('#mobile-menu-btn').getAttribute('aria-expanded'),'true');
 await page.locator('#mobile-menu-btn').click();
 await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 assert.equal(await logo.evaluate(v=>v.paused),true,'Ordinary clicks/tab visibility must not replay a finished logo');
 await page.setViewportSize({width:1280,height:900});
 assert.equal(await page.locator('video.logo-premium-video:visible').evaluate(v=>v.paused),true,'Resizing must not start a second pass');
 await page.locator('a.nav-link[href="#home"]').click();await isPlaying();
 assert.equal(await page.locator('video.logo-premium-video:visible').evaluate(v=>v.currentTime<2),true);
 await finish();
 await page.locator('a.nav-link[href="#home"]').click();await isPlaying(); // Same hash must also replay.
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.waitForFunction(()=>[...document.querySelectorAll('video.logo-premium-video')].every(v=>v.paused));
 await page.emulateMedia({reducedMotion:'no-preference'});await isPlaying();await finish();
 await page.emulateMedia({reducedMotion:'reduce'});await page.emulateMedia({reducedMotion:'no-preference'});
 assert.equal(await page.locator('video.logo-premium-video:visible').evaluate(v=>v.paused),true,'Motion settings must not replay a finished pass');
 await page.setViewportSize({width:390,height:844});
 await page.reload();await isPlaying();await finish();
 await page.goto(origin+'/articles/');await page.goBack();await isPlaying();
 console.log('PASS: logo single pass, stops after ending, Home/same-hash/reload/Back restart, no click/resize replay');
 // Exercise real taps repeatedly, custom editing, prices and coupon/payment transitions.
 const timings=[];
 for (const viewport of [{width:390,height:844},{width:1280,height:900}]) {
  await page.setViewportSize(viewport);
  for (const slug of fs.readdirSync(path.join(root,'products'))) {
   await page.goto(origin+'/products/'+slug+'/');
   const form=page.locator('.raptor-order-form');
   if (!await form.count()) continue;
   const unit=await form.evaluate(f=>Number(f.dataset.price.replace(/[^\d.]/g,'')));
   for (const tier of ['tier_1','tier_6','tier_2','custom','tier_3','custom','tier_1','tier_2']) {
    const radio=form.locator('[name="bundle_tier_choice"][value="'+tier+'"]');
    await radio.locator('..').click();
    const custom=form.locator('[data-custom-quantity]');
    assert.equal(await custom.isVisible(),tier==='custom',slug+' custom visibility');
    if (tier==='custom') await custom.fill('7');
    const n=tier==='custom'?7:Number(tier.slice(5));
    assert.equal(await form.locator('[name="quantity"]').inputValue(),String(n));
    const expected=Math.round(unit*n*({tier_2:.92,tier_3:.85,tier_6:.8}[tier]||1));
    assert.equal(Number(await form.locator('[name="total_price"]').inputValue()),expected,slug+' price');
    assert.ok((await form.locator('[data-order-price-summary]').textContent()).includes('('+n+' ชิ้น)'));
   }
   await form.locator('[name="bundle_tier_choice"][value="custom"]').locator('..').click();
   const custom=form.locator('[data-custom-quantity]');
   await custom.fill('3');assert.equal(await custom.evaluate(e=>e.checkValidity()),false);
   await custom.fill('7');assert.equal(await custom.evaluate(e=>e.checkValidity()),true);
   await form.locator('[name="bundle_tier_choice"][value="tier_2"]').locator('..').click();
   assert.equal(await custom.isDisabled(),true,'Hidden invalid custom field must not block bundles');
   await form.locator('[name="payment_method"][value="STRIPE"]').check();
   assert.ok((await form.locator('button[type="submit"]').textContent()).includes('ออนไลน์'));
   await form.locator('[name="payment_method"][value="COD"]').check();
   const mutations=await form.evaluate(async f=>{
    let count=0;const observer=new MutationObserver(rs=>count+=rs.length);
    observer.observe(f.querySelector('[data-order-price-summary]'),{childList:true,subtree:true});
    const name=f.querySelector('[name="customer_name"]');name.value='Test';name.dispatchEvent(new Event('input',{bubbles:true}));
    await Promise.resolve();observer.disconnect();return count;
   });
   assert.equal(mutations,0,'Typing delivery details must not rebuild pricing');
   const latency=await form.evaluate(f=>{
    const start=performance.now();
    for(const tier of ['tier_1','tier_6','tier_3','tier_2'])f.querySelector('[value="'+tier+'"]').click();
    return performance.now()-start;
   });
   timings.push(latency);assert.ok(latency<150,'Four rapid selections exceeded 150ms: '+latency);
  }
 }
 console.log('PASS: all product forms mobile/desktop repeated real selection, custom quantity, exact prices, payment methods; max four-selection handler time '+Math.max(...timings).toFixed(1)+'ms');
 let charts=0;
 for(const slug of fs.readdirSync(path.join(root,'products'))){
  await page.goto(origin+'/products/'+slug+'/');
  for(const canvas of await page.locator('canvas').all()){
   await canvas.scrollIntoViewIfNeeded();const id=await canvas.getAttribute('id');
   try {
   await page.waitForFunction(id=>{const c=document.getElementById(id);return !!window.Chart?.getChart(c)&&c.width>0&&c.height>0&&c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v>0);},id,{timeout:10000});
   } catch(error) {console.log('Chart diagnostic',slug,await canvas.evaluate(c=>({library:typeof window.Chart,instance:!!window.Chart?.getChart(c),width:c.width,height:c.height,status:c.parentElement.querySelector('[role=status]')?.textContent})),errors,violations);throw error;}
   await page.waitForFunction(id=>{const chart=window.Chart.getChart(document.getElementById(id));return chart.getSortedVisibleDatasetMetas().every(meta=>meta.data.every(point=>['x','y'].every(key=>Math.abs(point[key]-point.getProps([key],true)[key])<.75)));},id);
   charts++;console.log('Rendered chart',slug,id);
   assert.equal(await page.locator('.chart-load-status').count(),0);
   if(slug==='raptor-cooling-spray')await page.screenshot({path:'/workspace/raptor-audit/visual-cooling-mobile.png'});
  }
 }
 assert.equal(charts,11,'Every existing product chart must actually render');
 assert.deepEqual(externalCharts,[]);assert.deepEqual(violations,[]);assert.deepEqual(errors,[]);
 // A failed load must recover by a real user retry instead of remaining blank.
 let failChart=true;
 await page.route('**/assets/vendor/chart.umd-4.5.1.min.js',route=>failChart?route.abort():route.continue());
 await page.goto(origin+'/products/raptor-cooling-spray/');await page.locator('canvas').scrollIntoViewIfNeeded();
 await page.getByRole('button',{name:'โหลดกราฟอีกครั้ง'}).waitFor();failChart=false;
 await page.getByRole('button',{name:'โหลดกราฟอีกครั้ง'}).click();
 await page.waitForFunction(()=>!!window.Chart?.getChart(document.querySelector('canvas')));
 assert.equal(await page.locator('.chart-load-status').count(),0);
 // Low Power Mode equivalent: preserve an effect and retry permission on interaction.
 const blocked=await browser.newPage({viewport:{width:390,height:844}});
 await blocked.addInitScript(()=>{HTMLMediaElement.prototype.play=function(){return Promise.reject(new DOMException('Autoplay denied','NotAllowedError'))}});
 await blocked.route('**/*',async route=>{
  if(route.request().url()===origin+'/'){const response=await route.fetch();return route.fulfill({response,body:(await response.text()).replace(/autoplay /g,'')});}
  return route.request().url().startsWith(origin)?route.continue():route.abort();
 });
 await blocked.goto(origin+'/');await blocked.waitForFunction(()=>document.querySelector('.logo-premium-shell[data-logo-state="fallback"]'));
 assert.equal(await blocked.locator('video.logo-premium-video:visible').evaluate(v=>getComputedStyle(v.parentElement).animationName),'logoFallbackPulse');
 assert.equal(await blocked.locator('video.logo-premium-video:visible').evaluate(v=>getComputedStyle(v.parentElement).animationIterationCount),'1');
 await blocked.close();
 console.log('PASS: all 11 product charts visibly render under CSP, chart retry recovery, mobile/desktop single-pass logo and explicit restart, reduced motion, blocked-autoplay fallback and mobile menu');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
