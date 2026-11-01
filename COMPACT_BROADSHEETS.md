# Compact broadsheets and combined subject averages

Implemented locally on 1 November 2026. Reference photographs were already available in `reference/broadsheets` (four WhatsApp examination-results photographs dated 19 October 2026). Their compact rank/name/grade/total/average/subject-code matrix informed the structure. IUPC Academy's existing official logo, school metadata and crimson-and-white identity are retained.

## Application files changed

- `src/pages/Reports.tsx`: uses the broadsheet-only subject adapter; preserves Midterm, End Term and Combined selection; code-only subject headings; one-line full names and admissions; readable rank, mean grade, total, average, standard deviation and completed-subject counts. Detailed incomplete reasons are outside the student-name cells. CSV and print actions use the selected view.
- `src/index.css`: changes only broadsheet table styles, removing name wrapping and fixed old paper-column widths; compact headers and rows; scoped print font/spacing. Report-card styling was not changed.
- `src/lib/compact-broadsheet.ts` (new): groups results by configured subject identity, normalizes component marks, creates one subject result, and delegates eligibility/grading/ranking to the unchanged existing engine. Keeps same-subject students in different streams separate without duplicating subject columns. Provides a matching CSV exporter.
- `src/lib/compact-broadsheet.test.ts` (new): 42 focused regression cases, including seven-class/three-view coverage, independent numeric expectations and teacher subject-scope checks.

No changes were made to `src/pages/ReportCards.tsx`, shared `src/lib/analytics.ts`, grading thresholds, backend loading, authentication, session permissions, offline synchronization, migrations or RLS.

## Calculation and eligibility rules

For each student and configured subject, Combined requires exactly one Midterm paper and one Endterm paper in the selected active term and the student's class. Each must have exactly one valid numeric mark and a finite positive maximum. Calculate `(Midterm score / Midterm maximum × 100 + End Term score / End Term maximum × 100) / 2`. No intermediate rounding is applied. The existing display formatter is used for the matrix and subject cells in CSV; CSV aggregate averages retain two decimal places.

The independently asserted examples include **72/100 and 84/100 → 78**, and **36/50 and 168/200 → 78**. Original mark records are unchanged. Midterm and End Term views show their original paper percentages independently; their raw marks and maxima remain available in cell tooltips.

Each subject counts once in totals, means and completion counts. Existing grade bands and completed-cohort ranking rules are reused, including competition ranks such as 1, 1, 3, admission ordering inside ties, and the existing floating-point tie tolerance. Equal displayed rounded averages do not necessarily constitute a tie when the underlying full-precision averages differ.

Missing components never become zero and never fall back to the available component. Numeric zero remains a valid recorded score. X and Y indicators are retained, with both component details available when they differ. Z identifies invalid/not-graded numeric results. `==` identifies a verified subject not taken. `INC` explicitly identifies a missing/incomplete or ambiguously configured result. Incomplete subjects are excluded from numeric subject statistics. A student's remaining valid subjects can produce a clearly marked provisional mean, while the student has no final rank. Unknown, erroneous, malformed, mismatched-term or insufficiently authorized enrollment scopes withhold final aggregates and ranks.

Multiple same-period papers or duplicate mark records are treated as ambiguous/incomplete. No unconfigured weighting rule, latest-paper selection or averaging across duplicates was introduced.

Subject analysis uses the same subject columns and valid normalized subject results as the matrix. Existing grading bands, grade interpretation, pass-mark configuration and distribution behavior are retained. Teacher subject lists restrict visible columns, values, summaries and CSV data; partial overall enrollment scope does not gain a final class rank.

## Print and preview output

Current fictional classes have seven or eight subject columns. All 21 class/assessment outputs fit **two A4 landscape pages**: matrix first, separate subject analysis second. Wider subject scopes or longer identity columns select A3 landscape automatically. Full names and admission numbers are not truncated. Mobile documents retain an accessible horizontal scroll region.

- [Before-and-after comparisons](screenshots/broadsheet-comparison/index.html): Year 7 Midterm, End Term and Combined; Year 13 Combined. Links open saved PDFs, including their analysis pages. Prior outputs were preserved before editing.
- [Main inspection gallery](screenshots/index.html): updated desktop and mobile broadsheet screenshots, current PDF thumbnails and links.
- [Detailed browser/data evidence](screenshots/broadsheet-comparison/verification.json).
- [Existing fictional report gallery](.local-migration/report-previews/index.html): updated in place, including the established PDF, CSV and screenshot filenames.

All 21 broadsheet PDFs and native CSV exports were regenerated, plus representative Year 7/13 desktop captures and the mobile broadsheet. The overall gallery retains 35 desktop captures, six mobile captures and 104 current PDFs; unrelated page screenshots and report-card PDFs were preserved.

Preview helpers changed or added under `.local-migration/report-inspection`:

- `verify-compact-broadsheets.mjs` — isolated local UI login, independent expected calculations, all 21 views, CSV/PDF generation, screen/print geometry and source/data fingerprints.
- `finish-compact-gallery.py` — before/after PDF renderings and synchronization with the existing report collection.
- `refresh-previews.mjs` — subject-column counts and actual selected print-paper size, replacing old two-paper-column assumptions.
- `render-refresh.py` — refreshes PDF thumbnails when their source PDF changes.
- `validate-refresh.mjs` — validates subject-level CSV output independently against local source marks while retaining legacy compatibility.
- `build-refresh-index.mjs` — links the before/after comparison from both existing gallery indexes.

`screenshots/README.md` and generated gallery evidence/index files were updated accordingly.

## Verification results

- TypeScript: **PASS**, `node node_modules/typescript/bin/tsc --noEmit`.
- Supported application/function unit suites: **185 tests across 10 files PASS**, including 42 compact-broadsheet cases, using `node node_modules/vitest/vitest.mjs run src supabase/functions/provision-staff/handler.test.ts`.
- Production build/PWA generation: **PASS**, `node node_modules/vite/bin/vite.js build`. Nothing was deployed.
- All seven actual fictional classes, Midterm/End Term/Combined: **21 views PASS**. Each contains its exact 10 students and seven/eight configured subject codes.
- **1,620 displayed subject cells** independently checked against original accepted marks; complete names/admissions, totals, averages, grades, competition ranks and completion counts checked. All 21 CSVs independently checked against source marks as well.
- All 21 subject-analysis views checked against direct per-student arithmetic, including entries, mean, grade, high/low and configured pass-threshold counts.
- Screen and print checks: no overflowing table-cell content, single-line identity cells, compact headers under 40 screen pixels, two landscape pages per broadsheet. Representative saved matrix and subject-analysis PDF renderings visually inspected.
- Year 13 report-card route still contains its original 14 assessment rows, seven Midterm and seven End Term. Report-card source and shared paper calculations have unchanged hashes.
- All 104 gallery PDFs passed document-text, school-branding, student-identity and paper-bound checks; refreshed thumbnails render from the saved PDFs. Gallery loaded via `file://` with networking blocked and all 145 images available. Main gallery indexes have no missing links; comparison files also checked.
- Isolated target verified before login: frontend `127.0.0.1:5180`, actual browser Supabase URL `127.0.0.1:58521`, database port `58522`, dedicated container and volume `supabase_db_iupc-report-inspection-20261031`.
- **All 23 public tables have identical before/after fingerprints**, including exactly **70 students, 108 examinations, 1,080 marks and 1,080 write receipts**. Mark revisions, school/staff permissions and settings are unchanged. No second fictional dataset was created.
- Browser requests were limited to the isolated frontend/API and font providers. No hosted Supabase database or production data was accessed. No commit or push was performed.

## Limits and existing checks

The isolated school has no teacher accounts, so teacher subject visibility is covered by regression fixtures and the existing scope filters, rather than a fabricated signed-in teacher screenshot. No teacher, invitation, permission grant or authentication state was created for testing.

Missing marks, irregularities, unequal maxima, duplicate papers and ranking ties were tested with independent in-memory fixtures; no accepted fictional marks were changed to produce those cases. The actual seven classes are complete.

Unrestricted Vitest discovery encounters existing SQL in `supabase/tests/authz.test.ts` (`begin; select plan(6); ...`) and cannot parse it as TypeScript. That SQL/RLS authorization fixture was left unchanged and was not executed against the database. The supported application/function suites passed explicitly. Existing non-blocking Vite future-config-loader and large-bundle warnings remain.

The compact layouts were verified using the existing 10-student classes. Very large cohorts require additional pages, with existing repeating-header/row-break rules; unusually wide subject sets or extremely long identities should be inspected at their automatically selected A3 size. No physical printer test was performed.
