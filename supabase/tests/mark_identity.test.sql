begin;
select plan(14);

-- Create isolated fixture rows inside this transaction; the final rollback keeps
-- the local database's school data unchanged.
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_user_meta_data)
values
  ('10000000-0000-4000-8000-000000000001','authenticated','authenticated','mark-admin-test@example.invalid','',now(),'{"full_name":"Mark Test Admin"}'),
  ('10000000-0000-4000-8000-000000000002','authenticated','authenticated','mark-teacher-test@example.invalid','',now(),'{"full_name":"Mark Test Teacher"}'),
  ('10000000-0000-4000-8000-000000000003','authenticated','authenticated','mark-unassigned-test@example.invalid','',now(),'{"full_name":"Mark Test Unassigned"}');

insert into public.schools(id,name,code) values
  ('20000000-0000-4000-8000-000000000001','Mark Identity Test School','MIT');
insert into public.classes(id,school_id,class_name,stream_name) values
  ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Test Class','A');
insert into public.subjects(id,school_id,name,code,category,level) values
  ('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Test Subject','MIT-SUB','Test','Custom');
insert into public.teachers(id,school_id,full_name,email,employee_id,initials) values
  ('50000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Mark Test Teacher','mark-teacher-test@example.invalid','MIT-T1','MT'),
  ('50000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','Mark Test Unassigned','mark-unassigned-test@example.invalid','MIT-T2','MU');
insert into public.memberships(id,school_id,user_id,role,teacher_id,active) values
  ('60000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','admin',null,true),
  ('60000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','teacher','50000000-0000-4000-8000-000000000001',true),
  ('60000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','teacher','50000000-0000-4000-8000-000000000002',true);
insert into public.teacher_subjects(school_id,teacher_id,subject_id) values
  ('20000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001');
insert into public.teacher_classes(school_id,teacher_id,class_id) values
  ('20000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001');
insert into public.teacher_permissions(teacher_id,permission) values
  ('50000000-0000-4000-8000-000000000001','marks.enter');
insert into public.terms(id,school_id,name,academic_year,is_active,start_date) values
  ('70000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Test Term','2099','true','2099-01-01');
insert into public.students(id,school_id,admission_number,full_name,gender,class_id) values
  ('80000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','MIT-ST1','Mark Test Student','Female','30000000-0000-4000-8000-000000000001');
insert into public.exams(id,school_id,term_id,subject_id,class_id,exam_name,exam_type,max_score,exam_date,status) values
  ('90000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','Test Paper','Test',100,'2099-01-02','open');
insert into public.student_subjects(school_id,student_id,subject_id) values
  ('20000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001');

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
insert into public.marks(id,school_id,exam_id,student_id,score)
values ('a0000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001',50);

set local role authenticated;
-- Since Stage 0B the client holds only UPDATE(remarks) on marks, so a score
-- travels through the receipt RPC. The direct UPDATE is refused at the privilege
-- level, and the approved path still works.
select throws_ok($$update public.marks set score=80 where id='a0000000-0000-4000-8000-000000000001'$$,'42501',null,'a direct score update is refused at the privilege level');
select lives_ok($$select public.apply_offline_write('c0000000-0000-4000-8000-000000000001','marks.setScore',
  jsonb_build_object('examId','90000000-0000-4000-8000-000000000001','studentId','80000000-0000-4000-8000-000000000001','score',80))$$,'authorized administrator can record a score through the RPC');
select is((select score from public.marks where id='a0000000-0000-4000-8000-000000000001'),80::numeric,'administrator score change persists');
select lives_ok($$update public.marks set remarks='Reviewed by registrar' where id='a0000000-0000-4000-8000-000000000001'$$,'authorized administrator can update remarks');
select throws_ok($$update public.marks set student_id='80000000-0000-4000-8000-000000000099' where id='a0000000-0000-4000-8000-000000000001'$$,'42501',null,'student identity cannot be reassigned');
select throws_ok($$update public.marks set exam_id='90000000-0000-4000-8000-000000000099' where id='a0000000-0000-4000-8000-000000000001'$$,'42501',null,'exam identity cannot be reassigned');
select throws_ok($$update public.marks set school_id='20000000-0000-4000-8000-000000000099' where id='a0000000-0000-4000-8000-000000000001'$$,'42501',null,'school identity cannot be reassigned');
select throws_ok($$update public.marks set id='a0000000-0000-4000-8000-000000000099' where id='a0000000-0000-4000-8000-000000000001'$$,'42501',null,'mark primary key cannot be reassigned');
select is((select jsonb_build_array(id,school_id,exam_id,student_id,score,remarks) from public.marks where id='a0000000-0000-4000-8000-000000000001'),jsonb_build_array('a0000000-0000-4000-8000-000000000001'::uuid,'20000000-0000-4000-8000-000000000001'::uuid,'90000000-0000-4000-8000-000000000001'::uuid,'80000000-0000-4000-8000-000000000001'::uuid,80,'Reviewed by registrar'),'rejected identity updates leave the original mark unchanged');
select is((select count(*)::integer from public.mark_revisions where mark_id='a0000000-0000-4000-8000-000000000001'),3,'successful insert, score update, and remarks update retain audit revisions');

reset role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select lives_ok($$select public.apply_offline_write('c0000000-0000-4000-8000-000000000002','marks.setScore',
  jsonb_build_object('examId','90000000-0000-4000-8000-000000000001','studentId','80000000-0000-4000-8000-000000000001','score',90))$$,'authorized assigned teacher can record a score through the RPC');
select lives_ok($$update public.marks set remarks='Teacher reviewed' where id='a0000000-0000-4000-8000-000000000001'$$,'authorized assigned teacher can update remarks');

reset role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select throws_ok($$update public.marks set score=95 where id='a0000000-0000-4000-8000-000000000001'$$,'42501',null,'an unassigned teacher cannot change a score');
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select is((select score from public.marks where id='a0000000-0000-4000-8000-000000000001'),90::numeric,'unassigned teacher cannot change the score');
select is((select remarks from public.marks where id='a0000000-0000-4000-8000-000000000001'),'Teacher reviewed','unassigned teacher cannot change remarks');

select * from finish();
rollback;
