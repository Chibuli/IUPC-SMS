# Local application checkpoint review

Branch: `main`. Reviewed parent: `1cff1b1`.

One application commit preserves the coupled backend, session, student lifecycle, offline and reporting changes together. Splitting shared modules and dependencies would require reconstructing the working implementation and validating an intermediate state. No application source was changed for this checkpoint.

## Reviewed scope

145 modified or untracked files were inventoried and read. The checkpoint contains 133 reviewed implementation files plus this manifest: 68 application/configuration files, 17 migration source files, and 49 tests/engineering documents including this manifest. Unchanged files already tracked in the parent remain part of the restorable repository.

Migration SQL was reviewed as development-history source only. It was not executed. Database test SQL contains local synthetic fixtures and was not executed. No hosted service was contacted.

A content scan found only explicitly fictional credential literals in mocked tests; no actual credentials or student-record exports were identified in the selected changes. Environment files, private operational notes, generated artifacts and local data are excluded.

## Validation performed

- `npm.cmd run typecheck`: passed.
- `npx.cmd vitest run src supabase/functions`: 362 tests passed across 21 files.
- `npm.cmd run build`: passed, including TypeScript, Vite and PWA output. Existing Vite configuration-loader and bundle-size warnings remain.
- `git diff --check`: passed. The exact staged diff, staged content scan and `git diff --cached --check` are required before committing.
- No database integration tests, migrations, Android build or hosted operations were run.
- PDF rendering was not repeated for this Git-only checkpoint. Earlier report validation is described in the reporting implementation documents; local PDFs and galleries are excluded.

The scoped Vitest command deliberately avoids `supabase/tests/authz.test.ts`, an older SQL/pgTAP source file with an incorrect TypeScript extension. The reviewed `authz.test.sql` is included; these variants are not identical.

## Exact files selected

```text
.gitignore
android/app/build.gradle
android/app/src/main/AndroidManifest.xml
android/app/src/main/res/xml/file_paths.xml
package-lock.json
package.json
scripts/verify-offline.mjs
src/App.tsx
src/AppLayout.tsx
src/components/SyncStatus.tsx
src/components/permissions.tsx
src/components/ui.tsx
src/data/auth.ts
src/data/db.ts
src/data/seed.ts
src/data/types.ts
src/index.css
src/lib/analysis.ts
src/lib/analytics.ts
src/lib/deck.ts
src/lib/offline.ts
src/lib/print.ts
src/pages/Analysis.tsx
src/pages/Classes.tsx
src/pages/Dashboard.tsx
src/pages/Login.tsx
src/pages/MarksEntry.tsx
src/pages/ReportCards.tsx
src/pages/Reports.tsx
src/pages/Settings.tsx
src/pages/Students.tsx
src/pages/Subjects.tsx
src/pages/Teachers.tsx
src/pages/Terms.tsx
src/pages/Timetable.tsx
src/session.tsx
vite.config.ts
ACADEMIC_REPORT_IMPLEMENTATION.md
BROADSHEET_HEADER_SPACING.md
CLASS_LIST_REFINEMENT.md
COMPACT_BROADSHEETS.md
DASHBOARD_UI_REFINEMENT.md
FICTIONAL_REPORT_INSPECTION.md
FINAL_BROADSHEET_REFINEMENT.md
MARKS_LOADING_FIX.md
REPORT_CARD_DESIGN_REFINEMENT.md
REPORT_PRESENTATION_REFINEMENT.md
REPORT_REMARKS_INITIALS_STAGE1.md
STITCH_AUTH_DESIGN_RESULT.md
android/app/src/main/res/xml/backup_rules.xml
android/app/src/main/res/xml/data_extraction_rules.xml
public/_headers
public/_redirects
scripts/render-academic-pdfs.py
scripts/verify-academic-reports.mjs
scripts/verify-auth.mjs
scripts/verify-dashboard.mjs
scripts/verify-production.mjs
src/components/AcademicReportSheet.test.tsx
src/components/AcademicReportSheet.tsx
src/components/BackendSetup.tsx
src/components/BroadsheetHeader.test.tsx
src/components/BroadsheetHeader.tsx
src/components/ClassListPrint.tsx
src/components/ReportPerformanceGraph.tsx
src/data/backend.test.ts
src/data/backend.ts
src/data/load-marks.test.ts
src/data/load-marks.ts
src/data/school-cache.ts
src/data/student-lifecycle.test.ts
src/data/student-lifecycle.ts
src/data/supabase.ts
src/lib/academic-report.test.ts
src/lib/academic-report.ts
src/lib/admission-number.ts
src/lib/analytics.test.ts
src/lib/auth-callback.ts
src/lib/broadsheet-presentation.test.ts
src/lib/broadsheet-presentation.ts
src/lib/class-list-pagination.test.ts
src/lib/class-list-pagination.ts
src/lib/compact-broadsheet.test.ts
src/lib/compact-broadsheet.ts
src/lib/enrollment-certainty.test.ts
src/lib/enrollment-certainty.ts
src/lib/offline-outcomes.test.ts
src/lib/offline-outcomes.ts
src/lib/offline-store.ts
src/lib/production-config.test.ts
src/lib/production-config.ts
src/lib/report-performance-graph.test.tsx
src/lib/report-performance-graph.ts
src/lib/report-teacher.test.ts
src/lib/report-teacher.ts
src/lib/subject-remarks-integration.test.ts
src/lib/subject-remarks.test.ts
src/lib/subject-remarks.ts
src/lib/teacher-onboarding.test.ts
src/lib/teacher-onboarding.ts
src/pages/AuthCallback.tsx
src/pages/Reports.presentation.test.tsx
src/pages/Students.admission.test.tsx
src/test/academic-report-fixtures.ts
src/test/broadsheet-fixtures.ts
supabase/config.toml
supabase/functions/provision-staff/handler.test.ts
supabase/functions/provision-staff/handler.ts
supabase/functions/provision-staff/index.ts
supabase/migrations/20261028000100_initial_schema.sql
supabase/migrations/20261028000200_authz_fixes.sql
supabase/migrations/20261028000300_admin_operations.sql
supabase/migrations/20261028000400_transactional_operations.sql
supabase/migrations/20261028000500_backend_hardening.sql
supabase/migrations/20261028000600_initial_data_provision.sql
supabase/migrations/20261028000700_shared_catalogue_subjects.sql
supabase/migrations/20261028000800_complete_shared_catalogue.sql
supabase/migrations/20261028000900_subject_offerings.sql
supabase/migrations/20261028001000_teacher_scope_rls.sql
supabase/migrations/20261029000100_student_archival.sql
supabase/migrations/20261029000200_report_signatories.sql
supabase/migrations/20261029000300_verify_student_enrollments.sql
supabase/migrations/20261030000100_protect_mark_identity.sql
supabase/migrations/20261030000200_enforce_exact_subject_enrollment.sql
supabase/migrations/20261030000300_harden_student_lifecycle.sql
supabase/migrations/20261031000100_stage4_mark_integrity_and_retention.sql
supabase/tests/authz.test.sql
supabase/tests/database.test.sql
supabase/tests/exact_subject_enrollment.test.sql
supabase/tests/mark_identity.test.sql
supabase/tests/stage4_database_controls.test.sql
supabase/tests/student_archival.test.sql
supabase/tests/student_lifecycle_transitions.test.sql
GIT_CHECKPOINT_REVIEW.md
```

## Deliberately excluded files

These remain untouched and uncommitted:

- `.env.example`: Environment template excluded under the requested no-.env scope
- `HOSTED_AUTH_SETUP_PLAN.md`: Private environment/hosted-operation notes; not required for source restoration
- `HOSTED_FINAL_PREFLIGHT.md`: Private environment/hosted-operation notes; not required for source restoration
- `HOSTED_INITIALIZATION_RESULT.md`: Private environment/hosted-operation notes; not required for source restoration
- `HOSTED_MIGRATION_PLAN.md`: Private environment/hosted-operation notes; not required for source restoration
- `HOSTED_SECURITY_GATE_REVIEW.md`: Private environment/hosted-operation notes; not required for source restoration
- `LOCAL_TEACHER_ACTIVATION_RESULT.md`: Private environment/hosted-operation notes; not required for source restoration
- `PRODUCTION_READINESS.md`: Private environment/hosted-operation notes; not required for source restoration
- `SUPABASE_SETUP.md`: Private environment/hosted-operation notes; not required for source restoration
- `stitch_iupc_academy_diagonal_portal.zip`: Generated design archive; not required to restore application source
- `supabase/.env.example`: Environment template excluded under the requested no-.env scope
- `supabase/tests/authz.test.ts`: Older SQL/pgTAP source with an incorrect TypeScript extension; keep proper .sql tests instead

Ignored local files also remain excluded: actual environment configuration, local databases/backups, `.local-migration/` galleries and audits, screenshots, generated PDFs, APKs, build output, signing material and `node_modules`. The design ZIP is excluded. No uncertain file was added merely to obtain a clean status.

## Restoration limits

This is an application-source checkpoint, not a backup of live school data or hosted infrastructure. Restore dependencies using the lockfile. Configure private environment values separately; the environment templates are intentionally not committed under the requested no-env scope. Production requires a compatible existing database, appropriate authentication configuration and separately managed function secrets. Migration source is preserved for review and must not be automatically applied to an existing database. Android builds require a local SDK and signing configuration. Local PDF inspection tools require their browser/Python tooling and regenerate fictional artifacts separately.

Some historical engineering documents reference private operational notes or generated galleries that are deliberately excluded. Previously tracked reference assets are inherited unchanged. No deployment or hosted-readiness acceptance is implied by the local build and tests.

No marks, student records, admission numbers or school data were modified for this checkpoint. No reset, stash, clean, amendment, push, deployment or migration was performed.
