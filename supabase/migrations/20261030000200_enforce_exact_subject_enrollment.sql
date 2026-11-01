-- Every mark must correspond to the student's current authoritative enrollment
-- in the exact subject of the paper. SECURITY DEFINER is needed to make this
-- check independent of the caller's row visibility under student_subjects RLS;
-- no enrollment information is returned to the caller.
create or replace function public.enforce_mark_subject_enrollment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  required_subject uuid;
begin
  select e.subject_id into required_subject
    from public.exams e
    where e.id = new.exam_id and e.school_id = new.school_id;

  if required_subject is null then
    raise exception 'record not found' using errcode = '42501';
  end if;

  -- Hold a key-share lock until the mark transaction ends. Concurrent removal
  -- or reassignment of this enrollment must serialize with this mark write.
  perform 1
    from public.student_subjects ss
    where ss.school_id = new.school_id
      and ss.student_id = new.student_id
      and ss.subject_id = required_subject
    for key share;

  if not found then
    raise exception 'student is not enrolled in this examination subject'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_mark_subject_enrollment() from public, anon, authenticated;

-- The zz_ prefix orders this after the existing permission/class/identity and
-- archived-student guards, avoiding an enrollment oracle before authorization.
create trigger zz_enforce_mark_subject_enrollment_before
  before insert or update on public.marks
  for each row execute function public.enforce_mark_subject_enrollment();
