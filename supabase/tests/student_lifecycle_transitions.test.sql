begin;
select plan(26);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_user_meta_data)
values
  ('12000000-0000-4000-8000-000000000001','authenticated','authenticated','lifecycle-admin@example.invalid','',now(),'{"full_name":"Lifecycle Admin"}'),
  ('12000000-0000-4000-8000-000000000002','authenticated','authenticated','lifecycle-teacher@example.invalid','',now(),'{"full_name":"Lifecycle Teacher"}'),
  ('12000000-0000-4000-8000-000000000003','authenticated','authenticated','lifecycle-foreign-admin@example.invalid','',now(),'{"full_name":"Foreign Admin"}');
insert into public.schools(id,name,code) values
  ('22000000-0000-4000-8000-000000000001','Lifecycle Test School','LTS'),
  ('22000000-0000-4000-8000-000000000002','Lifecycle Other School','LOS');
insert into public.classes(id,school_id,class_name,stream_name) values
  ('32000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001','Lifecycle Class','A'),
  ('32000000-0000-4000-8000-000000000002','22000000-0000-4000-8000-000000000002','Foreign Lifecycle Class','A');
insert into public.memberships(id,school_id,user_id,role,active) values
  ('62000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001','admin',true),
  ('62000000-0000-4000-8000-000000000002','22000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000002','teacher',true),
  ('62000000-0000-4000-8000-000000000003','22000000-0000-4000-8000-000000000002','12000000-0000-4000-8000-000000000003','admin',true);
insert into public.students(id,school_id,admission_number,full_name,gender,class_id) values
  ('82000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001','LTS-1','Lifecycle Student','Female','32000000-0000-4000-8000-000000000001'),
  ('82000000-0000-4000-8000-000000000002','22000000-0000-4000-8000-000000000001','LTS-2','Audit Failure Student','Male','32000000-0000-4000-8000-000000000001'),
  ('82000000-0000-4000-8000-000000000003','22000000-0000-4000-8000-000000000001','LTS-3','Update Failure Student','Female','32000000-0000-4000-8000-000000000001'),
  ('82000000-0000-4000-8000-000000000004','22000000-0000-4000-8000-000000000002','LOS-1','Foreign Student','Male','32000000-0000-4000-8000-000000000002');

select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','12000000-0000-4000-8000-000000000001',true);
set local role authenticated;

select is(public.archive_student('82000000-0000-4000-8000-000000000001'),true,'authorized archive succeeds');
select is((select archived from public.students where id='82000000-0000-4000-8000-000000000001'),true,'archive state is committed with the operation');
select is((select count(*)::integer from public.student_lifecycle_events where student_id='82000000-0000-4000-8000-000000000001'),1,'archive creates exactly one audit event');
select is((select actor_id from public.student_lifecycle_events where student_id='82000000-0000-4000-8000-000000000001' and event='archived'),'12000000-0000-4000-8000-000000000001'::uuid,'audit event records the authenticated actor');
select is(public.archive_student('82000000-0000-4000-8000-000000000001'),false,'repeated archive is a deterministic no-op');
select is((select count(*)::integer from public.student_lifecycle_events where student_id='82000000-0000-4000-8000-000000000001'),1,'repeated archive creates no duplicate audit event');
select is(public.reactivate_student('82000000-0000-4000-8000-000000000001'),true,'authorized reactivation succeeds');
select is((select archived from public.students where id='82000000-0000-4000-8000-000000000001'),false,'reactivation clears archival state');
select is((select archived_by from public.students where id='82000000-0000-4000-8000-000000000001'),null::uuid,'reactivation clears archived_by');
select is((select count(*)::integer from public.student_lifecycle_events where student_id='82000000-0000-4000-8000-000000000001'),2,'reactivation creates one corresponding audit event');
select is(public.reactivate_student('82000000-0000-4000-8000-000000000001'),false,'repeated reactivation is a deterministic no-op');
select is((select count(*)::integer from public.student_lifecycle_events where student_id='82000000-0000-4000-8000-000000000001'),2,'repeated reactivation creates no duplicate audit event');

-- A caller-set custom GUC is not authority, and direct SQL privileges exclude
-- all lifecycle metadata fields.
select set_config('iupc.student_lifecycle_transition','archive',true);
select throws_ok($$update public.students set archived_at=now() where id='82000000-0000-4000-8000-000000000001'$$,'42501',null,'custom setting cannot authorize a direct archived_at change');
select throws_ok($$update public.students set archived_by='12000000-0000-4000-8000-000000000001' where id='82000000-0000-4000-8000-000000000001'$$,'42501',null,'custom setting cannot authorize a direct archived_by change');
select throws_ok($$update public.students set archived=true,archived_at=now(),archived_by='12000000-0000-4000-8000-000000000001' where id='82000000-0000-4000-8000-000000000001'$$,'42501',null,'custom setting cannot authorize a direct archive');
select ok(not has_column_privilege('authenticated','public.students','archived_at','update'),'authenticated users cannot directly update archived_at');
select ok(not has_column_privilege('authenticated','public.students','archived_by','update'),'authenticated users cannot directly update archived_by');
select ok(position('for update' in lower(pg_get_functiondef('public.archive_student(uuid)'::regprocedure)))>0 and position('for update' in lower(pg_get_functiondef('public.reactivate_student(uuid)'::regprocedure)))>0,'both lifecycle RPCs lock the student row');

select set_config('request.jwt.claim.sub','12000000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.archive_student('82000000-0000-4000-8000-000000000001')$$,'42501',null,'teacher without administrator role cannot archive');
select set_config('request.jwt.claim.sub','12000000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.archive_student('82000000-0000-4000-8000-000000000001')$$,'42501',null,'administrator of another school cannot archive this student');

-- Simulate failure after the state update: the function transaction must roll
-- back both the lifecycle field change and any partial audit write.
reset role;
create function public.test_fail_lifecycle_audit_insert()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.student_id='82000000-0000-4000-8000-000000000002' then
    raise exception 'injected lifecycle audit failure' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger test_fail_lifecycle_audit_insert_before
  before insert on public.student_lifecycle_events
  for each row execute function public.test_fail_lifecycle_audit_insert();
select set_config('request.jwt.claim.sub','12000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select throws_ok($$select public.archive_student('82000000-0000-4000-8000-000000000002')$$,'23514',null,'audit insertion failure aborts archive');
select is((select archived from public.students where id='82000000-0000-4000-8000-000000000002'),false,'audit insertion failure rolls back lifecycle fields');
select is((select count(*)::integer from public.student_lifecycle_events where student_id='82000000-0000-4000-8000-000000000002'),0,'audit insertion failure leaves no lifecycle event');
reset role;
drop trigger test_fail_lifecycle_audit_insert_before on public.student_lifecycle_events;
drop function public.test_fail_lifecycle_audit_insert();

create function public.test_fail_lifecycle_student_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id='82000000-0000-4000-8000-000000000003' then
    raise exception 'injected lifecycle update failure' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger test_fail_lifecycle_student_update_before
  before update on public.students
  for each row execute function public.test_fail_lifecycle_student_update();
set local role authenticated;
select throws_ok($$select public.archive_student('82000000-0000-4000-8000-000000000003')$$,'23514',null,'lifecycle state update failure aborts archive');
select is((select archived from public.students where id='82000000-0000-4000-8000-000000000003'),false,'state update failure leaves student unarchived');
select is((select count(*)::integer from public.student_lifecycle_events where student_id='82000000-0000-4000-8000-000000000003'),0,'state update failure creates no audit event');
reset role;
drop trigger test_fail_lifecycle_student_update_before on public.students;
drop function public.test_fail_lifecycle_student_update();

select * from finish();
rollback;
