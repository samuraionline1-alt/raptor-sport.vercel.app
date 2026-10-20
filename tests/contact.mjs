import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import handler from '../api/contact.js';
import {retryContactEmails} from '../lib/contact-notifications.js';
import {response} from './helpers/order-database.mjs';
const db=new PGlite();
await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
await db.exec(fs.readFileSync('supabase/sql/contact_messages.sql','utf8'));
const id='a1234567-1234-4123-8123-123456789012';
await db.query('insert into raptor_contact_messages(id,customer_name,contact,message) values($1,$2,$3,$4)',[id,'Test','buyer@example.com','Hello']);
await db.exec('set role anon');
for (const q of ['select * from raptor_contact_messages',`select * from raptor_claim_contact_email('${id}')`])await assert.rejects(db.exec(q),/permission denied/);
await db.exec('reset role;set role service_role');
assert.equal((await db.query('select * from raptor_claim_contact_email($1)',[id])).rows.length,1);
assert.equal((await db.query('select * from raptor_claim_contact_email($1)',[id])).rows.length,0);
await db.exec("update raptor_contact_messages set email_status='failed',email_attempts=8");
assert.equal((await db.query('select * from raptor_claim_contact_email($1)',[id])).rows.length,0);
assert.equal((await db.query('select email_status from raptor_contact_messages')).rows[0].email_status,'manual_review');
await db.close();
process.env.RESEND_API_KEY='mock';process.env.ORDER_NOTIFICATION_EMAIL='owner@example.com';process.env.RESEND_EMAIL_DOMAIN='example.com';
const rows=new Map();let emailCalls=0,failDb=false,failEmail=false,allowRate=true;
global.fetch=async(url,options={})=>{
 if(url==='https://api.resend.com/emails') {emailCalls++;assert.equal(JSON.parse(options.body).to[0],'owner@example.com');return failEmail?new Response('',{status:503}):Response.json({id:'mock'});}
 const path=new URL(url).pathname.split('/rest/v1/')[1],query=new URL(url).searchParams,body=options.body?JSON.parse(options.body):null;
 if(path==='rpc/raptor_rate_limit')return Response.json(allowRate);
 if(failDb)return new Response('',{status:503});
 if(path==='rpc/raptor_claim_contact_email') {const row=rows.get(body.p_id);if(!row || !['pending','failed'].includes(row.email_status))return Response.json([]);row.email_status='sending';row.email_attempts++;return Response.json([row]);}
 assert.equal(path,'raptor_contact_messages');
 if(options.method==='POST') {if(!rows.has(body.id))rows.set(body.id,{...body,email_status:'pending',email_attempts:0});return new Response(null,{status:204});}
 if(options.method==='PATCH') {Object.assign(rows.get(query.get('id').slice(3)),body);return new Response(null,{status:204});}
 if(query.has('id'))return Response.json(rows.has(query.get('id').slice(3))?[rows.get(query.get('id').slice(3))]:[]);
 return Response.json([...rows.values()].filter(r=>r.email_status==='failed').slice(0,1));
};
const valid={submission_id:id,customer_name:'Test contact',contact:'buyer@example.com',message:'ข้อความทดสอบ'};
const send=async(body=valid,extra={})=>{const res=response();await handler({method:'POST',headers:{'content-type':'application/json'},body,...extra},res);return res;};
assert.equal((await send()).code,200);assert.equal(rows.size,1);assert.equal(emailCalls,1);
assert.equal((await send({...valid,message:'Should not overwrite'})).code,409);assert.equal(emailCalls,1);assert.equal(rows.get(id).message,valid.message);
for (const body of [{...valid,customer_name:''},{...valid,contact:'bad'},{...valid,contact:'--------'},{...valid,message:'x'.repeat(5001)},{...valid,submission_id:'bad'},[]])assert.equal((await send(body)).code,400);
assert.equal((await send(valid,{headers:{'content-type':'application/json',origin:'https://evil.example'}})).code,403);
assert.equal((await send(valid,{headers:{'content-type':'text/plain'}})).code,415);
allowRate=false;assert.equal((await send()).code,429);allowRate=true;
assert.equal((await send({...valid,website:'spam'})).code,200);assert.equal(rows.size,1);
failDb=true;assert.equal((await send()).code,503);failDb=false;
failEmail=true;const failedId='b1234567-1234-4123-8123-123456789012';assert.equal((await send({...valid,submission_id:failedId})).code,200);assert.equal(rows.get(failedId).email_status,'failed');
failEmail=false;await retryContactEmails();assert.equal(rows.get(failedId).email_status,'sent');
assert.equal((await send(valid,{method:'GET'})).code,405);
console.log('PASS: private contact schema/leases/limits, input/origin validation, durable persistence, deduplication and email recovery');
