-- Fictional, disposable database only. Real grants/RLS/triggers/transactions.
begin;
create function pg_temp.fid(tag text,n integer) returns uuid language sql immutable as $$
  select (tag||'000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.ok(actual boolean,label text) returns void language plpgsql as $$
begin
  if actual is distinct from true then raise exception 'FAIL: %',label; end if;
  perform set_config('iupc.admin_count',(coalesce(nullif(current_setting('iupc.admin_count',true),''),'0')::int+1)::text,true);
  raise notice 'PASS: %',label;
end; $$;
create function pg_temp.denied(expected text,label text,statement text) returns void language plpgsql as $$
declare actual text;
begin
  begin execute statement; exception when others then actual:=sqlstate; end;
  perform pg_temp.ok(actual=expected,label||' ['||coalesce(actual,'no error')||']');
end; $$;
create function pg_temp.change(steps jsonb, req uuid default gen_random_uuid(), version text default null)
returns jsonb language sql volatile as $$
  select public.apply_enrollment_history_change(pg_temp.fid('62',1),pg_temp.fid('67',2),req,
    coalesce(version,public.read_enrollment_history(pg_temp.fid('62',1),pg_temp.fid('67',2))->>'version'),steps)
$$;
create function pg_temp.input(patch jsonb default '{}') returns jsonb language sql immutable as $$
  select '{"term_id":"66000000-0000-4000-8000-000000000001","coverage_kind":"whole_term","start_precision":"term_start","end_precision":"term_end","evidence_state":"confirmed","source_type":"class_register","source_reference":"FICTIONAL-2B","reason":"Fictional verified evidence"}'::jsonb||patch
$$;
do $$begin execute format('grant usage on schema %I to authenticated,anon',pg_my_temp_schema()::regnamespace::text); end$$;
grant execute on function pg_temp.fid(text,integer),pg_temp.ok(boolean,text),pg_temp.denied(text,text,text),pg_temp.change(jsonb,uuid,text),pg_temp.input(jsonb) to authenticated,anon;

select set_config('request.jwt.claim.sub',pg_temp.fid('61',1)::text,true);
set local role authenticated;
select pg_temp.ok((public.read_enrollment_history(pg_temp.fid('62',1),pg_temp.fid('67',2))->'school')='[]','administrator reads empty history');
select public.read_enrollment_history(pg_temp.fid('62',1),pg_temp.fid('67',2))->>'version' as original_version \gset
select pg_temp.fid('71',1)::text as req \gset
select jsonb_build_array(
 jsonb_build_object('key','school','axis','school','input',pg_temp.input('{"school_state":"enrolled","entry_kind":"admission"}')),
 jsonb_build_object('key','class','axis','class','input',pg_temp.input('{"class_id":"64000000-0000-4000-8000-000000000001","subject_scope_complete":true}'),'refs','{"school_history_id":"school"}'::jsonb),
 jsonb_build_object('key','subject','axis','subject','input',pg_temp.input('{"subject_id":"65000000-0000-4000-8000-000000000001","subject_state":"enrolled"}'),'refs','{"class_history_id":"class"}'::jsonb)
)::text as admission_steps \gset
select pg_temp.change(:'admission_steps',:'req',:'original_version')::text as admission_result \gset
select pg_temp.ok((:'admission_result'::jsonb->>'applied')::boolean,'atomic school/class/subject admission confirmed');
select pg_temp.ok(pg_temp.change(:'admission_steps',:'req',:'original_version')=:'admission_result'::jsonb,'lost response retry returns identical receipt');
select pg_temp.ok((select count(*)=1 from public.enrollment_history_operations),'retry creates no duplicate receipt');
select pg_temp.ok((select count(*)=1 from public.student_school_enrollment_history),'retry creates no duplicate evidence');
select pg_temp.ok((select recorded_by=pg_temp.fid('61',1) and change_id=:'req'::uuid from public.student_school_enrollment_history),'server actor and common change identity');
select pg_temp.denied('22023','receipt cannot authorize a different request',format('select pg_temp.change(%L,%L,%L)',replace(:'admission_steps','Fictional verified evidence','Different evidence'),:'req',:'original_version'));
select pg_temp.denied('PT409','stale history refused',format('select pg_temp.change(%L,gen_random_uuid(),%L)',:'admission_steps',:'original_version'));
select pg_temp.denied('42501','cross school read refused',$$select public.read_enrollment_history(pg_temp.fid('62',2),pg_temp.fid('67',3))$$);
select pg_temp.denied('42501','student scope spoof refused',$$select public.read_enrollment_history(pg_temp.fid('62',1),pg_temp.fid('67',3))$$);
select pg_temp.denied('22023','school field cannot bypass transaction scope',$$select pg_temp.change('[{"key":"a","axis":"school","input":{"school_id":"62000000-0000-4000-8000-000000000002"}}]')$$);
select pg_temp.denied('22023','forward references refused',$$select pg_temp.change('[{"key":"a","axis":"class","input":{},"refs":{"school_history_id":"later"}}]')$$);

-- Second step fails; its otherwise valid first step must also roll back.
select pg_temp.denied('23514','entire bundle rolled back on overlap',format('select pg_temp.change(%L)',jsonb_build_array(
 jsonb_build_object('key','valid','axis','school','input',pg_temp.input('{"term_id":"66000000-0000-4000-8000-000000000002","school_state":"enrolled"}')),
 jsonb_build_object('key','invalid','axis','school','input',pg_temp.input('{"school_state":"enrolled"}')))));
select pg_temp.ok((select count(*)=1 from public.student_school_enrollment_history),'failed transfer leaves no partial history');
select pg_temp.ok((select count(*)=1 from public.enrollment_history_operations),'failed bundle leaves no success receipt');

select (:'admission_result'::jsonb->'ids'->>'school') as school_id, (:'admission_result'::jsonb->'ids'->>'class') as class_id, (:'admission_result'::jsonb->'ids'->>'subject') as subject_id \gset
-- Explicit leaf-first retirement and parent-first re-establishment.
select pg_temp.change(jsonb_build_array(
 jsonb_build_object('key','retireSubject','axis','subject','input',pg_temp.input(jsonb_build_object('supersedes_id',:'subject_id','class_history_id',:'class_id','subject_id',pg_temp.fid('65',1),'subject_state','enrolled','evidence_state','voided'))),
 jsonb_build_object('key','retireClass','axis','class','input',pg_temp.input(jsonb_build_object('supersedes_id',:'class_id','school_history_id',:'school_id','class_id',pg_temp.fid('64',1),'evidence_state','voided'))),
 jsonb_build_object('key','schoolCorrect','axis','school','input',pg_temp.input(jsonb_build_object('supersedes_id',:'school_id','school_state','enrolled','entry_kind','admission','source_reference','FICTIONAL-CORRECTION'))),
 jsonb_build_object('key','classRestore','axis','class','input',pg_temp.input(jsonb_build_object('class_id',pg_temp.fid('64',1))),'refs','{"supersedes_id":"retireClass","school_history_id":"schoolCorrect"}'::jsonb),
 jsonb_build_object('key','subjectRestore','axis','subject','input',pg_temp.input(jsonb_build_object('subject_id',pg_temp.fid('65',1),'subject_state','enrolled')),'refs','{"supersedes_id":"retireSubject","class_history_id":"classRestore"}'::jsonb)
))::text as correction_result \gset
select pg_temp.ok((select count(*)=2 from public.student_school_enrollment_history),'original school evidence preserved after correction');
select pg_temp.ok((select count(*)=3 from public.student_class_enrollment_history),'class retirement and replacement retained');
select pg_temp.ok((select count(*)=3 from public.student_subject_enrollment_history),'subject retirement and replacement retained');
select pg_temp.ok((select count(*)=1 from public.student_class_enrollment_history_effective),'one effective class after atomic correction');
select pg_temp.ok((select school_history_id=(:'correction_result'::jsonb->'ids'->>'schoolCorrect')::uuid from public.student_class_enrollment_history_effective),'replacement parent relationship correct');

-- Adjacent class transfer + subject discontinuation in T2 (no current assignment changes).
select pg_temp.change(jsonb_build_array(
 jsonb_build_object('key','s','axis','school','input',pg_temp.input('{"term_id":"66000000-0000-4000-8000-000000000002","school_state":"enrolled"}')),
 jsonb_build_object('key','c1','axis','class','input',pg_temp.input('{"term_id":"66000000-0000-4000-8000-000000000002","coverage_kind":"dated_segment","end_precision":"exact_date","effective_to":"2099-06-01","class_id":"64000000-0000-4000-8000-000000000001"}'),'refs','{"school_history_id":"s"}'::jsonb),
 jsonb_build_object('key','c2','axis','class','input',pg_temp.input('{"term_id":"66000000-0000-4000-8000-000000000002","coverage_kind":"dated_segment","start_precision":"exact_date","effective_from":"2099-06-01","class_id":"64000000-0000-4000-8000-000000000002"}'),'refs','{"school_history_id":"s"}'::jsonb),
 jsonb_build_object('key','sub1','axis','subject','input',pg_temp.input('{"term_id":"66000000-0000-4000-8000-000000000002","coverage_kind":"dated_segment","start_precision":"exact_date","effective_from":"2099-06-01","end_precision":"exact_date","effective_to":"2099-06-10","subject_id":"65000000-0000-4000-8000-000000000001","subject_state":"enrolled"}'),'refs','{"class_history_id":"c2"}'::jsonb),
 jsonb_build_object('key','sub2','axis','subject','input',pg_temp.input('{"term_id":"66000000-0000-4000-8000-000000000002","coverage_kind":"dated_segment","start_precision":"exact_date","effective_from":"2099-06-10","subject_id":"65000000-0000-4000-8000-000000000001","subject_state":"not_taken"}'),'refs','{"class_history_id":"c2"}'::jsonb)
));
select pg_temp.ok((select count(*)=2 from public.student_class_enrollment_history_effective where term_id=pg_temp.fid('66',2)),'class transfer retains both placements');
select pg_temp.ok((select count(*)=2 from public.student_subject_enrollment_history_effective where term_id=pg_temp.fid('66',2)),'subject discontinuation preserves original participation');

select pg_temp.change(jsonb_build_array(
 jsonb_build_object('key','admit','axis','school','input',pg_temp.input('{"term_id":"66000000-0000-4000-8000-000000000003","coverage_kind":"dated_segment","start_precision":"exact_date","end_precision":"exact_date","effective_from":"2099-09-01","effective_to":"2099-09-10","school_state":"enrolled","entry_kind":"admission"}')),
 jsonb_build_object('key','withdraw','axis','school','input',pg_temp.input('{"term_id":"66000000-0000-4000-8000-000000000003","coverage_kind":"dated_segment","start_precision":"exact_date","end_precision":"exact_date","effective_from":"2099-09-10","effective_to":"2099-09-20","school_state":"not_enrolled"}')),
 jsonb_build_object('key','return','axis','school','input',pg_temp.input('{"term_id":"66000000-0000-4000-8000-000000000003","coverage_kind":"dated_segment","start_precision":"exact_date","effective_from":"2099-09-20","school_state":"enrolled","entry_kind":"return"}'))
));
select pg_temp.ok((select count(*)=3 from public.student_school_enrollment_history_effective where term_id=pg_temp.fid('66',3)),'withdrawal and return recorded atomically');

select set_config('request.jwt.claim.sub',pg_temp.fid('61',2)::text,true);
select pg_temp.denied('42501','teacher history read refused',$$select public.read_enrollment_history(pg_temp.fid('62',1),pg_temp.fid('67',2))$$);
select pg_temp.denied('42501','teacher history write refused',$$select pg_temp.change('[{"key":"s","axis":"school","input":{}}]')$$);
select pg_temp.ok((select count(*)=0 from public.enrollment_history_operations),'teacher cannot read receipts');
select set_config('request.jwt.claim.sub',pg_temp.fid('61',3)::text,true);
select pg_temp.denied('42501','cross-school administrator cannot read',$$select public.read_enrollment_history(pg_temp.fid('62',1),pg_temp.fid('67',2))$$);
select pg_temp.denied('42501','cross-school administrator cannot write',$$select pg_temp.change('[{"key":"s","axis":"school","input":{}}]')$$);
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.memberships set active=false where user_id=pg_temp.fid('61',1);
select set_config('request.jwt.claim.sub',pg_temp.fid('61',1)::text,true);
set local role authenticated;
select pg_temp.denied('42501','revoked administrator cannot read',$$select public.read_enrollment_history(pg_temp.fid('62',1),pg_temp.fid('67',2))$$);
select pg_temp.denied('42501','revoked administrator cannot replay receipts',format('select pg_temp.change(%L,%L,%L)',:'admission_steps',:'req',:'original_version'));
reset role;
set local role anon;
select pg_temp.denied('42501','anonymous cannot read RPC',$$select public.read_enrollment_history(pg_temp.fid('62',1),pg_temp.fid('67',2))$$);
select pg_temp.denied('42501','anonymous cannot write RPC',$$select public.apply_enrollment_history_change(pg_temp.fid('62',1),pg_temp.fid('67',2),gen_random_uuid(),'x','[]')$$);
reset role;
select pg_temp.denied('42501','owner cannot rewrite receipt',$$update public.enrollment_history_operations set recorded_at=now()$$);
select pg_temp.denied('42501','owner cannot delete receipt',$$delete from public.enrollment_history_operations$$);
select pg_temp.denied('42501','owner cannot truncate receipts',$$truncate public.enrollment_history_operations$$);
select 'PHASE2B_ASSERTIONS='||current_setting('iupc.admin_count');
rollback;
