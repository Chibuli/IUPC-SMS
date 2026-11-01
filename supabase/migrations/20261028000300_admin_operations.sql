create or replace function public.set_teacher_permissions(target_teacher uuid, permission_keys text[])
returns void language plpgsql security invoker set search_path = '' as $$
declare target_school uuid;
begin
  select school_id into target_school from public.teachers where id=target_teacher;
  if target_school is null or not public.is_school_admin(target_school) then raise exception 'not authorized' using errcode='42501'; end if;
  if exists(select 1 from unnest(permission_keys) p where p not in ('marks.enter','marks.after_deadline','records.view_all_subjects')) then raise exception 'invalid permission' using errcode='22023'; end if;
  delete from public.teacher_permissions where teacher_id=target_teacher;
  insert into public.teacher_permissions(teacher_id,permission) select target_teacher,p from unnest(permission_keys) p on conflict do nothing;
end;
$$;
revoke all on function public.set_teacher_permissions(uuid,text[]) from public, anon;
grant execute on function public.set_teacher_permissions(uuid,text[]) to authenticated;

create or replace function public.deactivate_teacher(target_teacher uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare target_school uuid;
begin
  select school_id into target_school from public.teachers where id=target_teacher;
  if target_school is null or not public.is_school_admin(target_school) then raise exception 'not authorized' using errcode='42501'; end if;
  update public.teachers set active=false where id=target_teacher;
  update public.memberships set active=false where teacher_id=target_teacher and school_id=target_school;
end;
$$;
revoke all on function public.deactivate_teacher(uuid) from public, anon;
grant execute on function public.deactivate_teacher(uuid) to authenticated;

create or replace function public.activate_term(target_term uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare target_school uuid;
begin
  select school_id into target_school from public.terms where id=target_term;
  if target_school is null or not public.is_school_admin(target_school) then raise exception 'not authorized' using errcode='42501'; end if;
  update public.terms set is_active=false where school_id=target_school;
  update public.terms set is_active=true where id=target_term;
end;
$$;
revoke all on function public.activate_term(uuid) from public, anon;
grant execute on function public.activate_term(uuid) to authenticated;

create or replace function public.assign_teacher(target_school uuid,target_email text,target_full_name text,target_employee_id text,target_subjects uuid[],target_classes uuid[])
returns uuid language plpgsql security invoker set search_path = '' as $$
declare teacher uuid;
begin
  if not public.is_school_admin(target_school) then raise exception 'not authorized' using errcode='42501'; end if;
  insert into public.teachers(school_id,email,full_name,employee_id,initials)
  values(target_school,lower(trim(target_email)),trim(target_full_name),trim(target_employee_id),upper(left(trim(target_full_name),1))) returning id into teacher;
  update public.memberships set teacher_id=teacher where school_id=target_school and lower((select email from auth.users where id=user_id))=lower(trim(target_email)) and role='teacher';
  insert into public.teacher_subjects(school_id,teacher_id,subject_id) select target_school,teacher,s from unnest(target_subjects) s;
  insert into public.teacher_classes(school_id,teacher_id,class_id) select target_school,teacher,c from unnest(target_classes) c;
  return teacher;
end;
$$;
revoke all on function public.assign_teacher(uuid,text,text,text,uuid[],uuid[]) from public, anon;
grant execute on function public.assign_teacher(uuid,text,text,text,uuid[],uuid[]) to authenticated;
