create or replace function public.move_timetable_slots(updates jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare item jsonb; target_school uuid;
begin
  if jsonb_typeof(updates)<>'array' or jsonb_array_length(updates)>20 then raise exception 'invalid timetable batch' using errcode='22023'; end if;
  for item in select value from jsonb_array_elements(updates) loop
    if coalesce(item->>'id','') !~* '^[0-9a-f-]{36}$' then raise exception 'invalid slot' using errcode='22023'; end if;
    select school_id into target_school from public.timetable_slots where id=(item->>'id')::uuid;
    if target_school is null or not public.is_school_admin(target_school) then raise exception 'not authorized' using errcode='42501'; end if;
    if (item->>'day')::int not between 1 and 5 or (item->>'period')::int not between 1 and 32 then raise exception 'invalid slot position' using errcode='22023'; end if;
  end loop;
  for item in select value from jsonb_array_elements(updates) loop
    update public.timetable_slots set class_id=(item->>'class_id')::uuid,day=(item->>'day')::smallint,period=(item->>'period')::smallint where id=(item->>'id')::uuid;
  end loop;
end;
$$;
revoke all on function public.move_timetable_slots(jsonb) from public, anon;
grant execute on function public.move_timetable_slots(jsonb) to authenticated;
