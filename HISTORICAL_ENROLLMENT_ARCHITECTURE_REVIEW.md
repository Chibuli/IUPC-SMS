# Historical enrollment and academic eligibility architecture review

IUPC Academy, Mombasa, Kenya. Phase 1: repository-only investigation.

## 1. Recommendation and evidence limits

The missing capability is authoritative enrollment evidence for each academic period, not a new grading formula. Keep the existing student register, current class and subject assignments, accepted marks and calculation rules. Add a small administrator-controlled history layer that independently records school participation, class placement and subject eligibility, with verified negative facts, unknown states, evidence references and immutable corrections.

The recommended minimum is **three additive term-scoped history tables**, with revision/audit metadata on their rows. They can store confirmed whole-term facts when exact dates are unavailable, and dated segments when documented dates exist. No replacement backend, new grading engine, general event platform or separate academic-year table is required. This is a proposed contract, not implemented SQL.

A verified class register can establish eligibility for a term without establishing the exact original admission date. Conversely, an accepted examination result does not establish the student's complete school/class/subject coverage for the year. Never fill admission dates from database creation timestamps or infer pre-enrollment from absent marks.

**Smallest safe next step:** separately authorize Phase 2A to review the additive history schema, administrator-only confirmation contract and fictional compatibility tests. Leave current consumers and official calculations unchanged. Execute migrations and connect verified history only in later, separately authorized stages. Midterm exemptions, transfer ranking and annual subject-switch treatment need explicit school decisions.

This investigation establishes what the checked-in schema and application define. It does **not** certify which migrations are applied to any database, inspect real student information, or certify production configuration. Tests and fictional fixtures were read as source; they are not evidence of actual enrollment. No hosted service, SQL query, test runner, build or browser was used in this phase.

## 2. Git baseline and permitted artifact

- Branch: main.
- Actual HEAD: **49faa11d56c551af30cc408521f645055e1cb0e5**, feat(marks-entry): refine academic marks entry workspace.
- Parent checkpoint: **be9f3fbf545f57565f1ae90634ea63b0761b03c5**, feat(app): checkpoint IUPC school management system.
- Earlier commits inspected: 1cff1b1, student subject enrollment; 2637e60, offline Android/register-gated sign-up.
- Tracked files were clean; twelve previously excluded files remained untracked. Their names appear in section 16. No production credentials were used or environment values read.
- The only authorized addition is this document. Application source, migrations, tests and existing documentation remain unchanged; nothing is staged or committed.

## 3. Existing database model

| Relation | Relevant repository-defined fields | Authority and limitation |
| --- | --- | --- |
| students | id, school_id, admission_number, full_name, gender, date_of_birth, class_id, guardian fields, status, created_at, updated_at; later archived, archived_at, archived_by | Student identity and current placement/status; no academic admission date, initial-class history or withdrawal/return intervals. |
| student_subjects | school_id, student_id, subject_id; primary key student_id + subject_id | Current subject membership only. No academic-year, term, class, start/end date or creation timestamp. |
| student_lifecycle_events | id, school_id, student_id, actor_id, archived/reactivated event, created_at | Administrative archival audit; not academic admission/departure/re-admission history. No effective date, class/subject snapshot or evidence reference. |
| classes | id, school_id, class_name, stream_name, created_at; later class_teacher_id | Stable current class identity and signatory assignment. No student membership timeline or year-effective placement. |
| terms | id, school_id, name, academic_year text, is_active, start_date, created_at | Stable term UUID and configured year/start. No end date, explicit ordinal or separate academic-year foreign key. |
| exams | id, school_id, term_id, class_id, subject_id, exam_name/type, max_score, exam_date, editing_deadline, status, timestamps | Examination context, maximum and entry/finalization status. Not a student eligibility/attendance roster. |
| marks | student/exam/school IDs, numeric score or X/Y score_code, remarks, entered_by, updated_at | Accepted server examination result. Not enrollment history or evidence that a missing score means ineligibility. |
| mark_revisions | school/mark/actor IDs, old/new scores/codes, changed_at | Score-change audit; no class/subject/admission history. |
| write_receipts | actor/request/school IDs, operation, payload, result, created_at | Idempotent accepted submission evidence. Submission time is not admission or examination participation time. |
| report_cards | school/student/term IDs, attendance counts, remarks/sign-off text, next-term dates, updated_at | Period-specific manual information; no immutable computed result snapshot or enrollment evidence versions. |
| student_notes | school/student/author IDs, body, author_name, created_at | Contextual narrative. Not structured, confirmed, complete enrollment evidence. |
| teacher_subjects / teacher_classes | teacher/school/subject or class IDs | Authorization assignments without academic effective dates. Not student eligibility. |
| timetable_slots | school/term/class/subject/teacher IDs, day/period/week/room, created_at | Selected-term teacher assignment where unambiguous. No dated teacher-change history within a term. Rows are editable. |
| mark_windows | school_id, closes_at, updated_at | School-wide entry deadline, not an enrollment or term boundary. |

Sources: [initial schema](supabase/migrations/20261028000100_initial_schema.sql#L85), [archival additions](supabase/migrations/20261029000100_student_archival.sql#L3), [signatories](supabase/migrations/20261029000200_report_signatories.sql), [latest retention controls](supabase/migrations/20261031000100_stage4_mark_integrity_and_retention.sql).

The frontend Student type does not expose student created_at/updated_at or archived_by. Its subject_ids, enrollment_certainty and enrollment_term_id are **transient loader results**, not persisted history columns. The Database type has no enrollment-history or lifecycle-event collection. See [types](src/data/types.ts#L86) and [loader](src/data/backend.ts#L75).

## 4. Registration: authoritative fields versus proxies

| Requested property | Classification | Finding |
| --- | --- | --- |
| Admission number | Explicit authoritative field | Stored, manually entered, school/admission uniqueness in SQL. Number formatting does not prove a date/year. |
| Academic admission date | Not recorded | No join/admission-date field in the schema, model or form. DOB is unrelated. |
| Creation date | Explicit technical field; unreliable admission proxy | Student insertion timestamp exists in SQL, not the loaded Student model. It cannot be used as an academic admission date. |
| School enrollment status | Explicit current operational field | Active/Alumni and separate archival flag; neither establishes historical participation. |
| Initial class | Not independently preserved | Creation writes class_id; the same field can later be overwritten. Current placement is an unreliable initial-class proxy. |
| Current class | Explicit authoritative current field | Same-school class_id foreign key. |
| Academic year of admission | Not recorded | Cannot safely derive from current class, admission number, created_at or first mark. |
| Previous school | Not structurally recorded | Possible narrative notes are not verified structured facts. Not needed for minimal reporting eligibility storage. |
| Class transfer history | Not recorded | Current placement can change; no dated before/after event or class membership relation. |
| Departure/withdrawal dates | Not recorded academically | archived_at proves an archive operation time only. |
| Return/re-admission history | Administrative audit only; unreliable academic proxy | Reactivation is logged and current archive metadata cleared. It does not confirm an academic return date. |

The admission form collects identity, DOB, class, subjects and guardian information. It explicitly creates an Active student through api.students.create -> save_student. Its suggested subjects come from loaded class examinations, otherwise a class-year-name-to-level heuristic. That suggestion is not historical evidence. A null form subject selection means use the suggested list; administrators can deliberately select a different list.

The backend supports administrator updates through api.students.update -> update_student. A repository search found no current page caller of api.students.update: the inspected Students UI has admission subject selection and enrollment display, not a complete historical correction/transfer editor. Do not assume a history workflow already exists.

Sources: [form and subject suggestions](src/pages/Students.tsx#L15), [admission handler](src/pages/Students.tsx#L163), [student API](src/data/db.ts#L101), [save/update RPCs](supabase/migrations/20261028000500_backend_hardening.sql#L64).

## 5. Current class and subject assignments are not history

### Class placement

The model cannot generally answer which class a student attended in Term 1, Term 2 or Term 3, whether placement covered the term beginning, or when a transfer started/ended. There is only current class_id. Classes are not year-versioned; school + class_name + stream_name is unique, so class identity can span years.

A mark's exam supplies a definite assessment class/term/subject context. That does not establish full-term class placement, all eligible subjects or classmates without marks. Present SQL guards check current class at write time; neither that nor an entry timestamp proves the student's placement on every examination date. The investigation cannot assume that all older data was captured under the latest guard chain.

### Subject placement

save_student inserts current student_subjects rows. **update_student deletes the complete existing list and inserts its replacement**, atomically with the student update. Even an unrelated profile edit through this operation rewrites the current subject list. No enrollment dates, previous sets or academic periods survive in that relation.

Subject membership itself has no class foreign key: operational eligibility combines the student/subject link with current student class and examination class. SQL checks tenant subject IDs, not an historical class curriculum. Subject IDs should remain tenant-scoped identities; Cambridge codes or display names cannot stand in for history keys.

Current subjects can be changed during a term through the administrator backend, but the date and reason are not captured. Removing membership erases that current link; it does not delete accepted marks. The exact-subject guard then rejects a later mark update while that enrollment is absent. Re-adding a subject does not recover the earlier interval.

| Question | Reliably answerable now? |
| --- | --- |
| Currently enrolled, with complete authorized verification | Yes, for the current relation/snapshot. |
| Never took the subject | No; current absence does not establish past non-participation. |
| Joined a subject late / changed / discontinued it | No preserved start/end or prior subject list. |
| Was enrolled but missed an assessment | Only if period eligibility is independently known; absence of a mark is insufficient. |
| Changed classes | Current class can differ; transfer history is unavailable. |
| Historic subject eligibility unknown | Must remain unknown; do not infer N/T or pre-enrollment. |

Sources: [subject relation](supabase/migrations/20261028000100_initial_schema.sql#L98), [replacement operation](supabase/migrations/20261028000500_backend_hardening.sql#L85), [exact enrollment trigger](supabase/migrations/20261030000200_enforce_exact_subject_enrollment.sql), [guard test source](supabase/tests/exact_subject_enrollment.test.sql).

## 6. Academic terms and selection

Term UUID is the stable academic period identifier. Academic year is a text group, with uniqueness on school/name/year and at most one active term per school; exactly one active term is not guaranteed. The loader verifies enrollment only when precisely one term is active.

Reports select a UUID, filter its school/year, require three distinct configured term start dates, and order by those dates. They do not parse display names or use today's date for academic selection. There is no separate persisted term ordinal.

Terms have no end date. The Terms UI labels inactive terms Closed, but that is derived from is_active, not a separately recorded closure/finalization state. Examination status and editing deadlines govern assessment entry; mark_windows supplies a school-wide deadline. No enrollment/assessment applicability window or exemption fact follows from those deadlines. A report card's next-term dates are not the authoritative calendar.

The verification RPC accepts a requested existing term but queries current student_subjects and current class_id. The loader normally requests only the active term and stamps the returned scope with that UUID. **Activating an old term does not reconstruct old enrollment**: it would attach current-state verification to the newly requested period. It must not be used as a historical backfill workaround.

Reuse existing UUIDs/year grouping. A separate academic-year table is unnecessary for the minimum. An optional terms.end_date could later support reliable exact-date interval classification, but it must come from verified school calendar data. Do not infer it from the next term's start or report-card text. Explicit term attestations can work without this addition.

Sources: [term schema](supabase/migrations/20261028000100_initial_schema.sql#L106), [activation](supabase/migrations/20261028000300_admin_operations.sql#L29), [terms UI](src/pages/Terms.tsx), [report ordering](src/lib/academic-report.ts#L59), [verification RPC](supabase/migrations/20261029000300_verify_student_enrollments.sql).

## 7. Actual eligibility and calculation paths

### Backend verification

loadSchoolDatabase verifies account/school/session scope and loads the complete authorized mark set with pagination/count checks. For the unique active term, it calls verify_student_enrollments in batches of up to 500. The decoder distinguishes verified enrollment, verified empty, unknown and error, rejecting duplicate/malformed subject IDs and ambiguous response rows.

The SQL verifier returns authorized non-archived students. Admins may obtain the full current enrollment list. Teachers require relevant class access and authorization over **all current enrollment and examination subjects in scope**, plus relevant assessments; otherwise scope is unknown rather than a partial list represented as complete. Missing response rows also remain unknown. This is authorization completeness, not proof of academic enrollment duration.

### Marks Entry

verifiedEnrolledIn requires verified_enrolled, exact selected-term stamp, a nonempty unique well-formed subject list and the selected subject. The roster starts with operational Active/non-archived pupils in the current class, then displays the existing eligible subset. Unresolved enrollment is shown separately. Editing still depends on the current paper permission.

api.marks.setScore uses the durable offline submission/receipt path and existing server checks. apply_offline_write checks current class; triggers enforce current exact subject membership and lifecycle/permission rules. Queued/rejected submissions are not official report results. History integration must not silently weaken those rules or provide retrospective permission to edit any past examination.

### Live reports versus fixture evidence

The Report Cards roster includes current operational class members and, for administrators, additional students found through marks in the selected year's periods up to the selected term. This is historical discovery, not a complete historical enrollment population. Pupils without surviving marks may be absent.

The engine accepts ReportEvidence[], but **the live Report Cards page calls buildAcademicReport without that argument**. Fictional late-admission fixtures explicitly supply it. There is no persisted live evidence adapter; passing fixtures do not demonstrate that real admission history exists.

eligibilityFor requires exactly one student/term evidence row. An explicit pre-enrollment row yields N/A. An enrolled row must match class; its subject list supplies enrolled versus N/T. Conflicting duplicate rows or a mismatched class yield unknown. Without evidence, fallback requires current class, matching transient term stamp and verified_enrolled with subjects. verified_no_enrollments is not turned into a complete historical evidence row by that fallback.

ReportEvidence has one class and subject list per student/term. It lacks provenance/revisions, a school ID of its own and within-term intervals. It should remain a narrowly validated adapter output, not a teacher-editable payload. Future adapters must enforce tenant consistency and complete, nonconflicting scope before creating it.

### Missing results and an important implementation nuance

termSubject requires one Midterm and one Endterm paper, accepted valid numeric marks, normalization through the paper maximum and locked/published status. Open/draft remains Pending; X is missing/INC, Y irregularity. Missing required components do not become zero. No structured explicit absence or authorized exemption facility exists.

With a complete numeric pair, **a subject can currently have a numeric Complete result despite unknown eligibility**, because numeric completeness is checked before the unknown-status fallback. A subject band can therefore be derived while its eligibility-aware remark says Unresolved. The overall result explicitly rejects unknown eligibility, and subject positions require enrolled eligibility. Do not claim that every subject number/grade is currently suppressed when history is unknown. This is a future presentation/integration risk, not a change performed here.

cumulativeResult uses equal elapsed-term weights and skips only N/A as legitimate pre-enrollment. Other missing required terms make it INC/Unresolved. Legitimate shorter school-entry coverage is Provisional with an accurate term count. Prior N/T is not equivalent to pre-enrollment; it is not automatically averaged around as a late school admission.

Overall term averages exclude verified N/T, require known eligibility and complete required results. Different term subject sets withhold cumulative overall output as subject-coverage Unresolved. A currently N/T subject has no cumulative subject result. Storage alone cannot define an annual subject-switch policy.

### Rankings, class changes and trends

Current reportPosition uses complete current overall performance in the selected term/class and identical sorted subject-set group. Cumulative position requires Complete cumulative coverage, excluding provisional students. Competition ties use the established 1e-9 tolerance; denominator counts eligible reports in the supplied population. The rank utility cannot discover missing classmates or repair a partial RLS-visible roster.

The report constructor passes the **same selected class ID into every term's assessment lookup**. A transfer between terms cannot be fixed by adding a history row alone: future per-term class lookup and cohort mapping are necessary. Passing two class evidence rows for one term instead produces unknown. Intraterm transfer grouping needs school policy.

Subject trends compare consecutive completed term averages. Graph mapping requires Complete overall values or verified eligible assessment components in its within-term mode. Graph points and averages are not enrollment evidence.

### Broadsheets

The live Reports page uses the unique active term, current operational class/stream roster and authorized subjects. buildCompactBroadsheet normalizes the selected Midterm/Endterm mode, retains enrollment-only subjects, marks verified non-participation N/T and downgrades hidden/partial scope to unknown. buildBroadsheet requires matching term verification, complete valid enrollment, all required numeric results and no unassessed subjects before ranking. Existing incomplete/provisional terminology is not the same as report-card late-admission provisional coverage and must not be silently redefined.

This is neither historical enrollment storage nor an annual ranking source. It should not be altered simply to make historic report-card ranks available.

Sources: [loader](src/data/backend.ts#L75), [authorized marks](src/data/load-marks.ts), [decoder](src/lib/enrollment-certainty.ts), [Marks Entry](src/pages/MarksEntry.tsx#L33), [live reports](src/pages/ReportCards.tsx#L43), [engine](src/lib/academic-report.ts#L25), [subject ranks](src/components/AcademicReportSheet.tsx#L64), [graph](src/lib/report-performance-graph.ts), [broadsheet adapter](src/lib/compact-broadsheet.ts#L18), [broadsheet completeness](src/lib/analytics.ts#L125).

## 8. Security and administrative authority

| Operation | Existing authority |
| --- | --- |
| Admit student; select current class/subjects | Administrator UI, save_student administrator check, tenant constraints and RLS. |
| Update profile/current class/current subjects | Administrator RPC and students/subject-membership policies; no ordinary teacher enrollment-edit grant. |
| Remove subject enrollment | Administrator policy; archival guard prevents archived-history mutation. |
| Archive/reactivate | Deliberate admin RPC, student row locks and append-only lifecycle events; not academic withdrawal/return. |
| Enter/correct scores | Existing assignment, marks.enter, deadline, open-paper, lifecycle and exact-enrollment checks. |
| View history | Same-school admins retain archived records. Teachers receive only authorized RLS-visible non-archived student/assessment records. No general historic-all-students grant. |
| Change timetable/terms/settings | Existing administrator workflow; no enrollment-history authority is implied for teachers. |

is_school_admin uses active membership/profile, not a frontend role flag. is_assigned_teacher uses active membership/profile/staff and subject/class assignments. It has no term parameter: timetable-based class access can use a matching slot from any term. records.view_all_subjects affects frontend filtering but is not a replacement for server authorization. Enrollment facts must not grant access by themselves.

Lifecycle events, revisions and receipts provide useful audit patterns, but do not store the missing academic facts. Do not reinterpret archived/reactivated event meanings or make ordinary notes an automatic eligibility ledger. Historical date/subject edits without audit could falsely convert INC into N/A/N/T, change provisional coverage/rank populations or suppress a previously accepted result.

History confirmation and correction should be school-admin-only under existing permissions, with evidence, actor, reason, immutable previous versions and academic-impact review. Delegation to teachers or a new role requires separate approval. The latest migration source protects marks/revisions/receipts against client deletion/truncation and parent cascades; do not weaken that protection. Deployment of those controls was not verified here.

Sources: [admin policies](supabase/migrations/20261028000100_initial_schema.sql#L422), [assignment helper](supabase/migrations/20261028000500_backend_hardening.sql#L36), [scoped policies](supabase/migrations/20261028001000_teacher_scope_rls.sql), [archived history reads](supabase/migrations/20261029000100_student_archival.sql#L225), [lifecycle hardening](supabase/migrations/20261030000300_harden_student_lifecycle.sql), [retention](supabase/migrations/20261031000100_stage4_mark_integrity_and_retention.sql), [application checks](src/session.tsx#L253).

## 9. Minimum proposed data contract — not implemented

Names below are recommendations, not created database objects. Use existing UUID relationships; keep current tables operational until a deliberate cutover. A single new admission_date column cannot represent transfers, subjects or returns. Adding a term column directly to student_subjects would alter its key, replacement semantics and every current enrollment guard; separate history is the smaller compatibility change.

### Common fields for the three history relations

- Identity: id UUID primary key; school_id, student_id, term_id required. Same-school composite FKs to existing identities; year derives from term_id, not a duplicated unconstrained year string.
- Version: fact_id UUID for one logical assertion, positive revision integer, supersedes_id referencing a previous revision in the same relation, and change_id grouping one atomic administrator operation across relations.
- Coverage: whole_term, dated_segment, partial_term_dates_unknown or unknown. Whole-term is an explicitly attested period fact, not an invented admission date.
- Effective bounds: optional effective_from/effective_to dates, with explicit start precision (term_start/exact_date/unknown) and end precision (term_end/exact_date/unknown). Populate dates only for exact bounds. End-exclusive intervals must be documented. Unknown bounds must not be treated as infinite enrollment. Term-bound facts can exist without a configured exact term end.
- Evidence: unverified/confirmed/conflict/voided evidence_state, controlled source_type, bounded source_reference and reason. Distinguish prospective admin action, retrospective documentary confirmation and legacy observation. No raw student documents or unnecessary PII in public payloads.
- Audit: recorded_by/recorded_at and confirmed_by/confirmed_at, server attributed. Confirmation/correction creates an immutable revision. Recording time and academic effective time remain separate.

A confirmed term fact may have no exact admission date. Missing rows are unknown, not negative evidence. Confidence scores, storage timestamps or a frontend checkbox without documented authority cannot promote an inference into an official fact.

### A. student_school_enrollment_history

Records school participation for a term/segment. Additional fields: school_state = enrolled/pre_enrollment/not_enrolled/unknown; optional entry_kind = admission/return/continuation/unknown.

For an entry, departure or return within the named term, exact effective bounds retain real documented dates. Adjacent confirmed term/segment assertions reconstruct the school timeline, including departures and returns. Whole-term participation can be confirmed even when the original first-admission day is unknown; entry_kind must then not claim a new first admission. An event outside configured periods should remain a source reference until its real academic period is established, not be assigned a fabricated term.

Pre-enrollment is an **explicit negative fact**: it must establish that the student had not yet joined in that term. A later enrolled row does not prove first-ever admission or exclude an earlier return cycle. A withdrawal gap is not_enrolled, not automatically the report engine's pre-enrollment N/A. Its academic treatment needs approval.

### B. student_class_enrollment_history

Records class placement for a term or dated segment. Additional fields: school_history_id referencing the relevant school fact revision; class_id; subject_scope_complete boolean default false. No row or unresolved placement remains unknown, never current-class fallback.

subject_scope_complete is deliberate administrator confirmation that the associated subject facts represent the entire official subject scope for that placement period. Seeing one subject or having one mark is insufficient. Dated transfer segments can coexist without overlapping; two contradictory whole-term placements cannot. The engine cannot yet flatten intraterm transfers into one official class rank.

### C. student_subject_enrollment_history

Records subject participation for a class/term/segment. Additional fields: class_history_id, subject_id, subject_state = enrolled/not_taken/unknown. School/student/term and temporal bounds must agree with the parent placement. Preserve tenant subject UUIDs rather than labels or Cambridge codes.

An explicit not-taken fact, or exclusion from a fully attested complete subject list, can establish N/T. Absence from a partial list remains unknown. Late subject entry is not late school admission. Preserve earlier eligibility and marks after later subject removal; retroactive contradictions require conflict review.

### Constraints and revision selection

1. Tenant-consistent FKs and restrictive history deletion. Archive should preserve evidence. Parent revisions must agree on school/student/term and compatible bounds.
2. Unique school/fact_id/revision; unique supersession of a revision to prevent concurrent branching. Parent references are revision-specific; corrections must reconfirm or deliberately carry forward compatible child evidence, not silently attach an old subject list to a different class.
3. Valid states, positive revisions, correct date/precision combinations, exact start before exact end, and required evidence/actor/time/reason for confirmation. Negative eligibility conflicting with accepted assessments must be flagged, not used to erase results.
4. Prevent overlapping effective confirmed assertions on the same axis: student/term class exclusivity, and student/class/term/subject exclusivity. Whole-term overlaps every segment; unknown bounds cannot be assumed disjoint. Transfer segments may be adjacent.
5. Serialize confirmation/correction using the existing student-row transaction-lock pattern; validate the complete bundle and atomically record prospective current-state and history changes. A new extension is not necessary merely to serialize this workflow. Any later range exclusion-index design needs separate review.
6. A resolver selects effective confirmed revisions. An unconfirmed correction proposal does not replace the last confirmed version; conflicts must be surfaced. A voided effective assertion leaves uncertainty rather than resurrecting an older superseded claim. Exact view/RPC implementation needs tests before adoption.

Recommended B-tree indexes: all tables on school_id/student_id/term_id; unique fact/revision and supersedes_id; parent-history FK indexes. Class history additionally school_id/term_id/class_id/student_id for historical rosters; subject history school_id/term_id/subject_id/student_id. A school/evidence_state/term_id review-queue index is useful. Add date-range indexes only when measured needs justify them.

Inline immutable revisions supply the audit trail; a fourth generic audit/event table is not required initially. Source references should identify controlled school records without duplicating document contents. Reuse existing notes as supporting human context, not confirmation authority.

### RLS and write contract

School admins can review/confirm their own school's facts. Ordinary teacher reads remain within existing authorized student/class/subject scope through a purpose-specific adapter; documentary references need not be exposed. Direct client DELETE/TRUNCATE must be unavailable. Use tightly checked admin confirmation/revision operations, not browser role assertions. Existing direct current-table privileges must be addressed in the future capture design so administrators cannot bypass history logging; do not silently change them now.

Prefer existing invoker checks where sufficient. A privileged helper, if required, needs explicit caller/school checks, fixed search path and narrowly revoked/granted execution. Facts must not grant mark-edit rights or access to hidden students. No service credential belongs in frontend code.

## 10. Integration and historical transition

### Selected-period reader

The future adapter should accept selected school/term/student/class and required assessment scope, resolve only confirmed effective evidence and return completeness/conflicts plus evidence revision IDs. It must distinguish missing history from verified empty scope and authorization-limited visibility.

- Explicit confirmed earlier pre-enrollment maps to the existing N/A evidence path.
- Confirmed relevant placement and complete subject scope can map to an enrolled ReportEvidence row when the required assessments are covered.
- Verified negative subject facts map to N/T only with complete scope or explicit evidence.
- Missing, conflicting, partially visible or ambiguous segment history stays unresolved.
- Intraterm boundaries must be evaluated against assessment dates and approved policy; never silently waive a required component.

Existing ReportEvidence cannot express all partial-term, withdrawal or transfer cases. Keep those unresolved until a specifically approved richer result is integrated. Between-term transfers need per-term class lookup rather than the one-class lookup currently used. This is data mapping, not a reason to change term weights or grading bands.

Historical cohorts must come from confirmed term placements, including pupils with no marks. Student result validity and knowledge of the complete authorized ranking population are separate. Do not publish a class denominator from a partial RLS-visible roster. Preserve existing tie, comparability and completeness rules.

### Safe transition for existing students

1. Add no inferred admissions and clone no class/subject list backwards. An empty history table cannot mean no enrollment. Keep current workflows operating while history consumers remain disabled.
2. If legacy current snapshots are staged for review, identify them as unverified observations with actual recording time and unknown academic bounds. They must not establish Term 1 participation or annual coverage.
3. At an approved prospective cutover, record real effective period/date and evidence atomically with admin changes. Plain profile edits must not fabricate enrollment transitions. All supported write paths need capture, not only the visible UI.
4. Admins may confirm documentary admission/class/subject/transfer records. Exact dates remain null when unknown; confirmed term scope may still be usable. Historical school-entry N/A requires affirmative evidence, not missing marks.
5. Preserve every accepted mark/revision/receipt, admission number and report-card record. Do not relocate marks between exams/classes to fit the backfill. Contradictory negative facts enter conflict review, not deletion or silent suppression.
6. Historical confirmation requires an academic-impact preview and deliberate approval; unverified/conflicting backfill cannot affect official reprints/ranks. Do not automatically change exam publication status. School decisions govern revisions of issued reports.
7. Enable readers only after compatibility checks. Do not retain a fallback that contradicts confirmed history. Any future change to server mark eligibility or replay of queued submissions needs separate authorization and tests; leave current guards in place during storage rollout.
8. Exact reproduction of an issued historical report is a separate requirement: report_cards does not pin computed results/evidence versions, and grading scales/signatories lack comprehensive period snapshots. Optional version-pinned report metadata/issued-document retention is not part of the minimum enrollment storage.

History for reporting does not imply permission to edit historical marks. Existing current class/exact-subject guards and receipt/account-isolation behavior remain important. Cached facts, if later introduced, must stay school/account isolated, revision-aware and read-only; stale evidence cannot authorize a write.

## 11. Edge-case matrix

These are outcomes when evidence exists, not claims about real pupils. Complete grades require both required valid accepted/finalized assessments. Current rank also needs complete eligible overall subjects and a comparable class/subject cohort; cumulative rank needs complete elapsed coverage and an approved group. Unknown is never a zero or a last-place rank.

| Case | Required evidence / eligibility | Grade and coverage | Current-term position | Cumulative position | Unresolved matters / approval |
| --- | --- | --- | --- | --- | --- |
| 1. Enrolled from start of Term 1 | Confirmed school, class, complete subject scope for required terms; exact original date may be unknown | Complete when required components are complete | Yes if current overall complete | Yes if all elapsed coverage complete/comparable | Unverified earlier scopes; first surviving mark is insufficient |
| 2. Joins Term 2 | Confirmed first entry; explicit T1 pre-enrollment; current placement/subjects and both-assessment eligibility | Current complete; provisional 1 of 2, later 2 of 3 with complete T2/T3 | Yes if complete | No for that partial year | Exact entry day may remain null; missing required T2 paper is INC, not legitimate provisional completeness |
| 3. Joins Term 3 | Confirmed first entry and T1/T2 pre-enrollment; current assessment eligibility | Complete current term; provisional 1 of 3 | Yes if complete | No for that year | Earlier negative facts need confirmation, not absent-score inference |
| 4. Joins halfway through T1 | Entry boundary or documented period coverage, class/subject facts and exam dates | Complete only if eligible for both required assessments and both valid; otherwise INC/qualified unresolved eligibility | Only with normal complete-term requirements met | Only if all elapsed requirements meet policy | No automatic exemption/compensation; ambiguous dates/applicability need school review |
| 5. Transfers classes | Old/new placements and boundary, school/subject continuity | Whole current term may be complete; existing single-class lookup cannot combine earlier-class data reliably | Yes if current cohort established/complete; intraterm grouping may be unresolved | Hold until per-term class mapping and comparison policy approved | Exam ownership, intraterm/annual ranking cohort; do not duplicate pupil across two class populations |
| 6. Changes subjects in T2 | Approved old/new subject sets and effective periods; complete-scope attestations | Current subjects may be complete; prior N/T is not pre-enrollment. Changed-set cumulative overall unresolved; new-subject cumulative can be INC | Yes within a complete comparable current set | No official cumulative overall while coverage unresolved | Annual subject-switch policy; no automatic school-entry provisional treatment |
| 7. Drops subject in T3 | Confirmed prospective end/not-taken fact, retaining previous participation | Current dropped subject N/T if verified; remaining current overall may be complete; changed-set annual overall unresolved | Yes only within complete comparable current set | Hold under existing changed-set policy | Required/elective and annual treatment; retroactive drop cannot erase marks |
| 8. Enrolled, misses Midterm | Confirmed enrollment; required missing/X/pending component; valid End Term if present | INC; available component visible, no zero or complete grade | No while required result missing | No complete cumulative rank | X does not prove absence/exemption |
| 9. Enrolled, misses End Term | Converse required components | INC; Midterm remains visible | No | No complete cumulative rank | Same absence/exemption limits |
| 10. Joins after Midterm, before End Term | Confirmed dated entry, class/subject boundaries and exam dates | End Term may be valid; existing requirement still needs Midterm; no grade from End Term alone | No complete-term rank under present requirements | No | Exemption/replacement assessment requires school decision; no authorized mechanism currently exists |
| 11. Leaves and returns | Confirmed departure/return segments and changed placements; not archive timestamps alone | A later covered current term may be complete; gap is not automatically pre-enrollment N/A | Yes for later complete eligible term | No if required coverage missing; withdrawal-gap policy unresolved | Partial terms, school gap treatment, cohort placement |
| 12. Old marks, admission date unknown | Verified term class/subject registers may still establish coverage without an exact first date | Complete grades possible for independently confirmed periods | Yes if current evidence/requirements established | Yes only if every elapsed required period confirmed/comparable | Exact admission date may stay null; no inferred pre-enrollment before known periods |
| 13. Accepted marks, no enrollment evidence | Accepted exam links prove assessment context only; seek school/class/subject records | Components/subject numbers may be visible in current code; official overall eligibility Unresolved | No official overall rank | No | Historic class, subject scope and coverage; no promotion of mark provenance into whole-term proof |
| 14. Current class active, past class unknown | Current class plus matching verified current subject scope; evidence required for past | Current can be complete; earlier periods Unresolved | Yes if current complete | No where earlier required periods unresolved; T1 has no prior-term requirement | Current placement cannot prove historical class |
| 15. Teacher changes in term | Exact term/class/subject timetable; effective dates/primary rule if needed inside term | Student grades/eligibility unchanged by teacher identity alone | Determined by student evidence/results | Same | Multiple teachers currently resolve to dash; attribution policy/history is separate |
| 16. Subject changes after accepted marks | Dated prospective change or explicit audited documentary correction; retained marks | Later eligibility can differ without rewriting past facts; retrospective contradiction is a conflict | Only in confirmed current comparable scope | Only with complete verified historical coverage | Current guard rejects subsequent writes while membership absent; do not weaken it. Review report/rank impact explicitly |

Provisional reporting is legitimate shorter school-entry coverage with required eligible assessments completed. It is not a synonym for incomplete papers, ordinary withdrawal gaps, subject-set changes, unknown history or restricted visibility.

## 12. School decisions requiring explicit approval

1. Accepted documentary evidence and administrator confirmation authority, including term confirmation with no exact admission day.
2. Entry after a required examination: retain INC, authorize another assessment, or introduce explicit exemptions? No exemption workflow is assumed.
3. Withdrawal/return gaps and partial-term treatment, distinct from first admission.
4. Current/annual ranking cohort following class transfers, especially intraterm transfers and cross-class comparability.
5. Annual treatment of subject changes/drops, required versus elective subjects and unequal subject sets; do not conflate N/A and N/T.
6. Whether term ends or assessment eligibility cutoffs need formal configuration; no guessed boundaries.
7. Historical correction/reissue authority and whether issued results must be reproducible from pinned evidence and grading-policy versions.
8. Teacher access to past placements/documentary references; within-term teacher attribution/primary-teacher rules if requested.
9. Prospective capture cutover, direct administrator API/database edits and evidence-reference privacy/retention.

Existing equal weighting, configured grades/points, tie handling and accepted-mark rules need not change for storage alone.

## 13. Proposed implementation phases — none performed

| Phase | Deliverable | Gate |
| --- | --- | --- |
| 2A: storage and contract | Review additive history/revision schema, constraints/RLS, reader/confirmation contract and fictional compatibility plan; consumers unchanged | Zero inferred backfill, no destructive migration, explicit tenant/uncertainty rules; source review before execution |
| 2B: administrator workflow | Atomic prospective capture; documentary historical confirmation with reason and impact preview | Teachers cannot fabricate history/exemptions; admission/manual numbers/current subject choices still work; profile edits do not invent transitions |
| 2C: selected-period integration | Verified report evidence, per-term class lookup and historical population mapping; historical Marks Entry only where approved | Same existing fixture values, formulas, tie rules and acceptance semantics; unresolved/conflicts fail closed; no silent offline/authorization change |
| 2D: focused compatibility tests | All 16 cases; tenant/year isolation, immutable corrections, concurrency and schema-upgrade fixtures | Synthetic data only; marks/revisions/receipts preserved; no unverified recalculation/publication |
| 2E: separately authorized local execution | Apply reviewed additions to isolated local disposable database and exercise UI/RPC/offline flows | Explicit execution authority, fictional data, no hosted contact; review upgrade failures before any production proposal |

Include tests for no active/malformed multiple active terms; wrong school/year/subject; duplicate/missing verification rows; hidden teacher subject scope; overlapping transfer segments; concurrent corrections; subject-list replacement capture; archive/reactivate without academic dates; current membership removal after accepted marks; stale cached evidence and queue replay. Preserve existing 75/80/85 and legitimate provisional 90/95 fixture results rather than changing marks to conceal integration problems.

## 14. Compatibility risks and limits

- A checked-in migration is not evidence of applied schema. Any future upgrade must verify prerequisites on an authorized local copy and preserve existing data.
- Current relations remain current operational truth during storage-only rollout. Capture must cover every supported admin write path before history becomes authoritative; frontend-only capture is insufficient.
- Missing historical students or restricted RLS scope can make a denominator look complete when it is not. History population completeness must be explicit.
- One-class ReportEvidence and N/A-only available-term rules do not solve intraterm transfers, withdrawal gaps or subject switches. Additional integration/policy is necessary; no automatic eligibility compensation.
- Accepted history must remain discoverable after moves/subject removal/archival. Excluding rows from an operational UI is not deletion, and a history correction must not re-key a mark.
- History can change recomputed eligibility after deliberate confirmation. Unverified backfill cannot drive official output; issued-report revision/version policy is separate.
- Timetable assignments are term-specific but editable and lack intraterm effective dates/primary priority. Current names, signatories and grading scales also limit exact historic reproduction. Do not expand Phase 2A into unrelated versioning features.
- Account-scoped read-only evidence caches must not grant edit authority or weaken pending/rejected recovery, receipt identity or sign-out isolation.

## 15. Likely future files, not changed in this phase

- New additive migration source under supabase/migrations, generated/reviewed only when authorized; do not rewrite existing migrations.
- New local SQL authorization/history/compatibility test sources under supabase/tests; retain exact-enrollment and lifecycle protections.
- src/data/types.ts, src/data/backend.ts, src/data/db.ts: typed evidence, selected-period reader and atomic administrator operations.
- src/pages/Students.tsx and a small admin history component/resolver: evidence confirmation, no teacher exemptions or registration redesign.
- src/lib/enrollment-certainty.ts and a dedicated history adapter/test module: retain verified-empty versus unknown/error and complete-scope distinctions.
- src/pages/ReportCards.tsx and targeted src/lib/academic-report.ts integration: verified evidence, per-term class lookup and cohorts without changing formulas.
- src/pages/MarksEntry.tsx only for approved selected-period eligibility integration; preserve recent keyboard/save/print work.
- src/lib/analytics.ts, src/lib/compact-broadsheet.ts, src/pages/Reports.tsx: compatibility verification first; no changes required for storage-only rollout and no silent ranking refactor.
- src/test/academic-report-fixtures.ts and focused enrollment/report/ranking/workspace tests; existing local PDF verifier if new fictional scenarios are added.
- Teacher/timetable history, cache format or offline guards only if a separately approved requirement requires changes; not automatic Phase 2A scope.

Inspected engineering records: [academic implementation](ACADEMIC_REPORT_IMPLEMENTATION.md), [Stage 1 remarks and initials](REPORT_REMARKS_INITIALS_STAGE1.md), [Marks Entry refinement](MARKS_ENTRY_WORKSPACE_REDESIGN.md). Code/migration definitions take precedence where documentation summarizes behavior. Historical validation totals in those documents were not rerun or represented as new Phase 1 test results.

## 16. Final working-tree status and stopping point

Branch and HEAD remain main / 49faa11d56c551af30cc408521f645055e1cb0e5. Both earlier commits are preserved. Tracked content and staging remain unchanged. The only new authorized artifact is this report.

The twelve pre-existing untracked files remain excluded and unchanged:

~~~text
.env.example
supabase/.env.example
HOSTED_AUTH_SETUP_PLAN.md
HOSTED_FINAL_PREFLIGHT.md
HOSTED_INITIALIZATION_RESULT.md
HOSTED_MIGRATION_PLAN.md
HOSTED_SECURITY_GATE_REVIEW.md
LOCAL_TEACHER_ACTIVATION_RESULT.md
PRODUCTION_READINESS.md
SUPABASE_SETUP.md
stitch_iupc_academy_diagonal_portal.zip
supabase/tests/authz.test.ts
~~~

Only this document was written. No code, migration, test, configuration, existing document, academic record, marks, admission number, enrollment, calculation, rank, graph, authentication, RLS, permission or offline behavior was changed. No SQL, migrations, tests/builds, hosted connections, production credentials, commits, resets, pushes or deployments were used.

**Recommendation:** authorize only the additive administrator-audited Phase 2A history contract and fictional compatibility work next. Preserve explicit uncertainty and current operation; defer execution, live result integration, exemptions and transfer/subject-change policy to separately authorized stages. No proposed solution has been implemented.
