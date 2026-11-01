-- Mark identity is permanent after creation. Keep authorized updates to scores,
-- special score codes, remarks, timestamps, and audit fields on the existing
-- validation and audit paths.
create or replace function public.enforce_mark_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.school_id is distinct from old.school_id
    or new.exam_id is distinct from old.exam_id
    or new.student_id is distinct from old.student_id then
    raise exception 'mark identity is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_mark_identity() from public, anon, authenticated;

-- This name sorts before the existing mark-validation triggers so identity
-- changes are rejected consistently before any other trigger evaluates NEW.
create trigger enforce_mark_identity_before
  before update on public.marks
  for each row execute function public.enforce_mark_identity();
