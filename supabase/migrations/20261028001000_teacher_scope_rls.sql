-- Narrow school-member reads to classes and academic assignments the teacher
-- actually holds. SECURITY DEFINER authorization helpers inspect assignment
-- tables without exposing their complete contents through their RLS policies.
drop policy if exists "classes member read" on public.classes;
create policy "classes assigned read" on public.classes for select to authenticated
  using (public.is_school_admin(school_id) or public.is_assigned_teacher(school_id,null,id));

-- Staff contact details are not campus-wide directory data. Teachers can see
-- only their own staff row; administrators retain the full staff register.
drop policy if exists "teachers member read" on public.teachers;
create policy "teachers self or admin read" on public.teachers for select to authenticated
  using (public.is_school_admin(school_id) or id=(select m.teacher_id from public.memberships m
    where m.school_id=teachers.school_id and m.user_id=(select auth.uid()) and m.active));

drop policy if exists "teacher permissions member read" on public.teacher_permissions;
create policy "teacher permissions own read" on public.teacher_permissions for select to authenticated
  using (public.is_school_admin((select t.school_id from public.teachers t where t.id=teacher_id))
    or teacher_id=(select m.teacher_id from public.memberships m
      where m.school_id=(select t.school_id from public.teachers t where t.id=teacher_id)
        and m.user_id=(select auth.uid()) and m.active));

drop policy if exists "teacher subjects member read" on public.teacher_subjects;
create policy "teacher subjects assigned read" on public.teacher_subjects for select to authenticated
  using (public.is_school_admin(school_id) or public.is_assigned_teacher(school_id,subject_id,null));

drop policy if exists "teacher classes member read" on public.teacher_classes;
create policy "teacher classes assigned read" on public.teacher_classes for select to authenticated
  using (public.is_school_admin(school_id) or public.is_assigned_teacher(school_id,null,class_id));

drop policy if exists "subjects admin write" on public.subjects;
create policy "subjects admin write" on public.subjects for all to authenticated
  using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));
-- Shared catalogue rows are non-school reference data. School-owned offerings
-- are visible only to administrators and staff assigned to that subject.
drop policy if exists "subjects member read" on public.subjects;
create policy "subjects assigned read" on public.subjects for select to authenticated
  using (school_id is null or public.is_school_admin(school_id)
    or public.is_assigned_teacher(school_id,id,null));

drop policy if exists "student subjects member read" on public.student_subjects;
create policy "student subjects assigned read" on public.student_subjects for select to authenticated
  using (public.is_school_admin(school_id) or exists (
    select 1 from public.students s where s.id=student_id and s.school_id=student_subjects.school_id
      and public.is_assigned_teacher(s.school_id,student_subjects.subject_id,s.class_id)
  ));

drop policy if exists "timetable member read" on public.timetable_slots;
create policy "timetable assigned read" on public.timetable_slots for select to authenticated
  using (public.is_school_admin(school_id) or public.is_assigned_teacher(school_id,subject_id,class_id));

-- Marks and students already have separate tenant constraints; add the class
-- relationship explicitly so a teacher cannot submit a mark for a learner in
-- another class of the same school through the direct REST table endpoint.
create or replace function public.enforce_mark_student_class()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.exams e join public.students s on s.id=new.student_id and s.school_id=new.school_id
    where e.id=new.exam_id and e.school_id=new.school_id and e.class_id=s.class_id
  ) then
    raise exception 'record not found' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_mark_student_class() from public,anon,authenticated;
create trigger enforce_mark_student_class_before
  before insert or update on public.marks for each row execute function public.enforce_mark_student_class();
