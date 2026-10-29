create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default '' check (length(display_name) <= 120),
 created_at timestamptz not null default now()
);
create table public.orders (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id),
 transaction_id text unique,
 order_reference text,
 status text not null default 'draft' check (status in ('draft','quoted','confirmed','in_progress','completed','cancelled','failed')),
 currency text not null default 'INR' check (currency = 'INR'),
 total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index orders_user_created on public.orders(user_id,created_at desc);
create table public.order_events (
 id bigint generated always as identity primary key,
 order_id uuid not null references public.orders(id),
 status text not null,
 summary text not null default '',
 created_at timestamptz not null default now()
);
create index order_events_order on public.order_events(order_id,created_at);
create table public.payment_records (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.orders(id),
 provider_reference text unique,
 amount numeric(14,2) not null check (amount >= 0),
 currency text not null default 'INR' check (currency = 'INR'),
 status text not null default 'pending' check (status in ('pending','authorized','paid','failed','refunded','partially_refunded')),
 created_at timestamptz not null default now()
);
create index payment_records_order on public.payment_records(order_id);
create table public.refunds (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.orders(id),
 payment_id uuid not null references public.payment_records(id),
 amount numeric(14,2) not null check (amount > 0),
 status text not null default 'requested' check (status in ('requested','processing','completed','failed')),
 reason text not null default '',
 created_at timestamptz not null default now()
);
create index refunds_order on public.refunds(order_id);
create index refunds_payment on public.refunds(payment_id);
create table public.settlement_records (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.orders(id),
 reference text unique,
 amount numeric(14,2) not null check (amount >= 0),
 status text not null default 'pending' check (status in ('pending','reconciled','settled','disputed')),
 created_at timestamptz not null default now()
);
create index settlement_records_order on public.settlement_records(order_id);
create table public.support_tickets (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id),
 order_id uuid references public.orders(id),
 subject text not null check (length(trim(subject)) between 1 and 160),
 description text not null check (length(trim(description)) between 1 and 10000),
 status text not null default 'open' check (status in ('open','in_progress','resolved','closed')),
 created_at timestamptz not null default now()
);
create index support_tickets_user_created on public.support_tickets(user_id,created_at desc);
create index support_tickets_order on public.support_tickets(order_id);

create table public.ondc_callbacks (
 id bigint generated always as identity primary key,
 action text not null,
 transaction_id text not null,
 message_id text not null,
 received_at bigint not null,
 payload text not null,
 unique(transaction_id,message_id,action)
);
create index ondc_callbacks_latest on public.ondc_callbacks(transaction_id,action,id desc);
create table public.ondc_protocol_logs (
 id bigint generated always as identity primary key,
 direction text not null check (direction in ('INBOUND','OUTBOUND')),
 action text not null,
 transaction_id text,
 message_id text,
 endpoint text not null,
 status_code integer,
 created_at bigint not null,
 payload text not null
);
create index ondc_protocol_logs_transaction on public.ondc_protocol_logs(transaction_id,id);
create table public.ondc_runner_nonces (nonce text primary key, expires bigint not null);
create index ondc_runner_nonces_expiry on public.ondc_runner_nonces(expires);
create table private.backend_credentials (name text primary key, token_hash bytea not null);
alter table private.backend_credentials enable row level security;

-- Every public table defaults to denied. Privileged records have no client grants.
alter table public.profiles enable row level security;
alter table public.orders enable row level security;
alter table public.order_events enable row level security;
alter table public.payment_records enable row level security;
alter table public.refunds enable row level security;
alter table public.settlement_records enable row level security;
alter table public.support_tickets enable row level security;
alter table public.ondc_callbacks enable row level security;
alter table public.ondc_protocol_logs enable row level security;
alter table public.ondc_runner_nonces enable row level security;
revoke all on public.profiles,public.orders,public.order_events,public.payment_records,public.refunds,public.settlement_records,public.support_tickets,public.ondc_callbacks,public.ondc_protocol_logs,public.ondc_runner_nonces from anon,authenticated;
grant all on public.profiles,public.orders,public.order_events,public.payment_records,public.refunds,public.settlement_records,public.support_tickets,public.ondc_callbacks,public.ondc_protocol_logs,public.ondc_runner_nonces to service_role;
grant usage,select on all sequences in schema public to service_role;
grant select on public.profiles,public.orders,public.order_events,public.payment_records,public.refunds,public.support_tickets to authenticated;
grant insert(id,display_name),update(display_name) on public.profiles to authenticated;
grant insert(user_id,order_id,subject,description) on public.support_tickets to authenticated;
create policy profiles_select on public.profiles for select to authenticated using ((select auth.uid())=id);
create policy profiles_insert on public.profiles for insert to authenticated with check ((select auth.uid())=id);
create policy profiles_update on public.profiles for update to authenticated using ((select auth.uid())=id) with check ((select auth.uid())=id);
create policy orders_select on public.orders for select to authenticated using ((select auth.uid())=user_id);
create policy events_select on public.order_events for select to authenticated using (exists(select 1 from public.orders o where o.id=order_id and o.user_id=(select auth.uid())));
create policy payments_select on public.payment_records for select to authenticated using (exists(select 1 from public.orders o where o.id=order_id and o.user_id=(select auth.uid())));
create policy refunds_select on public.refunds for select to authenticated using (exists(select 1 from public.orders o where o.id=order_id and o.user_id=(select auth.uid())));
create policy tickets_select on public.support_tickets for select to authenticated using ((select auth.uid())=user_id);
create policy tickets_insert on public.support_tickets for insert to authenticated with check ((select auth.uid())=user_id and (order_id is null or exists(select 1 from public.orders o where o.id=order_id and o.user_id=(select auth.uid()))));

-- This one definer function can inspect only the private credential hash.
-- It is executable only by the trusted Edge Function service role.
create function public.zp_verify_backend_token(p_token text) returns boolean
language sql security definer set search_path='' as $$
 select length(p_token) between 40 and 128 and exists(
  select 1 from private.backend_credentials where name='protocol-store'
  and token_hash=sha256(convert_to(p_token,'UTF8'))
 );
$$;
revoke all on function public.zp_verify_backend_token(text) from public,anon,authenticated;
grant execute on function public.zp_verify_backend_token(text) to service_role;

-- One transaction durably stores callback+audit. Unique receipt IDs handle retries.
create function public.zp_store_callback(p_endpoint text,p_payload text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare c jsonb; inserted_id bigint; prior_payload text; stamp bigint;
begin
 if octet_length(p_payload)>4194304 then raise exception 'payload_too_large'; end if;
 c:=(p_payload::jsonb)->'context';
 if c is null or coalesce(c->>'action','')='' or coalesce(c->>'transaction_id','')='' or coalesce(c->>'message_id','')='' or p_endpoint<>'/buyer/'||(c->>'action') then raise exception 'invalid_context'; end if;
 stamp:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
 insert into public.ondc_callbacks(action,transaction_id,message_id,received_at,payload)
 values(c->>'action',c->>'transaction_id',c->>'message_id',stamp,p_payload)
 on conflict(transaction_id,message_id,action) do nothing returning id into inserted_id;
 if inserted_id is null then
  select payload into prior_payload from public.ondc_callbacks where transaction_id=c->>'transaction_id' and message_id=c->>'message_id' and action=c->>'action';
  if prior_payload::jsonb <> p_payload::jsonb then raise exception 'message_id_conflict'; end if;
  return false;
 end if;
 insert into public.ondc_protocol_logs(direction,action,transaction_id,message_id,endpoint,status_code,created_at,payload)
 values('INBOUND',c->>'action',c->>'transaction_id',c->>'message_id',p_endpoint,200,stamp,p_payload);
 return true;
end;
$$;
revoke all on function public.zp_store_callback(text,text) from public,anon,authenticated;
grant execute on function public.zp_store_callback(text,text) to service_role;
create function public.zp_consume_nonce(p_nonce text,p_expires bigint) returns boolean
language plpgsql security invoker set search_path='' as $$
declare affected integer;
begin
 if length(p_nonce) not between 1 and 256 or p_expires < extract(epoch from now())*1000 or p_expires > extract(epoch from now())*1000+600000 then raise exception 'invalid_nonce'; end if;
 delete from public.ondc_runner_nonces where expires<extract(epoch from now())*1000;
 insert into public.ondc_runner_nonces(nonce,expires) values(p_nonce,p_expires) on conflict do nothing;
 get diagnostics affected=row_count;
 return affected=1;
end;
$$;
revoke all on function public.zp_consume_nonce(text,bigint) from public,anon,authenticated;
grant execute on function public.zp_consume_nonce(text,bigint) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('support-attachments','support-attachments',false,10485760,array['application/pdf','image/jpeg','image/png']);
create policy support_files_select on storage.objects for select to authenticated using (bucket_id='support-attachments' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy support_files_insert on storage.objects for insert to authenticated with check (bucket_id='support-attachments' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy support_files_delete on storage.objects for delete to authenticated using (bucket_id='support-attachments' and (storage.foldername(name))[1]=(select auth.uid())::text);
