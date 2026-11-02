-- PostgREST 14 retries SQLSTATE 40001 indefinitely. A stale reviewed snapshot
-- is an application conflict, not a retryable serialization failure. Preserve
-- the complete authorized atomic contract; return HTTP 409 through PostgREST.
create or replace function public.apply_enrollment_history_change(
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
    raise exception 'History changed; reload before reviewing this change again' using errcode='PT409';
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
