-- Examination lifecycle guards.
--
-- The Examinations page was the first surface able to move a paper out of
-- `open`, and until now the transition rules lived only in the browser. RLS
-- already limits `exams` writes to school administrators and the mark trigger
-- already refuses every score write once a paper is not `open`; this file makes
-- the lifecycle itself a database rule as well.
--
-- It is deliberately additive: no statement here rewrites an existing status,
-- total, date or mark. Applying it cannot fail because of historical data,
-- because no row is touched.
--
-- Rules:
--   1. Only a school administrator (or a trusted owner connection without a
--      user JWT, as elsewhere in this schema) may insert or update a paper.
--   2. A new paper starts as `draft` or `open`; nothing is born published.
--   3. Status moves follow one graph:
--        draft -> open
--        open  -> locked
--        locked -> published | open
--        published -> locked
--      Anything else is refused, so a hand-crafted request cannot publish a
--      paper that was never locked.
--   4. Publication needs at least one recorded outcome; an empty paper is not
--      publishable.
--   5. Totals stay between 0 and 1000 and can never fall below a score already
--      recorded against the paper.
--   6. The date sat stays inside a sane calendar range, and a per-paper deadline
--      can never fall before the date the paper is sat.
--   7. Once a paper has any marks, its term, class, subject and assessment type
--      are immutable, so stored results cannot be re-attributed by editing the
--      paper underneath them.
--
-- Legacy records: a paper written before this file is never rejected merely for
-- existing. On INSERT every rule applies in full. On UPDATE, the date range,
-- deadline order and total ceiling are checked only for values the caller is
-- actually changing, so a historical paper whose deadline predates its exam
-- date — impossible to enter today, but recordable before this guard — can
-- still be locked or published. Changing that deadline is held to the new rule,
-- which is how such a row is repaired. Transition, publication, recorded-score
-- and identity rules always apply once a change is attempted.
--
-- Marks themselves are untouched: `enforce_mark_write` continues to freeze them,
-- and the Stage 4 foreign keys keep a paper's history from being deleted.
create or replace function public.enforce_exam_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not public.is_school_admin(new.school_id) then
    raise exception 'not authorized' using errcode='42501';
  end if;

  if new.exam_date is null then
    raise exception 'paper date is outside the range a school paper can be sat' using errcode='22023';
  end if;

  if tg_op = 'INSERT' then
    if new.max_score is null or new.max_score <= 0 or new.max_score > 1000 then
      raise exception 'maximum marks must be greater than zero and at most 1000' using errcode='23514';
    end if;
    if new.exam_date < date '2000-01-01' or new.exam_date > date '2100-12-31' then
      raise exception 'paper date is outside the range a school paper can be sat' using errcode='22023';
    end if;
    if new.editing_deadline is not null and new.editing_deadline < new.exam_date::timestamptz then
      raise exception 'the editing deadline cannot fall before the date the paper is sat' using errcode='22023';
    end if;
    if new.status not in ('draft','open') then
      raise exception 'a paper must start as a draft or open for entry' using errcode='22023';
    end if;
    return new;
  end if;

  if new.id <> old.id or new.school_id <> old.school_id then
    raise exception 'paper identity is immutable' using errcode='42501';
  end if;

  -- Values the caller is writing are held to the full rule; untouched legacy
  -- values are not re-judged.
  if new.max_score is distinct from old.max_score
     and (new.max_score is null or new.max_score <= 0 or new.max_score > 1000) then
    raise exception 'maximum marks must be greater than zero and at most 1000' using errcode='23514';
  end if;

  if new.exam_date is distinct from old.exam_date
     and (new.exam_date < date '2000-01-01' or new.exam_date > date '2100-12-31') then
    raise exception 'paper date is outside the range a school paper can be sat' using errcode='22023';
  end if;

  if (new.editing_deadline is distinct from old.editing_deadline or new.exam_date is distinct from old.exam_date)
     and new.editing_deadline is not null
     and new.editing_deadline < new.exam_date::timestamptz then
    raise exception 'the editing deadline cannot fall before the date the paper is sat' using errcode='22023';
  end if;

  if new.status is distinct from old.status
     and not ((old.status='draft' and new.status='open')
           or (old.status='open' and new.status='locked')
           or (old.status='locked' and new.status='published')
           or (old.status='locked' and new.status='open')
           or (old.status='published' and new.status='locked')) then
    raise exception 'invalid examination status transition' using errcode='22023';
  end if;

  if new.status='published' and old.status<>'published'
     and not exists(select 1 from public.marks m where m.exam_id=new.id and (m.score is not null or m.score_code is not null)) then
    raise exception 'a paper with no recorded result cannot be published' using errcode='22023';
  end if;

  if new.max_score < old.max_score
     and exists(select 1 from public.marks m where m.exam_id=new.id and m.score is not null and m.score > new.max_score) then
    raise exception 'the maximum cannot fall below a recorded score' using errcode='23514';
  end if;

  if (new.term_id<>old.term_id or new.class_id<>old.class_id or new.subject_id<>old.subject_id or new.exam_type<>old.exam_type)
     and exists(select 1 from public.marks m where m.exam_id=new.id) then
    raise exception 'a paper with recorded results cannot change its term, class, subject or assessment type' using errcode='42501';
  end if;

  return new;
end;
$$;
revoke all on function public.enforce_exam_write() from public,anon,authenticated;
drop trigger if exists enforce_exam_write_before on public.exams;
create trigger enforce_exam_write_before
  before insert or update on public.exams
  for each row execute procedure public.enforce_exam_write();
