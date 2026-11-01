# Printable broadsheet letterhead spacing

Completed locally, 1 November 2026. Header-only correction; no academic or CSV changes.

## Root cause

Both Reports pages duplicated a two-part outer flex header. Inside its left part, `gap-3` separated the logo from school information by only **12 CSS px (9 PDF points)**. The right examination block used `shrink-0`, while print CSS capped it at 50% without reserving a centre information column. Longer text therefore competed with the logo/information group rather than flowing in independently sized columns. Contact text was only 8px, and the telephone and postal separator rendered unconditionally, producing a bare `TEL` and a leading `·` when those fields were empty.

The original logo itself was not distorted. The correction continues using the existing `SchoolLogo` and the same configured `school.logo_url` at its existing height and original aspect ratio.

## Application files changed

- `src/components/BroadsheetHeader.tsx` (new): shared letterhead, typed school/title/detail props, configured-value cleanup and conditional contact rendering.
- `src/pages/Reports.tsx`: imports that component and replaces only the two duplicated header blocks. Academic titles/details, tables, results key, legend, statistics, signatures and CSV handler remain unchanged.
- `src/index.css`: scoped letterhead grid/typography rules; removes the obsolete last-child 50% print restriction. No table or other document styles were changed.
- `src/components/BroadsheetHeader.test.tsx` (new): five focused contact/fixture tests.

Preview helpers: `verify-compact-broadsheets.mjs` gained a header-only verification/output mode; new `render-header-fixture.mjs` and `finish-header-gallery.py` generate and validate the letterhead comparisons. Existing gallery/render helpers refreshed their normal output. No dependencies were added.

## Exact layout correction

The header is now a three-column CSS grid: `max-content minmax(0, 1fr) minmax(0, 1.1fr)`, with **24px column gaps**, top alignment, an 8px bottom inset and the existing crimson rule. The logo occupies its own intrinsic-width column; school information and examination information have independent shrinkable columns. The right title wraps naturally, including unusually long unbroken text, instead of forcing a non-shrinking flex item.

School name remains 17px and prominent. Contact/location text is 10px with consistent alignment. The configured fictional-data warning is retained and emphasized. The existing logo height remains 40px; its proportional width and `object-fit: contain` are preserved. Both Student Results and Subject Analysis use exactly the same component and CSS in Midterm, End Term and Combined.

Measured actual PDF logo-to-school-name separation: **minimum 18.01 PDF points**, equivalent to approximately **24 CSS pixels**. DOM checks measured exactly 24px between logo/school and school/examination blocks. No clipping or overlapping text was detected.

## Configured school information

Values still come from the current school record already loaded by Reports. No new database query, setting or contact was introduced.

- Trim whitespace; omit empty, null, undefined and literal “null”/“undefined” contact values.
- Render a telephone label only alongside a configured nonblank number.
- Join postal/location values only when present, eliminating an orphan separator.
- Show configured email only when present.
- Preserve the school's configured address/warning text verbatim. No fictional warning is hardcoded into real documents.
- Mark contacts from a record carrying a configured fictional/test-data warning as unverified test contacts. Reserved `.invalid`/`.test` email domains are likewise identified as test email, even without such a warning.

The isolated school therefore prints its existing fictional-data warning, `Mombasa, Kenya`, and **Test email (unverified): office@iupc-test.invalid**. It prints no telephone line. Ordinary configured school contacts retain ordinary Tel/Email labels, without invented numbers, email addresses, mottos or accreditation.

## Verification

- **61 focused tests across four files PASS**: shared letterhead, actual Reports renderer, presentation/key behavior and existing compact calculations.
- TypeScript validation **PASS**; production/PWA build **PASS**. Existing non-blocking future config-loader and bundle-size warnings remain.
- All **21 class/assessment views** regenerated and checked, including 1,620 subject results and existing academic statistics.
- All 21 current broadsheets remain **two A4 landscape pages** for the existing fictional cohorts. No third page, clipped headings or overflowing cells.
- Both pages of Year 7 Midterm, End Term, Combined and Year 13 Combined were inspected. PDF extraction confirms their **entire non-header text is identical before and after**, including student results, key/legend, statistics, distributions, pass rates and signatures.
- Long school-name/examination-title fixtures rendered through the actual shared component on **A4 and A3 landscape**, two pages each, without overflow. Both fixture pages share matching header geometry. No school setting was changed for these tests.
- Original logo ratio approximately 2.4507; rendered ratio approximately 2.45, with rounding tolerance only. Existing official image content/quality is preserved.
- CSV export files, complete CSV/calculation helper source and report-card source have **identical SHA-256 hashes** before and after.
- All 21 full calculation snapshots and all **23 public-table fingerprints unchanged**: **70 fictional students, 1,080 accepted marks**, original assessments, revisions, receipts, settings and permissions retained.
- Isolated database container/project/volume and port 58522 were verified before access; frontend's actual Supabase URL verified as `127.0.0.1:58521` before normal test login. Frontend is `127.0.0.1:5180`. No hosted Supabase or production data was accessed.
- Main gallery loaded from disk with network blocked: all **146** current screenshot/PDF-thumbnail images load. Main indexes check **1,053 links with zero missing files**. Earlier comparison pages and their documents remain preserved.

## Updated files and evidence

Open `C:\Users\ADMIN\3D Objects\IUPC SMS\screenshots\index.html` or the current comparison gallery at `screenshots/broadsheet-comparison/index.html`.

Requested current PDFs:

- `screenshots/pdfs/broadsheet-year-7-midterm.pdf`
- `screenshots/pdfs/broadsheet-year-7-endterm.pdf`
- `screenshots/pdfs/broadsheet-year-7-combined-term.pdf`
- `screenshots/pdfs/broadsheet-year-13-combined-term.pdf`

Before/after copies and both-page images: `screenshots/broadsheet-comparison/header-before/` and `header-after/`. The previous presentation comparison is retained as `presentation-stage-index.html`; its own earlier comparisons remain linked.

Additional evidence: `header-contactsheet.png` shows all eight current representative headers; `header-pdf-checks.json` records spacing and body-text equality; `header-verification.json` contains all-class checks; `header-invariance.json` records academic/data invariance; `header-fixtures/` contains the A4/A3 long-title fixtures and measurements. The existing `.local-migration/report-previews` PDFs and gallery aliases were synchronized.

No changes to grading, Combined calculations, ranks, CSV exports, student registration/data, RLS, migrations, authentication, offline synchronization, report cards or unrelated modules. No deployment, commit or push occurred.
