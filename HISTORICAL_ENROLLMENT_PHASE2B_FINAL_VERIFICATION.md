# Phase 2B final refinement and real local Supabase verification

IUPC Academy. 2 November 2026. Local-only development and fictional verification.

## Result and Git baseline

Implemented and verified the tabbed student details workspace and the real
React -> Supabase client -> GoTrue Auth -> Kong -> PostgREST -> PostgreSQL/RLS
history-management path. Phase 2C remains disconnected.

Branch is `main`; actual HEAD remains
`49faa11d56c551af30cc408521f645055e1cb0e5`. Nothing was staged, committed,
amended, reset, stashed, pushed or deployed. Pre-existing Phase 2A/2B changes and
unrelated untracked files were preserved. No retained application database or
hosted Supabase project was contacted or migrated.

Read the architecture review and both implementation reports, inspected the
existing three history tables, append guards, transaction RPC, contracts,
repository, Students detail layout, tests and prior fictional screenshot gallery.
The previous report's full-API verification limitation was treated as outstanding,
not as evidence of successful authentication/API integration.

## Exact files changed in this refinement

| File | Purpose |
| --- | --- |
| `src/pages/Students.tsx` | Reorganize existing detail content into workspace slots; protect close; reset note draft for a different student. Existing note, archive, subject, academic and registration handlers retained. |
| `src/components/StudentDetailsWorkspace.tsx` | New accessible tabs, persistent visited history panel, identity, draft indicator and close/navigation/unload protections. |
| `src/components/StudentDetailsWorkspace.css` | Student-dialog-only sizing, fixed header/identity/tabs and one scrolling content panel. |
| `src/components/StudentDetailsWorkspace.test.tsx` | Tab/keyboard/initial-mount and precision-label tests. |
| `src/components/StudentEnrollmentHistory.tsx` | Embedded/lazy tab mode, draft reporting, grouped evidence fields, compact evidence cards and clearer atomic review. |
| `src/components/StudentEnrollmentHistory.css` | Scoped card, form-section, focus and reachable action styling. |
| `src/lib/enrollment-history-management.ts` | Human-readable whole-term/exact-date labels and explanations; no eligibility calculation change. |
| `src/lib/enrollment-history-management.test.ts` | Update the whole-term presentation assertion while retaining the no-invented-dates check. |
| `src/data/enrollment-history-repository.ts` | Recognize PT409 as a stale-review conflict, retaining compatibility with 40001. |
| `src/data/enrollment-history-repository.test.ts` | Add PT409 error-contract regression. |
| `supabase/migrations/20261102015045_history_api_conflict_status.sql` | Additive correction for a defect observed through real PostgREST 14; preserve the RPC body except for the stale-review SQLSTATE. |
| `supabase/tests/enrollment_history_admin.test.sql` | Expect PT409 for application-level stale review. |
| `scripts/verify-enrollment-history-admin.py` | Verify the corrected stale-review outcome during real two-session SQL testing. |
| `scripts/verify-enrollment-history-ui.mjs` | Update the older intercepted fixture harness to open the history tab. This older mock harness is not the evidence for real API success. |
| `scripts/local-history-stack.py` | New owned disposable GoTrue/Kong/PostgREST/PG15 environment and fictional provisioning. |
| `scripts/verify-history-supabase.mjs` | Real Auth/API, permission, constraint, concurrency, rollback and retry checks. |
| `scripts/verify-history-browser-real.mjs` | Real frontend/API browser scenarios, response-loss fault injection, mobile checks and final gallery. |
| `HISTORICAL_ENROLLMENT_PHASE2B_FINAL_VERIFICATION.md` | This report. |

The original Phase 2A and Phase 2B migration files are unchanged. No dependency,
environment file, production setting, existing auth/permission implementation,
offline workflow or academic engine was changed.

## Student workspace and presentation

The existing student modal now has three tabs:

- **Overview:** identity, admission number/current class/status, current subjects,
  existing student information, academic/performance and archived-report summary,
  and the existing permission-controlled archive/reactivate action.
- **Enrollment History:** the existing school/class/subject history management,
  documentary evidence, immutable revisions, correction and transition actions.
- **Notes:** the existing notes/attachment notice, input and permissions.

Identity stays above the tabs. Tabs have tablist/tab/tabpanel relationships,
selected state, roving keyboard focus and Arrow/Home/End navigation. History
loads only when visited and remains mounted while another tab is selected, so
forms, staged changes and uncertain transaction IDs survive tab switches.
Student/school/role keys reset the workspace for a different student; note drafts
are also cleared when student selection changes. The real browser test checks
that one student's draft/name does not appear in another student's view.

Closing with a history form, transition, staged records, pending save or uncertain
receipt requires confirmation. Page unload is protected. A dialog-local
Back/Forward guard restores cancelled navigation using BrowserRouter's history
index, with URL/state restoration when an index is unavailable. No global
authentication workflow or router implementation was replaced.

History cards prioritize event/placement/subject, verification, actual term/year,
period and evidence reference. Audit details retain revision reasons, recording
actor/time and old evidence. A confirmed whole-term record reads **Full term
verified**, with a secondary explanation that exact calendar dates were not
asserted. Unverified claims are explicitly labeled unverified. Exact boundaries
use readable dates and retain the start-inclusive/end-exclusive convention.
Missing history remains unresolved; no calendar date is inferred.

The shared school/class/subject evidence editor groups Academic period,
Enrollment details, Evidence and Verification. All fields and explicit evidence
confirmation remain. The existing unified guided transition form retains its
date, destination/allocation, evidence, reason and confirmation controls.

Atomic review distinguishes new records from corrections, identifies retained
previous revisions, dates, subject/class identity, evidence source/reference and
the fact that live enrollment is unchanged. It states **All records save in one
transaction**, backed by the existing server-side transaction rather than a
client-side sequence.

The scoped modal uses a fixed heading, identity and tabs, with one content scroll
area. Narrow layouts use full-width controls, visible focus, scroll clearance for
fields and reachable action rows. At 390 x 844, the browser verified no horizontal
page overflow and confirmed the review action was inside the viewport after
scrolling. Desktop screenshots use 1366 x 900. This is not a physical-device
on-screen-keyboard certification.

## Verified integration defect: stale-review retries

The initial real concurrency test failed. PostgREST 14.18 retried the history
RPC's deliberate SQLSTATE **40001** instead of returning the application conflict
promptly, eventually producing a gateway timeout. Direct PostgreSQL assertions
had not exposed that behavior.

This behavior is documented by
[Supabase's troubleshooting discussion](https://github.com/orgs/supabase/discussions/50151)
and [PostgREST's upstream issue](https://github.com/PostgREST/postgrest/issues/3673).

The new CLI-generated additive migration changes only that deliberate stale
snapshot exception to **PT409**, which PostgREST returns as HTTP 409. The full
function definition remains inspectable; administrator checks, READ COMMITTED,
student locking, post-lock membership recheck, snapshot comparison, receipt
matching, allowlists, Phase 2A guards, immutable appends and atomicity are retained.
No applied migration source was rewritten, and no authorization was loosened.

The repository treats PT409 as a reload-and-review conflict. It still recognizes
40001 for older contracts, but PostgREST 14 environments must install the new
corrective migration through a separately authorized rollout before relying on
prompt stale-conflict responses. The interface does not apply migrations.

Other error distinctions remain: unavailable schema, offline-only refusal,
unconfirmed network outcome with identical-request receipt retry, conflicting
records, failed loads and revoked administrator access. A failed load is not an
empty history. A lost response is not described as a failed transaction or a
confirmed save. An actual 23514 failure rolls back the whole submitted bundle.

## Actual local environment and credential policy

Successful stack: `iupc-history-e2e-89034cc987`, created solely for this task.

| Component | Actual version/image |
| --- | --- |
| PostgreSQL | 15.19, `public.ecr.aws/supabase/postgres:15.19.0.007` |
| Supabase Auth | GoTrue v2.197.0, `public.ecr.aws/supabase/gotrue:v2.197.0` |
| PostgREST | 14.18, `public.ecr.aws/supabase/postgrest:v14.18` |
| Gateway | Kong 2.8.1, `public.ecr.aws/supabase/kong:2.8.1` |
| Browser | Installed headless Chrome; actual React development app and supabase-js client |

All images were already cached and started with `--pull never`. A new internal
Docker network isolated PostgreSQL/Auth/PostgREST. Only the disposable Kong
gateway joined an access network, published to 127.0.0.1 on an allocated port.
Kong anonymous reporting was disabled. The browser allowed only the local app
and that gateway; external assets/requests were blocked. No existing container,
volume, database or project configuration was reused/reset.

The database used a new tmpfs cluster. GoTrue ran its actual Auth migrations and
provided the real auth.users and JWT accessor functions. The complete application
migration chain, including Phase 2A/2B, was installed. The corrective migration
was then applied only to this disposable stack, and the final complete chain was
also replayed fresh by the independent PostgreSQL 15 verifier.

Fictional accounts were created through real local Auth signup with local-only
auto-confirm, then authenticated through password login. This provisioning
configuration does not modify the application's signup/permission policies.
Fixtures supplied administrators, an assigned teacher, another-school user and
a membership revoked during testing. Newly registered fictional test students
were created through the existing save_student RPC.

No hosted credentials or service-role JWT/key were used. Browser and API tests
used an ephemeral local anon key plus real authenticated user sessions.
Database owner access was limited to disposable setup, fixture membership
revocation/restoration, inspection and unchanged-record checks. All history
workflow writes under verification used real authenticated RPC requests.
Ephemeral credentials were confined to ignored runtime artifacts and are removed
when the owned stack stops. No credential value appears in this report.

Final cleanup completed: the owned stack's containers and networks were removed,
its runtime credential file is absent, and the dedicated Vite server was stopped.
Existing project containers/databases were not stopped or changed. The fictional
screenshots and non-secret result summaries remain available for review.

Docker Desktop's internal-network port behavior, an initial duplicate-helper
bootstrap assumption, and missing accept-profile/content-profile/x-retry-count
CORS headers were corrected in the disposable harness. These were environment
setup failures, not excuses to weaken application RLS or replace Auth with mocks.
Browser harness checks were also corrected to ignore OPTIONS bodies, wait for
the authoritative refresh and operate the evidence checkbox by keyboard.

## Actual results

| Validation | Result |
| --- | --- |
| Real Supabase Auth/API suite | **40 checks passed**. |
| Real React/browser/API suite | **16 scenarios passed**, **19 final screenshots**. |
| Focused Vitest suite | **235 tests across 10 files passed**. |
| PostgreSQL 15 assertions | **60 Phase 2A + 35 Phase 2B = 95 passed**. |
| Captured guided plans through real SQL guards | Four passed: transfer, subject change, withdrawal, return. |
| SQL two-session contention | One success and a stale PT409 rejection after serialization. |
| TypeScript | `npm.cmd run typecheck` passed; production build also passed TypeScript. |
| Production build | Passed, including PWA generation. Existing native-config-loader, large-chunk and plugin-timing warnings remain. |
| Whitespace | `git diff --check` passed; additional new-file review performed. |

The real API suite covers five actual password sessions, school/class/subject
recording, withdrawal, return, class transfer, subject change, evidence correction,
immutable reads, concurrent administrators, overlapping periods, stale review,
partial-bundle failure/rollback, direct INSERT/UPDATE/DELETE refusal, teacher and
cross-school reads/writes, tenant-ID spoofing, anonymous RPC denial, revoked
membership, and identical receipt retries after lost/completed responses.

API lost-response testing discarded a real response after server commit. The
browser separately used Chrome's response-stage network fault injection to close
the connection after the real server response reached the browser transport but
before the application received confirmation. The UI retained the exact request
ID/payload, retried it, obtained the receipt and persisted no duplicate revision.
No successful history response was fabricated.

The real browser additionally verifies tab keyboard navigation, note draft
preservation across tabs, cross-student isolation, saved history after reopening,
evidence grouping/confirmation, five-record atomic transfer review, correction
draft preservation, cancelled close, mobile actions, actual 409 concurrency and
403 revocation presentation, and the real authenticated teacher restriction.

Fictional legacy snapshots confirm unchanged students/current subject links,
classes, exams, accepted marks and report-card rows during history operations.
New fictional registrations are explicit setup actions before those comparisons.
Representative existing tests retain Marks Entry filtering, offline outcomes,
75/80/85 reporting, provisional 90/95 coverage, current/cumulative ranks and
broadsheet behavior. No official consumer was connected to history.

Commands:

```powershell
python -u scripts/local-history-stack.py
node scripts/verify-history-supabase.mjs
# Start Vite separately using the generated disposable URL/anon key in process
# environment only, host 127.0.0.1, port 5178; do not modify .env files.
node scripts/verify-history-browser-real.mjs
python -u scripts/verify-enrollment-history-admin.py
npx.cmd vitest run src/components/StudentDetailsWorkspace.test.tsx src/lib/enrollment-history-management.test.ts src/data/enrollment-history-repository.test.ts src/data/enrollment-history-compatibility.test.ts src/lib/academic-report.test.ts src/lib/enrollment-certainty.test.ts src/lib/compact-broadsheet.test.ts src/lib/offline-outcomes.test.ts src/pages/MarksEntry.workspace.test.tsx src/data/backend.test.ts
npm.cmd run typecheck
npm.cmd run build
git diff --check
```

The stack runner prints an owned stop-marker path. Creating that exact marker
requests orderly shutdown/removal of only its containers/networks and runtime
credentials. Do not use a Supabase reset, a retained database URL or a real school
credential to reproduce these checks. The incorrectly named SQL authz.test.ts
was not collected by an unscoped TypeScript test invocation.

## Visual artifacts, readiness and remaining limits

Gallery: `.local-migration/phase2b-review/index.html`.
Final screenshots use `final-01-overview.png` through
`final-19-teacher-readonly.png`, including evidence groups, correction, transfer,
subject changes, transaction review, revision history, mobile actions, lost
response, concurrent review and authorization failure. Actual rendered images
were inspected; they are fictional, local and ignored by Git.

`supabase-api-results.json`, `real-browser-results.json` and
`database-results.txt` preserve non-secret test summaries. Earlier screenshots
and the older intercepted fixture harness are not presented as full-stack proof.

**Implemented and verified:** the tabbed administration UI, actual local
Auth/PostgREST/RPC workflow, the PostgREST 14 conflict correction, RLS, atomicity,
concurrency, receipt retry and representative academic regressions.

**Not certified:** production migration/deployment, hosted configuration, SMTP,
Storage/Realtime features, every browser/device or physical mobile keyboard.
These are outside this focused verification. Complex unresolved dependent
history still requires documentary correction rather than guessed transitions.
No broader teacher documentary-read permission was introduced.

**Checkpoint readiness:** ready for a reviewed local checkpoint of this work;
no commit was made. Include the corrective migration with the implementation
and retain the previously uncommitted Phase 2A/2B prerequisites. Generated
screenshots, runtime credentials and disposable data must remain excluded.

**Phase 2C:** technically ready to begin a separately authorized design and
integration phase. It is not activated. Assessment applicability/exemptions,
withdrawal gaps, intraterm transfers/rank populations, annual subject switches,
calendar completion and issued-report correction policy still need school
decisions. Storage facts alone must not be converted into official eligibility.

Actual student records, accepted marks, current subject/class assignments,
academic calculations, grades/points, rankings, report cards/graphs/remarks,
broadsheets, authentication, existing permissions and offline recovery remain
unchanged. No backfill, hosted contact, migration on a retained database,
deployment, commit or push occurred.

## Local Git checkpoint review

The subsequently authorized checkpoint preserves Phase 2A/2B source, tests and
documentation on top of `49faa11d56c551af30cc408521f645055e1cb0e5`; it is not a
backup of live database contents. Its commit message is
`feat(enrollment): implement verified historical enrollment management`.
The exact committed inventory is available through `git show --name-only`.

During this checkpoint, the focused command above was rerun: 235 tests across
10 files passed. `npm.cmd run typecheck`, `npm.cmd run build` and staged whitespace
checks passed. Build warnings remain as described above. Staged content was
reviewed for secrets/private records, migration ordering and scope. No database
environment was recreated and no migration, SQL suite, API suite or browser suite
was executed during the checkpoint. The 40 API checks, 95 SQL assertions,
16 browser scenarios and 19 reviewed screenshots are prior verification results.

For a future compatible environment, retain the existing migration chain and
apply these additions exactly once, in this order, under separate authorization:

1. `20261101182121_historical_enrollment_foundation.sql`
2. `20261101184840_enrollment_history_admin_transactions.sql`
3. `20261102015045_history_api_conflict_status.sql`

The history tab's online reads/writes require the new schema and RPCs. The third
migration is required for safe prompt stale-review handling with PostgREST 14.
Missing setup remains an explicit unavailable state, not a local history store.
Do not execute the fictional test fixture against a retained school database.

Supabase URL/publishable key, actual Auth accounts, secrets and runtime settings
remain externally managed. No environment files, databases, generated galleries,
runtime credentials, build output or unrelated excluded files are checkpointed.
The checkpoint does not certify hosted production configuration or authorize a
rollout. Phase 2C stays inactive; historical facts do not drive official grades,
Marks Entry eligibility or rankings. Existing records and academic/auth/offline
logic remain unchanged by this checkpoint operation.
