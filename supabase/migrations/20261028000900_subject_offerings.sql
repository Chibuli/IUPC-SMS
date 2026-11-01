-- Shared catalogue rows are immutable reference data. A school that offers a
-- catalogue subject gets a tenant-scoped copy for assignments and exam rows.
create or replace function public.set_subject_offered(target_school uuid, target_subject uuid, is_offered boolean)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare subject_row public.subjects%rowtype; school_subject_id uuid;
begin
  if coalesce(auth.role(),'')<>'authenticated' or target_school is null or not public.is_school_admin(target_school) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into subject_row from public.subjects s
   where s.id=target_subject and (s.school_id=target_school or s.school_id is null);
  if not found then
    select * into subject_row from public.subjects s
     where s.school_id=target_school and s.code=(select shared.code from public.subjects shared where shared.id=target_subject and shared.school_id is null);
  end if;
  if not found then raise exception 'subject not found' using errcode = 'P0002'; end if;
  if subject_row.school_id=target_school then
    update public.subjects set offered=is_offered where id=subject_row.id and school_id=target_school returning id into school_subject_id;
    return school_subject_id;
  end if;
  if not is_offered then return target_subject; end if;
  insert into public.subjects(school_id,name,code,category,level,offered)
  values(target_school,subject_row.name,subject_row.code,subject_row.category,subject_row.level,true)
  on conflict(school_id,code) do update set offered=true returning id into school_subject_id;
  return school_subject_id;
end;
$$;
revoke all on function public.set_subject_offered(uuid,uuid,boolean) from public,anon;
grant execute on function public.set_subject_offered(uuid,uuid,boolean) to authenticated;

-- Safe for previously initialized schools: only create copies for syllabus
-- rows referenced by their existing assignments, exams or timetable.
insert into public.subjects(school_id,name,code,category,level,offered)
select distinct school_id,name,code,category,level,true
from (
  select ts.school_id, s.name, s.code, s.category, s.level from public.teacher_subjects ts join public.subjects s on s.id=ts.subject_id where s.school_id is null
  union all
  select e.school_id, s.name, s.code, s.category, s.level from public.exams e join public.subjects s on s.id=e.subject_id where s.school_id is null
  union all
  select slot.school_id, s.name, s.code, s.category, s.level from public.timetable_slots slot join public.subjects s on s.id=slot.subject_id where s.school_id is null
) used
on conflict(school_id,code) do nothing;
