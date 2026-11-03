begin;
select plan(17);

-- Fixtures live inside this transaction; the final rollback leaves the local
-- database's school data unchanged.
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_user_meta_data)
values
  ('13000000-0000-4000-8000-000000000001','authenticated','authenticated','class-admin@example.invalid','',now(),'{"full_name":"Class Admin"}'),
  ('13000000-0000-4000-8000-000000000002','authenticated','authenticated','class-teacher@example.invalid','',now(),'{"full_name":"Class Teacher"}'),
  ('13000000-0000-4000-8000-000000000003','authenticated','authenticated','class-foreign-admin@example.invalid','',now(),'{"full_name":"Foreign Class Admin"}');

insert into public.schools(id,name,code) values
  ('23000000-0000-4000-8000-000000000001','Class Assignment School','CAS'),
  ('23000000-0000-4000-8000-000000000002','Class Assignment Other','CAO');
insert into public.classes(id,school_id,class_name,stream_name) values
  ('33000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000001','Form 1','A'),
  ('33000000-0000-4000-8000-000000000002','23000000-0000-4000-8000-000000000001','Form 2','B'),
  ('33000000-0000-4000-8000-000000000003','23000000-0000-4000-8000-000000000002','Foreign Form','A');
insert into public.subjects(id,school_id,name,code,category,level,offered) values
  ('43000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000001','Class Test Subject','CAS-SUB','Test','Custom',true);
insert into public.memberships(id,school_id,user_id,role,active) values
  ('63000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000001','admin',true),
  ('63000000-0000-4000-8000-000000000002','23000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000002','teacher',true),
  ('63000000-0000-4000-8000-000000000003','23000000-0000-4000-8000-000000000002','13000000-0000-4000-8000-000000000003','admin',true);

select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000001',true);
set local role authenticated;

-- ── creation ────────────────────────────────────────────────────────────────
select public.save_teacher(
  null,
  '23000000-0000-4000-8000-000000000001',
  '{"full_name":"Fictional Class Teacher","email":"fictional.class@example.invalid","employee_id":"CAS-T1"}'::jsonb,
  array['43000000-0000-4000-8000-000000000001']::uuid[],
  array['33000000-0000-4000-8000-000000000001']::uuid[],
  array['marks.enter']::text[]
) as teacher \gset

select is((select count(*)::integer from public.teacher_classes where teacher_id=:'teacher'),1,'creating a teacher records the assigned class');
select is((select count(*)::integer from public.teacher_subjects where teacher_id=:'teacher'),1,'creating a teacher records the subject load');
select is((select count(*)::integer from public.teacher_permissions where teacher_id=:'teacher' and permission='marks.enter'),1,'creating a teacher records the permission');

-- ── preservation: the reported bug ──────────────────────────────────────────
-- Editing a name must not touch classes, subjects or permissions. NULL means
-- "this caller does not manage the relation".
select public.save_teacher(
  :'teacher',
  '23000000-0000-4000-8000-000000000001',
  '{"full_name":"Fictional Class Teacher Renamed","email":"fictional.class@example.invalid","employee_id":"CAS-T1"}'::jsonb,
  null, null, null
) as renamed \gset

select is((select full_name from public.teachers where id=:'teacher'),'Fictional Class Teacher Renamed','an unrelated detail change is applied');
select is((select count(*)::integer from public.teacher_classes where teacher_id=:'teacher'),1,'editing other details preserves class assignments');
select is((select count(*)::integer from public.teacher_subjects where teacher_id=:'teacher'),1,'editing other details preserves the subject load');
select is((select count(*)::integer from public.teacher_permissions where teacher_id=:'teacher' and permission='marks.enter'),1,'editing other details preserves permissions');

-- ── deliberate clearing ─────────────────────────────────────────────────────
select public.save_teacher(
  :'teacher',
  '23000000-0000-4000-8000-000000000001',
  '{"full_name":"Fictional Class Teacher Renamed","email":"fictional.class@example.invalid","employee_id":"CAS-T1"}'::jsonb,
  null, '{}'::uuid[], null
) as cleared \gset

select is((select count(*)::integer from public.teacher_classes where teacher_id=:'teacher'),0,'an explicit empty set clears class assignments');
select is((select count(*)::integer from public.teacher_subjects where teacher_id=:'teacher'),1,'clearing classes leaves the subject load alone');

-- ── replacement ─────────────────────────────────────────────────────────────
select public.save_teacher(
  :'teacher',
  '23000000-0000-4000-8000-000000000001',
  '{"full_name":"Fictional Class Teacher Renamed","email":"fictional.class@example.invalid","employee_id":"CAS-T1"}'::jsonb,
  null,
  array['33000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000002']::uuid[],
  null
) as reassigned \gset

select is((select count(*)::integer from public.teacher_classes where teacher_id=:'teacher'),2,'replacement stores both assigned classes');

select public.save_teacher(
  :'teacher',
  '23000000-0000-4000-8000-000000000001',
  '{"full_name":"Fictional Class Teacher Renamed","email":"fictional.class@example.invalid","employee_id":"CAS-T1"}'::jsonb,
  null,
  array['33000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000001']::uuid[],
  null
) as deduped \gset

select is((select count(*)::integer from public.teacher_classes where teacher_id=:'teacher'),1,'a repeated class id is stored once');

-- ── cross-school denial ─────────────────────────────────────────────────────
select throws_ok(
  format(
    $$select public.save_teacher(%L,%L,%L::jsonb,null,array[%L]::uuid[],null)$$,
    :'teacher',
    '23000000-0000-4000-8000-000000000001',
    '{"full_name":"Fictional Class Teacher Renamed","email":"fictional.class@example.invalid","employee_id":"CAS-T1"}',
    '33000000-0000-4000-8000-000000000003'
  ),
  '23503', null, 'a class from another school is refused'
);
select is((select count(*)::integer from public.teacher_classes where teacher_id=:'teacher'),1,'a refused assignment leaves the stored set unchanged');

-- ── the teacher this assignment is for ──────────────────────────────────────
update public.memberships set teacher_id=:'teacher'
  where user_id='13000000-0000-4000-8000-000000000002' and school_id='23000000-0000-4000-8000-000000000001';

select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000002',true);
select is(
  public.is_assigned_teacher(
    '23000000-0000-4000-8000-000000000001',
    '43000000-0000-4000-8000-000000000001',
    '33000000-0000-4000-8000-000000000001'
  ),
  true,
  'the assigned class grants the teacher class scope'
);
select throws_ok(
  format(
    $$select public.save_teacher(%L,%L,%L::jsonb,null,null,null)$$,
    :'teacher',
    '23000000-0000-4000-8000-000000000001',
    '{"full_name":"Fictional Teacher Attempt","email":"fictional.attempt@example.invalid","employee_id":"CAS-T9"}'
  ),
  '42501', null, 'a teacher cannot assign classes'
);

select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000003',true);
select throws_ok(
  format(
    $$select public.save_teacher(%L,%L,%L::jsonb,null,array[]::uuid[],null)$$,
    :'teacher',
    '23000000-0000-4000-8000-000000000001',
    '{"full_name":"Fictional Class Teacher Renamed","email":"fictional.class@example.invalid","employee_id":"CAS-T1"}'
  ),
  '42501', null, 'an administrator of another school cannot edit this teacher'
);

select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000001',true);
select is((select count(*)::integer from public.teacher_classes where teacher_id=:'teacher'),1,'cross-school attempts leave the assignment intact');

select * from finish();
rollback;
