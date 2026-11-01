# Final broadsheet presentation and academic key verification

Completed locally on 1 November 2026. This refines the existing reporting implementation; no academic calculation, enrollment/ranking rule or database record was changed.

## Files changed

Application and focused tests:

- `src/pages/Reports.tsx` — ADM NO., compact numeric formatting, verified Results Key, actual subject-code legend, structured Subject Analysis, pass-rate wording and signature spacing.
- `src/index.css` — scoped broadsheet typography, separated headings/identity columns, results-key grid, performance cards, reference/distribution tables and print spacing. Student rows remain unbroken and single-line; accessible scrolling and repeated table headers remain.
- `src/lib/broadsheet-presentation.ts` (new) — presentation-only trailing-zero formatter and verified key descriptions.
- `src/lib/compact-broadsheet.ts` — CSV presentation only: formatter import, ADM NO./MG headings, and removal of insignificant zeros at its existing one-/two-decimal precision. The complete `buildCompactBroadsheet` function has an identical before/after source hash.
- `src/lib/compact-broadsheet.test.ts` — updates the previous CSV display assertion from 78.0 to 78; numeric regression expectations remain unchanged.
- `src/lib/broadsheet-presentation.test.ts` (new) — numeric display, supported inputs/statuses, all three assessment modes, CSV metadata, zero-versus-missing, eligible distribution and unchanged fixture records.
- `src/pages/Reports.presentation.test.tsx` (new) — renders the actual Reports component with explicitly labeled in-memory fixtures; checks key text, provisional flags, statistics, pass rate and single student rows. Can export a standalone fixture for PDF verification.
- `src/test/broadsheet-fixtures.ts` (new) — in-memory test factory, never sent to Supabase or offline synchronization.

Preview helpers under `.local-migration/report-inspection` changed or added: `presentation-snapshot.mjs`, `inspect-presentation-layout.mjs`, `verify-compact-broadsheets.mjs`, `render-key-fixture.mjs`, `finish-presentation-gallery.py`, `render-refresh.py`, `validate-refresh.mjs`, `build-refresh-index.mjs`. Generated PDFs, screenshots, native CSVs, thumbnails and indexes were refreshed in the existing collections.

## Student results presentation

The matrix now reads RANK | NAME OF STUDENT | ADM NO. | MG | TOTAL | AVG | SD | COMP | configured subject codes. Full names and existing TEST admission numbers remain single-line and readable. No registration code or numbering convention was changed; IUPC-001 remains a future preference only. All existing 70 admission numbers and student records are unchanged.

The formatter first calls the unchanged `round` helper at the existing precision, then removes only trailing decimal zeros and a now-unused decimal point. Examples: 93.0 → 93, 88.5 → 88.5, 727.0 → 727. CSV aggregate averages retain their existing two-decimal precision before zero removal; matrix/other formatted values retain one-decimal precision. Grade-band point values are presented directly, so any configured meaningful fractional point precision is preserved. Grades and ranks continue to use full-precision calculations, even when rounded displayed averages look equal.

The Results Key is separate from the small completed-cohort summary. A compact legend maps every displayed subject code to its actual authorized configured name; full subject titles are not inserted in matrix headings.

## Verified results-key behavior

| Code/heading | Actual origin and meaning | Display, eligibility and CSV behavior |
|---|---|---|
| X | `MarksEntry`, `parseScoreInput`, database `marks.score_code`, and `backend.ts` decoder. Recorded missing marks; can include absence or an incomplete assessment. It does **not** independently confirm absence. | X remains a non-numeric component in each assessment mode. Combined cannot use the other component as a substitute. Ineligible for completion/final rank. PDF cell X; CSV cell X and explanatory outstanding-component metadata. |
| Y | Same entered-code path; examination irregularity. | Non-numeric; incomplete and unranked when required. PDF/CSV Y. If Combined has both X and Y, the existing Y priority is preserved and both component details remain available. |
| Z | Adapter defensive invalid/ungradable-result state, or the existing analytics engine's no-numeric-grade fallback for an otherwise verified row. **Not an accepted mark-entry code or configured grade band.** | Invalid numeric score/maximum can display a Z subject cell; a row with no valid numeric average can display MG Z. Required results remain incomplete/unranked. CSV distinguishes the subject Z and row MG Z. The key now clarifies this instead of implying a separately entered “not graded” assessment status. |
| == | Adapter verifies the student is not enrolled in that subject for the selected term. | Subject not taken, not a missing mark, not counted as a required subject. PDF and CSV ==. Unknown enrollment does not silently become subject-not-taken. |
| INC | Adapter finds a required missing score/paper, duplicate mark records or ambiguous multiple same-period papers. | Missing/incomplete/ambiguous assessment, not zero. PDF/CSV INC; component details retained. No final rank. Combined requires both valid components. |
| * | Existing Reports annotation after the provisional grade of an incomplete student who has a numeric provisional mean. | PDF MG such as A*. CSV preserves the raw grade and explicitly labels Assessment “Incomplete / provisional”; it does not add an asterisk to the grade value. |
| P | Existing Reports prefix on a numeric provisional incomplete average. | PDF such as P 80. CSV retains a numeric average with the explicit provisional Assessment field. It is an annotation, not a stored score. |
| — | Existing unavailable-value/rank rendering. | Can mean unverifiable enrollment/completion, no final rank, no numeric mean, or insufficient results for SD; it was too narrowly labeled as enrollment-only. CSV uses blank numeric/rank fields with separate verification/assessment metadata. |
| MG | Existing `gradeFor(row.mean, configured bands)`. | The configured grade of the student's valid subject-percentage average; provisional/unavailable handling as above. CSV heading corrected from MC to MG. |
| COMP | Existing `completed` and `required`. | Completed valid subjects / required subjects, e.g. 8/8. In a Combined view a subject completes only when both components are valid. Verified no-enrollment rows retain their explicit “No enrollment” presentation. |
| TOTAL / AVG | Existing `row.total` / `row.mean`. | Sum / arithmetic mean of valid required subject percentages. Partial values stay provisional; unknown scope withholds them. Each combined subject counts once. |
| SD | Existing population `stdDev` of valid required subject percentages. | Requires at least two numeric subject results; otherwise —. No formula change. |

Numeric **0** is an accepted numeric result, not X, INC or absence. Under the current configuration it is grade U with 1 point and can be academically complete while failing the pass threshold. No new assessment statuses were introduced. The database accepts only X and Y in `score_code`; the existing input parser rejects Z, INC and == as entered marks.

## Subject Analysis and statistical meanings

The existing subject table keeps GRADE, AVERAGE, ENTRY, HIGHEST, LOWEST and MEAN POINTS. Codes remain its headings; numeric cells are aligned and insignificant zeros removed. The following information is now grouped under clear headings rather than compressed into a line:

- **Class performance:** Mean Score, Mean Point, Mean Grade, Sum of Subject Averages.
- **Grade points:** the actual selected configured scale, followed by calculation/cohort notes.
- **Grade distribution:** grade, student count and percentage in a structured table, with an eligible-cohort total and the incomplete/unverified exclusion count.
- **Pass rate:** configured threshold and “n of d completed students meet or exceed the threshold (p%).”
- **Signatures:** horizontally aligned class teacher and principal lines with blank writing space; no names invented.

Verified formulas and cohorts:

1. **Mean Score:** arithmetic mean of `row.mean` for `completedRows` only. Each student mean uses valid eligible subject percentages, with one subject result per Combined column.
2. **Mean Point:** arithmetic mean of those completed students' mean-grade point values (`row.points`). It is not an average of all individual subject-grade points.
3. **Mean Grade:** `gradeFor(overallMeanScore, selectedScale.bands)`. It is **not** obtained by converting Mean Point back into a grade. The main results strip and Subject Analysis read the same `sheet.overall` values.
4. **Former TOT AVG:** `sum(sheet.summary[i].average ?? 0)`, confirmed to be the **SUM OF SUBJECT AVERAGES**. The exact calculation is preserved and the label corrected. Each subject's average uses its own valid entries, which can include a valid subject result from an otherwise incomplete student. This sum is not a percentage and need not equal completed-cohort Mean Score × subject count for uneven enrollment or incomplete data.
5. **Subject table MEAN POINTS:** the configured points for the subject's average-score grade (`bandFor(subjectAverage).points`). It is not the arithmetic mean of individual students' points. This existing calculation is preserved and explained in the notes.

Year 7 Combined provides a useful reconciliation, **calculated from the existing records, not hardcoded**: Mean Score = 69.425, displayed 69.4%; Mean Point = 6.4; Mean Grade = C because the selected C floor is 60%; Sum of Subject Averages = 555.4. All eight subjects have the same complete 10-student cohort, so 555.4 ÷ 8 = 69.425. The subject-average display values are independently rounded, so adding their printed one-decimal values may not exactly reproduce the full-precision sum.

The live isolated database's selected “IUPC Institutional Scale” contains **A*=9, A=8, B=7, C=6, D=5, E=4, F=3, G=2, U=1**, with floors 90,80,70,60,50,40,30,20,0 respectively. The selected stored pass mark is **40%**. Values are read from the existing grading configuration; no replacement scale or pass policy was hardcoded. The existing fallback remains untouched.

Distribution counts use `completedRows` only. Its denominator is the same eligible count; incomplete/unverified students are excluded. Pass numerator = completed students whose **full-precision mean** meets/exceeds `scale.pass_mark`; denominator = all completed students. Year 7 Combined therefore has 10/10 passing, 100%; Year 7 Midterm has 9/10, 90%. The fixture cohort deliberately includes a complete zero-mark student and verifies 1/2 passing, 50%, rather than excluding the zero as absent.

## Calculation consistency and separate decisions

No inconsistency was found between the defined broadsheet formulas, configured grade bands, Mean Grade and pass threshold. Different Mean Point and Mean Grade implications are expected because averaging grade points and grading an average percentage are different operations. No academic policy was changed.

Report cards also derive their Mean Grade from their numeric average through the same selected bands. Their separate Midterm/End Term presentation and calculations are unchanged. One **existing cohort-policy difference** matters when comparing incomplete data: the report-card class-average helper includes available numeric student averages, whereas the broadsheet class mean includes completed eligible students only. Complete, balanced fictional data reconciles; incomplete cross-report comparisons may differ. Harmonizing those cohorts would require a separate school decision and academic change. It was not changed here.

The source/report-card legend elsewhere still uses its existing wording; this task only corrects broadsheet presentation. No authentication, permission, activation or offline behavior was altered.

## Verification and protected data

Before database access, the dedicated isolated container, project label, port 58522 and dedicated volume were verified. The actual browser Supabase URL was verified as `http://127.0.0.1:58521` before normal local login. Frontend: `http://127.0.0.1:5180`. No hosted Supabase was accessed.

- **88 focused tests across four files PASS:** compact calculations, analytics, new numeric/key fixtures and the actual Reports renderer.
- TypeScript **PASS**; production build/PWA generation **PASS**. Existing future Vite-config-loader and bundle-size warnings remain non-blocking. No deployment occurred.
- All **21 actual class/assessment views** checked; **1,620 displayed subject cells**, CSV values, totals, averages, grades, ranks, subject statistics, cohort distributions and pass counts checked against independently calculated expected results.
- Before/after snapshots of all 21 full calculation objects are **deeply identical**, including full-precision Combined values, grades, ranks, ties, eligibility and summaries. The complete compact calculation function body and shared grading/analytics/format/report-card/student-registration/auth/offline/migration source hashes are unchanged.
- All **23 public-table fingerprints unchanged**: 70 fictional students, 7 classes, 108 original assessments, 1,080 accepted marks, 1,080 revisions and 1,080 receipts, with school/staff permissions and other records preserved. Term remains TERM 1, 2026/2027. No accepted record was changed to create a fixture.
- X/Y/Z/INC/==, zero, unavailable scope, provisional rows and eligible-only distributions tested in all three assessment modes. The actual Reports component was separately rendered with clearly labeled in-memory records and saved as a two-page PDF; PDF text checks locate codes in the student rows, not merely in the key. CSV fixtures retain explicit provisional/verification metadata.
- All **21 actual broadsheet PDFs** validated: two A4 landscape pages for the existing 10-student cohorts, no text beyond paper bounds, no clipped student cells, no overlapping content and no blank third page. Saved results and analysis renderings inspected. Larger scopes retain A3 selection; larger cohorts may correctly require additional pages with repeating headers and unsplit student rows.
- Gallery opened from `file://` with networking blocked: all **146** screenshot/PDF-thumbnail images load. Main indexes and current comparison links resolve; prior comparisons are preserved. The status fixture PDF is separate from the 104 actual gallery documents.

## Preview locations

- Current gallery: `C:\Users\ADMIN\3D Objects\IUPC SMS\screenshots\index.html`
- Current before/after comparison: `screenshots/broadsheet-comparison/index.html`
- **Before** this refinement: `screenshots/broadsheet-comparison/presentation-before/`
- **After** this refinement: `screenshots/broadsheet-comparison/presentation-after/`
- Four paired files in both folders: `broadsheet-year-7-endterm.pdf`, `broadsheet-year-7-combined-term.pdf`, `broadsheet-year-10-midterm.pdf`, `broadsheet-year-13-combined-term.pdf`. Each includes Student Results and Subject Analysis.
- Previous compact/Memon comparisons: `screenshots/broadsheet-comparison/compact-stage-index.html`, with original `before/` and `after/` files retained.
- Explicit status test artifacts: `screenshots/broadsheet-comparison/status-fixtures/index.html` (PDF, three CSV fixtures and PDF assertions).
- Full arithmetic/data invariance evidence: `screenshots/broadsheet-comparison/presentation-invariance.json`.
- All-class print/export evidence: `screenshots/broadsheet-comparison/presentation-verification.json`.

All 21 current broadsheet PDFs/CSVs and representative desktop/mobile screenshots were refreshed in the existing collection. `.local-migration/report-previews` retains its established names and was synchronized. Unrelated report-card PDFs, pages and historical assets were preserved.

No hosted data, accepted marks, migrations, RLS, grading or ranking formulas, teacher permissions, registration, authentication, offline synchronization or report-card implementation were modified. No commit or push was performed. No physical printer test was performed, and there are no local teacher accounts for a live teacher-login capture; existing subject-scope regression tests remain in place.
