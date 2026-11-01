# Class lists, broadsheets and report-card refinement

Completed locally on 1 November 2026 using only the existing fictional-data environment: frontend `127.0.0.1:5180`, Supabase API `58521`, database `58522`. Hosted Supabase was not accessed.

## Changes

- **Class lists:** printing from the student register carries the selected name/admission/class sort order into the existing active class-list print view. Class sorting within one class follows name order, as in the register. The Classes page also offers a print-order selector. The register action explicitly says it prints the active class roster, not a search-filtered or archived subset. Numbering, fixed columns, full admission numbers, crimson table headings and print row/page rules improve readability. Blank handwritten space and both signatories remain.
- **Broadsheets:** full subject names, codes, class and assessment headings wrap without ellipsis. Student names and full admission numbers remain visible. Screen columns have readable widths inside a keyboard-focusable horizontal scroll region. Combined assessments remain the default. The new selector uses only existing authorized `exam_type` values; Midterm and End Term filter the existing papers before calling the unchanged calculation function. School, class, stream, demographic and teacher subject scopes continue to apply.
- **Export:** every selected paper retains its original value. CSV headings now identify the full subject, class, assessment and exam name; filenames identify the selected view. CSV quoting/escaping and UTF-8 BOM remain supported. Existing callers of `toCsv` retain their default headings.
- **Printing:** broadsheets with more than 10 papers use A3 landscape, while smaller selections use A4 landscape. Matrix and subject analysis remain separate printed sections. Table headers repeat when a table continues onto another page, and individual student rows avoid breaks. Removed misleading fixed “page 1 of 2” labels because larger cohorts may span more pages. White print backgrounds replace the application shell background on these document pages.
- **Report cards:** official existing school logo retained; student, class, stream, academic term/year and assessment labels are explicit. Repeated subject rows now clearly identify Midterm or End Term without merging or averaging papers differently. Totals, averages, grades, remarks, grading key and signatory fields are preserved. Print-only spacing keeps the tested 14- and 16-assessment reports on one A4 portrait page. Existing subject-row counts are accurately labeled as assessments/papers.
- **Responsive behavior:** report cards and broadsheets scroll inside labeled, keyboard-focusable regions, keeping all academic columns available without overlapping text. Screen widths do not constrain print widths.

## Files changed

- `src/pages/Classes.tsx`
- `src/pages/Students.tsx`
- `src/pages/Reports.tsx`
- `src/pages/ReportCards.tsx`
- `src/index.css`
- `src/lib/print.ts`
- `src/lib/analytics.ts` — optional CSV heading formatter only; calculation logic unchanged.
- `src/lib/analytics.test.ts` — assessment and complete CSV-heading regression coverage.
- `.local-migration/report-inspection/verify-report-refinement.mjs` — protected local verification helper, no embedded credentials.
- `.local-migration/report-refinement-previews/render-pdfs.mjs` — network-blocked PDF preview rendering.
- This report and generated preview/CSV/verification artifacts.

## Verification

- TypeScript validation: **PASS**.
- Focused reporting/data-access/enrollment tests: **72 tests across 4 files PASS**.
- Production build and PWA generation: **PASS**. Existing non-blocking bundle-size and future Vite native-config-loader warnings remain.
- All **70 students** and **1,080 accepted marks** unchanged. Database fingerprints for students, marks, revisions and write receipts match before and after the final browser run.
- All seven class lists contain their exact 10 students: **70 distinct admission numbers**, no missing or duplicate students. All three register sort choices agree with printed order.
- All **21** class/assessment views and CSVs contain exactly 10 unique students. Every exported exam column, student identity and mark matches the baseline calculation data. Complete descriptive headings verified.
- All **70 report cards** retain the expected 14 or 16 assessment rows, correct exam/student association, displayed marks, grades and period labels.
- Combined, Midterm and End Term calculation objects for all seven classes match the pre-change baseline, including totals, averages, completion and ranks. No grading formula or assessment configuration changed.
- Year 13 remains complete: **140 marks**, 70 per period, 14 per student. Year 7 remains complete: **160 marks**, 80 per period, 16 per student.
- Representative Year 7 and Year 13 reports: **one A4 portrait page each**. Combined Year 7/13 broadsheets: **two A3 landscape pages each**, matrix followed by analysis. Individual Year 13 Midterm/End Term broadsheets: **two A4 landscape pages each**. Class list: **one A4 portrait page**.
- **390px and 768px** checks: no horizontal page overflow or overflowing table-cell content; academic scroll regions remain keyboard focusable. Desktop preview also inspected.

## Before-and-after PDFs

| Document | Before | After |
|---|---|---|
| Class list, Year 7 | [Before](.local-migration/report-refinement-previews/before/class-list-year7.pdf) | [After](.local-migration/report-refinement-previews/after/class-list-year7.pdf) |
| Combined broadsheet, Year 7 | [Before](.local-migration/report-refinement-previews/before/broadsheet-year7.pdf) | [After](.local-migration/report-refinement-previews/after/broadsheet-year7.pdf) |
| Combined broadsheet, Year 13 | [Before](.local-migration/report-refinement-previews/before/broadsheet-year13.pdf) | [After](.local-migration/report-refinement-previews/after/broadsheet-year13.pdf) |
| Report card, Year 13 | [Before](.local-migration/report-refinement-previews/before/report-year13.pdf) | [After](.local-migration/report-refinement-previews/after/report-year13.pdf) |

Additional previews: [Year 7 report](.local-migration/report-refinement-previews/after/report-year7.pdf), [Midterm broadsheet](.local-migration/report-refinement-previews/after/broadsheet-year13-midterm.pdf), [End Term broadsheet](.local-migration/report-refinement-previews/after/broadsheet-year13-endterm.pdf). Before/after folders also contain screenshots; the after folder contains all 21 CSV exports and [machine-readable verification](.local-migration/report-refinement-previews/after/verification.json).

## Practical limits

- Combined wide broadsheets require A3-capable printing or PDF output; select an individual assessment for A4 landscape. Honor CSS paper sizing in the print dialog rather than forcing A4 for an A3 document.
- Mobile users scroll across full academic documents; columns are not hidden or compressed into overlapping marks.
- The test classes contain 10 students each. Continuing-table header and row-break rules are configured, but a real larger-cohort physical printer run was not performed. Much longer names or substantially more papers may need additional pages.
- Existing remarks remain handwritten as implemented previously; this work does not add stored remarks or new report fields.

No hosted changes, migrations, RLS changes, authentication changes, accepted-mark/history changes, deployment or Git operations were performed.
