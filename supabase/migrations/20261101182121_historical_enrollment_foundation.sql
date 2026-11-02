-- Phase 2A only: empty, independent enrollment evidence; NO backfill or consumer switch.
-- Term UUIDs are authoritative. Exact dates use [from,to); symbolic term ends
-- remain symbolic because terms has no end_date. Unknown is never infinity.
-- Apply once through migration history, not as a rerunnable bootstrap.

do $ddl$
declare axis text; rel text; extra text;
begin
  foreach axis in array array['school','class','subject'] loop
    rel := 'student_' || axis || '_enrollment_history';
    extra := case axis
      when 'school' then $extra$
        school_state text not null default 'unknown'
          check (school_state in ('enrolled','pre_enrollment','not_enrolled','unknown')),
        entry_kind text not null default 'unknown'
          check (entry_kind in ('admission','return','continuation','unknown')),
        check (school_state='enrolled' or entry_kind='unknown')
      $extra$
      when 'class' then $extra$
        school_history_id uuid not null,
        class_id uuid not null,
        subject_scope_complete boolean not null default false,
        foreign key (class_id,school_id) references public.classes(id,school_id) on delete restrict,
        foreign key (school_history_id,school_id,student_id,term_id)
          references public.student_school_enrollment_history(id,school_id,student_id,term_id) on delete restrict
      $extra$
      else $extra$
        class_history_id uuid not null,
        subject_id uuid not null,
        subject_state text not null default 'unknown'
          check (subject_state in ('enrolled','not_taken','unknown')),
        foreign key (subject_id,school_id) references public.subjects(id,school_id) on delete restrict,
        foreign key (class_history_id,school_id,student_id,term_id)
          references public.student_class_enrollment_history(id,school_id,student_id,term_id) on delete restrict
      $extra$ end;
    execute format($table$
      create table public.%I (
        id uuid primary key default gen_random_uuid(),
        school_id uuid not null references public.schools(id) on delete restrict,
        student_id uuid not null,
        term_id uuid not null,
        fact_id uuid not null,
        revision integer not null check (revision>0),
        supersedes_id uuid unique,
        change_id uuid not null,
        coverage_kind text not null default 'unknown'
          check (coverage_kind in ('whole_term','dated_segment','partial_term_dates_unknown','unknown')),
        start_precision text not null default 'unknown'
          check (start_precision in ('term_start','exact_date','unknown')),
        end_precision text not null default 'unknown'
          check (end_precision in ('term_end','exact_date','unknown')),
        effective_from date,
        effective_to date,
        evidence_state text not null default 'unverified'
          check (evidence_state in ('unverified','confirmed','conflict','voided')),
        source_type text not null default 'administrator_review'
          check (source_type in ('admission_register','class_register','subject_selection',
            'transfer_record','departure_record','return_record','administrator_review','legacy_observation')),
        source_reference text not null default '' check (length(source_reference)<=240),
        reason text not null check (length(btrim(reason)) between 1 and 1000),
        recorded_by uuid not null references auth.users(id) on delete restrict,
        recorded_at timestamptz not null,
        updated_at timestamptz not null,
        confirmed_by uuid references auth.users(id) on delete restrict,
        confirmed_at timestamptz,
        unique (school_id,fact_id,revision),
        unique (id,school_id,student_id,term_id),
        foreign key (student_id,school_id) references public.students(id,school_id) on delete restrict,
        foreign key (term_id,school_id) references public.terms(id,school_id) on delete restrict,
        foreign key (supersedes_id,school_id,student_id,term_id)
          references public.%I(id,school_id,student_id,term_id) on delete restrict,
        check ((start_precision='exact_date')=(effective_from is not null)),
        check ((end_precision='exact_date')=(effective_to is not null)),
        check (effective_from is null or isfinite(effective_from)),
        check (effective_to is null or isfinite(effective_to)),
        check (effective_from is null or effective_to is null or effective_to>effective_from),
        check (
          (coverage_kind='whole_term' and start_precision='term_start' and end_precision='term_end')
          or (coverage_kind='dated_segment' and start_precision<>'unknown' and end_precision<>'unknown'
              and (start_precision='exact_date' or end_precision='exact_date'))
          or (coverage_kind='partial_term_dates_unknown'
              and (start_precision='unknown' or end_precision='unknown')
              and (start_precision<>'unknown' or end_precision<>'unknown'))
          or (coverage_kind='unknown' and start_precision='unknown' and end_precision='unknown')
        ),
        check ((evidence_state='confirmed')=(confirmed_by is not null and confirmed_at is not null)),
        check (evidence_state='confirmed' or (confirmed_by is null and confirmed_at is null)),
        check (evidence_state='unverified' or length(btrim(source_reference))>0),
        check (source_type<>'legacy_observation' or evidence_state<>'confirmed'),
        %s
      )
    $table$, rel, rel, extra);
    execute format('alter table public.%I enable row level security',rel);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',rel);
    execute format('grant select on public.%I to authenticated',rel);
    execute format('create policy history_admin_read on public.%I for select to authenticated using (public.is_school_admin(school_id))',rel);
    execute format('create index %I on public.%I(school_id,student_id,term_id)',rel||'_student_idx',rel);
    execute format('create index %I on public.%I(school_id,evidence_state,term_id)',rel||'_review_idx',rel);
  end loop;
end;
$ddl$;

create index class_history_roster_idx on public.student_class_enrollment_history(school_id,term_id,class_id,student_id);
create index class_history_parent_idx on public.student_class_enrollment_history(school_history_id);
create index subject_history_roster_idx on public.student_subject_enrollment_history(school_id,term_id,subject_id,student_id);
create index subject_history_parent_idx on public.student_subject_enrollment_history(class_history_id);

-- Three isolated read contracts. Pending proposals do not hide a confirmed
-- ancestor; conflict/voided terminal revisions do. No resurrection after void.
-- security_invoker preserves the new base-table admin-only RLS.
do $views$
declare axis text; rel text;
begin
  foreach axis in array array['school','class','subject'] loop
    rel := 'student_'||axis||'_enrollment_history';
    execute format($view$
      create view public.%I with (security_invoker=true) as
      select h.* from public.%I h
      where h.evidence_state='confirmed' and not exists (
        select 1 from public.%I newer where newer.school_id=h.school_id
          and newer.fact_id=h.fact_id and newer.revision>h.revision
          and newer.evidence_state in ('confirmed','conflict','voided'))
    $view$,rel||'_effective',rel,rel);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',rel||'_effective');
    execute format('grant select on public.%I to authenticated',rel||'_effective');
  end loop;
end;
$views$;

-- Symbolic bounds are compared within a term only. Unknown bounds conservatively
-- overlap any assertion in that term; this does not turn them into eligibility.
create function public.enrollment_history_overlaps(a jsonb,b jsonb)
returns boolean language sql immutable set search_path='' as $$
  select case
    when a->>'term_id'=b->>'term_id' then not (
      coalesce((a->>'effective_to')::date <= (b->>'effective_from')::date,false)
      or coalesce((b->>'effective_to')::date <= (a->>'effective_from')::date,false))
    when a->>'start_precision'='exact_date' and a->>'end_precision'='exact_date'
      and b->>'start_precision'='exact_date' and b->>'end_precision'='exact_date'
      then daterange((a->>'effective_from')::date,(a->>'effective_to')::date,'[)')
        && daterange((b->>'effective_from')::date,(b->>'effective_to')::date,'[)')
    else false
  end
$$;

create function public.enrollment_history_contains(parent jsonb,child jsonb)
returns boolean language sql immutable set search_path='' as $$
  select parent->>'term_id'=child->>'term_id' and (
    parent->>'coverage_kind'='whole_term'
    or (
      parent->>'coverage_kind'='dated_segment'
      and child->>'coverage_kind'='dated_segment'
      and (parent->>'start_precision'='term_start'
        or (child->>'start_precision'='exact_date'
          and (child->>'effective_from')::date >= (parent->>'effective_from')::date))
      and (parent->>'end_precision'='term_end'
        or (child->>'end_precision'='exact_date'
          and (child->>'effective_to')::date <= (parent->>'effective_to')::date))
    ))
$$;

revoke all on function public.enrollment_history_overlaps(jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.enrollment_history_contains(jsonb,jsonb) from public,anon,authenticated,service_role;

create function public.guard_enrollment_history()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  prior jsonb; candidate jsonb; parent jsonb; terminal boolean;
  conflict_found boolean; child_found boolean; term_start date;
  parent_rel text; parent_id uuid; axis_key text;
begin
  if tg_op<>'INSERT' then
    raise exception 'Enrollment evidence is append-only; append a correction revision' using errcode='42501';
  end if;
  if auth.uid() is null or not public.is_school_admin(new.school_id) then
    raise exception 'Not authorized for enrollment evidence' using errcode='42501';
  end if;
  -- A READ COMMITTED volatile trigger takes a fresh snapshot after this lock.
  -- Reject stale fixed-snapshot transactions rather than permit write skew.
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'History writes require READ COMMITTED' using errcode='25001';
  end if;
  perform 1 from public.students s where s.id=new.student_id and s.school_id=new.school_id for update;
  if not found then raise exception 'Invalid history scope' using errcode='23503'; end if;
  select t.start_date into term_start from public.terms t where t.id=new.term_id and t.school_id=new.school_id;
  if not found then raise exception 'Invalid history term' using errcode='23503'; end if;
  if new.effective_from<term_start or new.effective_to<=term_start then
    raise exception 'Exact bounds precede the selected term' using errcode='23514';
  end if;
  if new.supersedes_id is null then
    new.revision:=1;
  else
    execute format('select to_jsonb(h) from public.%I h where id=$1 and school_id=$2 and student_id=$3 and term_id=$4',tg_table_name)
      into prior using new.supersedes_id,new.school_id,new.student_id,new.term_id;
    if prior is null or prior->>'fact_id'<>new.fact_id::text then
      raise exception 'Invalid correction ancestry' using errcode='23514';
    end if;
    new.revision:=(prior->>'revision')::integer+1;
    if tg_table_name='student_class_enrollment_history' and prior->>'class_id' is distinct from to_jsonb(new)->>'class_id' then
      raise exception 'Retire placement and create a distinct class fact' using errcode='23514';
    end if;
    if tg_table_name='student_subject_enrollment_history' and prior->>'subject_id' is distinct from to_jsonb(new)->>'subject_id' then
      raise exception 'Retire participation and create a distinct subject fact' using errcode='23514';
    end if;
  end if;
  new.recorded_by:=auth.uid(); new.recorded_at:=clock_timestamp(); new.updated_at:=new.recorded_at;
  new.confirmed_by:=case when new.evidence_state='confirmed' then auth.uid() else null end;
  new.confirmed_at:=case when new.evidence_state='confirmed' then new.recorded_at else null end;
  candidate:=to_jsonb(new);
  terminal:=new.evidence_state in ('confirmed','conflict','voided');

  -- Retiring/changing a parent never silently repoints or orphans live children.
  if terminal and tg_table_name='student_school_enrollment_history' then
    select exists(select 1 from public.student_class_enrollment_history_effective c
      join public.student_school_enrollment_history p on p.id=c.school_history_id
      where p.school_id=new.school_id and p.fact_id=new.fact_id) into child_found;
  elsif terminal and tg_table_name='student_class_enrollment_history' then
    select exists(select 1 from public.student_subject_enrollment_history_effective s
      join public.student_class_enrollment_history p on p.id=s.class_history_id
      where p.school_id=new.school_id and p.fact_id=new.fact_id) into child_found;
  end if;
  if coalesce(child_found,false) then
    raise exception 'Retire confirmed children before correcting their parent' using errcode='23514';
  end if;

  if new.evidence_state='confirmed' then
    if tg_table_name<>'student_school_enrollment_history' then
      parent_rel:=case when tg_table_name='student_class_enrollment_history'
        then 'student_school_enrollment_history_effective' else 'student_class_enrollment_history_effective' end;
      parent_id:=case when tg_table_name='student_class_enrollment_history'
        then (candidate->>'school_history_id')::uuid else (candidate->>'class_history_id')::uuid end;
      execute format('select to_jsonb(p) from public.%I p where id=$1 and school_id=$2 and student_id=$3 and term_id=$4',parent_rel)
        into parent using parent_id,new.school_id,new.student_id,new.term_id;
      if parent is null or (parent_rel='student_school_enrollment_history_effective' and parent->>'school_state'<>'enrolled')
        or not coalesce(public.enrollment_history_contains(parent,candidate),false) then
        raise exception 'Confirmed child requires compatible effective confirmed parent' using errcode='23514';
      end if;
    end if;
    axis_key:=case when tg_table_name='student_subject_enrollment_history' then 'subject_id' else null end;
    execute format($overlap$
      select exists(select 1 from public.%I h
        where h.school_id=$1 and h.student_id=$2 and h.fact_id<>$3
          and ($4::text is null or to_jsonb(h)->>$4=$5->>$4)
          and public.enrollment_history_overlaps(to_jsonb(h),$5))
    $overlap$,tg_table_name||'_effective')
      into conflict_found using new.school_id,new.student_id,new.fact_id,axis_key,candidate;
    if conflict_found then raise exception 'Overlapping confirmed enrollment evidence' using errcode='23514'; end if;

    if (tg_table_name='student_school_enrollment_history' and candidate->>'school_state' in ('pre_enrollment','not_enrolled'))
      or (tg_table_name='student_subject_enrollment_history' and candidate->>'subject_state'='not_taken') then
      select exists(select 1 from public.marks m join public.exams e on e.id=m.exam_id and e.school_id=m.school_id
        where m.school_id=new.school_id and m.student_id=new.student_id and e.term_id=new.term_id
          and (m.score is not null or m.score_code is not null)
          and (tg_table_name='student_school_enrollment_history' or e.subject_id=(candidate->>'subject_id')::uuid)
          and (new.effective_from is null or e.exam_date>=new.effective_from)
          and (new.effective_to is null or e.exam_date<new.effective_to)) into conflict_found;
      if conflict_found then
        raise exception 'Negative eligibility conflicts with accepted assessment evidence; record conflict for review'
          using errcode='23514';
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_enrollment_history() from public,anon,authenticated,service_role;

do $triggers$
declare axis text; rel text;
begin
  foreach axis in array array['school','class','subject'] loop
    rel:='student_'||axis||'_enrollment_history';
    execute format('create trigger history_append_guard before insert or update or delete on public.%I for each row execute function public.guard_enrollment_history()',rel);
    execute format('create trigger history_truncate_guard before truncate on public.%I for each statement execute function public.guard_enrollment_history()',rel);
  end loop;
end;
$triggers$;

-- The ONLY authenticated write surface. IDs identifying existing entities are
-- checked by admin membership, tenant FKs and guards; actor/time/revision are
-- always server-derived. No writes to current students/subjects/marks occur.
create function public.append_enrollment_history(axis text,input_row jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare rel text; allowed text[]; extra text[]; values_row jsonb; prior jsonb; result uuid; target_school uuid;
begin
  if axis not in ('school','class','subject') or axis is null or jsonb_typeof(input_row) is distinct from 'object' then
    raise exception 'Invalid history request' using errcode='22023';
  end if;
  rel:='student_'||axis||'_enrollment_history';
  allowed:=array['school_id','student_id','term_id','fact_id','supersedes_id','change_id',
    'coverage_kind','start_precision','end_precision','effective_from','effective_to',
    'evidence_state','source_type','source_reference','reason'];
  extra:=case axis when 'school' then array['school_state','entry_kind']
    when 'class' then array['school_history_id','class_id','subject_scope_complete']
    else array['class_history_id','subject_id','subject_state'] end;
  if exists(select 1 from jsonb_object_keys(input_row) k where not k=any(allowed||extra)) then
    raise exception 'Unexpected history field; audit identity is server controlled' using errcode='22023';
  end if;
  target_school:=(input_row->>'school_id')::uuid;
  if auth.uid() is null or target_school is null or not public.is_school_admin(target_school) then
    raise exception 'Not authorized for enrollment evidence' using errcode='42501';
  end if;
  if input_row->>'supersedes_id' is not null then
    execute format('select to_jsonb(h) from public.%I h where id=$1 and school_id=$2',rel)
      into prior using (input_row->>'supersedes_id')::uuid,target_school;
    if prior is null then raise exception 'Invalid correction ancestry' using errcode='23514'; end if;
    if input_row->>'fact_id' is not null and input_row->>'fact_id'<>prior->>'fact_id' then
      raise exception 'Correction cannot change fact identity' using errcode='23514';
    end if;
  end if;
  values_row:=jsonb_build_object('id',gen_random_uuid(),'fact_id',coalesce((prior->>'fact_id')::uuid,
    (input_row->>'fact_id')::uuid,gen_random_uuid()),'change_id',gen_random_uuid(),
    'coverage_kind','unknown','start_precision','unknown','end_precision','unknown',
    'evidence_state','unverified','source_type','administrator_review','source_reference','',
    'school_state','unknown','entry_kind','unknown','subject_scope_complete',false,'subject_state','unknown')
    || input_row;
  execute format('insert into public.%I select (jsonb_populate_record(null::public.%I,$1)).* returning id',rel,rel)
    into result using values_row;
  return result;
end;
$$;
revoke all on function public.append_enrollment_history(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.append_enrollment_history(text,jsonb) to authenticated;

comment on function public.append_enrollment_history(text,jsonb) is
  'Phase 2A admin-only append/revision contract. READ COMMITTED. No backfill, live eligibility integration, or current-record changes.';
