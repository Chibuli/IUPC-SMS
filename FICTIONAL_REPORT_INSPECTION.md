# Fictional local dataset and report inspection

Prepared 31 October–1 November 2026. **The dataset is complete; application reporting verification is partial because an existing data-loading defect was reproduced.** No application redesign or business-logic fix was made.

## 1. Test environment

The original development environment targets local API `127.0.0.1:54321`; production targets hosted project `jqwppkakayhxttazenus`. Neither environment file was changed. A frontend port alone was not used as proof of database identity.

A separate Supabase stack was created with project ID `iupc-report-inspection-20261031`, API port **58521**, database port **58522**, container `supabase_db_iupc-report-inspection-20261031`, and its own identically named database volume. Container identity, project label, port binding and dedicated storage were verified before fictional data creation. All **17 unchanged migrations** were applied there using the supported local CLI. No privileged migration workaround, RLS disabling or permission weakening was used.

The existing development database was inspected read-only for class names, term and offered-subject metadata. The test stack's normal owner bootstrap reproduced those same seven class/stream labels and term. Metadata was compared before seeding. Existing development students and marks were both zero before and after; classes, term and offerings also remained identical.

Test credentials are confined to a protected, Git-ignored directory readable by the Windows owner and SYSTEM. Passwords, keys and sessions were never printed. One confirmed fictional local administrator was created through the local Auth Admin API and the existing owner-only bootstrap. Public registration was not enabled and no emails were sent.

## 2. Student, assessment and mark counts

All names are synthetic Kenyan-style combinations. Admission numbers use `TEST-YY-NNN`. Guardian names explicitly say `FICTIONAL TEST GUARDIAN`; guardian phone fields are blank. No real pupil or guardian records were copied.

| Existing class/stream | Active students | Offered/enrolled subjects | Midterm papers | Endterm papers | Accepted marks |
| --- | ---: | ---: | ---: | ---: | ---: |
| Year 7 A | 10 | 8 | 8 | 8 | 160 |
| Year 8 A | 10 | 8 | 8 | 8 | 160 |
| Year 9 A | 10 | 8 | 8 | 8 | 160 |
| Year 10 A | 10 | 8 | 8 | 8 | 160 |
| Year 11 A | 10 | 8 | 8 | 8 | 160 |
| Year 12 A | 10 | 7 | 7 | 7 | 140 |
| Year 13 A | 10 | 7 | 7 | 7 | 140 |
| **Total** | **70** | | **54** | **54** | **1,080** |

Only **TERM 1, 2026/2027** is populated. No additional classes or terms were created. The existing exam model calls the second assessment **`Endterm`**; no unsupported assessment type was introduced. Papers use the existing UI's default maximum of 100 and the unchanged institutional grading scale. Midterm date: 15 October 2026; Endterm date: 20 November 2026.

Enrollment follows the Student registration page's existing class/level rule: Lower Secondary for Years 7–9, IGCSE for Years 10–11, AS & A Level for Years 12–13. Existing offered subjects were used, with explicit enrollment through authenticated `save_student`. Every score was submitted as the authenticated local administrator through **`apply_offline_write`**, the existing authorized mark-submission RPC. No direct mark/history writes were performed.

Verification found **1,080 marks, 1,080 matching receipts, zero out-of-range marks, zero enrollment/class-ineligible marks**, and 23 public tables with RLS enabled. Negative checks rejected an out-of-range score and a cross-class submission without changing accepted counts. Performance includes high, average and struggling students, with varied Midterm-to-Endterm changes.

## 3. Class-list verification

- Each class displays exactly **10** students in the real local application; all 70 have verified enrollment.
- Student-register name sorting, admission-number sorting and unique-admission search passed.
- Seven existing class-list print actions produced **one-page A4 portrait PDFs**, each containing ten student rows and the existing signature lines.
- The separate printed class list uses its own backend/insertion order; it does **not** follow the register's alphabetical sorting. This was observed and left unchanged.
- The register/class-list UI does not provide a separate class-list CSV export; the supported print/PDF path was used.

## 4. Broadsheet verification

Generated **seven two-page A4 landscape PDFs** and **seven existing “Export to Excel” CSV files**, each CSV containing ten student rows. The CSV is the application's native BOM-prefixed CSV format, not an invented XLSX export.

The existing broadsheet exposes class, stream and demographic filters, **no assessment-type filter**. Midterm and Endterm therefore appear together as separate paper columns on the term sheet. Distinct Midterm-only and Endterm-only broadsheets cannot be selected through the existing UI. The combined sheet is currently titled “End-term results,” which is ambiguous when both periods are present.

Using the existing `buildBroadsheet` calculation function against the fully paginated accepted marks, totals, means and rankings match the application's displayed data for **Years 7–12**. **Year 13 does not match:** 140 marks exist, but only 60 reach the normal frontend loader, leaving all ten Year 13 students classified as incomplete instead of complete. No alternative ranking or averaging method was used.

## 5. Report-card verification

Generated **all 70 individual report-card PDFs**, each **one A4 portrait page**. School branding, fictional identity, admission number, class, term/year and existing grading/summary fields are present. Existing handwritten remarks/signature sections were retained; teacher initials remain blank because teacher assignment was not required for authorized administrator mark submission. No attendance records were invented; the existing unset attendance fields remain 0/0.

Actual saved PDF rendering was inspected in Chrome's local PDF viewer for a report card, class list and combined broadsheet. Page sizes/counts are correct, with no extra blank report-card pages observed. A wide-viewport print-media screenshot can look different from the saved A4 PDF; use the actual PDF/PDF-viewer preview for print-layout assessment.

The report card lists every assessment as a subject row, without showing Midterm/Endterm beside each row, and labels the score column `CAT (%)`. Eight subjects thus appear as sixteen rows/“subjects in scope.” This ambiguity is an existing presentation issue. The ten Year 13 PDFs also inherit the missing-mark problem: their totals/means/grades cannot be accepted as a complete-term result until the loader defect is corrected.

## 6. Analysis and visual findings

The existing Analysis page and its one-page PDF were inspected using the same local data. It reports 1,000/1,080 marks and 80 outstanding marks even though every mark was accepted by the database.

Concise issues, in priority order:

1. **High — silent mark truncation:** `loadSchoolDatabase` uses one unpaginated `select('*')` against `marks`, while the configured API limit is 1,000. This drops 80 Year 13 results and affects broadsheets, report cards and analysis. The dataset itself is complete. No API limit or application query was changed to mask it.
2. **Assessment selection/labels:** no separate-period broadsheet filter; mixed-term sheets say “End-term”; report rows repeat subjects without period labels and retain `CAT (%)` headings.
3. **Broadsheet readability:** narrow assessment headers truncate even on desktop. At 390px, the print-oriented table compresses/overlaps subject headers and marks; parts of headings/summary text clip inside the sheet.
4. **Mobile report-card density:** the A4-oriented form becomes very small and tightly wrapped on a phone. The saved A4 PDF is substantially clearer.
5. **Class-list ordering:** print order is independent of the student register's selected sort.
6. **Branding observation:** the shell is crimson/white, while existing printed table headers retain navy/black. The original low-resolution logo also remains a source-quality limitation. Neither was redesigned.

At 1440px and 390px, no horizontal **document/page** overflow was measured on the inspected register, class, report or analysis routes. That does not mean every cell is readable: internal clipping/compression on mobile broadsheets remains a confirmed defect. Navigation worked; no browser runtime errors were recorded.

## 7. Previews and interactive access

Open [the local preview index](.local-migration/report-previews/index.html) for all PDFs, CSVs and screenshot links. Representative outputs:

- [Class list — Year 7](.local-migration/report-previews/pdfs/class-list-year-7.pdf)
- [Combined-term broadsheet — Year 7](.local-migration/report-previews/pdfs/broadsheet-year-7-combined-term.pdf)
- [Individual report card — TEST-07-001](.local-migration/report-previews/pdfs/report-card-TEST-07-001.pdf)
- [Year 13 report showing the loader defect](.local-migration/report-previews/screenshots/report-card-year-13.png)
- [Mobile broadsheet readability](.local-migration/report-previews/screenshots/broadsheet-mobile.png)
- [Sanitized verification evidence](.local-migration/report-previews/verification-summary.json)

The isolated frontend is running at **http://127.0.0.1:5180** and the database is retained for inspection. To open a browser already signed in to the fictional local school, run from the project directory:

```powershell
node .local-migration/report-inspection/open-preview.mjs
```

If the frontend process has stopped, start it in another PowerShell window first:

```powershell
node .local-migration/report-inspection/serve.mjs
```

These helpers read protected test credentials privately, verify the isolated backend, and never display passwords. The normal development and production targets remain unchanged. External browser requests were blocked during inspection, so font fallback may differ from a normal online browser.

## 8. Checks and protected scope

**129 focused existing tests passed** across eight files. Real-local inspection separately verified record counts, enrollment, accepted receipts, validation rejection, sorting/search, CSV row counts, PDF page sizes/counts, and existing calculation consistency against all accepted data.

All 17 original migration hashes still match their copied test versions. Existing development metadata and student/mark counts are unchanged. The original frontend environment targets are preserved. **No hosted database or Auth records/settings, production records, RLS rules, role permissions, grading rules, report calculations, application source, teacher activation, offline functionality or deployment were modified. No Git operations occurred.**

Only ignored local setup/inspection scripts, isolated fictional records, test artifacts and this report were created. Reporting defects are documented for a separate approved correction; they were not bypassed or redesigned here.
