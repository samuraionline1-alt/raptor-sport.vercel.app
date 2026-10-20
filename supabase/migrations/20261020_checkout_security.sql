begin;
create table public.raptor_order_items (
 order_ref text not null references public.raptor_orders(order_ref), sku text not null, name text not null,
 quantity integer not null check(quantity > 0), unit_price_cents bigint not null check(unit_price_cents > 0),
 line_total_cents bigint not null check(line_total_cents > 0), primary key(order_ref,sku)
);
alter table public.raptor_order_items enable row level security;
revoke all on public.raptor_order_items from public,anon,authenticated;
grant all on public.raptor_order_items to service_role;
-- Historical orders remain intact; no attempt to infer missing SKUs.
alter table public.raptor_line_events drop constraint raptor_line_events_status_check;
alter table public.raptor_line_events add constraint raptor_line_events_status_check
 check(status in ('pending','sending','sent','failed','skipped','manual_review'));
alter table public.raptor_line_events
 add column next_attempt_at timestamptz not null default now(),
 add column first_attempt_at timestamptz,
 add column email_status text not null default 'pending' check(email_status in ('pending','sending','sent','failed','skipped','manual_review')),
 add column email_attempts integer not null default 0,
 add column email_next_attempt_at timestamptz not null default now(),
 add column email_first_attempt_at timestamptz,
 add column email_lease_until timestamptz,
 add column email_sent_at timestamptz,
 add column email_last_error text;
update public.raptor_line_events set email_status='sent',email_sent_at=(payload->'email_delivery'->>'sent_at')::timestamptz
 where payload->'email_delivery'->>'sent_at' is not null;
update public.raptor_line_events set first_attempt_at=created_at where attempts>0;
update public.raptor_line_events set email_first_attempt_at=created_at where payload ? 'email_delivery';
-- Ambiguous old deliveries must be reviewed, not blindly re-sent beyond provider deduplication windows.
update public.raptor_line_events set status='manual_review' where status <> 'sent' and created_at < now()-interval '23 hours';
update public.raptor_line_events set email_status='manual_review' where email_status <> 'sent' and created_at < now()-interval '23 hours';
create index raptor_email_retry on public.raptor_line_events(email_status,email_next_attempt_at);
create or replace function public.raptor_record_order(p_order jsonb)
returns void language plpgsql security invoker set search_path = public as $$
declare
  existing public.raptor_orders;
  new_status text := case when p_order->>'event_type' = 'payment_succeeded' then 'paid'
    when p_order->>'payment_method' = 'COD' then 'cod' else 'pending' end;
begin
  insert into public.raptor_orders (order_ref, customer_name, phone, address, product, quantity,
    total_price, payment_method, payment_status, order_channel, payload)
  values (p_order->>'order_ref', p_order->>'customer_name', p_order->>'phone', p_order->>'address',
    p_order->>'product', (p_order->>'quantity')::integer, (p_order->>'total_price')::numeric,
    p_order->>'payment_method', new_status, coalesce(p_order->>'order_channel', 'retail'), p_order)
  on conflict (order_ref) do nothing;
  select * into existing from public.raptor_orders where order_ref = p_order->>'order_ref' for update;
  if existing.phone <> p_order->>'phone' or existing.customer_name <> p_order->>'customer_name'
    or existing.address <> p_order->>'address' or existing.product <> p_order->>'product'
    or existing.quantity <> (p_order->>'quantity')::integer
    or existing.total_price <> (p_order->>'total_price')::numeric
    or existing.payment_method <> p_order->>'payment_method'
    or existing.order_channel <> coalesce(p_order->>'order_channel', 'retail')
    or (existing.payload->'items') is distinct from (p_order->'items')
    or (existing.payload->>'receipt_token_hash') is distinct from (p_order->>'receipt_token_hash')
    or coalesce(existing.payload->>'note','') <> coalesce(p_order->>'note','')
    or coalesce(existing.payload->>'email','') <> coalesce(p_order->>'email','') then
    raise exception 'Order reference conflict' using errcode = '23505';
  end if;
  if p_order ? 'items' then
    insert into public.raptor_order_items(order_ref,sku,name,quantity,unit_price_cents,line_total_cents)
      select existing.order_ref, item->>'sku', item->>'name', (item->>'quantity')::integer,
        (item->>'unit_price_cents')::bigint, (item->>'line_total_cents')::bigint
      from jsonb_array_elements(p_order->'items') item
      on conflict(order_ref,sku) do nothing;
  end if;
  if new_status = 'paid' then
    update public.raptor_orders set payment_status = 'paid', payload = p_order, updated_at = now()
      where order_ref = existing.order_ref;
  end if;
  -- A failed Checkout creation is not a customer waiting to scan a QR code.
  if p_order->>'event_type' <> 'checkout_initiated' or p_order->>'stripe_session_id' is not null then
    insert into public.raptor_line_events (order_ref, event_type, payload)
      values (p_order->>'order_ref', p_order->>'event_type', p_order)
      on conflict (order_ref, event_type) do nothing;
  end if;
end;
$$;

create function public.raptor_attach_checkout(p_ref text,p_session_id text) returns void
language plpgsql security invoker set search_path=public as $$
declare existing public.raptor_orders;
begin
 select * into existing from public.raptor_orders where order_ref=p_ref for update;
 if not found or existing.payment_method <> 'STRIPE' or p_session_id !~ '^cs_(test_|live_)?[A-Za-z0-9]+$' then
   raise exception 'Invalid order/session';
 end if;
 if existing.payload->>'stripe_session_id' is not null and existing.payload->>'stripe_session_id' <> p_session_id then
   raise exception 'Order reference conflict' using errcode='23505';
 end if;
 update public.raptor_orders set payload=payload || jsonb_build_object('stripe_session_id',p_session_id),updated_at=now() where order_ref=p_ref;
end; $$;

create function public.raptor_claim_notification(p_ref text,p_type text,p_channel text)
returns setof public.raptor_line_events language plpgsql security invoker set search_path=public as $$
declare item public.raptor_line_events;
begin
 select * into item from public.raptor_line_events where order_ref=p_ref and event_type=p_type for update skip locked;
 if not found then return; end if;
 if p_channel='line' then
   if not ((item.status in ('pending','failed') and item.next_attempt_at<=now()) or (item.status='sending' and item.lease_until<now())) then return; end if;
   if item.attempts>=8 or coalesce(item.first_attempt_at,now())<now()-interval '23 hours' then
     update public.raptor_line_events set status='manual_review',lease_until=null where order_ref=p_ref and event_type=p_type;
     return;
   end if;
   return query update public.raptor_line_events set status='sending',lease_until=now()+interval '90 seconds',
     attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,now()) where order_ref=p_ref and event_type=p_type returning *;
 elsif p_channel='email' then
   if not ((item.email_status in ('pending','failed') and item.email_next_attempt_at<=now()) or (item.email_status='sending' and item.email_lease_until<now())) then return; end if;
   if item.email_attempts>=8 or coalesce(item.email_first_attempt_at,now())<now()-interval '23 hours' then
     update public.raptor_line_events set email_status='manual_review',email_lease_until=null where order_ref=p_ref and event_type=p_type;
     return;
   end if;
   return query update public.raptor_line_events set email_status='sending',email_lease_until=now()+interval '90 seconds',
     email_attempts=email_attempts+1,email_first_attempt_at=coalesce(email_first_attempt_at,now()) where order_ref=p_ref and event_type=p_type returning *;
 else raise exception 'Invalid notification channel';
 end if;
end; $$;

create table public.raptor_rate_limits(key text primary key,window_start timestamptz not null,hits integer not null);
alter table public.raptor_rate_limits enable row level security;
revoke all on public.raptor_rate_limits from public,anon,authenticated;
grant all on public.raptor_rate_limits to service_role;
create function public.raptor_rate_limit(p_key text,p_limit integer,p_window_seconds integer) returns boolean
language plpgsql security invoker set search_path=public as $$
declare count integer;
begin
 if p_limit<1 or p_window_seconds<1 or p_window_seconds>3600 then raise exception 'Invalid limit'; end if;
 insert into public.raptor_rate_limits as limits(key,window_start,hits) values(p_key,now(),1)
 on conflict(key) do update set
  hits=case when limits.window_start < now()-make_interval(secs=>p_window_seconds) then 1 else limits.hits+1 end,
  window_start=case when limits.window_start < now()-make_interval(secs=>p_window_seconds) then now() else limits.window_start end
 returning hits into count;
 return count<=p_limit;
end; $$;
revoke all on function public.raptor_attach_checkout(text,text), public.raptor_claim_notification(text,text,text), public.raptor_rate_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.raptor_attach_checkout(text,text), public.raptor_claim_notification(text,text,text), public.raptor_rate_limit(text,integer,integer) to service_role;
commit;
