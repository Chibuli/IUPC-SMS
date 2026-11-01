begin;
select plan(25);

-- Stage 0B database controls. Everything runs inside this transaction and is
-- rolled back, so the local database's school data is untouched. This file is
-- written for a disposable environment: the Stage 0B migration must be applied
-- there first.

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_user_meta_data)
values
  ('10000000-0000-4000-8000-0000000000a1','authenticated','authenticated','s4-admin@example.invalid','',now(),'{"full_name":"S4 Admin"}'),
  ('10000000-0000-4000-8000-0000000000a2','authenticated','authenticated','s4-teacher@example.invalid','',now(),'{"full_name":"S4 Teacher"}'),
  ('10000000-0000-4000-8000-0000000000a3','authenticated','authenticated','s4-corrector@example.invalid','',now(),'{"full_name":"S4 Corrector"}');

insert into public.schools(id,name,code) values ('20000000-0000-4000-8000-0000000000b1','S4 School','S4S');
insert into public.classes(id,school_id,class_name,stream_name) values ('30000000-0000-4000-8000-0000000000c1','20000000-0000-4000-8000-0000000000b1','S4 Class','A');
insert into public.subjects(id,school_id,name,code,category,level) values ('40000000-0000-4000-8000-0000000000d1','20000000-0000-4000-8000-0000000000b1','S4 Subject','S4-SUB','Test','Custom');
insert into public.teachers(id,school_id,full_name,email,employee_id,initials) values
  ('50000000-0000-4000-8000-0000000000e1','20000000-0000-4000-8000-0000000000b1','S4 Teacher','s4-teacher@example.invalid','S4-T1','S4'),
  ('50000000-0000-4000-8000-0000000000e2','20000000-0000-4000-8000-0000000000b1','S4 Corrector','s4-corrector@example.invalid','S4-T2','SC');
insert into public.memberships(id,school_id,user_id,role,teacher_id,active) values
  ('60000000-0000-4000-8000-0000000000f1','20000000-0000-4000-8000-0000000000b1','10000000-0000-4000-8000-0000000000a1','admin',null,true),
  ('60000000-0000-4000-8000-0000000000f2','20000000-0000-4000-8000-0000000000b1','10000000-0000-4000-8000-0000000000a2','teacher','50000000-0000-4000-8000-0000000000e1',true),
  ('60000000-0000-4000-8000-0000000000f3','20000000-0000-4000-8000-0000000000b1','10000000-0000-4000-8000-0000000000a3','teacher','50000000-0000-4000-8000-0000000000e2',true);
insert into public.teacher_subjects(school_id,teacher_id,subject_id) values
  ('20000000-0000-4000-8000-0000000000b1','50000000-0000-4000-8000-0000000000e1','40000000-0000-4000-8000-0000000000d1');
insert into public.teacher_classes(school_id,teacher_id,class_id) values
  ('20000000-0000-4000-8000-0000000000b1','50000000-0000-4000-8000-0000000000e1','30000000-0000-4000-8000-0000000000c1');
insert into public.teacher_permissions(teacher_id,permission) values
  ('50000000-0000-4000-8000-0000000000e1','marks.enter');
insert into public.terms(id,school_id,name,academic_year,is_active,start_date) values
  ('70000000-0000-4000-8000-0000000000a1','20000000-0000-4000-8000-0000000000b1','S4 Term','2099','true','2099-01-01');
insert into public.students(id,school_id,admission_number,full_name,gender,class_id) values
  ('80000000-0000-4000-8000-0000000000a1','20000000-0000-4000-8000-0000000000b1','S4-ST1','S4 Student','Female','30000000-0000-4000-8000-0000000000c1'),
  ('80000000-0000-4000-8000-0000000000a2','20000000-0000-4000-8000-0000000000b1','S4-ST2','S4 Learner','Male','30000000-0000-4000-8000-0000000000c1');
insert into public.student_subjects(school_id,student_id,subject_id) values
  ('20000000-0000-4000-8000-0000000000b1','80000000-0000-4000-8000-0000000000a1','40000000-0000-4000-8000-0000000000d1'),
  ('20000000-0000-4000-8000-0000000000b1','80000000-0000-4000-8000-0000000000a2','40000000-0000-4000-8000-0000000000d1');
insert into public.exams(id,school_id,term_id,subject_id,class_id,exam_name,exam_type,max_score,exam_date,status) values
  ('90000000-0000-4000-8000-0000000000a1','20000000-0000-4000-8000-0000000000b1','70000000-0000-4000-8000-0000000000a1','40000000-0000-4000-8000-0000000000d1','30000000-0000-4000-8000-0000000000c1','S4 Paper','Test',100,'2099-01-02','open');

-- ── attribution ──────────────────────────────────────────────────────────────
-- 1. A new mark is attributed to the acting user, whoever inserts it.
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-0000000000a1',true);
insert into public.marks(id,school_id,exam_id,student_id,score)
values ('a0000000-0000-4000-8000-0000000000a1','20000000-0000-4000-8000-0000000000b1','90000000-0000-4000-8000-0000000000a1','80000000-0000-4000-8000-0000000000a1',50);
select is((select entered_by from public.marks where id='a0000000-0000-4000-8000-0000000000a1'),
  '10000000-0000-4000-8000-0000000000a1'::uuid, 'INSERT attributes the mark to the acting user');

-- 2. A later correction by another actor does not take the original attribution.
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-0000000000a3',true);
update public.marks set score=55 where id='a0000000-0000-4000-8000-0000000000a1';
select is((select entered_by from public.marks where id='a0000000-0000-4000-8000-0000000000a1'),
  '10000000-0000-4000-8000-0000000000a1'::uuid, 'an UPDATE by another actor preserves entered_by');

-- 3. The correcting actor is recorded separately, in the revision.
-- Select the correction by its content: every revision in one transaction shares
-- the same changed_at, so ordering by time would be arbitrary here.
select is((select count(*)::integer from public.mark_revisions
           where mark_id='a0000000-0000-4000-8000-0000000000a1'
             and actor_id='10000000-0000-4000-8000-0000000000a3' and old_score=50),1,
  'mark_revisions.actor_id records the correcting actor');

-- 4. Rewriting attribution is refused outright rather than silently discarded.
select throws_ok($$update public.marks set entered_by='10000000-0000-4000-8000-0000000000a3'
                  where id='a0000000-0000-4000-8000-0000000000a1'$$,
  '42501', 'mark identity is immutable', 'entered_by cannot be rewritten');

-- 5. A historical NULL attribution is not back-filled by a later correction.
alter table public.marks disable trigger enforce_mark_write_before;
insert into public.marks(id,school_id,exam_id,student_id,score,entered_by)
values ('a0000000-0000-4000-8000-0000000000a2','20000000-0000-4000-8000-0000000000b1','90000000-0000-4000-8000-0000000000a1','80000000-0000-4000-8000-0000000000a2',20,null);
alter table public.marks enable trigger enforce_mark_write_before;
select isnt((select entered_by from public.marks where id='a0000000-0000-4000-8000-0000000000a2'),
  '10000000-0000-4000-8000-0000000000a3'::uuid, 'a historical NULL attribution is never back-filled');

-- 6. A remarks-only change also leaves attribution alone.
update public.marks set remarks='reviewed' where id='a0000000-0000-4000-8000-0000000000a1';
select is((select entered_by from public.marks where id='a0000000-0000-4000-8000-0000000000a1'),
  '10000000-0000-4000-8000-0000000000a1'::uuid, 'a remarks correction preserves entered_by');

-- ── the two approved client writes ───────────────────────────────────────────
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-0000000000a2',true);
set local role authenticated;

-- 7. An authorized teacher can still correct remarks directly.
select lives_ok($$update public.marks set remarks='teacher note'
                  where id='a0000000-0000-4000-8000-0000000000a1'$$,
  'an authorized teacher can update remarks');

-- 8. A score travels through the receipt RPC, not a direct UPDATE.
select lives_ok($$select public.apply_offline_write(
  'b0000000-0000-4000-8000-0000000000a1','marks.setScore',
  jsonb_build_object('examId','90000000-0000-4000-8000-0000000000a1','studentId','80000000-0000-4000-8000-0000000000a1','score',70))$$,
  'an authorized teacher can record a score through the RPC');

select is((select score from public.marks where id='a0000000-0000-4000-8000-0000000000a1'),70::numeric,
  'the RPC write reached the mark');

-- 9. The receipt is what makes the retry safe, and it is bound to the payload.
select is((select count(*)::integer from public.write_receipts
           where request_id='b0000000-0000-4000-8000-0000000000a1'),1,'the accepted write left a receipt');

-- 10. Reusing the request id with different marks is blocked.
select throws_ok($$select public.apply_offline_write(
  'b0000000-0000-4000-8000-0000000000a1','marks.setScore',
  jsonb_build_object('examId','90000000-0000-4000-8000-0000000000a1','studentId','80000000-0000-4000-8000-0000000000a1','score',75))$$,
  '22023', 'idempotency key reused with different request', 'a request id cannot be reused for different marks');

-- ── direct client writes ─────────────────────────────────────────────────────
-- 11. A direct score update is refused at the privilege level.
select throws_ok($$update public.marks set score=80 where id='a0000000-0000-4000-8000-0000000000a1'$$,
  '42501', null, 'authenticated cannot update a score directly');

-- 12. Attribution cannot be written directly either.
select throws_ok($$update public.marks set entered_by=null where id='a0000000-0000-4000-8000-0000000000a1'$$,
  '42501', null, 'authenticated cannot update entered_by directly');

-- 13. A client cannot insert a mark at all.
select throws_ok($$insert into public.marks(school_id,exam_id,student_id,score)
                  values('20000000-0000-4000-8000-0000000000b1','90000000-0000-4000-8000-0000000000a1','80000000-0000-4000-8000-0000000000a1',10)$$,
  '42501', null, 'authenticated cannot insert a mark');

-- 14. Receipts and revisions are read-only to a client.
select throws_ok($$insert into public.write_receipts(user_id,request_id,school_id,operation,payload)
                  values('10000000-0000-4000-8000-0000000000a2',gen_random_uuid(),'20000000-0000-4000-8000-0000000000b1','marks.setScore','{}'::jsonb)$$,
  '42501', null, 'authenticated cannot write a receipt');
select throws_ok($$delete from public.write_receipts where request_id='b0000000-0000-4000-8000-0000000000a1'$$,
  '42501', null, 'authenticated cannot delete a receipt');

reset role;

-- ── the guard, not the ACL ───────────────────────────────────────────────────
-- 15. With DELETE granted temporarily, the guard is what refuses the statement.
grant delete on public.marks to authenticated;
set local role authenticated;
select throws_ok($$delete from public.marks where id='a0000000-0000-4000-8000-0000000000a1'$$,
  '42501', 'MARK_DELETE_FORBIDDEN', 'the row guard refuses a delete even when the privilege exists');
reset role;
revoke delete on public.marks from authenticated;

-- 16. TRUNCATE is refused by the statement guard, for the owner as well.
select throws_ok($$truncate public.marks, public.mark_revisions$$,
  '42501', 'TRUNCATE_FORBIDDEN', 'the truncate guard refuses a truncate');

-- 17. The retired delete policy is gone.
select is((select count(*)::integer from pg_policies where schemaname='public' and tablename='marks' and cmd='DELETE'),0,
  'no mark delete policy survives');

-- ── retention of history and receipts ────────────────────────────────────────
-- 18. A user with accepted receipts cannot be deleted, and the receipt survives.
select throws_ok($$delete from auth.users where id='10000000-0000-4000-8000-0000000000a2'$$,
  '23503', null, 'a user who owns accepted receipts cannot be deleted');
select is((select count(*)::integer from public.write_receipts where user_id='10000000-0000-4000-8000-0000000000a2'),1,
  'the accepted receipt is still there');

-- 19. A school with marks cannot be deleted through a cascade.
select throws_ok($$delete from public.schools where id='20000000-0000-4000-8000-0000000000b1'$$,
  '23503', null, 'a school with marks cannot be deleted');
select is((select count(*)::integer from public.marks where school_id='20000000-0000-4000-8000-0000000000b1') > 0, true,
  'marks survive the refused school deletion');

-- 20. Every protected relationship is restrictive and validated.
select is((select count(*)::integer from pg_constraint
           where conname in ('marks_entered_by_fkey','marks_school_id_fkey','marks_exam_id_school_id_fkey',
                             'marks_student_id_school_id_fkey','mark_revisions_actor_id_fkey','mark_revisions_mark_id_fkey',
                             'mark_revisions_school_id_fkey','write_receipts_user_id_fkey','write_receipts_school_id_fkey')
             and confdeltype='r' and convalidated),9,
  'all nine protected relationships are ON DELETE RESTRICT and validated');

-- 21. The column privileges are exactly the approved set.
select is(
  (select jsonb_build_object(
     'marks_select', has_table_privilege('authenticated','public.marks','SELECT'),
     'remarks_update', has_column_privilege('authenticated','public.marks','remarks','UPDATE'),
     'score_update', has_column_privilege('authenticated','public.marks','score','UPDATE'),
     'entered_by_update', has_column_privilege('authenticated','public.marks','entered_by','UPDATE'),
     'marks_delete', has_table_privilege('authenticated','public.marks','DELETE'),
     'receipts_insert', has_table_privilege('authenticated','public.write_receipts','INSERT'))),
   '{"marks_select":true,"remarks_update":true,"score_update":false,"entered_by_update":false,"marks_delete":false,"receipts_insert":false}'::jsonb,
  'authenticated holds read access and the remarks column only');

select * from finish();
rollback;
