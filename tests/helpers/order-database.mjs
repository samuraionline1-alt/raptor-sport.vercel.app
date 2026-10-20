import assert from 'node:assert/strict';
process.env.SUPABASE_URL = 'https://orders.example.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_mock';
export const events = new Map(), orders = new Map(), requests = [], rateLimits = new Map();
export const response = () => ({setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}});
export const fixture = extra => ({order_ref:'RPT-test',sku:'raptor-cooling-spray',product:'RAPTOR SPORTS ICE COLD SPRAY',quantity:2,bundleTier:'tier_2',subtotal:329,total_price:329,
 customer_name:'Test buyer',phone:'0812345678',address:'Bangkok',payment_method:'COD',receipt_token:'a'.repeat(64),...extra});
function equal(a,b) { return JSON.stringify(a) === JSON.stringify(b); }
export async function withOrderDatabase(run) {
  const downstream = global.fetch;
  global.fetch = async (url, options = {}) => {
    if (!String(url).startsWith(process.env.SUPABASE_URL)) return downstream(url, options);
    assert.equal(options.headers.apikey,'sb_secret_mock');assert.equal(options.headers.Authorization,undefined);
    requests.push({url,...options});
    const body = options.body ? JSON.parse(options.body) : null;
    const path = new URL(url).pathname.split('/rest/v1/')[1];
    const query = new URL(url).searchParams;
    const ok = data => ({ok:true,status:200,json:async()=>structuredClone(data)});
    if(path === 'rpc/raptor_rate_limit') { const hits=(rateLimits.get(body.p_key)||0)+1;rateLimits.set(body.p_key,hits);return ok(hits<=body.p_limit); }
    if(path === 'rpc/raptor_record_order') {
      const order=body.p_order, existing=orders.get(order.order_ref);
      if(existing) {
        for(const key of ['customer_name','phone','address','product','quantity','total_price','payment_method','order_channel','items','receipt_token_hash','note','email']) {
          if(!equal(existing.payload[key],order[key])) return {ok:false,status:409};
        }
        if(order.event_type==='payment_succeeded') {existing.payment_status='paid';existing.payload={...existing.payload,...order};}
      } else orders.set(order.order_ref,{created_at:new Date().toISOString(),payment_status:order.payment_method==='COD'?'cod':order.event_type==='payment_succeeded'?'paid':'pending',payload:structuredClone(order)});
      const key=order.order_ref+':'+order.event_type;
      if((order.event_type !== 'checkout_initiated' || order.stripe_session_id) && !events.has(key))events.set(key,{order_ref:order.order_ref,event_type:order.event_type,status:'pending',attempts:0,email_status:'pending',email_attempts:0,next_attempt_at:new Date(0).toISOString(),email_next_attempt_at:new Date(0).toISOString(),payload:structuredClone(order),created_at:orders.get(order.order_ref).created_at});
      return ok(null);
    }
    if(path === 'rpc/raptor_attach_checkout') {
      const existing=orders.get(body.p_ref);assert.ok(existing);
      if(existing.payload.stripe_session_id && existing.payload.stripe_session_id !== body.p_session_id) return {ok:false,status:409};
      existing.payload.stripe_session_id=body.p_session_id;return ok(null);
    }
    if(path === 'rpc/raptor_claim_notification') {
      const row=events.get(body.p_ref+':'+body.p_type),prefix=body.p_channel==='email'?'email_':'';
      if(!row) return ok([]);
      const status=row[prefix+'status'];
      if(!(['pending','failed'].includes(status)&&Date.parse(row[prefix+'next_attempt_at'])<=Date.now())&&!(status==='sending'&&Date.parse(row[prefix+'lease_until'])<Date.now()))return ok([]);
      if(row[prefix+'attempts']>=8 || (row[prefix+'first_attempt_at']&&Date.parse(row[prefix+'first_attempt_at'])<Date.now()-23*3600000)) {row[prefix+'status']='manual_review';return ok([]);}
      row[prefix+'status']='sending';row[prefix+'attempts']++;row[prefix+'first_attempt_at'] ||= new Date().toISOString();row[prefix+'lease_until']=new Date(Date.now()+90000).toISOString();return ok([row]);
    }
    if(path==='raptor_orders') {const row=orders.get(query.get('order_ref')?.slice(3));return ok(row?[row]:[]);}
    if(path==='product_reviews')return ok(null);
    if(path==='raptor_rate_limits')return ok(null);
    assert.equal(path,'raptor_line_events');
    const key=query.get('order_ref')?.slice(3)+':'+query.get('event_type')?.slice(3);
    const row=events.get(key);
    if(options.method==='PATCH') {assert.ok(row);Object.assign(row,body);return ok(null);}
    if(row)return ok([row]);
    const filter=query.get('or')||'';const prefix=filter.includes('email_status')?'email_':'';
    let rows=[...events.values()].filter(e=>{
      if(filter.includes('manual_review'))return e.status==='manual_review'||e.email_status==='manual_review';
      const cutoff=query.get('created_at');if(cutoff&&Date.parse(e.created_at)<Date.parse(cutoff.slice(4)))return false;
      return ['pending','failed'].includes(e[prefix+'status'])&&Date.parse(e[prefix+'next_attempt_at'])<=Date.now()||e[prefix+'status']==='sending'&&Date.parse(e[prefix+'lease_until'])<Date.now();
    });
    rows=rows.sort((a,b)=>Date.parse(a[prefix+'next_attempt_at'])-Date.parse(b[prefix+'next_attempt_at'])).slice(0,Number(query.get('limit')||100));
    return ok(rows);
  };
  try { return await run(); } finally {global.fetch=downstream;}
}
