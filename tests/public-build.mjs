import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
assert.equal(spawnSync(process.execPath,['scripts/security-headers.mjs','--check'],{stdio:'inherit'}).status,0);
assert.equal(spawnSync(process.execPath,['scripts/build-public.mjs'],{stdio:'inherit'}).status,0);
for(const privatePath of ['lib','api','supabase','scripts','tests','docs','data','package.json','package-lock.json','README.md','.git','.env','node_modules','vercel.json'])assert.equal(fs.existsSync(path.join('_site',privatePath)),false,privatePath+' must never become a static asset');
for(const publicPath of ['index.html','thank-you.html','contact-form.js','checkout.js','assets/site.css','products/raptor-cooling-spray/index.html','wholesale/index.html','articles/index.html','sitemap.xml','robots.txt'])assert.ok(fs.existsSync(path.join('_site',publicPath)),publicPath+' must remain available');
// Follow every local HTML asset/link in the built site, including article and policy pages.
const missing=[];
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
 const file=path.join(dir,entry.name);if(entry.isDirectory()){walk(file);continue;}
 if(!file.endsWith('.html'))continue;
 const html=fs.readFileSync(file,'utf8').replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/gi,'$1</script>');
 for(const match of html.matchAll(/\b(?:src|href|poster)\s*=\s*["']([^"']+)["']/g)){
  const href=match[1];if(/^(?:https?:|data:|mailto:|tel:|javascript:|#)/i.test(href))continue;
  const url=new URL(href,'https://test.local/'+path.relative('_site',file).replaceAll(path.sep,'/'));
  const target=path.join('_site',decodeURIComponent(url.pathname));
  if(![target,target+'.html',path.join(target,'index.html')].some(f=>fs.existsSync(f)))missing.push({file,href});
 }
}}
walk('_site');assert.deepEqual(missing,[],'Every local page and asset must survive the private-source exclusion');
console.log('PASS: static deployment excludes private sources and retains all linked pages/assets; CSP hashes current');
