begin;
-- Preserve existing reviews. Only the private server may moderate or set verification.
create table if not exists public.product_reviews (
 id uuid primary key default gen_random_uuid(),product_slug text not null,reviewer_name text not null,
 rating integer not null check(rating between 1 and 5),comment text not null,source_platform text,
 is_verified boolean not null default false,is_approved boolean not null default false,
 reviewed_at timestamptz default now(),created_at timestamptz not null default now()
);
alter table public.product_reviews add column if not exists verified_order_ref text references public.raptor_orders(order_ref);
-- Old browser submissions could assert verification themselves. Retain their text and approval,
-- but require order evidence before displaying a verified-purchase badge.
update public.product_reviews set is_verified=false where verified_order_ref is null and is_verified=true;
alter table public.product_reviews enable row level security;
revoke all on public.product_reviews from public,anon,authenticated;
grant all on public.product_reviews to service_role;
-- Replace permissive historical policies (including ALL policies).
do $$ declare p record; begin
 for p in select policyname from pg_policies where schemaname='public' and tablename='product_reviews' loop
  execute format('drop policy %I on public.product_reviews',p.policyname);
 end loop;
end $$;
create policy approved_public_reviews on public.product_reviews for select to anon,authenticated using(is_approved=true);
grant select(product_slug,reviewer_name,rating,comment,source_platform,is_verified,is_approved,reviewed_at,created_at)
 on public.product_reviews to anon,authenticated;
commit;
