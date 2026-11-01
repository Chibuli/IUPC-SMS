begin;
select plan(21);

select ok(exists (
  select 1 from information_schema.columns
  where table_schema='public' and table_name='students' and column_name='archived'
), 'students have a separate archival flag');
select ok(exists (
  select 1 from information_schema.columns
  where table_schema='public' and table_name='students' and column_name='archived_at'
), 'students record the archival time');
select ok(exists (
  select 1 from pg_constraint
  where conrelid='public.students'::regclass and conname='students_archive_timestamp_consistent'
), 'archival flag and timestamp are consistent');
select has_table('public','student_lifecycle_events','lifecycle audit history exists');
select ok((select relrowsecurity from pg_class where oid='public.student_lifecycle_events'::regclass), 'lifecycle audit history has RLS enabled');
select ok(exists (
  select 1 from pg_policies
  where schemaname='public' and tablename='student_lifecycle_events'
    and policyname='student lifecycle events admin read'
    and qual like '%is_school_admin%'
), 'lifecycle audit history is administrator-scoped');
select ok(has_function_privilege('authenticated','public.archive_student(uuid)','execute'), 'authenticated callers can invoke archive RPC');
select ok(has_function_privilege('authenticated','public.reactivate_student(uuid)','execute'), 'authenticated callers can invoke reactivation RPC');
select ok(not has_function_privilege('anon','public.archive_student(uuid)','execute'), 'anonymous callers cannot archive students');
select ok(exists (
  select 1 from pg_trigger where tgrelid='public.students'::regclass
    and tgname='reject_student_delete_before' and not tgisinternal
), 'direct student deletion is rejected by a database trigger');
select ok(exists (
  select 1 from pg_trigger where tgrelid='public.marks'::regclass
    and tgname='guard_archived_student_mark_write_before' and not tgisinternal
), 'mark writes revalidate archival status');
select ok(exists (
  select 1 from pg_trigger where tgrelid='public.student_subjects'::regclass
    and tgname='guard_archived_student_subject_write_before' and not tgisinternal
), 'enrollment history is protected while archived');
select ok(exists (
  select 1 from pg_trigger where tgrelid='public.report_cards'::regclass
    and tgname='guard_archived_student_report_card_write_before' and not tgisinternal
), 'report-card history is protected while archived');
select ok(exists (
  select 1 from pg_trigger where tgrelid='public.student_notes'::regclass
    and tgname='guard_archived_student_note_delete_before' and not tgisinternal
), 'archived notes cannot be deleted through ordinary table operations');
select ok(not has_table_privilege('authenticated','public.students','delete'), 'authenticated users cannot directly delete students');
select ok(not has_column_privilege('authenticated','public.students','archived','update'), 'authenticated users cannot directly change archival state');
select ok(exists (
  select 1 from pg_policies where schemaname='public' and tablename='students'
    and policyname='students assigned read' and qual like '%archived%'
), 'student profile reads filter archived rows from non-admins');
select ok(exists (
  select 1 from pg_policies where schemaname='public' and tablename='marks'
    and policyname='marks assigned read' and qual like '%archived%'
), 'teacher mark history reads filter archived students');
select ok(exists (
  select 1 from pg_policies where schemaname='public' and tablename='report_cards'
    and policyname='report cards assigned read' and qual like '%archived%'
), 'teacher report-card reads filter archived students');
select ok(exists (
  select 1 from pg_policies where schemaname='public' and tablename='student_notes'
    and policyname='notes member class read' and qual like '%archived%'
), 'teacher note reads filter archived students');
select ok(position('reactivate' in pg_get_functiondef('public.guard_archived_student_update()'::regprocedure)) > 0,
  'student update trigger permits only the controlled reactivation transition');

select * from finish();
rollback;
