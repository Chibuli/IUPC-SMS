begin;
select plan(13);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_user_meta_data)
values
  ('11000000-0000-4000-8000-000000000001','authenticated','authenticated','enrollment-admin@example.invalid','',now(),'{"full_name":"Enrollment Admin"}'),
  ('11000000-0000-4000-8000-000000000002','authenticated','authenticated','enrollment-teacher@example.invalid','',now(),'{"full_name":"Enrollment Teacher"}');
insert into public.schools(id,name,code) values
  ('21000000-0000-4000-8000-000000000001','Enrollment Test School','ETS'),
  ('21000000-0000-4000-8000-000000000002','Other Enrollment School','OES');
insert into public.classes(id,school_id,class_name,stream_name) values
  ('31000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','Test Class','A'),
  ('31000000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000001','Other Class','A'),
  ('31000000-0000-4000-8000-000000000003','21000000-0000-4000-8000-000000000002','Foreign Class','A');
insert into public.subjects(id,school_id,name,code,category,level) values
  ('41000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','Subject One','ETS-1','Test','Custom'),
  ('41000000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000001','Subject Two','ETS-2','Test','Custom'),
  ('41000000-0000-4000-8000-000000000003','21000000-0000-4000-8000-000000000002','Foreign Subject','OES-1','Test','Custom');
insert into public.teachers(id,school_id,full_name,email,employee_id,initials) values
  ('51000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','Enrollment Teacher','enrollment-teacher@example.invalid','ETS-T1','ET');
insert into public.memberships(id,school_id,user_id,role,teacher_id,active) values
  ('61000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','admin',null,true),
  ('61000000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002','teacher','51000000-0000-4000-8000-000000000001',true);
insert into public.teacher_subjects(school_id,teacher_id,subject_id) values
  ('21000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001');
insert into public.teacher_classes(school_id,teacher_id,class_id) values
  ('21000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001');
insert into public.teacher_permissions(teacher_id,permission) values ('51000000-0000-4000-8000-000000000001','marks.enter');
insert into public.terms(id,school_id,name,academic_year,is_active,start_date) values
  ('71000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','Test Term','2099',true,'2099-01-01'),
  ('71000000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000002','Foreign Term','2099',true,'2099-01-01');
insert into public.students(id,school_id,admission_number,full_name,gender,class_id) values
  ('81000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','ETS-1','Enrolled Student','Female','31000000-0000-4000-8000-000000000001'),
  ('81000000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000001','ETS-2','Wrong Class Student','Male','31000000-0000-4000-8000-000000000002'),
  ('81000000-0000-4000-8000-000000000003','21000000-0000-4000-8000-000000000002','OES-1','Foreign Student','Female','31000000-0000-4000-8000-000000000003'),
  ('81000000-0000-4000-8000-000000000004','21000000-0000-4000-8000-000000000001','ETS-4','Unenrolled Student','Male','31000000-0000-4000-8000-000000000001');
insert into public.exams(id,school_id,term_id,subject_id,class_id,exam_name,exam_type,max_score,exam_date,status) values
  ('91000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','One Paper','Test',100,'2099-01-02','open'),
  ('91000000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000002','31000000-0000-4000-8000-000000000001','Two Paper','Test',100,'2099-01-02','open'),
  ('91000000-0000-4000-8000-000000000003','21000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000002','Wrong Class Paper','Test',100,'2099-01-02','open'),
  ('91000000-0000-4000-8000-000000000004','21000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000002','41000000-0000-4000-8000-000000000003','31000000-0000-4000-8000-000000000003','Foreign Paper','Test',100,'2099-01-02','open'),
  ('91000000-0000-4000-8000-000000000005','21000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000002','31000000-0000-4000-8000-000000000002','Unassigned Class Paper','Test',100,'2099-01-02','open');
insert into public.student_subjects(school_id,student_id,subject_id) values
  ('21000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001'),
  ('21000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002','41000000-0000-4000-8000-000000000002'),
  ('21000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000003','41000000-0000-4000-8000-000000000003');

select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
insert into public.marks(school_id,exam_id,student_id,score)
values ('21000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001',0);
select is((select score from public.marks where exam_id='91000000-0000-4000-8000-000000000001' and student_id='81000000-0000-4000-8000-000000000001'),0::numeric,'direct insert succeeds for exact enrolled subject, including numeric zero');
select throws_ok($$insert into public.marks(school_id,exam_id,student_id,score) values ('21000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000004',50)$$,'23514',null,'student with no enrollment cannot be marked');
select throws_ok($$insert into public.marks(school_id,exam_id,student_id,score) values ('21000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000001',50)$$,'23514',null,'student enrolled in another subject cannot be marked for this subject');
select throws_ok($$insert into public.marks(school_id,exam_id,student_id,score) values ('21000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002',50)$$,'42501',null,'student in another class cannot receive this paper mark');
select throws_ok($$insert into public.marks(school_id,exam_id,student_id,score) values ('21000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000003',50)$$,'42501',null,'student from another school cannot receive this paper mark');
select throws_ok($$insert into public.marks(school_id,exam_id,student_id,score) values ('21000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000001',50)$$,'23514',null,'enrollment in a different subject does not satisfy the exact subject');
select throws_ok($$select public.apply_offline_write('a1000000-0000-4000-8000-000000000001','marks.setScore','{"examId":"91000000-0000-4000-8000-000000000002","studentId":"81000000-0000-4000-8000-000000000001","score":70}'::jsonb)$$,'23514',null,'offline score RPC rejects an un-enrolled subject');
select is((select count(*)::integer from public.write_receipts where request_id='a1000000-0000-4000-8000-000000000001'),0,'rejected offline write does not create an accepted receipt');
select lives_ok($$select public.apply_offline_write('a1000000-0000-4000-8000-000000000002','marks.setScore','{"examId":"91000000-0000-4000-8000-000000000001","studentId":"81000000-0000-4000-8000-000000000001","score":70}'::jsonb)$$,'offline score RPC accepts an exact-subject enrollment');
select is((select score from public.marks where exam_id='91000000-0000-4000-8000-000000000001' and student_id='81000000-0000-4000-8000-000000000001'),70::numeric,'accepted offline score is persisted');

reset role;
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select throws_ok($$insert into public.marks(school_id,exam_id,student_id,score) values ('21000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000005','81000000-0000-4000-8000-000000000002',50)$$,'42501',null,'teacher without assignment to required subject cannot write');
reset role;
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000001',true);
set local role authenticated;

-- Enrollment is authoritative at write time, not only at the time a mark was
-- first entered. Removing enrollment makes a later score update fail closed.
delete from public.student_subjects where student_id='81000000-0000-4000-8000-000000000001' and subject_id='41000000-0000-4000-8000-000000000001';
select throws_ok($$update public.marks set score=75 where exam_id='91000000-0000-4000-8000-000000000001' and student_id='81000000-0000-4000-8000-000000000001'$$,'23514',null,'direct update after enrollment removal is rejected');
select throws_ok($$select public.apply_offline_write('a1000000-0000-4000-8000-000000000003','marks.setScore','{"examId":"91000000-0000-4000-8000-000000000001","studentId":"81000000-0000-4000-8000-000000000001","score":80}'::jsonb)$$,'23514',null,'administrator cannot bypass missing exact-subject enrollment');

select * from finish();
rollback;
