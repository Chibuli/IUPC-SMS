-- Additive student archival lifecycle. Existing Active/Alumni values and all
-- student-linked academic rows remain untouched by this migration.
alter table public.students
  add column archived boolean not null default false,
  add column archived_at timestamptz,
  add column archived_by uuid references auth.users(id) on delete set null,
  add constraint students_archive_timestamp_consistent
    check (archived = (archived_at is not null));

create table public.student_lifecycle_events (
  id bigint generated always as identity primary key,
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null,
  actor_id uuid references auth.users(id) on delete set null,
  event text not null check (event in ('archived','reactivated')),
  created_at timestamptz not null default now(),
  foreign key (student_id, school_id) references public.students(id, school_id) on delete restrict
);

alter table public.student_lifecycle_events enable row level security;
grant select on public.student_lifecycle_events to authenticated;
create policy "student lifecycle events admin read"
  on public.student_lifecycle_events for select to authenticated
  using (public.is_school_admin(school_id));
revoke insert,update,delete on public.student_lifecycle_events from authenticated;

-- Lifecycle fields are changed only inside the administrator RPCs. Preserve
-- the existing editable student fields used by update_student().
revoke insert on public.students from authenticated;
grant insert (
  school_id, admission_number, full_name, gender, date_of_birth, class_id,
  guardian_name, guardian_phone, status
) on public.students to authenticated;
revoke update on public.students from authenticated;
grant update (
  admission_number, full_name, gender, date_of_birth, class_id,
  guardian_name, guardian_phone, status
) on public.students to authenticated;
revoke delete on public.students from authenticated;

create or replace function public.archive_student(target_student uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare student_row public.students%rowtype;
begin
  if auth.uid() is null then raise exception 'not authorized' using errcode='42501'; end if;
  select * into student_row from public.students s where s.id=target_student for update;
  if not found or not public.is_school_admin(student_row.school_id) then
    raise exception 'record not found' using errcode='42501';
  end if;
  if student_row.archived then return false; end if;

  perform set_config('iupc.student_lifecycle_transition', 'archive', true);
  update public.students
    set archived=true, archived_at=clock_timestamp(), archived_by=auth.uid()
    where id=target_student;
  insert into public.student_lifecycle_events(school_id,student_id,actor_id,event)
    values(student_row.school_id,target_student,auth.uid(),'archived');
  return true;
end;
$$;
revoke all on function public.archive_student(uuid) from public,anon;
grant execute on function public.archive_student(uuid) to authenticated;

create or replace function public.reactivate_student(target_student uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare student_row public.students%rowtype;
begin
  if auth.uid() is null then raise exception 'not authorized' using errcode='42501'; end if;
  select * into student_row from public.students s where s.id=target_student for update;
  if not found or not public.is_school_admin(student_row.school_id) then
    raise exception 'record not found' using errcode='42501';
  end if;
  if not student_row.archived then return false; end if;

  perform set_config('iupc.student_lifecycle_transition', 'reactivate', true);
  update public.students
    set archived=false, archived_at=null, archived_by=null
    where id=target_student;
  insert into public.student_lifecycle_events(school_id,student_id,actor_id,event)
    values(student_row.school_id,target_student,auth.uid(),'reactivated');
  return true;
end;
$$;
revoke all on function public.reactivate_student(uuid) from public,anon;
grant execute on function public.reactivate_student(uuid) to authenticated;

-- Prevent bypassing the lifecycle through REST/table DELETE or FK cascades.
create or replace function public.reject_student_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'students cannot be deleted; archive the student instead' using errcode='42501';
end;
$$;
revoke all on function public.reject_student_delete() from public,anon,authenticated;
create trigger reject_student_delete_before
  before delete on public.students for each row execute function public.reject_student_delete();

-- Serialize mark writes against archiving on the student row. If a mark write
-- acquires the lock first it commits before archival; if archival commits first,
-- the mark write observes archived=true and is rejected.
create or replace function public.guard_archived_student_mark_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare old_student uuid; new_student uuid; old_school uuid; new_school uuid;
begin
  if tg_op<>'INSERT' then old_student:=old.student_id; old_school:=old.school_id; end if;
  if tg_op<>'DELETE' then new_student:=new.student_id; new_school:=new.school_id; end if;
  -- Check both identities on UPDATE in a stable school/student order, so a
  -- mark cannot be moved out of archived history or across tenant boundaries.
  perform s.id from public.students s
    where (s.school_id,s.id) in ((old_school,old_student),(new_school,new_student))
    order by s.school_id,s.id for update;
  if not exists (
    select 1 from public.students s
    where (s.school_id,s.id) in ((old_school,old_student),(new_school,new_student))
  ) then raise exception 'record not found' using errcode='42501'; end if;
  if exists (
    select 1 from public.students s
    where (s.school_id,s.id) in ((old_school,old_student),(new_school,new_student)) and s.archived
  ) then raise exception 'archived students cannot receive mark changes' using errcode='42501'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.guard_archived_student_mark_write() from public,anon,authenticated;
create trigger guard_archived_student_mark_write_before
  before insert or update or delete on public.marks for each row
  execute function public.guard_archived_student_mark_write();

-- Do not permit new notes for archived students. Existing notes remain intact
-- and visible to administrators through the RLS policies below.
create or replace function public.guard_archived_student_note_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare is_archived boolean;
begin
  select s.archived into is_archived
    from public.students s
    where s.id=new.student_id and s.school_id=new.school_id
    for update;
  if not found then raise exception 'record not found' using errcode='42501'; end if;
  if is_archived then raise exception 'archived students cannot receive new notes' using errcode='42501'; end if;
  return new;
end;
$$;
revoke all on function public.guard_archived_student_note_insert() from public,anon,authenticated;
create trigger guard_archived_student_note_insert_before
  before insert on public.student_notes for each row
  execute function public.guard_archived_student_note_insert();

create or replace function public.guard_archived_student_note_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
declare is_archived boolean;
begin
  select s.archived into is_archived from public.students s
    where s.id=old.student_id and s.school_id=old.school_id
    for update;
  if found and is_archived then
    raise exception 'archived student history is retained' using errcode='42501';
  end if;
  return old;
end;
$$;
revoke all on function public.guard_archived_student_note_delete() from public,anon,authenticated;
create trigger guard_archived_student_note_delete_before
  before delete on public.student_notes for each row
  execute function public.guard_archived_student_note_delete();

-- Keep historical enrollments and report-card records immutable while archived;
-- administrators retain read access and can reactivate before making changes.
create or replace function public.guard_archived_student_history_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare old_student uuid; new_student uuid; old_school uuid; new_school uuid;
begin
  if tg_op<>'INSERT' then old_student:=old.student_id; old_school:=old.school_id; end if;
  if tg_op<>'DELETE' then new_student:=new.student_id; new_school:=new.school_id; end if;
  -- Lock all affected student rows in a stable school/student order so
  -- archiving cannot race history mutations or permit a cross-school move.
  perform s.id from public.students s
    where (s.school_id,s.id) in ((old_school,old_student),(new_school,new_student))
    order by s.school_id,s.id for update;
  if exists (
    select 1 from public.students s
    where (s.school_id,s.id) in ((old_school,old_student),(new_school,new_student)) and s.archived
  ) then
    raise exception 'archived student history is read-only; reactivate before changing it' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.guard_archived_student_history_write() from public,anon,authenticated;
create trigger guard_archived_student_subject_write_before
  before insert or update or delete on public.student_subjects for each row
  execute function public.guard_archived_student_history_write();
create trigger guard_archived_student_report_card_write_before
  before insert or update or delete on public.report_cards for each row
  execute function public.guard_archived_student_history_write();

-- Block ordinary profile edits after archival; reactivation remains an explicit
-- RPC transition and does not change the student's Active/Alumni status.
create or replace function public.guard_archived_student_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare transition text;
begin
  transition:=current_setting('iupc.student_lifecycle_transition',true);
  if old.archived and auth.uid() is not null then
    if transition='reactivate' and new.archived=false and public.is_school_admin(old.school_id) then
      return new;
    end if;
    raise exception 'use the authorized student lifecycle operation' using errcode='42501';
  end if;
  if old.archived is distinct from new.archived then
    if transition='archive' and new.archived=true and public.is_school_admin(old.school_id) then
      return new;
    end if;
    raise exception 'use the authorized student lifecycle operation' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_archived_student_update() from public,anon,authenticated;
create trigger guard_archived_student_update_before
  before update on public.students for each row
  execute function public.guard_archived_student_update();

-- Archived student identities and their attached academic data are visible only
-- to same-school administrators; former class/subject assignments do not grant
-- teachers an exception.
drop policy if exists "students assigned read" on public.students;
create policy "students assigned read" on public.students for select to authenticated
  using (public.is_school_admin(school_id) or
    (not archived and public.is_school_member(school_id) and public.is_assigned_teacher(school_id,null,class_id)));

drop policy if exists "student subjects member read" on public.student_subjects;
drop policy if exists "student subjects assigned read" on public.student_subjects;
create policy "student subjects assigned read" on public.student_subjects for select to authenticated
  using (public.is_school_admin(school_id) or exists (
    select 1 from public.students s where s.id=student_id and s.school_id=student_subjects.school_id
      and not s.archived and public.is_assigned_teacher(s.school_id,student_subjects.subject_id,s.class_id)
  ));

drop policy if exists "marks assigned read" on public.marks;
create policy "marks assigned read" on public.marks for select to authenticated
  using (public.is_school_admin(school_id) or (public.is_school_member(school_id) and exists (
    select 1 from public.exams e join public.students s on s.id=marks.student_id and s.school_id=marks.school_id
    where e.id=marks.exam_id and e.school_id=marks.school_id and not s.archived
      and public.is_assigned_teacher(e.school_id,e.subject_id,e.class_id)
  )));

drop policy if exists "marks scoped write" on public.marks;
create policy "marks scoped write" on public.marks for insert to authenticated
  with check (public.is_school_member(marks.school_id) and exists (
    select 1 from public.students s join public.exams e on e.id=marks.exam_id and e.school_id=marks.school_id
    where s.id=marks.student_id and s.school_id=marks.school_id and not s.archived
      and (public.is_school_admin(marks.school_id) or
        (e.status='open' and public.is_assigned_teacher(e.school_id,e.subject_id,e.class_id) and public.has_teacher_permission(e.school_id,'marks.enter')))
  ));

drop policy if exists "marks scoped update" on public.marks;
drop policy if exists "marks admin delete" on public.marks;
create policy "marks admin delete" on public.marks for delete to authenticated
  using (public.is_school_admin(marks.school_id) and exists (
    select 1 from public.students s where s.id=marks.student_id and s.school_id=marks.school_id and not s.archived
  ));

create policy "marks scoped update" on public.marks for update to authenticated
  using (public.is_school_member(marks.school_id) and exists (
    select 1 from public.students s join public.exams e on e.id=marks.exam_id and e.school_id=marks.school_id
    where s.id=marks.student_id and s.school_id=marks.school_id and not s.archived
      and (public.is_school_admin(marks.school_id) or
        (e.status='open' and public.is_assigned_teacher(e.school_id,e.subject_id,e.class_id) and public.has_teacher_permission(e.school_id,'marks.enter')))
  ))
  with check (public.is_school_member(marks.school_id) and exists (
    select 1 from public.students s join public.exams e on e.id=marks.exam_id and e.school_id=marks.school_id
    where s.id=marks.student_id and s.school_id=marks.school_id and not s.archived
      and (public.is_school_admin(marks.school_id) or
        (e.status='open' and public.is_assigned_teacher(e.school_id,e.subject_id,e.class_id) and public.has_teacher_permission(e.school_id,'marks.enter')))
  ));

drop policy if exists "report cards assigned read" on public.report_cards;
drop policy if exists "report cards admin write" on public.report_cards;
create policy "report cards admin write" on public.report_cards for all to authenticated
  using (public.is_school_admin(school_id) and exists (
    select 1 from public.students s where s.id=report_cards.student_id and s.school_id=report_cards.school_id and not s.archived
  ))
  with check (public.is_school_admin(school_id) and exists (
    select 1 from public.students s where s.id=report_cards.student_id and s.school_id=report_cards.school_id and not s.archived
  ));

create policy "report cards assigned read" on public.report_cards for select to authenticated
  using (public.is_school_admin(school_id) or (public.is_school_member(school_id) and exists (
    select 1 from public.students s where s.id=report_cards.student_id and s.school_id=report_cards.school_id
      and not s.archived and public.is_assigned_teacher(s.school_id,null,s.class_id)
  )));

drop policy if exists "notes member class read" on public.student_notes;
create policy "notes member class read" on public.student_notes for select to authenticated
  using (public.is_school_admin(school_id) or (public.is_school_member(school_id) and exists (
    select 1 from public.students s where s.id=student_notes.student_id and s.school_id=student_notes.school_id
      and not s.archived and public.is_assigned_teacher(s.school_id,null,s.class_id)
  )));

drop policy if exists "notes teacher insert" on public.student_notes;
create policy "notes teacher insert" on public.student_notes for insert to authenticated
  with check (author_id=auth.uid() and public.is_school_member(school_id) and exists (
    select 1 from public.students s where s.id=student_notes.student_id and s.school_id=student_notes.school_id
      and not s.archived and (public.is_school_admin(s.school_id) or public.is_assigned_teacher(s.school_id,null,s.class_id))
  ));
