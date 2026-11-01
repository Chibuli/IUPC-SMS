-- Harden follow-up behavior without rewriting already-applied migrations.

-- An authenticated JWT must be an active school administrator for membership
-- maintenance; only owner/service-role provisioning without an end-user JWT may
-- bootstrap identities. Role changes remain immutable for normal callers.
create or replace function public.protect_membership()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_school uuid;
begin
  target_school := case when tg_op='DELETE' then old.school_id else new.school_id end;
  if auth.uid() is null and current_user not in ('postgres','supabase_admin') and coalesce(auth.role(),'')<>'service_role' then
    raise exception 'trusted provisioning required' using errcode='42501';
  end if;
  if auth.uid() is not null and not public.is_school_admin(target_school) then
    raise exception 'not authorized' using errcode='42501';
  end if;
  if auth.uid() is not null and tg_op='INSERT' and (new.role <> 'teacher' or new.teacher_id is null
     or not exists(select 1 from public.teachers t where t.id=new.teacher_id and t.school_id=new.school_id)) then
    raise exception 'teacher membership must reference a valid staff record' using errcode='42501';
  end if;
  if auth.uid() is not null and tg_op='UPDATE' and (new.user_id<>old.user_id or new.school_id<>old.school_id or new.role<>old.role) then
    raise exception 'membership identity and role are immutable' using errcode='42501';
  end if;
  if auth.uid() is null and tg_op='UPDATE' and (new.user_id<>old.user_id or new.school_id<>old.school_id or new.role<>old.role) then
    raise exception 'membership identity cannot be rekeyed';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.protect_membership() from public,anon,authenticated;

-- A teacher is assigned to a subject through teacher_subjects and to a class
-- either explicitly or by a lesson on the timetable. This matches the existing
-- UI, which assigns subjects in the staff register and classes in the timetable.
create or replace function public.is_assigned_teacher(target_school uuid, target_subject uuid default null, target_class uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    join public.profiles p on p.id=m.user_id and p.active
    join public.teachers t on t.id=m.teacher_id and t.school_id=m.school_id and t.active
    where m.school_id=target_school and m.user_id=(select auth.uid()) and m.role='teacher' and m.active
      and (target_subject is null or exists (
        select 1 from public.teacher_subjects ts
        where ts.school_id=m.school_id and ts.teacher_id=t.id and ts.subject_id=target_subject
      ))
      and (target_class is null or exists (
        select 1 from public.teacher_classes tc
        where tc.school_id=m.school_id and tc.teacher_id=t.id and tc.class_id=target_class
      ) or exists (
        select 1 from public.timetable_slots slot
        where slot.school_id=m.school_id and slot.teacher_id=t.id and slot.class_id=target_class
          and (target_subject is null or slot.subject_id=target_subject)
      ))
  )
$$;
revoke all on function public.is_assigned_teacher(uuid,uuid,uuid) from public;
grant execute on function public.is_assigned_teacher(uuid,uuid,uuid) to authenticated;

-- Seed the complete shared curriculum reference catalogue in the following
-- migration. Tenant records use school-owned subject copies, not global rows.

-- Add existing class/staff/term administration workflows as transaction-safe RPCs.
create or replace function public.save_student(input_row jsonb, subject_ids uuid[])
returns uuid language plpgsql security invoker set search_path = '' as $$
declare target_school uuid; student_id uuid;
begin
  target_school:=nullif(input_row->>'school_id','')::uuid;
  if target_school is null or not public.is_school_admin(target_school) then raise exception 'not authorized' using errcode='42501'; end if;
  if input_row is null or jsonb_typeof(input_row)<>'object' then raise exception 'invalid student details' using errcode='22023'; end if;
  if coalesce(input_row->>'class_id','') !~* '^[0-9a-f-]{36}$' or not exists(select 1 from public.classes c where c.id=(input_row->>'class_id')::uuid and c.school_id=target_school) then raise exception 'class not found' using errcode='23503'; end if;
  if exists(select 1 from unnest(coalesce(subject_ids,'{}'::uuid[])) x left join public.subjects s on s.id=x and s.school_id=target_school where s.id is null) then raise exception 'invalid subject selection' using errcode='23503'; end if;
  insert into public.students(school_id,admission_number,full_name,gender,date_of_birth,class_id,guardian_name,guardian_phone,status)
  values(target_school,trim(input_row->>'admission_number'),trim(input_row->>'full_name'),(input_row->>'gender')::public.student_gender,nullif(input_row->>'date_of_birth','')::date,(input_row->>'class_id')::uuid,coalesce(input_row->>'guardian_name',''),coalesce(input_row->>'guardian_phone',''),coalesce(nullif(input_row->>'status','')::public.student_status,'Active'::public.student_status))
  returning id into student_id;
  insert into public.student_subjects(school_id,student_id,subject_id) select target_school,student_id,x from unnest(coalesce(subject_ids,'{}'::uuid[])) x;
  return student_id;
end;
$$;
revoke all on function public.save_student(jsonb,uuid[]) from public,anon;
grant execute on function public.save_student(jsonb,uuid[]) to authenticated;

-- Update a roster record and its many-to-many enrolments atomically; callers
-- cannot choose another school, class or subject outside their administrator scope.
create or replace function public.update_student(input_row jsonb, subject_ids uuid[])
returns uuid language plpgsql security invoker set search_path = '' as $$
declare target_school uuid; target_student uuid; target_class uuid;
begin
  if input_row is null or jsonb_typeof(input_row)<>'object' then raise exception 'invalid student details' using errcode='22023'; end if;
  begin
    target_school:=(input_row->>'school_id')::uuid;
    target_student:=(input_row->>'id')::uuid;
    target_class:=(input_row->>'class_id')::uuid;
  exception when others then raise exception 'invalid student details' using errcode='22023'; end;
  if not public.is_school_admin(target_school) then raise exception 'not authorized' using errcode='42501'; end if;
  if not exists(select 1 from public.classes c where c.id=target_class and c.school_id=target_school) then raise exception 'class not found' using errcode='23503'; end if;
  if exists(select 1 from unnest(coalesce(subject_ids,'{}'::uuid[])) x left join public.subjects s on s.id=x and s.school_id=target_school where s.id is null) then raise exception 'invalid subject selection' using errcode='23503'; end if;
  update public.students set admission_number=trim(input_row->>'admission_number'),full_name=trim(input_row->>'full_name'),gender=(input_row->>'gender')::public.student_gender,date_of_birth=nullif(input_row->>'date_of_birth','')::date,class_id=target_class,guardian_name=coalesce(input_row->>'guardian_name',''),guardian_phone=coalesce(input_row->>'guardian_phone',''),status=(input_row->>'status')::public.student_status
    where id=target_student and school_id=target_school;
  if not found then raise exception 'record not found' using errcode='P0002'; end if;
  delete from public.student_subjects where student_id=target_student and school_id=target_school;
  insert into public.student_subjects(school_id,student_id,subject_id) select target_school,target_student,x from unnest(coalesce(subject_ids,'{}'::uuid[])) x;
  return target_student;
end;
$$;
revoke all on function public.update_student(jsonb,uuid[]) from public,anon;
grant execute on function public.update_student(jsonb,uuid[]) to authenticated;

create or replace function public.save_teacher(target_teacher uuid, target_school uuid, teacher_data jsonb, subjects uuid[], classes uuid[], permissions text[])
returns uuid language plpgsql security invoker set search_path = '' as $$
declare teacher uuid; item uuid; subject_row public.subjects%rowtype;
begin
  if not public.is_school_admin(target_school) then raise exception 'not authorized' using errcode='42501'; end if;
  if teacher_data is null or jsonb_typeof(teacher_data)<>'object' then raise exception 'invalid teacher details' using errcode='22023'; end if;
  if target_teacher is null then
    insert into public.teachers(school_id,full_name,email,employee_id,initials)
    values(target_school,trim(teacher_data->>'full_name'),lower(trim(teacher_data->>'email')),trim(teacher_data->>'employee_id'),upper(left(trim(teacher_data->>'full_name'),1))) returning id into teacher;
    update public.memberships set teacher_id=teacher where school_id=target_school and lower((select u.email from auth.users u where u.id=memberships.user_id))=lower(trim(teacher_data->>'email')) and role='teacher';
  else
    teacher:=target_teacher;
    update public.teachers set full_name=trim(teacher_data->>'full_name'),email=lower(trim(teacher_data->>'email')),employee_id=trim(teacher_data->>'employee_id'),initials=upper(left(trim(teacher_data->>'full_name'),1)) where id=teacher and school_id=target_school;
    if not found then raise exception 'record not found' using errcode='P0002'; end if;
    delete from public.teacher_subjects where teacher_id=teacher and school_id=target_school;
    delete from public.teacher_classes where teacher_id=teacher and school_id=target_school;
  end if;
  foreach item in array coalesce(subjects,'{}'::uuid[]) loop
    select * into subject_row from public.subjects s where s.id=item and (s.school_id=target_school or s.school_id is null);
    if not found then raise exception 'invalid teacher subject' using errcode='23503'; end if;
    if subject_row.school_id is null then
      insert into public.subjects(school_id,name,code,category,level,offered)
        values(target_school,subject_row.name,subject_row.code,subject_row.category,subject_row.level,true)
        on conflict(school_id,code) do nothing;
    end if;
  end loop;
  if exists(select 1 from unnest(coalesce(classes,'{}'::uuid[])) x left join public.classes c on c.id=x and c.school_id=target_school where c.id is null) then
    raise exception 'invalid teacher assignment' using errcode='23503';
  end if;
  if exists(select 1 from unnest(coalesce(permissions,'{}'::text[])) p where p not in ('marks.enter','marks.after_deadline','records.view_all_subjects')) then
    raise exception 'invalid permission' using errcode='22023';
  end if;
  insert into public.teacher_subjects(school_id,teacher_id,subject_id)
    select target_school,teacher,own.id
    from unnest(coalesce(subjects,'{}'::uuid[])) requested(source_id)
    join public.subjects source on source.id=requested.source_id
    join public.subjects own on own.school_id=target_school and own.code=source.code
    on conflict do nothing;
  insert into public.teacher_classes(school_id,teacher_id,class_id) select target_school,teacher,x from unnest(coalesce(classes,'{}'::uuid[])) x;
  perform public.set_teacher_permissions(teacher,coalesce(permissions,'{}'::text[]));
  return teacher;
end;
$$;
revoke all on function public.save_teacher(uuid,uuid,jsonb,uuid[],uuid[],text[]) from public,anon;
grant execute on function public.save_teacher(uuid,uuid,jsonb,uuid[],uuid[],text[]) to authenticated;

create or replace function public.update_membership_active(target_user uuid,target_school uuid,is_active boolean)
returns void language plpgsql security invoker set search_path = '' as $$
begin
 if not public.is_school_admin(target_school) then raise exception 'not authorized' using errcode='42501'; end if;
 update public.memberships set active=is_active where user_id=target_user and school_id=target_school;
 if not found then raise exception 'record not found' using errcode='P0002'; end if;
end;
$$;
revoke all on function public.update_membership_active(uuid,uuid,boolean) from public,anon;
grant execute on function public.update_membership_active(uuid,uuid,boolean) to authenticated;

-- Use the same authoritative class assignment rule for student visibility.
drop policy if exists "students assigned read" on public.students;
create policy "students assigned read" on public.students for select to authenticated
  using (public.is_school_member(school_id) and (public.is_school_admin(school_id) or public.is_assigned_teacher(school_id,null,class_id)));

drop policy if exists "report cards assigned read" on public.report_cards;
create policy "report cards assigned read" on public.report_cards for select to authenticated
  using (public.is_school_admin(school_id) or (public.is_school_member(school_id) and exists (
    select 1 from public.students s where s.id=student_id and s.school_id=report_cards.school_id
      and public.is_assigned_teacher(s.school_id,null,s.class_id)
  )));

drop policy if exists "notes member class read" on public.student_notes;
create policy "notes member class read" on public.student_notes for select to authenticated
  using (public.is_school_admin(school_id) or (public.is_school_member(school_id) and exists (
    select 1 from public.students s where s.id=student_id and s.school_id=student_notes.school_id
      and public.is_assigned_teacher(s.school_id,null,s.class_id)
  )));
drop policy if exists "notes teacher insert" on public.student_notes;
create policy "notes teacher insert" on public.student_notes for insert to authenticated
  with check (author_id=auth.uid() and public.is_school_member(school_id) and exists (
    select 1 from public.students s where s.id=student_id and s.school_id=student_notes.school_id
      and (public.is_school_admin(s.school_id) or public.is_assigned_teacher(s.school_id,null,s.class_id))
  ));

create or replace function public.guard_note_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare stu public.students%rowtype;
begin
  if tg_op='DELETE' then select * into stu from public.students where id=old.student_id;
  else select * into stu from public.students where id=new.student_id; end if;
  if stu.id is null or not public.is_school_member(stu.school_id) then
    raise exception 'record not found' using errcode='42501';
  end if;
  if tg_op='DELETE' then
    if not public.is_school_admin(stu.school_id) then raise exception 'not authorized' using errcode='42501'; end if;
    return old;
  end if;
  if tg_op='UPDATE' then raise exception 'teacher notes are immutable' using errcode='42501'; end if;
  if public.is_school_admin(stu.school_id) then
    new.author_id:=auth.uid();
    new.school_id:=stu.school_id;
    new.author_name:=(select p.full_name from public.profiles p where p.id=auth.uid());
    return new;
  end if;
  if tg_op<>'INSERT' or not public.is_assigned_teacher(stu.school_id,null,stu.class_id) or new.author_id<>auth.uid() then
    raise exception 'not authorized' using errcode='42501';
  end if;
  new.school_id:=stu.school_id;
  new.author_name:=(select p.full_name from public.profiles p where p.id=auth.uid());
  return new;
end;
$$;
revoke all on function public.guard_note_write() from public,anon,authenticated;

-- Keep idempotency receipts bound to the exact request. A reused request key
-- with altered content must never acknowledge a different offline mutation.
alter table public.write_receipts add column if not exists payload jsonb;

create or replace function public.apply_offline_write(request_id uuid, operation text, payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  school uuid; v_exam_id uuid; student uuid; exam_row public.exams%rowtype;
  student_row public.students%rowtype; mark_row public.marks%rowtype;
  score_val numeric; code_val text; receipt public.write_receipts%rowtype;
  deadline timestamptz;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode='42501'; end if;
  if request_id is null or operation<>'marks.setScore' or jsonb_typeof(payload)<>'object' then
    raise exception 'invalid offline operation' using errcode='22023';
  end if;
  begin
    v_exam_id:=(payload->>'examId')::uuid;
    student:=(payload->>'studentId')::uuid;
  exception when others then raise exception 'invalid record' using errcode='22023'; end;
  select * into exam_row from public.exams where id=v_exam_id;
  select * into student_row from public.students where id=student;
  if exam_row.id is null or student_row.id is null or exam_row.school_id<>student_row.school_id or exam_row.class_id<>student_row.class_id then
    raise exception 'record not found' using errcode='42501';
  end if;
  school:=exam_row.school_id;
  if not public.is_school_member(school) then raise exception 'not authorized' using errcode='42501'; end if;

  select * into receipt from public.write_receipts r where r.user_id=auth.uid() and r.request_id=apply_offline_write.request_id;
  if found then
    if receipt.operation<>operation or receipt.payload is distinct from payload then
      raise exception 'idempotency key reused with different request' using errcode='22023';
    end if;
    return receipt.result;
  end if;

  if exam_row.status<>'open' then raise exception 'mark entry is closed' using errcode='42501'; end if;
  if not public.is_school_admin(school) then
    if not public.is_assigned_teacher(school,exam_row.subject_id,exam_row.class_id)
       or not public.has_teacher_permission(school,'marks.enter') then
      raise exception 'not authorized' using errcode='42501';
    end if;
    select coalesce(exam_row.editing_deadline,(select mw.closes_at from public.mark_windows mw where mw.school_id=school)) into deadline;
    if deadline is not null and deadline<=now() and not public.has_teacher_permission(school,'marks.after_deadline') then
      raise exception 'mark entry deadline passed' using errcode='42501';
    end if;
  end if;

  if payload->'score'='null'::jsonb then score_val:=null; code_val:=null;
  elsif jsonb_typeof(payload->'score')='number' then score_val:=(payload->>'score')::numeric; code_val:=null;
  elsif payload->>'score' in ('X','Y') then score_val:=null; code_val:=payload->>'score';
  else raise exception 'invalid score' using errcode='22023'; end if;
  if score_val is not null and (score_val<0 or score_val>exam_row.max_score) then
    raise exception 'invalid score' using errcode='23514';
  end if;

  insert into public.marks(school_id,exam_id,student_id,score,score_code)
    values(school,v_exam_id,student,score_val,code_val)
    on conflict on constraint marks_exam_id_student_id_key do update set score=excluded.score,score_code=excluded.score_code,updated_at=now()
    returning * into mark_row;
  receipt.result:=jsonb_build_object('id',mark_row.id,'exam_id',mark_row.exam_id,'student_id',mark_row.student_id,'accepted',true);
  insert into public.write_receipts(user_id,request_id,school_id,operation,payload,result)
    values(auth.uid(),request_id,school,operation,payload,receipt.result);
  return receipt.result;
end;
$$;
revoke all on function public.apply_offline_write(uuid,text,jsonb) from public,anon;
grant execute on function public.apply_offline_write(uuid,text,jsonb) to authenticated;
