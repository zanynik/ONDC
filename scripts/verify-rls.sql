-- Run against the dedicated ZeroProfit development project as an administrator.
-- All fixture rows and writes are rolled back; no email is sent.
begin;
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000000001','zp-test-a@example.invalid'),
 ('00000000-0000-4000-8000-000000000002','zp-test-b@example.invalid');
insert into public.orders(id,user_id,total_amount) values
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',100),
 ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002',200);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$ begin
 if (select count(*) from public.orders)<>1 or (select total_amount from public.orders)<>100 then raise exception 'Order isolation failed';end if;
 begin
  insert into public.orders(user_id,total_amount) values('00000000-0000-4000-8000-000000000001',1);
  raise exception 'Customer created a privileged order';
 exception when insufficient_privilege then null;end;
 begin
  perform public.zp_store_callback('/buyer/on_init','{}');
  raise exception 'Customer called privileged RPC';
 exception when insufficient_privilege then null;end;
 begin
  insert into public.support_tickets(user_id,order_id,subject,description) values('00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','test','test');
  raise exception 'Customer linked another customer order';
 exception when insufficient_privilege then null;end;
 insert into public.support_tickets(user_id,order_id,subject,description) values('00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','test','test');
 if (select count(*) from public.support_tickets)<>1 then raise exception 'Own ticket missing';end if;
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$ begin
 if (select count(*) from public.support_tickets)<>0 then raise exception 'Another customer ticket leaked';end if;
end $$;
reset role;
select 'PASS: customer isolation and backend privileges' as verification;
rollback;
