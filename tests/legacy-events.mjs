import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root=process.cwd();
const source=readFileSync(process.argv[2] || path.join(root,'gtm-ecommerce.js'),'utf8');
function harness({pathname='/',hash='',product=null,name='',shop=false}={}) {
 const pixels=[],listeners={},windowListeners={},storage=new Map();
 let observed;
 const window={dataLayer:[],fbq:(...args)=>pixels.push(args),addEventListener:(n,f)=>windowListeners[n]=f};
 window.IntersectionObserver=class {constructor(callback){observed=callback;}observe(){}disconnect(){}};
 const document={
  addEventListener:(n,f)=>listeners[n]=f,
  querySelector:()=>name?{value:name}:null,
  querySelectorAll:s=>s==='script[type="application/ld+json"]'&&product?[{textContent:JSON.stringify(product)}]:[],
  getElementById:id=>shop&&id==='shop'?{}:null
 };
 const location={pathname,hash};
 vm.runInNewContext(source,{window,document,location,Set,IntersectionObserver:window.IntersectionObserver,sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}});
 return {window,pixels,boot:()=>listeners.DOMContentLoaded(),location,observe:()=>observed([{isIntersecting:true}]),hashChange:()=>windowListeners.hashchange()};
}
let products=0;
for(const directory of readdirSync(path.join(root,'products'))) {
 let html;try{html=readFileSync(path.join(root,'products',directory,'index.html'),'utf8');}catch{continue;}
 const legacy=html.match(/fbq\('trackCustom', 'Viewcontent_([^']+)'/);
 const name=html.match(/name="product" value="([^"]+)"/)?.[1]?.replace(/&amp;/g,'&');
 const json=[...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m=>JSON.parse(m[1])).find(p=>p['@type']==='Product');
 if(!legacy||!json||!name)continue;
 const h=harness({pathname:'/products/'+directory+'/',product:json,name});
 h.boot();
 assert.equal(h.pixels.filter(p=>p[1]==='RaptorProductView_'+legacy[1]).length,1,directory+' legacy view name');
 assert.equal(h.pixels.filter(p=>p[1]==='ViewContent').length,0,'static bootstrap owns ViewContent; no duplicate');
 for(const event of ['InitiateCheckout','RaptorInitiateCheckout','RaptorFormSubmitStarted']) {
  h.window.trackRaptorPixel(event,{content_name:'SEO heading that must never become an event suffix',currency:'THB'},event!=='InitiateCheckout');
  assert.equal(h.pixels.filter(p=>p[0]==='trackCustom'&&p[1]===event+'_'+legacy[1]).length,1,directory+' '+event);
 }
 h.window.trackRaptorPixel('press button facebook',{page_section:'Contact Social Buttons'},true);
 h.window.trackRaptorPixel('RaptorReviewsSectionView',{page_section:'Athlete Reviews'},true);
 assert.ok(h.pixels.some(p=>p[1]==='press button facebook'));
 assert.ok(h.pixels.some(p=>p[1]==='RaptorReviewsSectionView'));
 assert.equal(h.pixels.some(p=>p[1]==='Purchase'),false);
 const before=h.window.dataLayer.length;
 h.window.RaptorEcommerce.track('begin_checkout',{value:179,currency:'THB',items:[]});
 assert.equal(h.window.dataLayer[before+1].event,'begin_checkout');
 assert.equal(h.window.dataLayer[before+2][1],'begin_checkout');
 assert.equal(h.window.dataLayer[before+2][2].send_to,'G-XC85CBJKQW');
 products++;
}
assert.ok(products>=11,'all published product fixtures');
const h=harness({hash:'#shop',shop:true});h.boot();h.observe();h.hashChange();
assert.equal(h.pixels.filter(p=>p[1]==='ViewCategory').length,1,'shop/hash/observer overlap must count once');
assert.equal(h.pixels.some(p=>['ViewContent','Purchase','Lead'].includes(p[1])),false,'browsing shop creates no product or conversion events');
console.log('PASS: '+products+' product contracts, legacy checkout/custom names, unchanged social/section names, single category view, GA4 checkout bridge; all providers stubbed, no network or orders.');

