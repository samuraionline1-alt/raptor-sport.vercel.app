// Publish browser assets only. Server code, SQL, tests, drafts and docs stay private.
import {readdir,mkdir,rm,copyFile,lstat} from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),out=path.join(root,'_site');
await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
const publicDirs=new Set(['assets','products','wholesale','articles','policies']);
const browserFile=/\.(?:html|js|css|png|jpe?g|webp|svg|gif|ico|mp4|woff2?|ttf)$/i;
async function copy(relative) {
 const source=path.join(root,relative),stat=await lstat(source);
 if(stat.isSymbolicLink())throw new Error('Public assets must not be symlinks');
 if(stat.isDirectory()) {for(const entry of await readdir(source))if(!entry.startsWith('.'))await copy(path.join(relative,entry));return;}
 if(!browserFile.test(relative) && !['robots.txt','sitemap.xml'].includes(relative) && !/^assets[\/]vendor[\/].*(?:LICENSE|OFL)\.txt$/.test(relative))return;
 const target=path.join(out,relative);await mkdir(path.dirname(target),{recursive:true});await copyFile(source,target);
}
for(const entry of await readdir(root))if(publicDirs.has(entry)||(!entry.startsWith('.')&&browserFile.test(entry))||['robots.txt','sitemap.xml'].includes(entry))await copy(entry);
console.log('Public build: browser assets only; private source excluded');
