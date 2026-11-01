-- Existing accounts can be provisioned by a project owner with the documented SQL procedure;
-- ordinary authenticated users must never be able to claim the first administrator role.
drop function if exists public.create_school_with_admin(text,text,text,text);

create or replace function public.is_assigned_teacher(target_school uuid, target_subject uuid default null, target_class uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    join public.profiles p on p.id=m.user_id and p.active
    join public.teachers t on t.id=m.teacher_id and t.school_id=m.school_id and t.active
    where m.school_id=target_school and m.user_id=(select auth.uid()) and m.role='teacher' and m.active
      and (target_subject is null or exists (
        select 1 from public.teacher_subjects ts where ts.school_id=m.school_id and ts.teacher_id=t.id and ts.subject_id=target_subject
      ))
      and (target_class is null or exists (
        select 1 from public.teacher_classes tc where tc.school_id=m.school_id and tc.teacher_id=t.id and tc.class_id=target_class
      ) or exists (
        select 1 from public.timetable_slots slot where slot.school_id=m.school_id and slot.teacher_id=t.id and slot.class_id=target_class
          and (target_subject is null or slot.subject_id=target_subject)
      ))
  )
$$;
revoke all on function public.is_assigned_teacher(uuid,uuid,uuid) from public;
grant execute on function public.is_assigned_teacher(uuid,uuid,uuid) to authenticated;

drop policy if exists "teachers member read" on public.teachers;
create policy "teachers member read" on public.teachers for select to authenticated using (public.is_school_member(school_id));

-- Membership admin operations remain checked both by RLS and a write trigger.
create or replace function public.protect_membership()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_school uuid;
begin
  target_school := case when tg_op='DELETE' then old.school_id else new.school_id end;
  -- A trusted owner/admin API may bootstrap only without an end-user JWT.
  -- Authenticated requests need a current administrator membership.
  if auth.uid() is not null and not public.is_school_admin(target_school) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if auth.uid() is not null and tg_op='INSERT' and new.role <> 'teacher' then
    raise exception 'administrator roles require project-owner provisioning' using errcode='42501';
  end if;
  if auth.uid() is not null and tg_op='UPDATE' and (new.user_id<>old.user_id or new.school_id<>old.school_id or new.role<>old.role) then
    raise exception 'membership identity and role are immutable' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
