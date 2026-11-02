-- Native PostgreSQL assertions: real constraints/RLS, NOT mocked authorization.
-- Requires the fictional enrollment-history-baseline.sql in an isolated DB.
-- Every history write and role change in this test is rolled back.
begin;
create function pg_temp.fid(tag text,n integer) returns uuid language sql immutable as $$
  select (tag||'000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.ok(actual boolean,label text) returns void language plpgsql as $$
begin
  if actual is distinct from true then raise exception 'FAIL: %',label; end if;
  perform set_config('iupc.history_test_count',(coalesce(nullif(current_setting('iupc.history_test_count',true),''),'0')::int+1)::text,true);
  raise notice 'PASS: %',label;
end;
$$;
create function pg_temp.denied(expected text,label text,statement text) returns void language plpgsql as $$
declare actual text;
begin
  begin execute statement; exception when others then actual:=sqlstate; end;
  perform pg_temp.ok(actual=expected,label||' [SQLSTATE '||coalesce(actual,'no error')||']');
end;
$$;
create function pg_temp.add_history(axis text,t integer,s integer,patch jsonb default '{}')
returns uuid language sql volatile as $$
  select public.append_enrollment_history(axis,jsonb_build_object(
    'school_id',pg_temp.fid('62',1),'student_id',pg_temp.fid('67',s),'term_id',pg_temp.fid('66',t),
    'evidence_state','confirmed','coverage_kind','whole_term','start_precision','term_start',
    'end_precision','term_end','source_type','class_register','source_reference','FICTIONAL-REGISTER',
    'reason','Fictional documentary verification','school_state','enrolled') - 'school_state'
    || case when axis='school' then '{"school_state":"enrolled"}'::jsonb else '{}'::jsonb end || patch)
$$;

do $$begin
  execute format('grant usage on schema %I to authenticated,anon',pg_my_temp_schema()::regnamespace::text);
end$$;
grant execute on function pg_temp.fid(text,integer),pg_temp.ok(boolean,text),
  pg_temp.denied(text,text,text),pg_temp.add_history(text,integer,integer,jsonb) to authenticated,anon;

select pg_temp.ok((select count(*)=0 from public.student_school_enrollment_history),'empty history: no automatic backfill');
select set_config('request.jwt.claim.sub',pg_temp.fid('61',1)::text,true);
set local role authenticated;
select pg_temp.add_history('school',1,2) as school1 \gset
select pg_temp.ok((select school_state='enrolled' and effective_from is null and effective_to is null
  from public.student_school_enrollment_history where id=:'school1'),'T1 whole-term fact does not invent admission date');
select pg_temp.ok((select recorded_by=pg_temp.fid('61',1) and confirmed_by=recorded_by
  and recorded_at=updated_at and confirmed_at=recorded_at
  from public.student_school_enrollment_history where id=:'school1'),'server audit identity/time');

select pg_temp.add_history('school',1,4,'{"school_state":"pre_enrollment"}');
select pg_temp.add_history('school',2,4,'{"coverage_kind":"dated_segment","start_precision":"exact_date","end_precision":"exact_date","effective_from":"2099-05-10","effective_to":"2099-06-10","entry_kind":"admission"}') as late2 \gset
select pg_temp.ok((select effective_from='2099-05-10' from public.student_school_enrollment_history where id=:'late2'),'verified T2 admission exact date');
select pg_temp.add_history('school',2,4,'{"coverage_kind":"dated_segment","start_precision":"exact_date","end_precision":"exact_date","effective_from":"2099-06-10","effective_to":"2099-07-01","school_state":"not_enrolled"}') as departure \gset
select pg_temp.add_history('school',2,4,'{"coverage_kind":"dated_segment","start_precision":"exact_date","end_precision":"term_end","effective_from":"2099-07-01","entry_kind":"return"}') as returned \gset
select pg_temp.ok((select count(*)=3 from public.student_school_enrollment_history_effective where student_id=pg_temp.fid('67',4) and term_id=pg_temp.fid('66',2)),'withdrawal and return retain three adjacent intervals');
select pg_temp.ok((select entry_kind='return' from public.student_school_enrollment_history where id=:'returned'),'return does not claim first admission');
select pg_temp.add_history('school',1,5,'{"school_state":"pre_enrollment"}');
select pg_temp.add_history('school',2,5,'{"school_state":"pre_enrollment"}');
select pg_temp.add_history('school',3,5,'{"coverage_kind":"dated_segment","start_precision":"exact_date","end_precision":"term_end","effective_from":"2099-09-15","entry_kind":"admission"}') as late3 \gset
select pg_temp.ok((select effective_from='2099-09-15' from public.student_school_enrollment_history where id=:'late3'),'verified T3 admission');
select pg_temp.denied('23514','overlapping school spans rejected',$$select pg_temp.add_history('school',2,4)$$);
select pg_temp.denied('23514','reversed dates rejected',$$select pg_temp.add_history('school',2,2,'{"coverage_kind":"dated_segment","start_precision":"exact_date","end_precision":"exact_date","effective_from":"2099-06-20","effective_to":"2099-06-10"}')$$);
select pg_temp.denied('23514','empty half-open interval rejected',$$select pg_temp.add_history('school',2,2,'{"coverage_kind":"dated_segment","start_precision":"exact_date","end_precision":"exact_date","effective_from":"2099-06-10","effective_to":"2099-06-10"}')$$);
select pg_temp.denied('23514','dates before selected term rejected',$$select pg_temp.add_history('school',2,2,'{"coverage_kind":"dated_segment","start_precision":"exact_date","end_precision":"term_end","effective_from":"2099-01-01"}')$$);
select pg_temp.add_history('school',3,2,'{"coverage_kind":"unknown","start_precision":"unknown","end_precision":"unknown","evidence_state":"unverified","school_state":"unknown","source_reference":""}') as unknown3 \gset
select pg_temp.ok((select count(*)=0 from public.student_school_enrollment_history_effective where id=:'unknown3'),'unknown history stays non-effective');
select pg_temp.denied('23514','confirmed evidence requires source',$$select pg_temp.add_history('school',2,2,'{"source_reference":""}')$$);
select pg_temp.denied('23514','legacy observation cannot become confirmation',$$select pg_temp.add_history('school',2,2,'{"source_type":"legacy_observation"}')$$);
select pg_temp.denied('23503','cross-school student rejected',$$select pg_temp.add_history('school',1,3)$$);
select pg_temp.denied('23503','cross-school term rejected',$$select pg_temp.add_history('school',4,2)$$);
select pg_temp.denied('23514','pre-enrollment cannot suppress accepted marks',$$select pg_temp.add_history('school',1,1,'{"school_state":"pre_enrollment"}')$$);
select pg_temp.add_history('school',1,1,'{"school_state":"pre_enrollment","evidence_state":"conflict"}') as conflict1 \gset
select pg_temp.ok((select count(*)=0 from public.student_school_enrollment_history_effective where id=:'conflict1'),'conflicting negative fact may be recorded but is not effective');

select pg_temp.add_history('class',1,2,jsonb_build_object('school_history_id',:'school1','class_id',pg_temp.fid('64',1),'subject_scope_complete',true)) as class1 \gset
select pg_temp.denied('23514','overlapping primary classes rejected',format(
  'select pg_temp.add_history(''class'',1,2,%L::jsonb)',jsonb_build_object('school_history_id',:'school1','class_id',pg_temp.fid('64',2))));
select pg_temp.add_history('school',2,2) as school2 \gset
select pg_temp.add_history('class',2,2,jsonb_build_object('school_history_id',:'school2','class_id',pg_temp.fid('64',2))) as class2 \gset
select pg_temp.ok((select count(*)=2 from public.student_class_enrollment_history_effective where student_id=pg_temp.fid('67',2)),'class move across terms preserves previous placement');
select pg_temp.denied('23503','cross-school class FK rejected',format(
  'select pg_temp.add_history(''class'',3,5,%L::jsonb)',jsonb_build_object('school_history_id',:'late3','class_id',pg_temp.fid('64',3),
    'coverage_kind','dated_segment','start_precision','exact_date','end_precision','term_end','effective_from','2099-09-15')));
select pg_temp.denied('23514','child interval cannot exceed parent',format(
  'select pg_temp.add_history(''class'',3,5,%L::jsonb)',jsonb_build_object('school_history_id',:'late3','class_id',pg_temp.fid('64',1))));
select pg_temp.denied('23514','unverified parent cannot authorize confirmed child',format(
  'select pg_temp.add_history(''class'',3,2,%L::jsonb)',jsonb_build_object('school_history_id',:'unknown3','class_id',pg_temp.fid('64',1))));
select pg_temp.add_history('class',2,4,jsonb_build_object('school_history_id',:'late2','class_id',pg_temp.fid('64',1),
  'coverage_kind','dated_segment','start_precision','exact_date','end_precision','exact_date',
  'effective_from','2099-05-10','effective_to','2099-06-01')) as transfer_a \gset
select pg_temp.add_history('class',2,4,jsonb_build_object('school_history_id',:'late2','class_id',pg_temp.fid('64',2),
  'coverage_kind','dated_segment','start_precision','exact_date','end_precision','exact_date',
  'effective_from','2099-06-01','effective_to','2099-06-10')) as transfer_b \gset
select pg_temp.ok((select count(*)=2 from public.student_class_enrollment_history_effective where student_id=pg_temp.fid('67',4)),'adjacent intraterm class transfer segments preserve old class');
select pg_temp.denied('23514','intraterm conflicting class dates rejected',format(
  'select pg_temp.add_history(''class'',2,4,%L::jsonb)',jsonb_build_object('school_history_id',:'late2','class_id',pg_temp.fid('64',2),
  'coverage_kind','dated_segment','start_precision','exact_date','end_precision','exact_date',
  'effective_from','2099-05-20','effective_to','2099-06-05')));
select pg_temp.add_history('school',2,1,'{"coverage_kind":"dated_segment","start_precision":"exact_date","end_precision":"exact_date","effective_from":"2099-09-15","effective_to":"2099-09-30"}');
select pg_temp.denied('23514','known exact overlap across term IDs rejected',$$select pg_temp.add_history('school',3,1,'{"coverage_kind":"dated_segment","start_precision":"exact_date","end_precision":"exact_date","effective_from":"2099-09-20","effective_to":"2099-10-01"}')$$);

select pg_temp.add_history('subject',1,2,jsonb_build_object('class_history_id',:'class1','subject_id',pg_temp.fid('65',1),'subject_state','enrolled')) as math1 \gset
select pg_temp.add_history('subject',1,2,jsonb_build_object('class_history_id',:'class1','subject_id',pg_temp.fid('65',2),'subject_state','enrolled')) as english1 \gset
select pg_temp.ok((select count(*)=2 from public.student_subject_enrollment_history_effective where class_history_id=:'class1'),'two different simultaneous subjects remain valid');
select pg_temp.denied('23514','duplicate subject overlap rejected',format(
  'select pg_temp.add_history(''subject'',1,2,%L::jsonb)',jsonb_build_object('class_history_id',:'class1','subject_id',pg_temp.fid('65',1),'subject_state','enrolled')));
select pg_temp.denied('23503','foreign subject FK rejected',format(
  'select pg_temp.add_history(''subject'',1,2,%L::jsonb)',jsonb_build_object('class_history_id',:'class1','subject_id',pg_temp.fid('65',3),'subject_state','enrolled')));
select pg_temp.add_history('subject',2,2,jsonb_build_object('class_history_id',:'class2','subject_id',pg_temp.fid('65',2),'subject_state','enrolled')) as english2 \gset
select pg_temp.ok((select term_id=pg_temp.fid('66',2) from public.student_subject_enrollment_history_effective where id=:'english2'),'T2 subject addition uses selected stable period');
select pg_temp.add_history('school',3,2,jsonb_build_object('supersedes_id',:'unknown3')) as school3 \gset
select pg_temp.add_history('class',3,2,jsonb_build_object('school_history_id',:'school3','class_id',pg_temp.fid('64',2),'subject_scope_complete',true)) as class3 \gset
select pg_temp.add_history('subject',3,2,jsonb_build_object('class_history_id',:'class3','subject_id',pg_temp.fid('65',2),'subject_state','not_taken')) as dropped \gset
select pg_temp.ok((select count(*)=2 from public.student_subject_enrollment_history_effective where student_id=pg_temp.fid('67',2) and subject_id=pg_temp.fid('65',2) and subject_state='enrolled'),'T3 drop retains earlier subject eligibility');
select pg_temp.ok((select subject_state='not_taken' from public.student_subject_enrollment_history_effective where id=:'dropped'),'T3 explicit subject exclusion is distinct from school pre-enrollment');

-- Corrections/proposals never erase accepted facts or silently repoint children.
select pg_temp.add_history('school',1,2,jsonb_build_object('supersedes_id',:'school1','evidence_state','unverified')) as proposal \gset
select pg_temp.ok((select count(*)=1 from public.student_school_enrollment_history_effective where id=:'school1'),'unverified proposal does not replace confirmed ancestor');
select pg_temp.denied('23514','parent correction cannot orphan confirmed class',format(
  'select pg_temp.add_history(''school'',1,2,%L::jsonb)',jsonb_build_object('supersedes_id',:'proposal')));
select pg_temp.denied('23514','class correction cannot orphan confirmed subjects',format(
  'select pg_temp.add_history(''class'',1,2,%L::jsonb)',jsonb_build_object('supersedes_id',:'class1','school_history_id',:'school1','class_id',pg_temp.fid('64',1))));
select pg_temp.add_history('subject',1,2,jsonb_build_object('supersedes_id',:'math1','class_history_id',:'class1','subject_id',pg_temp.fid('65',1),'evidence_state','voided')) as void_math \gset
select pg_temp.ok((select count(*)=0 from public.student_subject_enrollment_history_effective where fact_id=(select fact_id from public.student_subject_enrollment_history where id=:'math1')),'void does not resurrect old confirmation');
select pg_temp.ok((select count(*)=2 from public.student_subject_enrollment_history where fact_id=(select fact_id from public.student_subject_enrollment_history where id=:'math1')),'old evidence and void revision both retained');
select pg_temp.denied('23505','competing supersession branch rejected',format(
  'select pg_temp.add_history(''subject'',1,2,%L::jsonb)',jsonb_build_object('supersedes_id',:'math1','class_history_id',:'class1','subject_id',pg_temp.fid('65',1),'evidence_state','voided')));
select pg_temp.denied('22023','recording actor cannot be supplied',$$select pg_temp.add_history('school',2,1,'{"recorded_by":"61000000-0000-4000-8000-000000000003"}')$$);
select pg_temp.denied('22023','unsupported axis rejected',$$select public.append_enrollment_history('students','{}')$$);
select pg_temp.denied('22023','null input rejected',$$select public.append_enrollment_history('school',null)$$);
select pg_temp.denied('42501','direct history insert denied',$$insert into public.student_school_enrollment_history default values$$);
select pg_temp.denied('42501','direct history update denied',$$update public.student_school_enrollment_history set reason='erase'$$);
select pg_temp.denied('42501','direct history deletion denied',$$delete from public.student_school_enrollment_history$$);
select pg_temp.denied('42501','history truncate denied',$$truncate public.student_school_enrollment_history$$);

reset role;
select pg_temp.denied('42501','owner update also hits append guard',$$update public.student_school_enrollment_history set reason='rewrite'$$);
select pg_temp.denied('42501','owner truncate hits statement guard',$$truncate public.student_subject_enrollment_history$$);
select set_config('request.jwt.claim.sub',pg_temp.fid('61',2)::text,true);
set local role authenticated;
select pg_temp.ok((select count(*)=0 from public.student_school_enrollment_history),'teacher cannot read administrator evidence');
select pg_temp.ok((select count(*)=0 from public.student_class_enrollment_history_effective),'invoker view cannot bypass teacher RLS');
select pg_temp.denied('42501','teacher append denied',$$select pg_temp.add_history('school',2,1)$$);
select pg_temp.denied('42501','teacher correction denied',format(
  'select pg_temp.add_history(''school'',1,2,%L::jsonb)',jsonb_build_object('supersedes_id',:'school1')));
reset role;
select set_config('request.jwt.claim.sub',pg_temp.fid('61',3)::text,true);
set local role authenticated;
select pg_temp.ok((select count(*)=0 from public.student_school_enrollment_history),'other-school admin cannot read School A history');
select pg_temp.denied('42501','other-school admin cannot write School A history',$$select pg_temp.add_history('school',2,1)$$);
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
select pg_temp.denied('42501','anonymous select denied',$$select * from public.student_school_enrollment_history$$);
select pg_temp.denied('42501','anonymous RPC denied',$$select public.append_enrollment_history('school','{}')$$);
reset role;
update public.memberships set active=false where user_id=pg_temp.fid('61',1);
select set_config('request.jwt.claim.sub',pg_temp.fid('61',1)::text,true);
set local role authenticated;
select pg_temp.ok((select count(*)=0 from public.student_school_enrollment_history),'revoked membership loses read access');
select pg_temp.denied('42501','revoked membership loses append access',$$select pg_temp.add_history('school',2,1)$$);
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.memberships set active=true where user_id=pg_temp.fid('61',1);
select pg_temp.ok((select score=75 and entered_by=pg_temp.fid('61',1) from public.marks where id=pg_temp.fid('69',1)),'accepted mark identity/value unchanged');
select pg_temp.ok((select class_id=pg_temp.fid('64',1) and admission_number='H-FIX-002' from public.students where id=pg_temp.fid('67',2)),'current student class/admission unchanged');
select pg_temp.ok((select count(*)=2 from public.student_subjects where school_id=pg_temp.fid('62',1)),'current subject-selection rows unchanged');
select 'PHASE2A_ASSERTIONS='||current_setting('iupc.history_test_count');
rollback;
