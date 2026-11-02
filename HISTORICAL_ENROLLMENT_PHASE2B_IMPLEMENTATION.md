# Phase 2B: administrator-controlled historical enrollment management

IUPC Academy, Mombasa, Kenya. Local implementation only.

## Baseline and recovered work

Branch: `main`. HEAD remains `49faa11d56c551af30cc408521f645055e1cb0e5`.
The earlier `be9f3fbf545f57565f1ae90634ea63b0761b03c5` checkpoint is preserved.
No files were staged, committed, reset, stashed, discarded or pushed.

The interrupted session had saved a transaction migration, repository, history
panel, CSS, management helpers and a disposable database runner. Tests, guided
transitions, validation and this report were unfinished. Those files were
continued in place. The architecture review and Phase 2A report were read and
their three-table, term-scoped, immutable-evidence contract retained.

Phase 2A and other pre-existing untracked files remain untracked. The original
250-file hash inventory confirms that the only changed pre-existing application
file is Students.tsx; the Phase 2A test runner has one compatibility correction.
The new Phase 2B migration was empty when that inventory was captured. Existing
Phase 2A schema, contracts, SQL tests, fixtures and reports were not overwritten.

## Exact implementation files

| File | Change |
| --- | --- |
| `src/pages/Students.tsx` | One import and one keyed history-panel mount in the existing student detail modal. |
| `src/components/StudentEnrollmentHistory.tsx` | Collapsible history timeline, evidence form, immutable correction composer, guided transition form, review/confirmation and recovery states. |
| `src/components/StudentEnrollmentHistory.css` | Scoped crimson/white styling, responsive forms, visible focus and wrapped audit information. |
| `src/data/enrollment-history-repository.ts` | Online-only, verified-account-scoped read/save RPC contract and error mapping. |
| `src/data/enrollment-history-repository.test.ts` | Focused repository/session/error/online-only tests. |
| `src/lib/enrollment-history-management.ts` | Effective/head selection, date/evidence presentation, validation and staged revision references. |
| `src/lib/enrollment-history-transitions.ts` | Pure transactional-plan construction for transfers, withdrawals, returns and subject changes. |
| `src/lib/enrollment-history-management.test.ts` | Evidence/revision/date/transition tests, using fictional records. |
| `supabase/migrations/20261101184840_enrollment_history_admin_transactions.sql` | New additive read/write RPCs and immutable idempotency receipts. Generated with the existing migration-new convention; no old migration edited. |
| `supabase/tests/enrollment_history_admin.test.sql` | Real PostgreSQL authorization, transaction, revision and retry assertions. |
| `scripts/verify-enrollment-history-admin.py` | Isolated cached-image PostgreSQL 15 migration, SQL, browser-plan replay and two-session concurrency verifier. |
| `scripts/verify-enrollment-history-ui.mjs` | Intercepted fictional browser fixtures, assertions, screenshots and local gallery. |
| `scripts/verify-enrollment-history.py` | Skip migrations at/after its Phase 2A target while replaying prerequisites; otherwise the newly added Phase 2B source would run before Phase 2A in this older verifier. |
| `HISTORICAL_ENROLLMENT_PHASE2B_IMPLEMENTATION.md` | This report. |

No dependency, authentication, existing permission, database-loader, academic
engine, mark entry, offline queue or synchronization source changed.

## Administrator interface

Open **Students -> a student -> Enrollment History**. The panel loads only on
request. School enrollment, class history and subject history show actual
stored effective facts and unresolved revision heads. Periods sort by configured
term start and effective dates, with recording time as a stable fallback.
Term names and academic years come from existing term UUIDs; the interface does
not derive periods from display strings or today's date.

An empty history explicitly says **Historical enrollment not yet verified**.
Missing rows never become pre-enrollment, not-taken or zero marks. An unknown
date can be recorded as unresolved evidence. No initial historical date, current
class or current subject choice is copied into a history form.

School records support enrolled, before-admission, not-enrolled/withdrawn and
unknown facts, with admission/return/continuation entry reasons where permitted.
The record form supports whole-term symbolic bounds, exact dates and unknown or
partially unknown boundaries. Exact ends exclude the specified day; symbolic
term boundaries do not invent calendar dates. Terms still lack an authoritative
end-date column.

Class records link to a verified school period. Subject records link to a
verified class placement and tenant-owned offered subject ID, not a Cambridge
code or a global catalogue identity. Existing no-longer-offered subjects remain
available when correcting their recorded history. The UI does not modify the
school's offering catalogue or active student subject-selection list.

Evidence source, bounded reference and reason are explicit. Verification needs
an additional deliberate checkbox; changing form facts resets that checkbox.
Choosing an evidence label alone does not establish verification. No document
upload, fabricated staff name or fabricated supporting document was added.
Recording/verification timestamps are server-derived and displayed separately
from effective dates. Audit details show the actual recording account UUID;
staff names are not guessed when a name lookup is unavailable.

Forms use associated labels, keyboard-operable native controls, visible focus,
live error/status messages, and a single-column narrow layout. Opening a form,
staging a review, or receiving an error brings that section into view. The
existing application navigation and student modal are retained.

## Guided transitions and corrections

### School admission, withdrawal and return

Admission records are deliberately entered with documentary period/date facts.
Withdrawal splits an existing verified enrolled period at an administrator-
supplied date: the old period ends and a not-enrolled period begins. A return
splits a verified not-enrolled period and creates enrolled coverage with
entry reason return. These operations remain inside the selected term.
Cross-term facts are recorded against their actual existing term IDs.

Where withdrawal affects verified class/subject dependents, the review includes
their explicit retirement and replacement revisions for the documented earlier
portion. Old evidence is retained. Return does not infer a new class or subjects;
administrators must record those separately from evidence.

### Class placements and transfers

A class transfer ends the old placement and begins a different class on the
verified date. Existing subject evidence is retired and restored for the earlier
placement. Destination subjects are explicitly selected from school offerings;
none are copied automatically from the live student record. Complete subject
scope requires its own evidence-backed assertion. The live students.class_id is
not changed.

### Subject enrollment, discontinuation and change

A subject can be recorded independently under a verified class period. A guided
discontinuation ends enrolled coverage and records verified not-taken coverage
from the boundary. A subject change can additionally establish a different
subject fact. The original subject identity and accepted marks remain intact.
Negative facts conflicting with accepted assessment evidence are rejected by
the existing Phase 2A guard, not used to erase or reinterpret marks.

### Immutable corrections

Correct evidence creates a revision superseding the latest recorded revision.
The previous record remains visible in the audit detail. There is no permanent
delete button. Retiring erroneous evidence requires a new voided revision with
reason/evidence. Unverified proposals do not displace confirmed ancestors;
conflict/voided terminal revisions do not resurrect older confirmations.

Parent corrections with verified children require explicit leaf-first retirement
and parent-first reconfirmation. The composer supports references to earlier
staged revisions, so the complete correction is saved together. It does not
pretend that independent browser requests are atomic.

Guided transitions refuse unknown bounds, pending correction chains and
dependents wholly after the proposed transition, rather than silently changing
unsupported facts. These cases need individual evidence review through the
correction composer. Guided transitions are reviewed as one bundle and can be
discarded only as a complete bundle. General staged corrections can be assembled
and their last staged item removed before confirmation.

## Persistence and atomicity

The Phase 2A tables remain the sole enrollment evidence ledger:

- `student_school_enrollment_history`
- `student_class_enrollment_history`
- `student_subject_enrollment_history`

`read_enrollment_history(school, student)` validates active administrator
membership and tenancy, then returns all three revision arrays, contract/runtime
versions and a deterministic history snapshot fingerprint. The fingerprint is
an optimistic concurrency token, not an authorization credential.

`apply_enrollment_history_change(school, student, request_id, expected_version,
steps)` is one PostgreSQL transaction. It:

1. Checks the existing active school-administrator helper and READ COMMITTED.
2. Locks the same student row used by Phase 2A, without updating that row, and
   rechecks administrator membership after waiting for the lock.
3. Resolves a matching prior receipt before the stale-version check, allowing
   exact retries after a lost response.
4. Refuses reused request IDs with different actor/scope/payload and refuses a
   stale history snapshot.
5. Validates 1-100 ordered steps, unique step labels and earlier-step references.
   School/student/change IDs are server-controlled. Actor/time/revision fields
   remain controlled by the existing Phase 2A append contract.
6. Calls `append_enrollment_history` for every step. Existing tenant FKs, parent
   coverage, immutable ancestry, accepted-mark protection and overlap guards all
   run normally. Any error rolls back every step and the receipt.
7. Records an authoritative receipt only after all appends succeed.

The additive `enrollment_history_operations` table is a small retry-receipt
store, not a fourth enrollment-history system or generic audit framework. It
stores request UUID, school/student, authorized actor, exact request, result and
server recording time. Student/school and actor FKs restrict deletion. Its
school/student index supports administrative review; primary request identity
provides uniqueness. UPDATE/DELETE/TRUNCATE guards keep receipts immutable.
It deliberately does not reuse marks' offline receipts or queue.

History is never written to localStorage, IndexedDB, the general Database cache
or the offline queue. Drafts and an uncertain request remain only in the open
panel's memory. Offline requests fail before dispatch. A transport failure after
dispatch is labeled unconfirmed, not saved or failed with certainty. Retrying
uses the identical request; a confirmed receipt prevents duplicate revisions.
Definitive validation/stale errors allow deliberate review again. Unauthorized
responses clear documentary data and drafts. Missing schema/functions produce
a setup message and never fall back to an invented local history store.

Closing/reloading the page loses an unsaved draft. An uncertain request should
be retried before closing; the UI states this. This phase does not add durable
offline drafts or an administrative receipt-recovery dashboard.

## Authorization and database compatibility

Both RPCs use fixed empty search paths and explicit active administrator/tenant
checks, consistent with the existing approved Phase 2A definer convention.
PUBLIC, anon and service_role receive no new RPC execute grants. Authenticated
RPC callers still require the actual administrator membership check.

The receipt table has RLS and administrator-only SELECT. Authenticated clients
have no direct mutation privileges. Teachers receive neither documentary reads
nor writes, matching Phase 2A. The existing teacher academic-data visibility,
mark permissions and all old RLS policies remain unchanged. The frontend role
gate is only presentation; the database independently rejects teachers,
cross-school identities, revoked memberships and anonymous access.

Real SQL checks ran on **PostgreSQL 15.19** from the already-cached Supabase
image `public.ecr.aws/supabase/postgres:15.19.0.007`. Each run creates a uniquely
named disposable container with `--pull never --network none`, no published
ports, no mounted volume and a new tmpfs cluster. Existing containers and local
application databases are not reused, reset, migrated or stopped. Only the
owned container is stopped/removed in finally.

The 17 prior migrations are replayed, fictional pre-upgrade records inserted,
and Phase 2A then Phase 2B applied transactionally. Legacy rows remain unchanged
and history stays empty immediately after upgrade. SQL suites roll back their
fictional changes; a separate concurrency exercise commits fictional history
only in that disposable cluster.

Auth users/UID/role functions use minimal local platform stubs with realistic
authenticated identities and memberships. Application helper functions, RLS,
grants, constraints, triggers and transactions are the real migration code.
This establishes PostgreSQL 15 engine compatibility, **not** a complete running
Supabase Auth/PostgREST integration or deployment-readiness certification.
No PostgreSQL 18 result is substituted for this PostgreSQL 15 run. Public
[PostgreSQL 15 transaction documentation](https://www.postgresql.org/docs/15/transaction-iso.html)
was consulted; no hosted project was contacted.

## Actual validation

| Check | Result |
| --- | --- |
| Existing Phase 2A SQL assertions on PostgreSQL 15 | 60 passed. |
| New Phase 2B SQL assertions | 35 passed, including admission bundle, immutable corrections, exact retry receipts, rollback, stale snapshots, class/subject changes, withdrawal/return, teacher/anonymous/cross-school/revoked access and immutable receipts. |
| Actual browser-generated plans replayed through PostgreSQL 15 | Four passed: class transfer, subject change, school withdrawal and school return. Only fictional seed IDs were substituted with server-generated seed IDs. |
| Two real concurrent sessions | First change succeeds; contender waits and receives stale-snapshot SQLSTATE 40001. |
| Fictional legacy snapshots | Students, marks, current subject links, classes, exams and report-card rows unchanged after upgrade and tests. |
| Focused Vitest pass | 220 tests across nine files passed; 45 are the new management/repository cases. |
| TypeScript | `npm.cmd run typecheck` passed; final production build also ran `tsc --noEmit` successfully. |
| Production build | `npm.cmd run build` passed, including PWA generation. Existing native-config-loader, large-bundle and plugin-timing warnings remain. |
| Fictional browser checks | 12 grouped scenarios passed; 17 screenshots generated. Every external request was intercepted/blocked, with fictional loopback API responses only. |
| Visual review | Actual screenshots inspected for empty history, school/class/subject timelines, correction/evidence, transfer and subject-change reviews, conflict/uncertain/stale/setup states, teacher restriction and narrow layout. |
| Source preservation | Original file hashes and tracked diff reviewed. Prior migrations, Phase 2A contract/tests/fixtures, academic/auth/offline sources and unrelated untracked files preserved. |

The first TypeScript pass found one `unknown` JSX conditional, fixed with explicit
Boolean conversion. The first new SQL pass reached a membership-revocation test
that still held the other-school JWT context; clearing that fictional context
before owner fixture maintenance fixed the test without changing authorization.
Final checks passed. Screenshot review prompted explicit form/review/error
scrolling and focus; TypeScript/build and browser validation were repeated for
that adjustment. No academic marks were altered to satisfy tests.

Focused command (no unscoped SQL-as-TypeScript collection):

```powershell
npx.cmd vitest run src/lib/enrollment-history-management.test.ts src/data/enrollment-history-repository.test.ts src/data/enrollment-history-compatibility.test.ts src/lib/academic-report.test.ts src/lib/enrollment-certainty.test.ts src/lib/compact-broadsheet.test.ts src/lib/offline-outcomes.test.ts src/pages/MarksEntry.workspace.test.tsx src/data/backend.test.ts
```

The existing incorrectly named SQL `supabase/tests/authz.test.ts` was not run as
a TypeScript test. No repeated exhaustive full-repository audit was performed.

## Reproduce locally and inspect

Database verification (cached image and Docker required; never accepts an app
database URL or credentials):

```powershell
python -u scripts/verify-enrollment-history-admin.py
```

Browser fixture verification uses a separately started local dev server with a
fictional loopback backend; do not point it at a real backend:

```powershell
$env:VITE_SUPABASE_URL='http://127.0.0.1:59999'
$env:VITE_SUPABASE_PUBLISHABLE_KEY='sb_publishable_fictional_phase2b_local_only'
npm.cmd run dev -- --host 127.0.0.1 --port 5178 --strictPort
# In another terminal:
node scripts/verify-enrollment-history-ui.mjs
python -u scripts/verify-enrollment-history-admin.py
```

The browser verifier refuses a non-fictional API origin and blocks all external
requests before navigation. The last database command also replays the captured
UI transition plans. Browser fixtures verify presentation/contracts; database
tests independently verify actual authorization and atomic behavior.

Open `.local-migration/phase2b-review/index.html` for the local gallery.
Artifacts include `01-unverified-history.png` through the named correction,
transfer, conflict, mobile and access-state screenshots, `browser-results.json`,
`ui-plans.json` and `database-results.txt`. These fictional generated files are
ignored local artifacts, not application data or repository deliverables.

No existing application database has received either migration as part of this
phase. Future separately authorized execution must review prerequisites, normal
migration tracking, backups and full Supabase integration before applying source
to any actual school environment. No automatic migration command or setup button
was added to the interface.

## Limitations, policy and Phase 2C boundary

- Guided transitions stay within one explicit term. Exact calendar ends remain
  unknown where the school has not configured them. Cross-term histories need
  separate verified term records.
- Complex dependent history with unresolved dates, pending proposals or later
  placements requires individual documentary review and explicit correction
  bundles. The guided form blocks it rather than guessing, clipping later facts
  or committing only half a transfer.
- New subject selection uses current tenant offerings; correcting an existing
  discontinued offering is supported. Recording a previously unrecorded subject
  that is no longer offered needs catalogue/history policy review rather than
  silently treating the whole Cambridge catalogue as school offerings.
- Actor UUIDs are shown when no authorized name lookup exists. No staff-name or
  historical teacher-assignment inference was introduced.
- The write API supports up to 100 ordered revisions per transaction. Very large
  bundles need explicit review; there is no partial-write fallback.
- Full local Supabase Auth/PostgREST end-to-end execution remains unverified.
  PostgreSQL 15 transaction/RLS checks and intercepted browser checks passed, but
  they are separate evidence and are not described as one live full-stack test.
- No automatic history capture was attached to existing current enrollment write
  paths, per Phase 2B's strict separation. Administrators can record historical
  facts without changing live current enrollment, and vice versa.
- Midterm admission/exemptions, withdrawal gap grading, class-transfer ranking,
  annual subject switches/drops, documentary confirmation authority, calendar
  completion, teacher documentary privacy and issued-report correction policies
  still require explicit school decisions.

The storage and administrator transaction contract are ready for **Phase 2C
design/review**, not activation. The live report engine still receives no history
adapter, and existing `ReportEvidence` cannot safely express every intraterm
transfer/withdrawal case. Complete historical cohorts, parent/subject-scope
validation, unresolved/conflict handling, policy approval and full-stack local
verification must precede any future official eligibility or ranking integration.

## Preservation confirmation

No real student, mark, admission-number, class/subject assignment or assessment
record was read for fixtures or modified. Only fictional records in the new
disposable database and intercepted browser fixtures were used. Existing local
application databases and hosted Supabase were untouched.

Academic calculations, grading bands/points, provisional policy, current-term
and cumulative rankings, report cards/graphs/remarks, broadsheets, class lists,
Marks Entry eligibility, accepted results, authentication, existing permissions
and offline pending/rejected recovery/synchronization remain unchanged. No
backfill, Phase 2C integration, production migration, commit, push or deployment
was performed. Prior changes and unrelated untracked files remain in place.
