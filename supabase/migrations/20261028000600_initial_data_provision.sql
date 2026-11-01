-- Owner-only first-school bootstrap. No demo learners, marks, or reports.
create or replace function public.provision_initial_admin(target_user uuid, school_name text, school_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_school uuid; profile_name text;
begin
  if auth.uid() is not null or current_user not in ('postgres','supabase_admin') then
    raise exception 'project-owner provisioning required' using errcode='42501';
  end if;
  if exists(select 1 from public.memberships) then raise exception 'initial administrator already provisioned'; end if;
  select coalesce(p.full_name,u.email) into profile_name
    from auth.users u join public.profiles p on p.id=u.id
    where u.id=target_user and u.email_confirmed_at is not null and p.active;
  if profile_name is null then raise exception 'confirmed active user not found'; end if;
  if length(trim(coalesce(school_name,''))) not between 2 and 160 or length(trim(coalesce(school_code,''))) not between 2 and 32 then
    raise exception 'invalid school details' using errcode='22023';
  end if;

  insert into public.schools(name,code) values(trim(school_name),upper(trim(school_code))) returning id into new_school;
  insert into public.memberships(school_id,user_id,role,active) values(new_school,target_user,'admin',true);
  insert into public.terms(school_id,name,academic_year,is_active,start_date)
    values(new_school,'TERM 1','2026/2027',true,date '2026-09-07');
  insert into public.classes(school_id,class_name,stream_name)
    select new_school,'Year '||year_no,'A' from generate_series(7,13) as years(year_no);
  -- Create tenant-owned copies for this campus's already-offered syllabuses.
  -- Other global catalogue rows can be offered later by the admin-only RPC.
  insert into public.subjects(school_id,name,code,category,level,offered)
    select new_school,name,code,category,level,true from public.subjects s
    where s.school_id is null and s.code=any(array[
      '0500','0580','0610','0620','0625','0478','0470','0450',
      '0861','0862','0893','0860','1129','0839','0073','0081',
      '9709','9702','9701','9618','9708','9700','9990'
    ]);
  insert into public.mark_windows(school_id,closes_at) values(new_school,null);
  insert into public.grading_scales(school_id,name,pass_mark,bands) values(new_school,'IUPC Institutional Scale',40,
    '[{"grade":"A*","min_score":90,"points":9,"remark":"Excellent"},{"grade":"A","min_score":80,"points":8,"remark":"Very Good"},{"grade":"B","min_score":70,"points":7,"remark":"Good"},{"grade":"C","min_score":60,"points":6,"remark":"Average"},{"grade":"D","min_score":50,"points":5,"remark":"Below Average"},{"grade":"E","min_score":40,"points":4,"remark":"Needs to Improve"},{"grade":"F","min_score":30,"points":3,"remark":"Weak"},{"grade":"G","min_score":20,"points":2,"remark":"Very Weak"},{"grade":"U","min_score":0,"points":1,"remark":"Ungraded"}]'::jsonb);
  return new_school;
end;
$$;
revoke all on function public.provision_initial_admin(uuid,text,text) from public,anon,authenticated;
