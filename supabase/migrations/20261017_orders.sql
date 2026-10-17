begin;

create table public.raptor_orders (
  order_ref text primary key,
  customer_name text not null,
  phone text not null,
  address text not null,
  product text not null,
  quantity integer not null check (quantity > 0),
  total_price numeric(12,2) not null check (total_price > 0),
  payment_method text not null check (payment_method in ('COD', 'STRIPE')),
  payment_status text not null check (payment_status in ('cod', 'pending', 'paid')),
  order_channel text not null default 'retail',
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.raptor_line_events (
  order_ref text not null references public.raptor_orders(order_ref),
  event_type text not null check (event_type in ('order_created', 'checkout_initiated', 'payment_succeeded')),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts integer not null default 0,
  last_error text,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  primary key (order_ref, event_type)
);
create index raptor_line_events_retry on public.raptor_line_events(status, created_at);
alter table public.raptor_orders enable row level security;
alter table public.raptor_line_events enable row level security;
revoke all on public.raptor_orders, public.raptor_line_events from anon, authenticated;
grant all on public.raptor_orders, public.raptor_line_events to service_role;

-- The order and its notification queue entry commit together. Only the server
-- can call this function; browser keys cannot read or write customer data.
create function public.raptor_record_order(p_order jsonb)
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
    or existing.payment_method <> p_order->>'payment_method' then
    raise exception 'Order reference conflict' using errcode = '23505';
  end if;
  if new_status = 'paid' then
    update public.raptor_orders set payment_status = 'paid', payload = p_order, updated_at = now()
      where order_ref = existing.order_ref;
  end if;
  insert into public.raptor_line_events (order_ref, event_type, payload)
    values (p_order->>'order_ref', p_order->>'event_type', p_order)
    on conflict (order_ref, event_type) do nothing;
end;
$$;
revoke all on function public.raptor_record_order(jsonb) from public, anon, authenticated;
grant execute on function public.raptor_record_order(jsonb) to service_role;
commit;
