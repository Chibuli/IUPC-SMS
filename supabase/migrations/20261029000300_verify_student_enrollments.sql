-- Return complete enrollment scope only when the authenticated caller is
-- authorized for the student and every enrollment/assessment subject in scope.
-- A teacher missing any assignment receives an explicit `unknown` row, never a
-- partial subject list. This function does not change RLS or enrollment data.
create or replace function public.verify_student_enrollments(
  target_school uuid,
  target_term uuid,
  target_students uuid[]
)
returns table(student_id uuid, certainty text, subject_ids uuid[])
language plpgsql stable security definer set search_path = '' as $$
declare
  student_row public.students%rowtype;
  authorized_scope boolean;
  has_assessment boolean;
  enrollment_ids uuid[];
begin
  if auth.uid() is null or target_school is null or target_term is null
    or target_students is null or cardinality(target_students) > 500 then
    raise exception 'invalid enrollment verification request' using errcode='22023';
  end if;
  if not public.is_school_member(target_school) then
    raise exception 'not authorized' using errcode='42501';
  end if;
  if not exists (select 1 from public.terms t where t.id=target_term and t.school_id=target_school) then
    raise exception 'assessment not found' using errcode='42501';
  end if;

  for student_row in
    select s.* from public.students s
    where s.id = any(target_students) and s.school_id=target_school and not s.archived
      and (public.is_school_admin(target_school) or public.is_assigned_teacher(target_school,null,s.class_id))
    order by s.id
  loop
    select coalesce(array_agg(ss.subject_id order by ss.subject_id), '{}'::uuid[])
      into enrollment_ids
      from public.student_subjects ss
      where ss.student_id=student_row.id and ss.school_id=target_school;

    select exists (
      select 1 from public.exams e
      where e.school_id=target_school and e.term_id=target_term and e.class_id=student_row.class_id
    ) into has_assessment;

    authorized_scope := public.is_school_admin(target_school);
    if not authorized_scope then
      authorized_scope := has_assessment
        and exists (
          select 1 from public.exams e
          where e.school_id=target_school and e.term_id=target_term and e.class_id=student_row.class_id
            and public.is_assigned_teacher(target_school,e.subject_id,student_row.class_id)
        )
        and not exists (
          select 1 from public.exams e
          where e.school_id=target_school and e.term_id=target_term and e.class_id=student_row.class_id
            and not public.is_assigned_teacher(target_school,e.subject_id,student_row.class_id)
        )
        and not exists (
          select 1 from public.student_subjects ss
          where ss.student_id=student_row.id and ss.school_id=target_school
            and not public.is_assigned_teacher(target_school,ss.subject_id,student_row.class_id)
        );
    end if;

    if authorized_scope then
      if cardinality(enrollment_ids) > 0 then
        student_id := student_row.id;
        certainty := 'verified_enrolled';
        subject_ids := enrollment_ids;
      else
        student_id := student_row.id;
        certainty := 'verified_no_enrollments';
        subject_ids := '{}'::uuid[];
      end if;
    else
      student_id := student_row.id;
      certainty := 'unknown';
      subject_ids := null;
    end if;
    return next;
  end loop;
end;
$$;

revoke all on function public.verify_student_enrollments(uuid,uuid,uuid[]) from public, anon, authenticated;
grant execute on function public.verify_student_enrollments(uuid,uuid,uuid[]) to authenticated;
