-- Keep the existing RPC signatures and product semantics. The row locks and
-- state checks serialize transitions; same-state retries return false and do
-- not create another audit event.
create or replace function public.archive_student(target_student uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  student_row public.students%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into student_row
  from public.students s
  where s.id = target_student
  for update;

  if not found or not public.is_school_admin(student_row.school_id) then
    raise exception 'record not found' using errcode = '42501';
  end if;
  if student_row.archived then
    return false;
  end if;

  perform set_config('iupc.student_lifecycle_transition', 'archive', true);
  update public.students
    set archived = true,
        archived_at = clock_timestamp(),
        archived_by = auth.uid()
    where id = target_student and school_id = student_row.school_id;
  if not found then
    raise exception 'student lifecycle update failed' using errcode = 'P0002';
  end if;

  insert into public.student_lifecycle_events(school_id, student_id, actor_id, event)
    values (student_row.school_id, target_student, auth.uid(), 'archived');
  return true;
end;
$$;
revoke all on function public.archive_student(uuid) from public, anon;
grant execute on function public.archive_student(uuid) to authenticated;

create or replace function public.reactivate_student(target_student uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  student_row public.students%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into student_row
  from public.students s
  where s.id = target_student
  for update;

  if not found or not public.is_school_admin(student_row.school_id) then
    raise exception 'record not found' using errcode = '42501';
  end if;
  if not student_row.archived then
    return false;
  end if;

  perform set_config('iupc.student_lifecycle_transition', 'reactivate', true);
  update public.students
    set archived = false,
        archived_at = null,
        archived_by = null
    where id = target_student and school_id = student_row.school_id;
  if not found then
    raise exception 'student lifecycle update failed' using errcode = 'P0002';
  end if;

  insert into public.student_lifecycle_events(school_id, student_id, actor_id, event)
    values (student_row.school_id, target_student, auth.uid(), 'reactivated');
  return true;
end;
$$;
revoke all on function public.reactivate_student(uuid) from public, anon;
grant execute on function public.reactivate_student(uuid) to authenticated;

-- The custom GUC is intent metadata only, never authority. The row update must
-- execute under the owner context of the matching SECURITY DEFINER RPC, and
-- still pass the active-admin membership check for this student's school.
-- SECURITY INVOKER is deliberate: current_user remains the definer RPC's owner
-- when called by that RPC, but remains 'authenticated' for a direct REST write.
create or replace function public.guard_archived_student_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  transition text;
  lifecycle_changed boolean;
  authorized_transition boolean := false;
begin
  transition := current_setting('iupc.student_lifecycle_transition', true);
  lifecycle_changed := old.archived is distinct from new.archived
    or old.archived_at is distinct from new.archived_at
    or old.archived_by is distinct from new.archived_by;

  if lifecycle_changed then
    if transition = 'archive'
       and not old.archived
       and new.archived
       and new.archived_at is not null
       and new.archived_by = auth.uid()
       and current_user = pg_get_userbyid((
         select p.proowner from pg_catalog.pg_proc p
         where p.oid = 'public.archive_student(uuid)'::pg_catalog.regprocedure
       ))
       and public.is_school_admin(old.school_id) then
      authorized_transition := true;
    elsif transition = 'reactivate'
       and old.archived
       and not new.archived
       and new.archived_at is null
       and new.archived_by is null
       and current_user = pg_get_userbyid((
         select p.proowner from pg_catalog.pg_proc p
         where p.oid = 'public.reactivate_student(uuid)'::pg_catalog.regprocedure
       ))
       and public.is_school_admin(old.school_id) then
      authorized_transition := true;
    end if;

    if not authorized_transition then
      raise exception 'use the authorized student lifecycle operation' using errcode = '42501';
    end if;
    return new;
  end if;

  -- Preserve administrator-only handling of archived profiles. Alumni remains
  -- an independent status; this guard does not alter it.
  if old.archived and auth.uid() is not null then
    raise exception 'use the authorized student lifecycle operation' using errcode = '42501';
  end if;

  return new;
end;
$$;
revoke all on function public.guard_archived_student_update() from public, anon, authenticated;
