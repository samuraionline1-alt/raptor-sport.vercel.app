import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(process.argv[2]||new URL('../api/contact.js',import.meta.url),'utf8');
const {createContactHandler}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const before={...process.env};
Object.assign(process.env,{SUPABASE_URL:'https://database.example',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_TEST',RESEND_API_KEY:'test-mail',ORDER_NOTIFICATION_EMAIL:'test@example.invalid',RESEND_EMAIL_DOMAIN:'example.invalid'});
const rows=new Map();let emails=0,requests=0,failMail=false;
const reply=(status,data)=>({ok:status>=200&&status<300,status,json:async()=>data});
const request=async(url,options)=>{
 requests++;
 const data=JSON.parse(options.body);
 if(url.includes('/rpc/raptor_submit_contact')){
  const row=data.p_message, prior=rows.get(row.id);
  if(prior){
   if(prior.message!==row.message)return reply(409,{code:'23505'});
   return reply(200,{created:false,email_status:prior.email_status});
  }
  if(rows.size>=5)return reply(400,{code:'P0001',message:'contact_rate_limit'});
  rows.set(row.id,{...row,email_status:'pending'});
  return reply(200,{created:true,email_status:'pending'});
 }
 if(url==='https://api.resend.com/emails'){emails++;return reply(failMail?500:200,{id:'mail'});}
 if(url.includes('/raptor_contact_messages?id=eq.')){Object.assign(rows.get(url.split('id=eq.')[1]),data);return reply(204,null);}
 throw Error('Unexpected request '+url);
};
const handler=createContactHandler(request);
async function call(body,headers={},method='POST'){
 let code,result;
 await handler({method,body,headers:{'content-type':'application/json',origin:'https://www.raptorthailand.com','x-vercel-forwarded-for':'192.0.2.1',...headers}},{setHeader(){},status(n){code=n;return this;},json(x){result=x;return this;}});
 return {code,result};
}
const valid={submission_id:'00000000-0000-4000-8000-000000000001',customer_name:'Contact test',contact:'test@example.invalid',message:'Test with mocked providers only'};
try{
 assert.equal((await call(valid)).code,200);assert.equal(rows.size,1);assert.equal(emails,1);
 assert.equal((await call(valid)).code,200);assert.equal(rows.size,1);assert.equal(emails,1,'duplicate must not email twice');
 assert.equal((await call({...valid,message:'changed'})).code,409);
 const count=requests;
 for(const bad of [{...valid,customer_name:''},{...valid,contact:'bad'},{...valid,message:'x'.repeat(5001)},{...valid,submission_id:'bad'}])assert.equal((await call(bad)).code,400);
 assert.equal((await call({...valid,website:'spam'})).code,200);assert.equal(requests,count);
 assert.equal((await call(valid,{origin:'https://attacker.invalid'})).code,403);
 assert.equal((await call(valid,{'content-type':'text/plain'})).code,415);
 assert.equal((await call(null,{},'GET')).code,405);
 failMail=true;
 assert.equal((await call({...valid,submission_id:'00000000-0000-4000-8000-000000000002'})).code,200,'durable save survives email outage');
 assert.equal(rows.get('00000000-0000-4000-8000-000000000002').email_status,'failed');
 failMail=false;
 for(let i=3;i<=5;i++)assert.equal((await call({...valid,submission_id:'00000000-0000-4000-8000-00000000000'+i})).code,200);
 assert.equal((await call({...valid,submission_id:'00000000-0000-4000-8000-000000000006'})).code,429);
 assert.equal(rows.size,5);
 const page=readFileSync(process.argv[3]||new URL('../index.html',import.meta.url),'utf8');
 assert.ok(page.includes('action="/api/contact"'));
 assert.ok(!page.includes("querySelectorAll('.raptor-order-form, .raptor-contact-form')"));
 assert.ok(!page.includes('https://formspree.io/f/mvzyqnag'));
 console.log('PASS: valid submission, duplicate suppression, validation, origin/type/method checks, honeypot, email outage, rate limit, isolated contact handler; no network traffic.');
}finally{for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);}
