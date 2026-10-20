import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=process.cwd(),scripts=new Set(),handlers=new Set();
const hash=value=>`'sha256-${createHash('sha256').update(value).digest('base64')}'`;
const decode=value=>value.replace(/&(?:quot|apos|amp|lt|gt|#\d+|#x[\da-f]+);/gi,entity=>{
 const named={'&quot;':'"','&apos;':"'",'&amp;':'&','&lt;':'<','&gt;':'>'};
 return named[entity] ?? String.fromCodePoint(entity[2].toLowerCase()==='x'?parseInt(entity.slice(3,-1),16):parseInt(entity.slice(2,-1),10));
});
async function scan(relative='') {
 for(const entry of await readdir(path.join(root,relative),{withFileTypes:true})) {
  if(entry.name.startsWith('.')||['node_modules','_site','api','lib','scripts','tests','docs','supabase','data','work'].includes(entry.name))continue;
  const file=path.join(relative,entry.name);
  if(entry.isDirectory()){await scan(file);continue;}
  if(!entry.name.endsWith('.html'))continue;
  const html=(await readFile(path.join(root,file),'utf8')).replace(/\r\n?/g,'\n');
  for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
   if(/\bsrc\s*=|\btype\s*=\s*["']application\/(?:ld\+)?json["']/i.test(match[1]))continue;
   if(match[2].trim())scripts.add(hash(match[2]));
  }
  const tags=html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'');
  for(const match of tags.matchAll(/\bon[a-z]+\s*=\s*(?:"([^"]*)"|'([^']*)')/gi))handlers.add(hash(decode(match[1]??match[2])));
 }
}
await scan();
const csp=["default-src 'self'","base-uri 'self'","object-src 'none'","frame-ancestors 'none'","form-action 'self' https://checkout.stripe.com",
 "script-src 'self' https://www.googletagmanager.com https://connect.facebook.net https://www.google-analytics.com https://www.googleadservices.com https://googleads.g.doubleclick.net "+[...scripts].sort().join(' '),
 "script-src-attr 'unsafe-hashes' "+[...handlers].sort().join(' '),
 "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com","font-src 'self' https://fonts.gstatic.com","img-src 'self' data: https:","media-src 'self'",
 "connect-src 'self' https://jktnltfbyuvurhqmzhww.supabase.co https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://www.facebook.com https://*.doubleclick.net https://www.googleadservices.com",
 "frame-src https://www.googletagmanager.com"].join('; ');
if(Buffer.byteLength(csp)>7500)throw new Error('CSP exceeds the response header budget');
const config=JSON.parse(await readFile('vercel.json','utf8'));
const headers=config.headers.find(h=>h.source==='/(.*)').headers;
const existing=headers.find(h=>h.key==='Content-Security-Policy');
if(process.argv.includes('--check')) {
 if(existing?.value!==csp || headers.some(h=>h.key==='Content-Security-Policy-Report-Only'))throw new Error('CSP hashes are stale. Run npm run security:headers and commit vercel.json before deployment.');
} else {
 existing.value=csp;
 config.headers[0].headers=headers.filter(h=>h.key!=='Content-Security-Policy-Report-Only');
 await writeFile('vercel.json',JSON.stringify(config,null,2)+'\n');
}
console.log(`Security headers: ${scripts.size} inline scripts and ${handlers.size} handlers explicitly allowed; arbitrary inline code blocked`);
