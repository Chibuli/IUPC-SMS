-- IUPC Academy initial schema. Deliberately contains no demo records.
create extension if not exists pgcrypto with schema extensions;

create type public.app_role as enum ('admin', 'teacher');
create type public.exam_status as enum ('draft', 'open', 'locked', 'published');
create type public.student_status as enum ('Active', 'Alumni');
create type public.student_gender as enum ('Male', 'Female');
create type public.subject_level as enum ('Lower Secondary', 'IGCSE', 'O Level', 'AS & A Level', 'Custom');

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 160),
  code text not null unique check (length(trim(code)) between 2 and 32),
  address text not null default '', postal text not null default '', city text not null default '',
  contact_email text not null default '', phone_number text not null default '',
  logo_url text, crest_url text, motto text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (length(trim(full_name)) between 2 and 160),
  active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null default 'teacher',
  teacher_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (school_id, user_id)
);

create table public.classes (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  class_name text not null check (length(trim(class_name)) between 1 and 80),
  stream_name text not null check (length(trim(stream_name)) between 1 and 80),
  created_at timestamptz not null default now(), unique (school_id, class_name, stream_name), unique (id, school_id)
);

create table public.teachers (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  full_name text not null check (length(trim(full_name)) between 2 and 160),
  email text not null, employee_id text not null, initials text not null default '', active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (school_id, email), unique (school_id, employee_id), unique (id, school_id)
);

alter table public.memberships add constraint memberships_teacher_school_fk
  foreign key (teacher_id, school_id) references public.teachers(id, school_id) on delete set null (teacher_id);

create table public.teacher_permissions (
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  permission text not null check (permission in ('marks.enter','marks.after_deadline','records.view_all_subjects')),
  primary key (teacher_id, permission)
);
create table public.subjects (
  id uuid primary key default gen_random_uuid(), school_id uuid references public.schools(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120), code text not null check (length(trim(code)) between 1 and 32),
  category text not null default 'General', level public.subject_level not null default 'Custom', offered boolean not null default true,
  unique (school_id, code), unique (id, school_id)
);
create unique index subjects_catalogue_code_unique on public.subjects(code) where school_id is null;

create table public.teacher_subjects (
  school_id uuid not null references public.schools(id) on delete cascade,
  teacher_id uuid not null, subject_id uuid not null,
  primary key (teacher_id, subject_id),
  foreign key (teacher_id, school_id) references public.teachers(id, school_id) on delete cascade,
  foreign key (subject_id, school_id) references public.subjects(id, school_id) on delete cascade
);

create table public.teacher_classes (
  school_id uuid not null references public.schools(id) on delete cascade,
  teacher_id uuid not null, class_id uuid not null,
  primary key (teacher_id, class_id),
  foreign key (teacher_id, school_id) references public.teachers(id, school_id) on delete cascade,
  foreign key (class_id, school_id) references public.classes(id, school_id) on delete cascade
);

create table public.students (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  admission_number text not null check (length(trim(admission_number)) between 1 and 48),
  full_name text not null check (length(trim(full_name)) between 2 and 160),
  gender public.student_gender not null, date_of_birth date, class_id uuid not null,
  guardian_name text not null default '', guardian_phone text not null default '',
  status public.student_status not null default 'Active',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (school_id, admission_number), unique (id, school_id),
  foreign key (class_id, school_id) references public.classes(id, school_id) on delete restrict
);
create index students_school_class_idx on public.students(school_id, class_id, status, full_name);

create table public.student_subjects (
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null, subject_id uuid not null,
  primary key (student_id, subject_id),
  foreign key (student_id, school_id) references public.students(id, school_id) on delete cascade,
  foreign key (subject_id, school_id) references public.subjects(id, school_id) on delete restrict
);

create table public.terms (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80), academic_year text not null,
  is_active boolean not null default false, start_date date not null, created_at timestamptz not null default now(),
  unique (school_id, name, academic_year), unique (id, school_id)
);
create unique index terms_single_active_per_school on public.terms(school_id) where is_active;

create table public.mark_windows (
  school_id uuid primary key references public.schools(id) on delete cascade,
  closes_at timestamptz, updated_at timestamptz not null default now()
);

create table public.exams (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  term_id uuid not null, subject_id uuid not null, class_id uuid not null,
  exam_name text not null check (length(trim(exam_name)) between 1 and 120), exam_type text not null,
  max_score numeric(7,2) not null check (max_score > 0), exam_date date not null,
  editing_deadline timestamptz, status public.exam_status not null default 'open',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (school_id, term_id, class_id, subject_id, exam_type), unique (id, school_id),
  foreign key (term_id, school_id) references public.terms(id, school_id) on delete restrict,
  foreign key (subject_id, school_id) references public.subjects(id, school_id) on delete restrict,
  foreign key (class_id, school_id) references public.classes(id, school_id) on delete restrict
);
create index exams_school_term_idx on public.exams(school_id, term_id, class_id, subject_id);

create table public.marks (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  exam_id uuid not null, student_id uuid not null,
  score numeric(7,2), score_code text check (score_code in ('X','Y')),
  remarks text not null default '', entered_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (exam_id, student_id),
  check ((score is null) <> (score_code is null) or (score is null and score_code is null)),
  foreign key (exam_id, school_id) references public.exams(id, school_id) on delete cascade,
  foreign key (student_id, school_id) references public.students(id, school_id) on delete cascade
);
create index marks_student_idx on public.marks(school_id, student_id, exam_id);

create table public.mark_revisions (
  id bigint generated always as identity primary key,
  school_id uuid not null references public.schools(id) on delete cascade,
  mark_id uuid not null references public.marks(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  old_score numeric(7,2), old_score_code text, new_score numeric(7,2), new_score_code text,
  changed_at timestamptz not null default now()
);

create table public.grading_scales (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  name text not null, pass_mark numeric(7,2) not null default 50, bands jsonb not null default '[]'::jsonb check (jsonb_typeof(bands) = 'array'),
  created_at timestamptz not null default now(), unique (school_id, name)
);

create table public.report_cards (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null, term_id uuid not null,
  attendance_present integer not null default 0 check (attendance_present >= 0),
  attendance_total integer not null default 0 check (attendance_total >= attendance_present),
  class_teacher text not null default '', academic text not null default '', activities text not null default '',
  conduct text not null default '', principal text not null default '', hse text not null default '',
  next_term_begins date, next_term_ends date, updated_at timestamptz not null default now(),
  unique (student_id, term_id),
  foreign key (student_id, school_id) references public.students(id, school_id) on delete cascade,
  foreign key (term_id, school_id) references public.terms(id, school_id) on delete cascade
);

create table public.student_notes (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null, body text not null check (length(trim(body)) between 1 and 4000),
  author_id uuid not null references auth.users(id) on delete restrict,
  author_name text not null, created_at timestamptz not null default now(),
  foreign key (student_id, school_id) references public.students(id, school_id) on delete cascade
);

create table public.timetable_slots (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  term_id uuid not null, class_id uuid not null, day smallint not null check (day between 1 and 5),
  period smallint not null check (period between 1 and 32), subject_id uuid not null, teacher_id uuid not null,
  room text not null default '', week smallint check (week between 1 and 52),
  created_at timestamptz not null default now(),
  foreign key (term_id, school_id) references public.terms(id, school_id) on delete cascade,
  foreign key (class_id, school_id) references public.classes(id, school_id) on delete cascade,
  foreign key (subject_id, school_id) references public.subjects(id, school_id) on delete restrict,
  foreign key (teacher_id, school_id) references public.teachers(id, school_id) on delete restrict
);
create index timetable_school_term_idx on public.timetable_slots(school_id, term_id, class_id, day, period);

create table public.bell_schedules (
  school_id uuid primary key references public.schools(id) on delete cascade,
  entries jsonb not null default '[]'::jsonb check (jsonb_typeof(entries) = 'array'),
  updated_at timestamptz not null default now()
);

create table public.write_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  school_id uuid not null references public.schools(id) on delete cascade,
  operation text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);

create or replace function public.is_school_admin(target_school uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m join public.profiles p on p.id=m.user_id where m.school_id=target_school and m.user_id=(select auth.uid()) and m.role='admin' and m.active and p.active)
$$;
create or replace function public.is_school_member(target_school uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m join public.profiles p on p.id=m.user_id where m.school_id=target_school and m.user_id=(select auth.uid()) and m.active and p.active)
$$;
revoke all on function public.is_school_admin(uuid),public.is_school_member(uuid) from public;
grant execute on function public.is_school_admin(uuid),public.is_school_member(uuid) to authenticated;
create or replace function public.is_assigned_teacher(target_school uuid, target_subject uuid, target_class uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    join public.teachers t on t.id = m.teacher_id and t.school_id = m.school_id and t.active
    join public.teacher_subjects ts on ts.teacher_id = t.id and ts.school_id = t.school_id
    where m.school_id = target_school and m.user_id = (select auth.uid()) and m.role = 'teacher' and m.active
      and ts.subject_id = target_subject
      and public.is_school_member(target_school)
      and (target_class is null or exists (select 1 from public.teacher_classes tc where tc.teacher_id = t.id and tc.school_id = t.school_id and tc.class_id = target_class))
  )
$$;
create or replace function public.has_teacher_permission(target_school uuid, target_permission text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m join public.profiles pr on pr.id=m.user_id and pr.active join public.teachers t on t.id=m.teacher_id and t.active join public.teacher_permissions p on p.teacher_id=t.id
    where m.school_id=target_school and m.user_id=(select auth.uid()) and m.role='teacher' and m.active and p.permission=target_permission)
$$;
revoke all on function public.is_school_admin(uuid) from public;
revoke all on function public.is_school_member(uuid) from public;
revoke all on function public.is_assigned_teacher(uuid,uuid,uuid) from public;
revoke all on function public.has_teacher_permission(uuid,text) from public;
grant execute on function public.is_school_admin(uuid), public.is_school_member(uuid), public.is_assigned_teacher(uuid,uuid,uuid), public.has_teacher_permission(uuid,text) to authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, full_name) values (new.id, coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), nullif(split_part(new.email, '@', 1),''), 'User'));
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public,anon,authenticated;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.protect_membership()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_school uuid;
begin
  target_school := case when tg_op='DELETE' then old.school_id else new.school_id end;
  if auth.uid() is null and current_user not in ('postgres','supabase_admin') and coalesce(auth.role(),'')<>'service_role' then
    raise exception 'trusted provisioning required' using errcode='42501';
  end if;
  if auth.uid() is not null and not public.is_school_admin(target_school) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if auth.uid() is not null and tg_op='INSERT' and (new.role<>'teacher' or new.teacher_id is null or not exists(select 1 from public.teachers t where t.id=new.teacher_id and t.school_id=new.school_id)) then
    raise exception 'teacher membership must reference a valid staff record' using errcode='42501';
  end if;
  if tg_op='UPDATE' and (new.user_id<>old.user_id or new.school_id<>old.school_id or new.role<>old.role) then
    raise exception 'membership identity and role are immutable' using errcode = '42501';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.protect_membership() from public,anon,authenticated;
create trigger protect_membership_write before insert or update or delete on public.memberships for each row execute procedure public.protect_membership();

create or replace function public.enforce_mark_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare ex public.exams%rowtype; stu public.students%rowtype; membership public.memberships%rowtype; deadline timestamptz;
begin
  select * into ex from public.exams where id = coalesce(new.exam_id, old.exam_id);
  select * into stu from public.students where id = coalesce(new.student_id, old.student_id);
  if ex.id is null or stu.id is null or ex.school_id <> stu.school_id or ex.school_id <> coalesce(new.school_id, old.school_id) then raise exception 'record not found' using errcode = '42501'; end if;    if tg_op = 'DELETE' then
    if not public.is_school_admin(ex.school_id) then raise exception 'not authorized' using errcode = '42501'; end if;
    return old;
  end if;
  if auth.uid() is null or not public.is_school_member(ex.school_id) then raise exception 'not authorized' using errcode = '42501'; end if;
  if new.school_id<>ex.school_id or new.exam_id<>ex.id or new.student_id<>stu.id then raise exception 'record scope is immutable' using errcode='42501'; end if;
  if ex.status <> 'open' then raise exception 'mark entry is closed' using errcode = '42501'; end if;
  if new.score is not null and (new.score < 0 or new.score > ex.max_score) then raise exception 'invalid score' using errcode = '23514'; end if;
  if new.score_code is not null and new.score is not null then raise exception 'invalid score' using errcode = '23514'; end if;
  if not public.is_school_admin(ex.school_id) then
    if not public.is_assigned_teacher(ex.school_id, ex.subject_id, ex.class_id) or not public.has_teacher_permission(ex.school_id, 'marks.enter') then raise exception 'not authorized' using errcode = '42501'; end if;
    select m.* into membership from public.memberships m where m.school_id = ex.school_id and m.user_id = auth.uid() and m.active;
    select coalesce(ex.editing_deadline, (select mw.closes_at from public.mark_windows mw where mw.school_id=ex.school_id)) into deadline;
    if deadline is not null and deadline <= now() and not public.has_teacher_permission(ex.school_id, 'marks.after_deadline') then raise exception 'mark entry deadline passed' using errcode = '42501'; end if;
  end if;
  new.entered_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.enforce_mark_write() from public,anon,authenticated;
create trigger enforce_mark_write_before before insert or update or delete on public.marks for each row execute procedure public.enforce_mark_write();

create or replace function public.audit_mark_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    insert into public.mark_revisions(school_id, mark_id, actor_id, old_score, old_score_code, new_score, new_score_code)
    values (new.school_id, new.id, auth.uid(), old.score, old.score_code, new.score, new.score_code);
  elsif tg_op = 'INSERT' then
    insert into public.mark_revisions(school_id, mark_id, actor_id, new_score, new_score_code)
    values (new.school_id, new.id, auth.uid(), new.score, new.score_code);
  end if;
  return new;
end;
$$;
revoke all on function public.audit_mark_write() from public,anon,authenticated;
create trigger audit_mark_write_after after insert or update on public.marks for each row execute procedure public.audit_mark_write();

create or replace function public.guard_note_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare stu public.students%rowtype; teacher_class boolean;
begin
  if tg_op='DELETE' then select * into stu from public.students where id=old.student_id;
  else select * into stu from public.students where id=new.student_id; end if;
  if stu.id is null or not public.is_school_member(stu.school_id) then raise exception 'record not found' using errcode = '42501'; end if;
  if tg_op='DELETE' then
    if not public.is_school_admin(stu.school_id) then raise exception 'not authorized' using errcode = '42501'; end if;
    return old;
  end if;
  if tg_op='UPDATE' then raise exception 'student notes are immutable' using errcode='42501'; end if;
  if public.is_school_admin(stu.school_id) then
    new.author_id:=auth.uid(); new.author_name:=(select p.full_name from public.profiles p where p.id=auth.uid()); new.school_id:=stu.school_id; return new;
  end if;
  select exists(select 1 from public.memberships m join public.teacher_classes tc on tc.teacher_id=m.teacher_id and tc.school_id=m.school_id
    where m.school_id=stu.school_id and m.user_id=auth.uid() and m.role='teacher' and m.active and tc.class_id=stu.class_id) into teacher_class;
  if not teacher_class or new.author_id<>auth.uid() then raise exception 'not authorized' using errcode='42501'; end if;
  new.school_id:=stu.school_id;
  new.author_name:=(select p.full_name from public.profiles p where p.id=auth.uid());
  return new;
end;
$$;
revoke all on function public.guard_note_write() from public,anon,authenticated;
create trigger guard_note_write_before before insert or update or delete on public.student_notes for each row execute procedure public.guard_note_write();

create or replace function public.apply_offline_write(request_id uuid, operation text, payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare school uuid; exam_row public.exams%rowtype; mark_row public.marks%rowtype; student uuid; score_val numeric; code_val text; receipt jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode='42501'; end if;
  if request_id is null or operation not in ('marks.setScore') or jsonb_typeof(payload) <> 'object' then raise exception 'invalid offline operation' using errcode = '22023'; end if;
  select r.result into receipt from public.write_receipts r where r.user_id=auth.uid() and r.request_id=apply_offline_write.request_id;
  if found then return receipt; end if;
  begin exam_row.id := (payload->>'examId')::uuid; student := (payload->>'studentId')::uuid; exception when others then raise exception 'invalid record' using errcode='22023'; end;
  select * into exam_row from public.exams where id=exam_row.id;
  if exam_row.id is null then raise exception 'record not found' using errcode='P0002'; end if;
  school := exam_row.school_id;
  if not public.is_school_member(school) then raise exception 'not authorized' using errcode='42501'; end if;
  if payload->'score' = 'null'::jsonb then score_val := null; code_val := null;
  elsif jsonb_typeof(payload->'score')='number' then score_val := (payload->>'score')::numeric; code_val := null;
  elsif payload->>'score' in ('X','Y') then score_val := null; code_val := payload->>'score';
  else raise exception 'invalid score' using errcode='22023'; end if;
  insert into public.marks(school_id, exam_id, student_id, score, score_code)
  values(school, exam_row.id, student, score_val, code_val)
  on conflict(exam_id, student_id) do update set score=excluded.score, score_code=excluded.score_code, updated_at=now()
  returning * into mark_row;
  receipt := jsonb_build_object('id', mark_row.id, 'exam_id', mark_row.exam_id, 'student_id', mark_row.student_id, 'accepted', true);
  insert into public.write_receipts(user_id, request_id, school_id, operation, result) values(auth.uid(), request_id, school, operation, receipt);
  return receipt;
end;
$$;
revoke all on function public.apply_offline_write(uuid,text,jsonb) from public, anon;
grant execute on function public.apply_offline_write(uuid,text,jsonb) to authenticated;

alter table public.schools enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.classes enable row level security;
alter table public.teachers enable row level security;
alter table public.teacher_permissions enable row level security;
alter table public.subjects enable row level security;
alter table public.teacher_subjects enable row level security;
alter table public.teacher_classes enable row level security;
alter table public.students enable row level security;
alter table public.student_subjects enable row level security;
alter table public.terms enable row level security;
alter table public.mark_windows enable row level security;
alter table public.exams enable row level security;
alter table public.marks enable row level security;
alter table public.mark_revisions enable row level security;
alter table public.grading_scales enable row level security;
alter table public.report_cards enable row level security;
alter table public.student_notes enable row level security;
alter table public.timetable_slots enable row level security;
alter table public.bell_schedules enable row level security;
alter table public.write_receipts enable row level security;

create policy "profiles self read" on public.profiles for select to authenticated using (id=(select auth.uid()));

create policy "members read own" on public.memberships for select to authenticated using (user_id=(select auth.uid()) and active);
create policy "members admin all" on public.memberships for all to authenticated using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));

create policy "school member read" on public.schools for select to authenticated using (public.is_school_member(id));
create policy "school admin update" on public.schools for update to authenticated using (public.is_school_admin(id)) with check (public.is_school_admin(id));

create policy "classes member read" on public.classes for select to authenticated using (public.is_school_member(school_id));
create policy "classes admin write" on public.classes for all to authenticated using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));
create policy "teachers member read" on public.teachers for select to authenticated using (public.is_school_member(school_id) and (public.is_school_admin(school_id) or id=(select teacher_id from public.memberships where user_id=auth.uid() and school_id=teachers.school_id)));
create policy "teachers admin write" on public.teachers for all to authenticated using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));
create policy "teacher permissions member read" on public.teacher_permissions for select to authenticated using (exists(select 1 from public.teachers t where t.id=teacher_id and public.is_school_member(t.school_id)));
create policy "teacher permissions admin write" on public.teacher_permissions for all to authenticated using (exists(select 1 from public.teachers t where t.id=teacher_id and public.is_school_admin(t.school_id))) with check (exists(select 1 from public.teachers t where t.id=teacher_id and public.is_school_admin(t.school_id)));
create policy "subjects member read" on public.subjects for select to authenticated using (school_id is null or public.is_school_member(school_id));
create policy "subjects admin write" on public.subjects for all to authenticated using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));
create policy "teacher subjects member read" on public.teacher_subjects for select to authenticated using (public.is_school_member(school_id));
create policy "teacher subjects admin write" on public.teacher_subjects for all to authenticated using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));
create policy "teacher classes member read" on public.teacher_classes for select to authenticated using (public.is_school_member(school_id));
create policy "teacher classes admin write" on public.teacher_classes for all to authenticated using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));

create policy "students admin all" on public.students for all to authenticated using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));
create policy "students assigned read" on public.students for select to authenticated using (public.is_school_member(school_id) and (public.is_school_admin(school_id) or public.is_assigned_teacher(school_id,null,class_id)));
create policy "student subjects member read" on public.student_subjects for select to authenticated using (public.is_school_member(school_id));
create policy "student subjects admin write" on public.student_subjects for all to authenticated using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));

create policy "terms member read" on public.terms for select to authenticated using (public.is_school_member(school_id));
create policy "terms admin write" on public.terms for all to authenticated using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));
create policy "windows member read" on public.mark_windows for select to authenticated using (public.is_school_member(school_id));
create policy "windows admin write" on public.mark_windows for all to authenticated using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));
create policy "exams assigned read" on public.exams for select to authenticated using (public.is_school_admin(school_id) or public.is_assigned_teacher(school_id,subject_id,class_id));
create policy "exams admin write" on public.exams for all to authenticated using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));
create policy "marks assigned read" on public.marks for select to authenticated using (public.is_school_member(school_id) and (public.is_school_admin(school_id) or exists(select 1 from public.exams e where e.id=exam_id and e.school_id=marks.school_id and public.is_assigned_teacher(e.school_id,e.subject_id,e.class_id))));
create policy "marks scoped write" on public.marks for insert to authenticated with check (public.is_school_member(school_id) and (public.is_school_admin(school_id) or exists(select 1 from public.exams e where e.id=exam_id and e.school_id=marks.school_id and public.is_assigned_teacher(e.school_id,e.subject_id,e.class_id) and public.has_teacher_permission(e.school_id,'marks.enter'))));
create policy "marks scoped update" on public.marks for update to authenticated using (public.is_school_member(school_id) and (public.is_school_admin(school_id) or exists(select 1 from public.exams e where e.id=exam_id and e.school_id=marks.school_id and public.is_assigned_teacher(e.school_id,e.subject_id,e.class_id) and public.has_teacher_permission(e.school_id,'marks.enter')))) with check (public.is_school_member(school_id) and (public.is_school_admin(school_id) or exists(select 1 from public.exams e where e.id=exam_id and e.school_id=marks.school_id and public.is_assigned_teacher(e.school_id,e.subject_id,e.class_id) and public.has_teacher_permission(e.school_id,'marks.enter'))));
create policy "marks admin delete" on public.marks for delete to authenticated using (public.is_school_admin(school_id));
create policy "mark revisions admin read" on public.mark_revisions for select to authenticated using (public.is_school_admin(school_id));
create policy "grading member read" on public.grading_scales for select to authenticated using (public.is_school_member(school_id));
create policy "grading admin write" on public.grading_scales for all to authenticated using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));
create policy "report cards assigned read" on public.report_cards for select to authenticated using (public.is_school_admin(school_id) or (public.is_school_member(school_id) and exists(select 1 from public.students s where s.id=student_id and (public.is_assigned_teacher(s.school_id,null,s.class_id) or exists(select 1 from public.teacher_classes tc join public.memberships m on m.teacher_id=tc.teacher_id and m.school_id=tc.school_id where tc.class_id=s.class_id and tc.school_id=s.school_id and m.user_id=auth.uid() and m.active)))));
create policy "report cards admin write" on public.report_cards for all to authenticated using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));
create policy "notes member class read" on public.student_notes for select to authenticated using (public.is_school_member(school_id) and (public.is_school_admin(school_id) or exists(select 1 from public.students s where s.id=student_id and s.school_id=student_notes.school_id and public.is_assigned_teacher(s.school_id,null,s.class_id))));
create policy "notes teacher insert" on public.student_notes for insert to authenticated with check (author_id=auth.uid() and public.is_school_member(school_id) and exists(select 1 from public.students s where s.id=student_id and s.school_id=student_notes.school_id and (public.is_school_admin(s.school_id) or public.is_assigned_teacher(s.school_id,null,s.class_id))));
create policy "notes admin update delete" on public.student_notes for update to authenticated using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));
create policy "notes admin delete" on public.student_notes for delete to authenticated using (public.is_school_admin(school_id));
create policy "timetable member read" on public.timetable_slots for select to authenticated using (public.is_school_member(school_id));
create policy "timetable admin write" on public.timetable_slots for all to authenticated using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));
create policy "bell member read" on public.bell_schedules for select to authenticated using (public.is_school_member(school_id));
create policy "bell admin write" on public.bell_schedules for all to authenticated using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));
create policy "receipts own read" on public.write_receipts for select to authenticated using (user_id=(select auth.uid()));

-- Explicitly remove table access from anon; authenticated accesses remain filtered by RLS.
revoke all on all tables in schema public from anon;
revoke all on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.memberships, public.schools, public.classes, public.teachers,
  public.teacher_permissions, public.subjects, public.teacher_subjects, public.teacher_classes, public.students,
  public.student_subjects, public.terms, public.mark_windows, public.exams, public.marks, public.grading_scales,
  public.report_cards, public.student_notes, public.timetable_slots, public.bell_schedules to authenticated;
grant select on public.mark_revisions, public.write_receipts to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Timestamp maintenance; client roles and user metadata never grant authority.
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$ begin new.updated_at := now(); return new; end $$;
do $$ declare t text; begin
  foreach t in array array['schools','profiles','teachers','students','terms','exams','marks','report_cards','grading_scales','mark_windows','bell_schedules'] loop
    execute format('create trigger touch_updated_at before update on public.%I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;
