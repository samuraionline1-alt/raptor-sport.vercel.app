import {mkdtemp,mkdir,readFile,writeFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import catalog from '../product-catalog.js';
const temp=await mkdtemp(path.join(tmpdir(),'raptor-review-security-'));
try {
 await mkdir(path.join(temp,'scripts'));await copyFile('scripts/sync-reviews-seo.mjs',path.join(temp,'scripts/sync-reviews-seo.mjs'));
 for(const p of catalog.retail){await mkdir(path.join(temp,'products',p.sku),{recursive:true});await writeFile(path.join(temp,'products',p.sku,'index.html'),'<html><head><script type="application/ld+json">{"@type":"Product","name":"test"}</script><script src="/gtm-ecommerce.js?v=secure-20261020" defer></script></head><body><footer></footer></body></html>');}
 const payload='</script><script id="injected-review">window.reviewInjected=true</script>';
 const reviews=[{product_slug:'raptor-cooling-spray',reviewer_name:payload,comment:payload,rating:5,is_verified:false,reviewed_at:'2026-10-20T00:00:00Z'}];
 const code=`globalThis.fetch=async()=>Response.json(${JSON.stringify(reviews)});await import(${JSON.stringify(pathToFileURL(path.join(temp,'scripts/sync-reviews-seo.mjs')).href)});`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
 const output=await readFile(path.join(temp,'products/raptor-cooling-spray/index.html'),'utf8');
 assert.ok(!output.includes('<script id="injected-review">'),'Review content cannot terminate the JSON-LD script');
 const json=output.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];assert.equal(JSON.parse(json).review[0].reviewBody,payload,'Escaping preserves the exact review text');
 assert.ok(!output.includes('Verified Official Buyer'),'Unverified static review must not claim a verified purchase');
 assert.equal([...output.matchAll(/src="\/gtm-ecommerce\.js/g)].length,1,'Review sync does not duplicate the versioned tracking script');
 console.log('PASS: full SEO review generator rejects script termination, preserves JSON content, respects verification and avoids duplicate analytics scripts');
}finally{await rm(temp,{recursive:true,force:true});}
