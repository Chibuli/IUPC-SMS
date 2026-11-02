# Phase 2A: historical enrollment database foundation

IUPC Academy. Implemented locally against branch main, starting HEAD
49faa11d56c551af30cc408521f645055e1cb0e5. No commit or deployment.

## Delivered files

1. supabase/migrations/20261101182121_historical_enrollment_foundation.sql
2. supabase/tests/enrollment_history.test.sql
3. supabase/tests/fixtures/enrollment-history-baseline.sql
4. scripts/verify-enrollment-history.py
5. src/data/enrollment-history-contract.ts
6. src/data/enrollment-history-compatibility.test.ts
7. HISTORICAL_ENROLLMENT_PHASE2A_IMPLEMENTATION.md

The existing HISTORICAL_ENROLLMENT_ARCHITECTURE_REVIEW.md was read in full and
retained unchanged. It remains an untracked artifact from Phase 1. All prior
migration files, application pages, current database loaders, academic utilities,
offline code and authentication code remain unchanged.

The Supabase CLI's local migration-new command generated the timestamped source.
It did not log in, link a project, run a database reset, or apply a migration.

## Scope and mapping

This is independent, initially empty evidence storage. It does not change the
current students.class_id, student_subjects relationship or any accepted marks.
It introduces no UI, backfill, automatic capture, report evidence adapter or
academic eligibility calculation.

The three table names and term-scoped design follow the approved review:

| Table | Meaning and additional fields |
| --- | --- |
| student_school_enrollment_history | School participation; school_state enrolled/pre_enrollment/not_enrolled/unknown, entry_kind admission/return/continuation/unknown. Non-enrolled facts cannot claim an admission/return entry kind. |
| student_class_enrollment_history | Primary placement; school_history_id references the exact school evidence revision, class_id, subject_scope_complete default false. |
| student_subject_enrollment_history | Subject participation; class_history_id references the exact placement revision, subject_id, subject_state enrolled/not_taken/unknown. Different subjects may be simultaneous. |

Every table includes:

- id, school_id, student_id and term_id UUIDs.
- fact_id, positive revision, supersedes_id and change_id.
- coverage_kind: whole_term, dated_segment, partial_term_dates_unknown or unknown.
- start_precision: term_start/exact_date/unknown; end_precision:
  term_end/exact_date/unknown; optional effective_from/effective_to dates.
- evidence_state: unverified/confirmed/conflict/voided.
- source_type: admission_register, class_register, subject_selection,
  transfer_record, departure_record, return_record, administrator_review or
  legacy_observation; bounded source_reference and required reason.
- Server-derived recorded_by/recorded_at/updated_at and, for confirmation,
  confirmed_by/confirmed_at.

Academic year is obtained through the existing terms UUID; no new academic-year
table or duplicated unconstrained year label is added. Stable tenant-owned class
and subject IDs are retained. Current subject offerings/selection are untouched.

## Referential and temporal integrity

School IDs reference schools; student and term references are composite with
school_id. Class and subject references use their existing id/school_id keys.
Parent evidence and correction ancestry use id/school_id/student_id/term_id
composite keys. All new history references use ON DELETE RESTRICT, preserving
evidence rather than cascading it away.

Exact date intervals are half-open: effective_from is included, effective_to is
excluded. Adjacent intervals are permitted. Exact dates must be finite; exact
end must be strictly after exact start when both are supplied. Bounds preceding
the selected term's configured start are rejected. No term end is invented.

Whole-term assertions have symbolic term_start/term_end bounds and NULL exact
dates. Dated segments require known bounds and at least one exact bound.
Partially unknown bounds and wholly unknown coverage have distinct contracts.
Unknown does not mean open-ended enrollment and is not academic eligibility.

Confirmed overlaps are rejected for the same student/school:

- School assertions conflict on overlapping participation/non-participation.
- Class assertions conflict irrespective of class_id: only one primary placement
  can cover the same interval.
- Subject assertions conflict for the same subject, including contradictory
  enrolled/not_taken facts. Different subjects remain permitted.
- Within a term, symbolic/unknown bounds overlap conservatively. Across term
  IDs, two fully exact intervals are also checked for intersection.

Because terms has no end_date, exact numeric overlap between two symbolic facts
from different term UUIDs cannot be proved. Their scopes remain their named
terms; the implementation does not fabricate calendar ends or automatically
map dates to term names. Future calendar validation/eligibility integration must
retain that uncertainty.

Confirmed children require an effective confirmed compatible parent with
matching school/student/term. A class parent must represent enrolled school
participation. Child coverage must be contained in its parent's known scope.
An unknown or partial parent cannot silently authorize a wider complete child.

Confirmed pre_enrollment/not_enrolled facts, or subject not_taken facts, are
rejected where their interval conflicts with existing accepted non-null numeric
or X/Y assessment evidence. Administrators may instead append an explicit
conflict for documentary review; no mark is changed, erased or re-keyed.

## Audit, correction and read contract

The sole authenticated write surface is append_enrollment_history(axis,
input_row), returning a newly generated UUID. Axis is restricted to school,
class or subject. The JSON allowlist excludes actor, timestamps, record ID and
revision. School/student/term and referenced IDs are checked on the server.
No external AI, client role claim or service credential is involved.

Recording actor/time, confirmation actor/time and revision are server-derived.
updated_at is the immutable revision timestamp, equal to recorded_at. An edit
is a new revision; existing evidence is never overwritten. A meaningful reason
is required. Terminal evidence needs a nonblank source reference. A legacy
observation cannot be directly confirmed as historical fact.

Unique school/fact_id/revision and unique supersedes_id prevent duplicate
revisions and branching correction chains. Ancestry must match school, student,
term and logical fact. Class or subject identity changes require retirement
and a distinct fact rather than retagging an existing chain.

The three matching *_effective views are security-invoker reads of confirmed
assertions. A later unverified proposal does not hide a confirmed ancestor.
A later confirmed, conflict or voided revision does replace that ancestor's
effective status; a void does not resurrect it.

These views are NOT academic eligibility answers. Confirmed state unknown and
partial/unknown coverage remain unresolved. Future consumers must inspect raw
terminal conflict/void information and complete subject-scope evidence; absence
from an effective view alone must not become N/A or N/T. subject_scope_complete
is a documented administrator assertion, not an automatically finalized subject
list or permission to ignore later conflicting/voided child facts.

Parent correction/retirement is blocked while effective confirmed children
still reference any revision of that logical parent. The operator must retire
dependent facts and explicitly create/reconfirm compatible evidence. Old
parent/child rows remain linked to the exact historic revision.

All appends acquire a lock on the existing student row without updating it.
The guard requires READ COMMITTED. Its volatile internal queries then observe
committed history after waiting for that lock. REPEATABLE READ and SERIALIZABLE
writes fail closed with SQLSTATE 25001 rather than accepting an older fixed
snapshot. Two-session collision behavior was tested on actual PostgreSQL.

The next administrator workflow needs an atomic multi-fact operation for
retiring/reconfirming parent/child bundles and reviewing academic impact. This
phase provides the append contract only; it does not pretend that separate
client RPC requests form an atomic workflow or implement Phase 2B.

## Indexes

All tables have primary, composite-reference, logical-fact/revision and
supersedes uniqueness indexes, plus school/student/term and
school/evidence_state/term review indexes.

Class history additionally has school/term/class/student roster and school
parent lookup indexes. Subject history has school/term/subject/student roster
and class parent lookup indexes. No extension or broad audit framework was
installed. No existing relation or index was rewritten.

## Security contract and verified behavior

All new tables have RLS enabled and administrator-only SELECT policies using
the existing active-profile/membership-aware is_school_admin helper.
Authenticated users have SELECT privileges but no direct mutation privilege.
The views preserve underlying RLS through security_invoker.

Teacher reads of these new documentary tables return zero rows; teacher writes
are denied. This deliberately defers a narrow teacher read adapter until its
privacy/selected-period contract is approved. Existing teacher visibility and
marking permissions on all old tables are unchanged.

The append RPC and its guard independently require auth.uid plus administrator
membership for the requested school. It is the only granted authenticated write
entry point. Internal helpers/trigger functions are not executable by clients.
PUBLIC, anon and service_role receive no new history privileges or RPC grant.

Row UPDATE/DELETE and statement TRUNCATE guards protect the append-only ledger
in addition to revoked client privileges. Tests also exercise these guards as
the owning role. As with existing retention guards, a deliberate database owner
who disables/drops integrity objects is outside this protection.

Actual SQL tests verify admin append, actor spoof rejection, teacher read/write
denial, anonymous denial, cross-school read/write denial, cross-school reference
failure and revoked membership denial. No mock returns a permission verdict.

The technical distinction between grants, RLS, owner bypass and invoker reads
was checked against [PostgreSQL RLS documentation](https://www.postgresql.org/docs/18/ddl-rowsecurity.html).
Snapshot behavior was reviewed against [transaction isolation documentation](https://www.postgresql.org/docs/18/transaction-iso.html).
Only public documentation was consulted; no hosted project/database/API or
production credential was used.

## Disposable verification environment

Installed PostgreSQL 18.6 binaries were used. The verifier creates a fresh,
uniquely named OS temporary cluster and marker, binds only to 127.0.0.1 on a
newly allocated port, and uses no existing server/data directory. It accepts no
database URL, host, port, password or existing data-directory argument. Ambient
PG connection settings are removed; a nonexistent password-file path is used.

On Windows, initdb drops elevated Administrator group rights. The verifier
grants local Users access ONLY to its newly created fictional temporary
directory so the restricted initdb process can initialize it. No workspace or
existing database ACL was changed.

The cluster contains two newly created databases, iupc_phase2a_a and
iupc_phase2a_b. Each receives the complete 17 prior migration files unchanged,
fictional pre-upgrade student/class/subject/term/mark fixtures, then the new
migration exactly once in a transaction. Both fresh database replays pass.
Like existing migrations, the source is tracked/apply-once, not an idempotent
bootstrap intended for blind repeated execution on the same schema.

Minimal local auth users/UID/role functions and empty extensions/storage schemas
stand in for Supabase platform infrastructure. Application membership helpers,
constraints, policies, triggers and role checks are the actual migration code.
This verifies real PostgreSQL behavior, but NOT a running Supabase Auth,
PostgREST, Storage or hosted deployment. The configured database major version
is 15; runtime execution on a full local Supabase/PostgreSQL 15 stack remains a
separate compatibility check. No PostgreSQL 18-only schema feature was intended.

pgTAP was not installed locally. Focused SQL assertions use temporary invoker
test helpers with real SET ROLE/JWT-context simulation; production policies are
not mocked. Tests roll back their history and role-fixture changes. A separate
two-session test commits only fictional history inside the disposable cluster.
The owner server is stopped in finally; artifacts are retained for review.

Windows background-server pipe inheritance initially blocked the test harness;
file redirection fixed that. A prior bootstrap attempt lacked the platform
storage schema expected by an existing migration; the disposable platform stub
was corrected without editing that migration. The final runs have no failed
subprocesses or constraint/RLS assertions.

Final artifact directory:
C:/Users/ADMIN/AppData/Local/Temp/iupc-phase2a-disposable-ib5itqjd

verification.json records the commands, outputs and concurrency verdicts.
postgres.log confirms shutdown; postmaster.pid is absent. All cluster files and
other generated output are local artifacts, not repository deliverables.

## Actual validation results

| Check | Actual result |
| --- | --- |
| Prior migration chain + new migration on two fresh databases | Passed twice; no existing database reused/reset |
| Zero backfill | All three history tables empty immediately after migration, twice |
| Native SQL assertions | 60 passed in each database, 120 assertions total |
| Concurrent overlapping appends | One succeeds, the other rejects overlap, in both databases |
| Fixed snapshots | REPEATABLE READ and SERIALIZABLE writes rejected, in both databases |
| Existing fixture snapshots | Students, current subject links, classes, subjects, terms, exams, marks, report cards, revisions and receipts unchanged by upgrade and rollback test suite |
| TypeScript | npm.cmd run typecheck passed |
| Focused application tests | 175 tests across seven files passed |
| Production build | npm.cmd run build passed, including PWA generation |
| Source/whitespace review | New source files reviewed; tracked implementation and prior migrations unchanged |

Focused command:

    npx.cmd vitest run src/data/enrollment-history-compatibility.test.ts src/lib/academic-report.test.ts src/lib/enrollment-certainty.test.ts src/lib/compact-broadsheet.test.ts src/lib/offline-outcomes.test.ts src/pages/MarksEntry.workspace.test.tsx src/data/backend.test.ts

The new compatibility file contributes nine cases: Term 1/2/3 results 75/80/85,
both late-admission cases, unresolved history, missing assessments, unchanged
current subjects/broadsheet output and static isolation checks. Database tests
separately cover T1/T2/T3 admissions, withdrawal/return, dated class transfers,
same/cross-term overlaps, negative eligibility conflicts, subject addition/drop,
multiple subjects, corrections/voids, parent containment, tenant FKs and access.

Existing Vite native-config-loader, large-chunk and plugin-timing warnings
remain. No unscoped full-suite invocation or incorrectly named SQL .test.ts file
was executed. Existing offline/report/marking tests passed without their source
being changed.

## Reproduce safely and future execution

With installed Windows PostgreSQL 18 binaries and Python:

    python -u scripts/verify-enrollment-history.py

The optional --schema-only mode checks upgrade/no-backfill without the SQL or
concurrency suite. Each invocation creates a NEW marked temporary cluster.
There is no application database reset, cleanup, credential input or hosted
command. The runner leaves its stopped cluster files; remove only an individually
verified disposable directory through a separate deliberate cleanup if desired.

Do not run the baseline fixture against an existing school database. It contains
fictional data intended only for the verifier's fresh database. Do not apply
this migration to the real local app or hosted environment as part of Phase 2A.
Before any later authorized application, compare deployed schema/prerequisites,
use normal migration tracking and verify backups/retention independently.

## Departures and clarifications from the architecture review

No material source/schema discrepancy was found. The three named relations,
term UUIDs, precision states, provenance and append-safe version strategy follow
the review. The following choices make its abstract contract concrete:

1. No new terms.end_date or academic-year table. Symbolic bounds preserve the
   existing calendar gap instead of inventing dates.
2. New history is admin-readable only. Teacher-specific read access is deferred,
   rather than exposing source references prematurely or changing old policies.
3. Three invoker effective-confirmation views provide isolated head selection;
   they do not supply ReportEvidence or infer any academic eligibility.
4. One admin append RPC with guarded revisions is provided. Atomic multi-fact
   workflow and prospective automatic capture are Phase 2B, not wired here.
5. Parent correction requires explicit retirement of active confirmed children;
   class/subject retagging requires a distinct fact. This prevents silent
   reparenting while keeping every old assertion.
6. READ COMMITTED-only writes avoid fixed-snapshot overlap races without a new
   range-index extension or an UPDATE to the existing student record.
7. No generic audit table or runtime repository abstraction was added. The
   isolated readonly TypeScript contract is not attached to Database/cache.
8. Real native PostgreSQL tests replace unavailable local pgTAP/Supabase stack
   execution; platform and PostgreSQL 15 limits are explicitly reported.

## Readiness and unresolved decisions

The storage/security foundation is ready for Phase 2B review, not an approval to
publish historical results or apply a migration to real school records.
Phase 2B must implement atomic change bundles, complete subject-list capture,
evidence/impact review and capture of all authorized admin write paths.

Phase 2C must validate raw conflict/void/unknown heads and confirmed parent
coverage, then deliberately connect selected-period evidence and full historical
cohorts. It must not infer N/T from missing view rows or treat a current subject
list as past eligibility.

School decisions remain: acceptable evidence/confirmation authority; midterm
admission/exemptions; withdrawal/return gap treatment; class-transfer ranking;
annual subject switches/drops; calendar boundaries; teacher history privacy and
attribution; and historical report correction/reissue/version retention.
No policy for these was invented or implemented.

## Preservation statement

No existing application database or hosted service was opened. Real student,
accepted mark, admission-number, enrollment, class, subject or assessment records
were not read for testing or changed. The unchanged-record checks above refer to
explicitly fictional upgrade fixtures in isolated disposable databases.

Existing Students/current enrollment, Marks Entry filtering, report/broadsheet
calculations, provisional grades, rankings, graphs, remarks, offline recovery,
authentication, existing RLS and teacher permissions remain untouched. The new
tables remain disconnected from official outputs. No backfill, UI, deployment,
commit or push was performed. The architecture review and pre-existing excluded
working-tree files were preserved.
