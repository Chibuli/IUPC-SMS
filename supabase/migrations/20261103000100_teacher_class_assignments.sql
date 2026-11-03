-- Teacher class assignments — stop unrelated staff edits from erasing them.
--
-- The previous `save_teacher` deleted every `teacher_classes` row and re-inserted
-- from the `classes` argument, so any caller that did not track class
-- assignments (the staff edit form always sent an empty array) silently wiped
-- them. Its subject and permission handling had the same shape: a caller that
-- omits the argument clears the stored load.
--
-- This replacement distinguishes the two intents explicitly:
--   * `classes IS NULL`      -> leave the stored class assignments untouched;
--   * `classes = '{}'`       -> deliberately clear every class assignment;
--   * `classes = '{...}'`    -> replace them with exactly this set.
-- `subjects` and `permissions` follow the same rule. The staff form always sends
-- the complete set it loaded, which also keeps it working against the currently
-- deployed function until this file is applied.
--
-- Everything is validated before the row or its relations are touched, and every
-- referenced class, subject and teacher must belong to `target_school`, which is
-- also the administrator scope check. A cross-school id is refused, not silently
-- dropped.
create or replace function public.save_teacher(target_teacher uuid, target_school uuid, teacher_data jsonb, subjects uuid[], classes uuid[], permissions text[])
returns uuid language plpgsql security invoker set search_path = '' as $$
declare teacher uuid;
begin
  if not public.is_school_admin(target_school) then raise exception 'not authorized' using errcode='42501'; end if;
  if teacher_data is null or jsonb_typeof(teacher_data)<>'object' then raise exception 'invalid teacher details' using errcode='22023'; end if;
  if exists(select 1 from unnest(coalesce(subjects,'{}'::uuid[])) requested(id)
    left join public.subjects s on s.id=requested.id and s.school_id=target_school and s.offered
    where s.id is null) then
    raise exception 'select an offered school subject' using errcode='23503';
  end if;
  if exists(select 1 from unnest(coalesce(classes,'{}'::uuid[])) requested(id)
    left join public.classes c on c.id=requested.id and c.school_id=target_school
    where c.id is null) then
    raise exception 'invalid teacher assignment' using errcode='23503';
  end if;
  if exists(select 1 from unnest(coalesce(permissions,'{}'::text[])) p where p not in ('marks.enter','marks.after_deadline','records.view_all_subjects')) then
    raise exception 'invalid permission' using errcode='22023';
  end if;

  if target_teacher is null then
    insert into public.teachers(school_id,full_name,email,employee_id,initials)
    values(target_school,trim(teacher_data->>'full_name'),lower(trim(teacher_data->>'email')),trim(teacher_data->>'employee_id'),upper(left(trim(teacher_data->>'full_name'),1)))
    returning id into teacher;
  else
    teacher:=target_teacher;
    update public.teachers set full_name=trim(teacher_data->>'full_name'),email=lower(trim(teacher_data->>'email')),employee_id=trim(teacher_data->>'employee_id'),initials=upper(left(trim(teacher_data->>'full_name'),1))
      where id=teacher and school_id=target_school;
    if not found then raise exception 'record not found' using errcode='P0002'; end if;
  end if;

  -- NULL means "this caller does not manage subject load": keep what is stored.
  if subjects is not null then
    delete from public.teacher_subjects where teacher_id=teacher and school_id=target_school;
    insert into public.teacher_subjects(school_id,teacher_id,subject_id)
      select target_school,teacher,x from unnest(subjects) x
      on conflict do nothing;
  end if;

  -- NULL means "this caller does not manage class assignments": keep what is
  -- stored. An explicit empty array is the only way to clear them.
  if classes is not null then
    delete from public.teacher_classes where teacher_id=teacher and school_id=target_school;
    insert into public.teacher_classes(school_id,teacher_id,class_id)
      select distinct target_school,teacher,x from unnest(classes) x;
  end if;

  if permissions is not null then
    perform public.set_teacher_permissions(teacher,permissions);
  end if;
  return teacher;
end;
$$;
revoke all on function public.save_teacher(uuid,uuid,jsonb,uuid[],uuid[],text[]) from public,anon;
grant execute on function public.save_teacher(uuid,uuid,jsonb,uuid[],uuid[],text[]) to authenticated;
