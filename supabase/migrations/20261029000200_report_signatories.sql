-- Report-card signatories are school settings, not free-text report-card edits.
-- Existing schools start with no configured principal; existing classes start
-- without an assigned class teacher. No student or report-card data is changed.
alter table public.schools
  add column principal_name text not null default ''
    check (length(trim(principal_name)) <= 160);

alter table public.classes
  add column class_teacher_id uuid;

alter table public.classes
  add constraint classes_class_teacher_school_fk
  foreign key (class_teacher_id, school_id)
  references public.teachers(id, school_id)
  on delete set null (class_teacher_id);
