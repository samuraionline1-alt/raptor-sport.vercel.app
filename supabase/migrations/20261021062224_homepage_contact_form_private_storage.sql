begin;
create table public.raptor_contact_messages (
 id uuid primary key,
 created_at timestamptz not null default now(),
 customer_name text not null check(char_length(customer_name) between 1 and 200),
 contact text not null check(char_length(contact) between 1 and 254),
 message text not null check(char_length(message) between 1 and 5000),
 request_fingerprint text not null check(request_fingerprint ~ '^[a-f0-9]{64}$'),
 email_status text not null default 'pending' check(email_status in ('pending','sent','failed')),
 email_sent_at timestamptz
);
create index raptor_contact_fingerprint_created on public.raptor_contact_messages(request_fingerprint,created_at);
alter table public.raptor_contact_messages enable row level security;
revoke all on public.raptor_contact_messages from public,anon,authenticated;
grant select,insert,update on public.raptor_contact_messages to service_role;
create function public.raptor_submit_contact(p_message jsonb) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare prior public.raptor_contact_messages; new_id uuid := (p_message->>'id')::uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('raptor-contact:' || (p_message->>'request_fingerprint'),0));
 select * into prior from public.raptor_contact_messages where id=new_id;
 if found then
  if prior.customer_name is distinct from p_message->>'customer_name'
   or prior.contact is distinct from p_message->>'contact'
   or prior.message is distinct from p_message->>'message'
   or prior.request_fingerprint is distinct from p_message->>'request_fingerprint' then
   raise exception 'contact_reference_conflict' using errcode='23505';
  end if;
  return jsonb_build_object('created',false,'email_status',prior.email_status);
 end if;
 if (select count(*) from public.raptor_contact_messages where request_fingerprint=p_message->>'request_fingerprint' and created_at>now()-interval '15 minutes') >= 5 then
  raise exception 'contact_rate_limit' using errcode='P0001';
 end if;
 insert into public.raptor_contact_messages(id,customer_name,contact,message,request_fingerprint)
 values(new_id,p_message->>'customer_name',p_message->>'contact',p_message->>'message',p_message->>'request_fingerprint');
 return jsonb_build_object('created',true,'email_status','pending');
end;
$$;
revoke all on function public.raptor_submit_contact(jsonb) from public,anon,authenticated;
grant execute on function public.raptor_submit_contact(jsonb) to service_role;
commit;
