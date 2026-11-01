# Academic reporting implementation — local engineering record

Implemented within the existing React application and browser-print PDF pipeline. No database migrations, schema expansion, deployment, commits, external API calls, or hosted Supabase access were performed. Existing working-tree changes were retained.

Files changed for this task:
- `src/lib/academic-report.ts`: isolated report policy, normalization, eligibility, completeness, cumulative calculation, trends, configured grading/remarks, period-specific teacher resolution, view models and competition ranks.
- `src/components/AcademicReportSheet.tsx`: shared A4 renderer, selected-term columns, student-name watermark, summary, optional authentic progress bars, horizontal configured grading key, saved remarks and blank signature areas.
- `src/pages/ReportCards.tsx`: selected-period report integration; historical student selection includes administrators' visible assessment records; existing admin-only attendance/sign-off save workflow retained.
- `src/components/ClassListPrint.tsx`: fifth column with blank header/cells and 60 mm width; existing shared letterhead and measured pagination retained. Roster table exported for the fixture renderer.
- `src/lib/admission-number.ts`, `src/pages/Students.tsx`, `src/data/db.ts`: manual blank admission entry, 1–48 character validation and case-insensitive duplicate preflight at the form/API boundary. Existing school/admission database unique constraint retained. Save failures are shown in the existing form error area.
- `src/index.css`: report styling only, preserving the existing application identity.
- `src/test/academic-report-fixtures.ts`, `src/lib/academic-report.test.ts`, `src/components/AcademicReportSheet.test.tsx`, `src/pages/Students.admission.test.tsx`: fictional fixtures and focused tests.
- `scripts/verify-academic-reports.mjs`: local Chromium PDF/screenshot verification, network requests blocked, same pure class-list pagination function and browser-measured rows.

Academic behavior:
- Terms are ordered by configured start date within the selected school and academic year. The active term and computer date never choose the layout or score scope. The computer date appears only as the printing date.
- Three distinct configured terms are required to establish unambiguous term ordering; an explicit error replaces guesses for incomplete/ambiguous year configuration. No display-name parsing is used.
- Required components are exactly the existing `Midterm` and `Endterm` paper types. Each numeric component is normalized to a percentage through its paper maximum. Both must be valid and finalized (`locked` or `published`). Open/draft marks remain Pending. Duplicate papers/marks and invalid numeric marks cannot produce complete results.
- The authoritative `db.marks` snapshot is used. Offline queues and rejected submissions are never read. Existing synchronization and accepted-write behavior are unchanged.
- Term 1 uses the mean of both components. Term 2 equally averages complete Terms 1 and 2. Term 3 equally averages complete Terms 1, 2 and 3. `REPORT_POLICY.termWeights` centralizes the equal weighting. Internal values remain unrounded; display uses the existing one-decimal convention and configured grading uses the raw percentage.
- Each subject receives one configured-band remark, or existing accepted nonblank remark overrides consolidated into one cell. Incomplete results get their status instead of a positive remark.
- Available-term provisional grades require authoritative pre-enrollment evidence. Required missing enrolled terms invalidate cumulative results instead of being averaged around. Verified subject exclusions show N/T and never count as zero.
- School-wide overall averages require known subject/class eligibility and complete components. Changed subject sets withhold cumulative overall results. Subject-level results remain distinct from overall averages.
- Current-term rank includes eligible complete late admissions. Cumulative rank requires complete coverage of all elapsed terms. Competition ties use the existing 1e-9 tolerance (1,1,3). Denominators count only complete students in the same selected period, class and subject set.
- Trends compare consecutive completed actual term averages, with 1e-9 tolerance and differences displayed to one decimal percentage point. Missing intermediate terms do not cause skipped-term comparisons. Overall trends require comparable subject sets.
- Teacher initials come from an unambiguous teacher on the exact term/class/subject timetable, never the mark entrant. Missing/ambiguous assignments display a dash. Current class-teacher and principal names are not reused for historical report signatories.
- Attendance comes from the selected student/term report-card record. Missing or invalid totals show “Not recorded.” Saved remarks are preserved; signatures are never fabricated.
- The optional graph uses authentic complete overall term averages, never invented history. It is omitted with fewer than two valid periods, for larger subject loads, or when live layout measurement finds insufficient room. Exceptional oversized documents display a warning; required rows are retained.

Existing-data and policy limitations:
- `Student` has no authoritative admission date. `students.created_at` is a storage timestamp, not an admission date. The existing `student_subjects` relation has no term/class history. Current client verification is explicitly tied to one active term. Neither absence of marks nor admission-number formatting proves late admission.
- Consequently, the live page cannot currently establish historical late admission or full historical ranking populations. Missing historical eligibility shows Unresolved and prevents official overall grades/ranks; valid component marks remain visible. The read-only `ReportEvidence` input exercises verified late admissions in fixtures without creating persisted facts or a teacher-editable exemption control. Connecting it to production would require an authorized, traceable enrollment-history source and separate approval for a database/workflow change. No such change was made.
- Prior subject ineligibility cannot be assumed from current subject selection. Class changes and uncertain past subject coverage remain unresolved.
- X means missing and Y means irregularity in the canonical marks workflow. The old report's contradictory “X absent” key was removed. No explicit absence/exemption fact exists in this schema, so neither is inferred from codes or free-text remarks.
- Grading scales and signatories have no term-effective historical snapshots. The report uses the configured school scale; it cannot reconstruct an earlier policy change. Historical attendance/manual report remarks remain period-specific.
- The existing database constraint prevents concurrent exact school/admission duplicates. Client/API preflight additionally rejects case variants in loaded records. A database guarantee against concurrent *case-variant* entries would require a deliberately approved normalized unique index; it was not silently added.
- No maximum subject count is configured in the inspected local model. Sixteen subjects with long names were used as a stress fixture; arbitrarily larger loads or very long saved remarks are not guaranteed to fit one legible page and trigger a live overflow warning.

Local visual review:
Open `.local-migration/academic-report-review/index.html`. It links 12 fictional academic report PDFs/HTML files and 5 class-list PDFs. Matching PNGs and `verification.json` are in the same directory. Nothing was published.

Verification (final totals recorded after the last run):
- `npm run typecheck`: passed.
- `npx vitest run src supabase/functions`: 17 files, 251 tests passed.
- `npm run build`: passed (TypeScript, Vite production bundle and PWA generation). Existing Vite config-loader and large-bundle warnings remain.
- Unscoped `npx vitest run`: executable tests passed, but the existing `supabase/tests/authz.test.ts` is SQL/pgTAP text and fails TypeScript parsing. It was not edited or executed against a database. Scoped tests above avoid that pre-existing harness mismatch.
- Fictional PDF generation: all 12 reports are one A4 portrait page. No horizontal cell clipping detected, including 16-subject long-name fixtures in each term. Watermark color has approximately 4.5% alpha.
- Class lists: 10/35/50/75/100 rows produced 1/2/2/3/4 A4 portrait pages. All blank fifth-column headers/cells verified, column measured ~60 mm, continuous numbering verified, signatures appear once on the final page, no clipped cells. Existing paginator supplies repeated headers/page totals.
- Visual inspection: complete Term 3 and 16-subject long-name report PNGs inspected directly; all other generated outputs remain available for school review. No claim of pixel-level inspection of every PDF.

Reproduce locally without school data:
1. `npm run build`
2. Set `IUPC_WRITE_ACADEMIC_FIXTURES=1` for `npx vitest run src/components/AcademicReportSheet.test.tsx`, then unset it.
3. `node scripts/verify-academic-reports.mjs`

Preservation confirmation: existing accepted marks, students, teachers, subjects, admission numbers, assessment histories, school/year settings, broadsheet calculations, authentication, RLS, permissions, offline submission/synchronization, and hosted Supabase were left unchanged. Source changes affect report presentation/calculation and future manual student admission only. No student data was created, updated, deleted, reset or reseeded.
