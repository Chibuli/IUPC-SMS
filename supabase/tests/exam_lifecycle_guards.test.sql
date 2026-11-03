begin;
select plan(20);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_user_meta_data)
values
  ('14000000-0000-4000-8000-000000000001','authenticated','authenticated','exam-admin@example.invalid','',now(),'{"full_name":"Exam Admin"}'),
  ('14000000-0000-4000-8000-000000000002','authenticated','authenticated','exam-teacher@example.invalid','',now(),'{"full_name":"Exam Teacher"}'),
  ('14000000-0000-4000-8000-000000000003','authenticated','authenticated','exam-foreign-admin@example.invalid','',now(),'{"full_name":"Foreign Exam Admin"}');

insert into public.schools(id,name,code) values
  ('24000000-0000-4000-8000-000000000001','Exam Guard School','EGS'),
  ('24000000-0000-4000-8000-000000000002','Exam Guard Other','EGO');
insert into public.classes(id,school_id,class_name,stream_name) values
  ('34000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001','Exam Guard Class','A');
insert into public.subjects(id,school_id,name,code,category,level,offered) values
  ('44000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001','Exam Guard Subject','EGS-SUB','Test','Custom',true),
  ('44000000-0000-4000-8000-000000000002','24000000-0000-4000-8000-000000000001','Exam Guard Other Subject','EGS-OTH','Test','Custom',true);
insert into public.teachers(id,school_id,full_name,email,employee_id,initials) values
  ('54000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001','Exam Guard Teacher','exam-teacher@example.invalid','EGS-T1','EG');
insert into public.memberships(id,school_id,user_id,role,teacher_id,active) values
  ('64000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000001','admin',null,true),
  ('64000000-0000-4000-8000-000000000002','24000000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000002','teacher','54000000-0000-4000-8000-000000000001',true),
  ('64000000-0000-4000-8000-000000000003','24000000-0000-4000-8000-000000000002','14000000-0000-4000-8000-000000000003','admin',null,true);
insert into public.teacher_subjects(school_id,teacher_id,subject_id) values
  ('24000000-0000-4000-8000-000000000001','54000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000001');
insert into public.teacher_classes(school_id,teacher_id,class_id) values
  ('24000000-0000-4000-8000-000000000001','54000000-0000-4000-8000-000000000001','34000000-0000-4000-8000-000000000001');
insert into public.teacher_permissions(teacher_id,permission) values
  ('54000000-0000-4000-8000-000000000001','marks.enter');
insert into public.terms(id,school_id,name,academic_year,is_active,start_date) values
  ('74000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001','Exam Guard Term','2099',true,'2099-01-01');
insert into public.students(id,school_id,admission_number,full_name,gender,class_id) values
  ('84000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001','EGS-1','Exam Guard Student','Female','34000000-0000-4000-8000-000000000001');

-- Fixtures are written as the owner connection: auth.uid() is null, which the
-- trigger treats as a trusted provisioning path, exactly like the other guards.
insert into public.exams(id,school_id,term_id,subject_id,class_id,exam_name,exam_type,max_score,exam_date,status) values
  ('94000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000001','34000000-0000-4000-8000-000000000001','Guard Paper','Guard',100,'2099-06-01','open');
-- The mark guards need an authenticated actor and a verified subject
-- enrollment even for an owner-connection fixture insert.
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','14000000-0000-4000-8000-000000000001',true);
insert into public.student_subjects(school_id,student_id,subject_id) values
  ('24000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000001');
insert into public.marks(id,school_id,exam_id,student_id,score) values
  ('a4000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001',50);

set local role authenticated;

-- ── creation ────────────────────────────────────────────────────────────────
select throws_ok($$
  insert into public.exams(school_id,term_id,subject_id,class_id,exam_name,exam_type,max_score,exam_date,status)
  values('24000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000001','34000000-0000-4000-8000-000000000001','Born Published','Born',100,'2099-06-01','published')
$$,'22023',null,'a new paper cannot be born published');

select throws_ok($$
  insert into public.exams(school_id,term_id,subject_id,class_id,exam_name,exam_type,max_score,exam_date,status)
  values('24000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000001','34000000-0000-4000-8000-000000000001','Huge Total','Huge',1500,'2099-06-01','draft')
$$,'23514',null,'a total above the ceiling is refused');

select throws_ok($$
  insert into public.exams(school_id,term_id,subject_id,class_id,exam_name,exam_type,max_score,exam_date,status)
  values('24000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000001','34000000-0000-4000-8000-000000000001','Ancient Paper','Ancient',100,'1999-12-31','draft')
$$,'22023',null,'a date outside the supported range is refused');

-- ── transitions ─────────────────────────────────────────────────────────────
select throws_ok($$update public.exams set status='published' where id='94000000-0000-4000-8000-000000000001'$$,'22023',null,'an open paper cannot jump straight to published');
select is((select status from public.exams where id='94000000-0000-4000-8000-000000000001'),'open','a refused transition leaves the status unchanged');

select throws_ok($$update public.exams set max_score=40 where id='94000000-0000-4000-8000-000000000001'$$,'23514',null,'a total cannot fall below a recorded score');
select throws_ok($$update public.exams set editing_deadline='2099-05-01T00:00:00Z' where id='94000000-0000-4000-8000-000000000001'$$,'22023',null,'a deadline before the paper date is refused');
select throws_ok($$update public.exams set subject_id='44000000-0000-4000-8000-000000000002' where id='94000000-0000-4000-8000-000000000001'$$,'42501',null,'a paper with results cannot change subject');

select lives_ok($$update public.exams set status='locked' where id='94000000-0000-4000-8000-000000000001'$$,'an open paper can be locked');
select is((select status from public.exams where id='94000000-0000-4000-8000-000000000001'),'locked','locking is recorded');
select lives_ok($$update public.exams set status='published' where id='94000000-0000-4000-8000-000000000001'$$,'a locked paper with a recorded result can be published');
select lives_ok($$update public.exams set status='locked' where id='94000000-0000-4000-8000-000000000001'$$,'a published paper can be withdrawn to locked');
select lives_ok($$update public.exams set status='open' where id='94000000-0000-4000-8000-000000000001'$$,'a locked paper can be reopened for corrections');

-- ── history ─────────────────────────────────────────────────────────────────
select is((select score from public.marks where exam_id='94000000-0000-4000-8000-000000000001'),50.00::numeric,'recorded marks survive every lifecycle change');
select is((select count(*)::integer from public.marks where exam_id='94000000-0000-4000-8000-000000000001'),1,'lifecycle changes neither create nor remove marks');

-- ── legacy rows ────────────────────────────────────────────────────────────
-- A paper written before this guard could hold a deadline earlier than its exam
-- date. Applying the guard must not freeze it; changing that deadline must be
-- held to the new rule.
reset role;
alter table public.exams disable trigger enforce_exam_write_before;
insert into public.exams(id,school_id,term_id,subject_id,class_id,exam_name,exam_type,max_score,exam_date,editing_deadline,status) values
  ('94000000-0000-4000-8000-000000000002','24000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000001','34000000-0000-4000-8000-000000000001','Legacy Paper','Legacy',100,'2099-07-01',null,'open');
alter table public.exams enable trigger enforce_exam_write_before;
-- A real result while the paper is still open, then the historical shape: a
-- locked paper whose deadline precedes the date it was sat.
insert into public.marks(school_id,exam_id,student_id,score) values
  ('24000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000002','84000000-0000-4000-8000-000000000001',70);
alter table public.exams disable trigger enforce_exam_write_before;
update public.exams set status='locked', editing_deadline='2099-06-01T00:00:00Z' where id='94000000-0000-4000-8000-000000000002';
alter table public.exams enable trigger enforce_exam_write_before;
set local role authenticated;

select lives_ok($$update public.exams set status='published' where id='94000000-0000-4000-8000-000000000002'$$,'a legacy locked paper with an early deadline can still be published');
select throws_ok($$update public.exams set editing_deadline='2099-06-15T00:00:00Z' where id='94000000-0000-4000-8000-000000000002'$$,'22023',null,'changing a legacy deadline to an invalid one is refused');
select lives_ok($$update public.exams set editing_deadline=null where id='94000000-0000-4000-8000-000000000002'$$,'a legacy deadline can be cleared');

-- ── authorization ───────────────────────────────────────────────────────────
select set_config('request.jwt.claim.sub','14000000-0000-4000-8000-000000000002',true);
with changed as (
  update public.exams set status='locked' where id='94000000-0000-4000-8000-000000000001' returning 1
)
select is((select count(*)::integer from changed),0,'a teacher cannot change a paper status');

select set_config('request.jwt.claim.sub','14000000-0000-4000-8000-000000000003',true);
with changed as (
  update public.exams set status='locked' where id='94000000-0000-4000-8000-000000000001' returning 1
)
select is((select count(*)::integer from changed),0,'an administrator of another school cannot change this paper');

select * from finish();
rollback;
