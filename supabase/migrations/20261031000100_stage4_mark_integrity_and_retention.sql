-- Stage 4 / Stage 0B — mark attribution, deletion and privilege hardening.
--
-- Every object this file changes is owned by `postgres`. It deliberately does
-- NOT touch anything owned by `supabase_admin`: the dblink extension, its 41
-- overloads, and the `supabase_admin` default privileges are Stage 0A, which is
-- still blocked on an authorised privileged route. Applying this file alone does
-- not close the Stage 4 database gate.
--
-- What this file establishes:
--   1. `marks.entered_by` is set once, on INSERT, and never rewritten by UPDATE.
--   2. A later correction is attributed to `mark_revisions.actor_id`, not by
--      replacing the original entry attribution.
--   3. Direct client writes are confined to reads plus a remarks-only update of
--      `marks`; scores travel through `apply_offline_write`, which is the path
--      the client already uses.
--   4. Rows of marks, revisions and receipts cannot be deleted through client
--      privileges, a row DELETE guard, a statement TRUNCATE guard, or a parent
--      cascade.
--   5. Users and schools referenced by history cannot be deleted out from under
--      it.
--   6. Future functions created by `postgres` do not inherit PUBLIC EXECUTE.

-- ── 1. Attribution integrity ────────────────────────────────────────────────
-- The INSERT branch keeps `auth.uid()`; the UPDATE branch copies the stored
-- value verbatim. `coalesce()` is not used: a historical NULL attribution stays
-- NULL rather than being back-filled with whoever happens to correct the mark.
create or replace function public.enforce_mark_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare ex public.exams%rowtype; stu public.students%rowtype; membership public.memberships%rowtype; deadline timestamptz;
begin
  select * into ex from public.exams where id = coalesce(new.exam_id, old.exam_id);
  select * into stu from public.students where id = coalesce(new.student_id, old.student_id);
  if ex.id is null or stu.id is null or ex.school_id <> stu.school_id or ex.school_id <> coalesce(new.school_id, old.school_id) then raise exception 'record not found' using errcode = '42501'; end if;    if tg_op = 'DELETE' then
    if not public.is_school_admin(ex.school_id) then raise exception 'not authorized' using errcode = '42501'; end if;
    return old;
  end if;
  if auth.uid() is null or not public.is_school_member(ex.school_id) then raise exception 'not authorized' using errcode = '42501'; end if;
  if new.school_id<>ex.school_id or new.exam_id<>ex.id or new.student_id<>stu.id then raise exception 'record scope is immutable' using errcode='42501'; end if;
  if ex.status <> 'open' then raise exception 'mark entry is closed' using errcode = '42501'; end if;
  if new.score is not null and (new.score < 0 or new.score > ex.max_score) then raise exception 'invalid score' using errcode = '23514'; end if;
  if new.score_code is not null and new.score is not null then raise exception 'invalid score' using errcode = '23514'; end if;
  if not public.is_school_admin(ex.school_id) then
    if not public.is_assigned_teacher(ex.school_id, ex.subject_id, ex.class_id) or not public.has_teacher_permission(ex.school_id, 'marks.enter') then raise exception 'not authorized' using errcode = '42501'; end if;
    select m.* into membership from public.memberships m where m.school_id = ex.school_id and m.user_id = auth.uid() and m.active;
    select coalesce(ex.editing_deadline, (select mw.closes_at from public.mark_windows mw where mw.school_id=ex.school_id)) into deadline;
    if deadline is not null and deadline <= now() and not public.has_teacher_permission(ex.school_id, 'marks.after_deadline') then raise exception 'mark entry deadline passed' using errcode = '42501'; end if;
  end if;
  if tg_op = 'INSERT' then
    new.entered_by := auth.uid();
  else
    -- The person who entered the mark is part of the mark's identity. A later
    -- score or remarks correction must not take their name, and must not fill in
    -- an attribution that was never recorded.
    new.entered_by := old.entered_by;
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

-- Reject a client that tries to rewrite attribution outright, rather than
-- letting the UPDATE branch silently discard the attempt.
create or replace function public.enforce_mark_identity()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.id is distinct from old.id
    or new.school_id is distinct from old.school_id
    or new.exam_id is distinct from old.exam_id
    or new.student_id is distinct from old.student_id
    or new.entered_by is distinct from old.entered_by then
    raise exception 'mark identity is immutable' using errcode = '42501';
  end if;
  return new;
end;
$function$;

-- Trigger functions are never called by a client directly; keep them unexecutable
-- by API roles even though they are only reachable through their triggers.
revoke all on function public.enforce_mark_write() from public, anon, authenticated;
revoke all on function public.enforce_mark_identity() from public, anon, authenticated;

-- ── 2. Deletion cannot cascade history away ─────────────────────────────────
-- Each constraint is dropped and recreated under its existing name so the
-- resulting catalogue entry is explicit rather than defaulted.
alter table public.marks drop constraint marks_entered_by_fkey;
alter table public.marks add constraint marks_entered_by_fkey
  foreign key (entered_by) references auth.users(id) on delete restrict;

alter table public.marks drop constraint marks_school_id_fkey;
alter table public.marks add constraint marks_school_id_fkey
  foreign key (school_id) references public.schools(id) on delete restrict;

alter table public.marks drop constraint marks_exam_id_school_id_fkey;
alter table public.marks add constraint marks_exam_id_school_id_fkey
  foreign key (exam_id, school_id) references public.exams(id, school_id) on delete restrict;

alter table public.marks drop constraint marks_student_id_school_id_fkey;
alter table public.marks add constraint marks_student_id_school_id_fkey
  foreign key (student_id, school_id) references public.students(id, school_id) on delete restrict;

alter table public.mark_revisions drop constraint mark_revisions_actor_id_fkey;
alter table public.mark_revisions add constraint mark_revisions_actor_id_fkey
  foreign key (actor_id) references auth.users(id) on delete restrict;

alter table public.mark_revisions drop constraint mark_revisions_mark_id_fkey;
alter table public.mark_revisions add constraint mark_revisions_mark_id_fkey
  foreign key (mark_id) references public.marks(id) on delete restrict;

alter table public.mark_revisions drop constraint mark_revisions_school_id_fkey;
alter table public.mark_revisions add constraint mark_revisions_school_id_fkey
  foreign key (school_id) references public.schools(id) on delete restrict;

alter table public.write_receipts drop constraint write_receipts_user_id_fkey;
alter table public.write_receipts add constraint write_receipts_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete restrict;

alter table public.write_receipts drop constraint write_receipts_school_id_fkey;
alter table public.write_receipts add constraint write_receipts_school_id_fkey
  foreign key (school_id) references public.schools(id) on delete restrict;

-- ── 3. Row and statement delete guards ──────────────────────────────────────
-- DELETE is refused while these guards are enabled, including for roles that
-- bypass RLS. Learners are archived instead. This is not protection against a
-- table owner or superuser deliberately disabling/dropping triggers or tables.
create or replace function public.prevent_mark_row_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception 'MARK_DELETE_FORBIDDEN' using errcode = '42501';
end;
$function$;

revoke all on function public.prevent_mark_row_delete() from public, anon, authenticated;

drop trigger if exists prevent_mark_delete_before on public.marks;
create trigger prevent_mark_delete_before
  before delete on public.marks
  for each row execute function public.prevent_mark_row_delete();

-- BYPASSRLS does not bypass triggers: service_role must not erase accepted
-- receipts or revisions. INSERT remains available to the existing audit/RPC
-- paths, and receipt reconciliation remains a read operation.
create or replace function public.prevent_history_row_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception 'HISTORY_DELETE_FORBIDDEN' using errcode = '42501';
end;
$function$;

revoke all on function public.prevent_history_row_delete() from public, anon, authenticated;

drop trigger if exists prevent_mark_revisions_delete_before on public.mark_revisions;
create trigger prevent_mark_revisions_delete_before
  before delete on public.mark_revisions
  for each row execute function public.prevent_history_row_delete();

drop trigger if exists prevent_write_receipts_delete_before on public.write_receipts;
create trigger prevent_write_receipts_delete_before
  before delete on public.write_receipts
  for each row execute function public.prevent_history_row_delete();

-- TRUNCATE ignores RLS and row triggers, so it needs its own statement guard.
create or replace function public.prevent_protected_truncate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception 'TRUNCATE_FORBIDDEN' using errcode = '42501';
end;
$function$;

revoke all on function public.prevent_protected_truncate() from public, anon, authenticated;

drop trigger if exists prevent_marks_truncate_before on public.marks;
create trigger prevent_marks_truncate_before
  before truncate on public.marks
  for each statement execute function public.prevent_protected_truncate();

drop trigger if exists prevent_mark_revisions_truncate_before on public.mark_revisions;
create trigger prevent_mark_revisions_truncate_before
  before truncate on public.mark_revisions
  for each statement execute function public.prevent_protected_truncate();

drop trigger if exists prevent_write_receipts_truncate_before on public.write_receipts;
create trigger prevent_write_receipts_truncate_before
  before truncate on public.write_receipts
  for each statement execute function public.prevent_protected_truncate();

-- The administrator DELETE policy is retired: there is no approved delete path.
drop policy if exists "marks admin delete" on public.marks;

-- ── 4. Table and column privileges ──────────────────────────────────────────
-- The tables previously carried the full default grant (arwdDxtm) for
-- `authenticated`, and no column ACLs at all, so every column was writable. The
-- reset below removes the table-level grant and re-grants exactly two things:
-- read access, and the right to change a mark's remarks.
revoke all on table public.marks from public, anon, authenticated;
revoke all on table public.mark_revisions from public, anon, authenticated;
revoke all on table public.write_receipts from public, anon, authenticated;

grant select on table public.marks to authenticated;
grant update (remarks) on table public.marks to authenticated;
grant select on table public.mark_revisions to authenticated;
grant select on table public.write_receipts to authenticated;

-- `service_role` keeps its existing table grants. The DELETE/TRUNCATE triggers
-- still enforce retention even though this role bypasses RLS.

-- ── 5. Default privileges for future functions ──────────────────────────────
-- PostgreSQL grants EXECUTE on a new function to PUBLIC. A schema-specific
-- REVOKE cannot remove that built-in default, so the global default is changed
-- for the role that creates these functions.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres revoke execute on functions from anon;
alter default privileges for role postgres revoke execute on functions from authenticated;

-- Existing per-schema grants are additive to global defaults. Remove those
-- grants too; the global revocations alone cannot undo them. This changes only
-- defaults for future postgres-created functions, not existing function ACLs
-- or their explicit application RPC grants. Future API functions need an
-- explicit EXECUTE grant for their intended callers.
alter default privileges for role postgres in schema public, storage
  revoke execute on functions from public, anon, authenticated;

-- NOTE: `supabase_admin` creates its own objects with its own defaults, which
-- this migration cannot change (it is not a member of that role). That remains
-- Stage 0A and stays blocked.

-- ── 6. Assertions ───────────────────────────────────────────────────────────
-- Effective privileges and structure, not the presence of the statements above.
do $$
declare problems text[] := '{}';
begin
  -- Client read access that must survive.
  if not has_table_privilege('authenticated', 'public.marks', 'SELECT') then
    problems := array_append(problems, 'authenticated lost SELECT on marks');
  end if;
  if not has_table_privilege('authenticated', 'public.mark_revisions', 'SELECT') then
    problems := array_append(problems, 'authenticated lost SELECT on mark_revisions');
  end if;
  if not has_table_privilege('authenticated', 'public.write_receipts', 'SELECT') then
    problems := array_append(problems, 'authenticated lost SELECT on write_receipts');
  end if;

  -- The one approved write: remarks, through the column grant.
  if not has_column_privilege('authenticated', 'public.marks', 'remarks', 'UPDATE') then
    problems := array_append(problems, 'authenticated lost the remarks update path');
  end if;

  -- Everything else on marks must be gone, at table and column level.
  if has_table_privilege('authenticated', 'public.marks', 'INSERT') then
    problems := array_append(problems, 'authenticated can still INSERT marks');
  end if;
  if has_table_privilege('authenticated', 'public.marks', 'UPDATE') then
    problems := array_append(problems, 'authenticated still holds table-level UPDATE on marks');
  end if;
  if has_table_privilege('authenticated', 'public.marks', 'DELETE') then
    problems := array_append(problems, 'authenticated can still DELETE marks');
  end if;
  if has_table_privilege('authenticated', 'public.marks', 'TRUNCATE') then
    problems := array_append(problems, 'authenticated can still TRUNCATE marks');
  end if;
  if has_table_privilege('authenticated', 'public.marks', 'REFERENCES') then
    problems := array_append(problems, 'authenticated can still add REFERENCES to marks');
  end if;
  if has_table_privilege('authenticated', 'public.marks', 'TRIGGER') then
    problems := array_append(problems, 'authenticated can still create TRIGGERs on marks');
  end if;
  if has_column_privilege('authenticated', 'public.marks', 'score', 'UPDATE') then
    problems := array_append(problems, 'authenticated can still UPDATE marks.score');
  end if;
  if has_column_privilege('authenticated', 'public.marks', 'score_code', 'UPDATE') then
    problems := array_append(problems, 'authenticated can still UPDATE marks.score_code');
  end if;
  if has_column_privilege('authenticated', 'public.marks', 'entered_by', 'UPDATE') then
    problems := array_append(problems, 'authenticated can still UPDATE marks.entered_by');
  end if;
  if has_column_privilege('authenticated', 'public.marks', 'exam_id', 'UPDATE')
     or has_column_privilege('authenticated', 'public.marks', 'student_id', 'UPDATE')
     or has_column_privilege('authenticated', 'public.marks', 'school_id', 'UPDATE') then
    problems := array_append(problems, 'authenticated can still rewrite mark identity columns');
  end if;
  if has_column_privilege('authenticated', 'public.marks', 'remarks', 'INSERT') then
    problems := array_append(problems, 'authenticated can still INSERT marks.remarks');
  end if;

  -- Revisions and receipts are read-only to clients.
  if has_table_privilege('authenticated', 'public.mark_revisions', 'INSERT')
     or has_table_privilege('authenticated', 'public.mark_revisions', 'UPDATE')
     or has_table_privilege('authenticated', 'public.mark_revisions', 'DELETE')
     or has_table_privilege('authenticated', 'public.mark_revisions', 'TRUNCATE') then
    problems := array_append(problems, 'authenticated can still write mark_revisions');
  end if;
  if has_table_privilege('authenticated', 'public.write_receipts', 'INSERT')
     or has_table_privilege('authenticated', 'public.write_receipts', 'UPDATE')
     or has_table_privilege('authenticated', 'public.write_receipts', 'DELETE')
     or has_table_privilege('authenticated', 'public.write_receipts', 'TRUNCATE') then
    problems := array_append(problems, 'authenticated can still write write_receipts');
  end if;

  -- The anonymous role gets nothing at all from these tables.
  if has_table_privilege('anon', 'public.marks', 'SELECT')
     or has_table_privilege('anon', 'public.marks', 'INSERT')
     or has_table_privilege('anon', 'public.marks', 'UPDATE')
     or has_table_privilege('anon', 'public.marks', 'DELETE') then
    problems := array_append(problems, 'anon still reaches marks');
  end if;
  if has_table_privilege('anon', 'public.mark_revisions', 'SELECT')
     or has_table_privilege('anon', 'public.write_receipts', 'SELECT') then
    problems := array_append(problems, 'anon still reads revision or receipt history');
  end if;

  -- Nine relationships, all restrictive and all validated.
  if (select count(*) from pg_constraint
       where conname in (
         'marks_entered_by_fkey', 'marks_school_id_fkey', 'marks_exam_id_school_id_fkey',
         'marks_student_id_school_id_fkey', 'mark_revisions_actor_id_fkey',
         'mark_revisions_mark_id_fkey', 'mark_revisions_school_id_fkey',
         'write_receipts_user_id_fkey', 'write_receipts_school_id_fkey')
         and confdeltype = 'r' and convalidated) <> 9 then
    problems := array_append(problems, 'a protected relationship is not ON DELETE RESTRICT and validated');
  end if;

  -- Guards exist, are enabled, and point at the guard functions.
  if (select count(*) from pg_trigger
       where tgname in ('prevent_mark_delete_before', 'prevent_marks_truncate_before',
                        'prevent_mark_revisions_truncate_before', 'prevent_write_receipts_truncate_before',
                        'prevent_mark_revisions_delete_before', 'prevent_write_receipts_delete_before')
         and tgenabled = 'O' and not tgisinternal) <> 6 then
    problems := array_append(problems, 'a delete or truncate guard is missing or disabled');
  end if;

  -- Check the new guards' target tables, event, timing and function as well as
  -- their names. A row-level BEFORE DELETE trigger has tgtype = 1 + 2 + 8.
  if exists (
    select 1 from (values
      ('public.mark_revisions'::regclass, 'prevent_mark_revisions_delete_before'),
      ('public.write_receipts'::regclass, 'prevent_write_receipts_delete_before')
    ) expected(relation_id, trigger_name)
    where not exists (
      select 1 from pg_trigger t
      where t.tgrelid = expected.relation_id and t.tgname = expected.trigger_name
        and t.tgfoid = 'public.prevent_history_row_delete()'::regprocedure
        and t.tgtype = 11 and t.tgenabled = 'O' and not t.tgisinternal
    )
  ) then
    problems := array_append(problems, 'a history row DELETE guard is incorrectly attached');
  end if;

  -- The retired delete policy must be gone.
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'marks' and cmd = 'DELETE') then
    problems := array_append(problems, 'a mark delete policy still exists');
  end if;

  -- The attribution logic itself: no coalesce, no attribution of the corrector.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'enforce_mark_write'
      and p.prosrc ilike '%new.entered_by := old.entered_by%'
      and p.prosrc not ilike '%coalesce(old.entered_by%'
  ) then
    problems := array_append(problems, 'enforce_mark_write does not preserve old.entered_by');
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'enforce_mark_identity'
      and p.prosrc ilike '%new.entered_by is distinct from old.entered_by%'
  ) then
    problems := array_append(problems, 'enforce_mark_identity does not reject attribution changes');
  end if;

  -- The audit path must still attribute to the acting user.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'audit_mark_write'
      and p.prosrc ilike '%auth.uid()%'
  ) then
    problems := array_append(problems, 'audit_mark_write no longer records the acting user');
  end if;

  -- No EXECUTE for PUBLIC, anon or authenticated on future postgres functions.
  if exists (
    select 1 from pg_default_acl d
    cross join lateral aclexplode(d.defaclacl) a
    where d.defaclrole = 'postgres'::regrole
      and d.defaclobjtype = 'f'
      and a.privilege_type = 'EXECUTE'
      and (a.grantee = 0
           or a.grantee = 'anon'::regrole
           or a.grantee = 'authenticated'::regrole)
  ) then
    problems := array_append(problems, 'future postgres functions still default to PUBLIC/anon/authenticated EXECUTE');
  end if;

  if cardinality(problems) > 0 then
    raise exception 'Stage 4 database assertions failed: %', array_to_string(problems, '; ');
  end if;
end;
$$;
