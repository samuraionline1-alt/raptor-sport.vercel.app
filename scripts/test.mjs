import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
let failures=0;
for(const name of readdirSync('tests').filter(n=>n.endsWith('.mjs')&&!['browser-flow.mjs','visual-browser.mjs','tracking-browser.mjs'].includes(n)).sort()) {
 const result=spawnSync(process.execPath,['tests/'+name],{stdio:'inherit'});
 if(result.status!==0)failures++;
}
if(failures)process.exit(1);
