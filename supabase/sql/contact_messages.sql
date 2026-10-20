-- Applied remotely as raptor_contact_messages; CLI unavailable in this workspace.
create table public.raptor_contact_messages (
 id uuid primary key,
 created_at timestamptz not null default now(),
 customer_name text not null check (char_length(customer_name) between 1 and 200),
 contact text not null check (char_length(contact) between 1 and 254),
 message text not null check (char_length(message) between 1 and 5000),
 email_status text not null default 'pending' check(email_status in ('pending','sending','sent','failed','manual_review')),
 email_attempts integer not null default 0,
 email_next_attempt_at timestamptz not null default now(),
 email_lease_until timestamptz,
 email_sent_at timestamptz
);
alter table public.raptor_contact_messages enable row level security;
revoke all on public.raptor_contact_messages from public, anon, authenticated;
grant select, insert, update, delete on public.raptor_contact_messages to service_role;
create index raptor_contact_messages_email_due_idx on public.raptor_contact_messages(email_next_attempt_at) where email_status in ('pending','failed','sending');
create function public.raptor_claim_contact_email(p_id uuid)
returns setof public.raptor_contact_messages
language plpgsql security invoker set search_path = '' as $$
begin
 update public.raptor_contact_messages set email_status='manual_review',email_lease_until=null
 where id=p_id and email_status not in ('sent','manual_review')
 and (email_attempts>=8 or created_at < now()-interval '23 hours')
 and (email_status<>'sending' or email_lease_until<now());
 return query update public.raptor_contact_messages
 set email_status='sending',email_attempts=email_attempts+1,email_lease_until=now()+interval '90 seconds'
 where id=p_id and email_attempts<8 and created_at>=now()-interval '23 hours'
 and ((email_status in ('pending','failed') and email_next_attempt_at<=now())
 or (email_status='sending' and email_lease_until<now())) returning *;
end $$;
revoke all on function public.raptor_claim_contact_email(uuid) from public, anon, authenticated;
grant execute on function public.raptor_claim_contact_email(uuid) to service_role;
