-- Phase 2B: administrative transactions only. No backfill or live eligibility integration.
create table public.enrollment_history_operations (
  request_id uuid primary key,
  school_id uuid not null references public.schools(id) on delete restrict,
  student_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  request jsonb not null,
  result jsonb not null,
  recorded_at timestamptz not null default now(),
  foreign key (student_id,school_id) references public.students(id,school_id) on delete restrict
);
create index enrollment_history_operations_student on public.enrollment_history_operations(school_id,student_id);
alter table public.enrollment_history_operations enable row level security;
revoke all on public.enrollment_history_operations from public,anon,authenticated,service_role;
grant select on public.enrollment_history_operations to authenticated;
create policy history_receipt_admin_read on public.enrollment_history_operations for select to authenticated
  using (public.is_school_admin(school_id));

create function public.guard_enrollment_history_receipt() returns trigger
language plpgsql set search_path='' as $$
begin
  raise exception 'Enrollment operation receipts are immutable' using errcode='42501';
end;
$$;
revoke all on function public.guard_enrollment_history_receipt() from public,anon,authenticated,service_role;
create trigger history_receipt_immutable before update or delete on public.enrollment_history_operations
  for each row execute function public.guard_enrollment_history_receipt();
create trigger history_receipt_no_truncate before truncate on public.enrollment_history_operations
  for each statement execute function public.guard_enrollment_history_receipt();

create function public.read_enrollment_history(target_school uuid,target_student uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare snapshot jsonb;
begin
  if auth.uid() is null or not public.is_school_admin(target_school) then
    raise exception 'Administrator membership required' using errcode='42501';
  end if;
  if not exists(select 1 from public.students where id=target_student and school_id=target_school) then
    raise exception 'Student is not in this school' using errcode='42501';
  end if;
  select jsonb_build_object(
    'school',coalesce((select jsonb_agg(to_jsonb(h) order by h.id) from public.student_school_enrollment_history h where school_id=target_school and student_id=target_student),'[]'::jsonb),
    'class',coalesce((select jsonb_agg(to_jsonb(h) order by h.id) from public.student_class_enrollment_history h where school_id=target_school and student_id=target_student),'[]'::jsonb),
    'subject',coalesce((select jsonb_agg(to_jsonb(h) order by h.id) from public.student_subject_enrollment_history h where school_id=target_school and student_id=target_student),'[]'::jsonb)
  ) into snapshot;
  return snapshot || jsonb_build_object('version',md5(snapshot::text),'contract_version',1,
    'server_version_num',current_setting('server_version_num')::integer);
end;
$$;
revoke all on function public.read_enrollment_history(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_enrollment_history(uuid,uuid) to authenticated;

-- Every step calls the existing Phase 2A append guard. An exception rolls back
-- ALL steps and the receipt. Parent/child corrections must be ordered leaf-first
-- when retiring evidence, parent-first when establishing its replacement.
create function public.apply_enrollment_history_change(
  target_school uuid,target_student uuid,request_id uuid,expected_version text,steps jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare receipt public.enrollment_history_operations; payload jsonb; step jsonb; values_row jsonb;
  refs jsonb:='{}'; ids jsonb:='{}'; ref record; step_key text; new_id uuid; answer jsonb;
begin
  if auth.uid() is null or not public.is_school_admin(target_school) then
    raise exception 'Administrator membership required' using errcode='42501';
  end if;
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'History changes require READ COMMITTED' using errcode='25001';
  end if;
  -- Same lock as Phase 2A: serializes history writes for this student.
  perform 1 from public.students where id=target_student and school_id=target_school for update;
  if not found then raise exception 'Student is not in this school' using errcode='42501'; end if;
  if not public.is_school_admin(target_school) then
    raise exception 'Administrator membership required' using errcode='42501';
  end if;
  if request_id is null or expected_version is null or jsonb_typeof(steps) is distinct from 'array'
    or jsonb_array_length(steps) not between 1 and 100 then
    raise exception 'Invalid change request' using errcode='22023';
  end if;
  payload:=jsonb_build_object('expected_version',expected_version,'steps',steps);
  select * into receipt from public.enrollment_history_operations o where o.request_id=apply_enrollment_history_change.request_id;
  if found then
    if receipt.school_id<>target_school or receipt.student_id<>target_student
      or receipt.actor_id<>auth.uid() or receipt.request<>payload then
      raise exception 'Change identity already used for a different request' using errcode='22023';
    end if;
    return receipt.result;
  end if;
  if public.read_enrollment_history(target_school,target_student)->>'version'<>expected_version then
    raise exception 'History changed; reload before reviewing this change again' using errcode='40001';
  end if;
  for step in select value from jsonb_array_elements(steps) loop
    step_key:=step->>'key';
    if step_key is null or step_key !~ '^[a-zA-Z][a-zA-Z0-9_]{0,39}$' or ids ? step_key
      or step->>'axis' is null or step->>'axis' not in ('school','class','subject')
      or jsonb_typeof(step->'input') is distinct from 'object'
      or exists(select 1 from jsonb_object_keys(step) k where k not in ('key','axis','input','refs')) then
      raise exception 'Invalid change step' using errcode='22023';
    end if;
    values_row:=step->'input';
    if values_row ?| array['school_id','student_id','change_id'] then
      raise exception 'Change scope is server controlled' using errcode='22023';
    end if;
    refs:=coalesce(step->'refs','{}'::jsonb);
    if jsonb_typeof(refs) is distinct from 'object' then raise exception 'Invalid references' using errcode='22023'; end if;
    for ref in select * from jsonb_each_text(refs) loop
      if ref.key not in ('school_history_id','class_history_id','supersedes_id') or not ids ? ref.value or values_row ? ref.key then
        raise exception 'A reference must identify an earlier step' using errcode='22023';
      end if;
      values_row:=values_row||jsonb_build_object(ref.key,ids->>ref.value);
    end loop;
    values_row:=values_row||jsonb_build_object('school_id',target_school,'student_id',target_student,'change_id',request_id);
    new_id:=public.append_enrollment_history(step->>'axis',values_row);
    ids:=ids||jsonb_build_object(step_key,new_id);
  end loop;
  answer:=jsonb_build_object('applied',true,'change_id',request_id,'ids',ids);
  insert into public.enrollment_history_operations(request_id,school_id,student_id,actor_id,request,result)
    values(request_id,target_school,target_student,auth.uid(),payload,answer);
  return answer;
end;
$$;
revoke all on function public.apply_enrollment_history_change(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.apply_enrollment_history_change(uuid,uuid,uuid,text,jsonb) to authenticated;

comment on function public.apply_enrollment_history_change(uuid,uuid,uuid,text,jsonb) is
  'Phase 2B online administrator transaction. Optimistic snapshot, immutable revisions, idempotent receipt. No current enrollment or academic writes.';
