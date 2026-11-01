# Class-list design and measured printing refinement

Completed locally on 1 November 2026. Class lists only; broadsheets and report cards are unchanged.

## Registration finding — separate from the class-list changes

Inspection found an **existing automatic admission-number prefill** in `src/pages/Students.tsx`: `nextAdmissionNumber` creates an `IUPC/<year>/<sequence>` suggestion for the initial class admission form, Add Student, and Save & Add Another. The input is editable, so this does not prevent manual entry. It conflicts with the requested manual-only preference, but the task also explicitly prohibits registration changes unless manual entry is blocked.

This was reported separately before implementation, and authorization to remove only that prefill was requested. No authorization was received during this work, so **Students.tsx remains unchanged**. No new numbering or automatic assignment was introduced. The existing prefill remains an outstanding registration-policy issue, not a class-list feature added by this task.

Live verification confirms the administrator can replace the current suggestion with `IUPC-001`, with no forced class/year-based format. Entering an existing fictional TEST admission number is rejected with the existing “already on roll” validation before saving. Existing frontend uniqueness checks and the database's `(school_id, admission_number)` unique constraint are unchanged. No valid registration was submitted, because this task prohibits changing student records.

## Root cause and application files changed

The old class list had a separate text-only school header, no official logo, unconditional contact separators, a fifth unlabeled column, no page-total calculation and only one header. It called print after fixed 60/100ms delays, which did not wait for fonts, images or pagination.

- `src/pages/Classes.tsx`: replaces the old print-only markup with `ClassListPrint`, memoizes the existing sorted active roster and waits for measured pages before opening the print dialog. Existing class management actions and sort options remain. The header shows a term/year only when a unique active term is available.
- `src/components/ClassListPrint.tsx` (new): shared school letterhead, four-column table, offscreen measurement at actual A4 width, explicit pages, continuous row numbering, final-only signatures and page totals.
- `src/lib/class-list-pagination.ts` (new): pure measured-height page packing with overflow rejection and signature continuation.
- `src/lib/class-list-pagination.test.ts` (new): nine pagination cases, including variable heights, taller letterheads, signature continuation and oversized-row rejection.
- `src/index.css`: adds only class-list-specific styles and page geometry. Existing broadsheet/report-card styles were not changed.

The existing `BroadsheetHeader.tsx` is reused **without modification**. The existing `src/lib/print.ts` classlist page name and A4 portrait/10mm margin rules remain unchanged. Registration, authentication, grading, offline synchronization, migrations and RLS were not modified.

Preview-only helpers added/updated: `.local-migration/report-inspection/classlist-fixture.html`, `verify-classlists.mjs`, `finish-classlist-gallery.py`, and `build-refresh-index.mjs`. No dependencies were added.

## Header and register design

The unchanged shared letterhead provides the official proportional logo on the left, configured school information in the centre, and CLASS LIST / class / stream / available term/year on the right. Its 24px column gaps, contact omission rules and unverified test-contact labels match the broadsheets. The configured fictional-data notice remains visible. No school contact, motto or accreditation was invented.

Column order is **NO. | ADM NO. | STUDENT NAME | GENDER**, with 7% / 23% / 56% / 14% widths. The four headings are crimson with white text; student rows have thin grey borders and alternating white/light backgrounds. Body type is 12px (9pt), admission type 11.5px, with a normal minimum row height of 8mm for readable registration/handwriting space. Long names/admission numbers wrap without truncation and increase their measured row height.

Every stored admission number is displayed directly, including all existing TEST values, without generation, reformatting, class derivation or renumbering. Only the sequential **NO.** column is generated for the printed roster. Active/non-archived filtering uses the unchanged existing lifecycle helper. Classes' Name/Admission sort options and register Name/Admission/Class print requests preserve their existing order.

## Reliable pagination strategy

The component first renders an offscreen, inaccessible measurement copy at **190mm**, the A4 portrait content width after 10mm side margins. It waits for the actual document fonts and logo decoding, then measures the actual letterhead, table headings, every row, footer and signature block. Page height is the corresponding **277mm** printable area.

The pure paginator packs consecutive measured row heights into that space, reserving the school header, table headings, footer and a small rounding guard. There is no hardcoded 25- or 30-student page size. Each generated section is an explicit A4 page, repeats the letterhead and table headings, and displays **Page n of N** from the generated page array. Student NO. uses the absolute roster offset, so it never restarts at a page break.

Student rows are never intentionally split. Both signature fields form one measured block after the final student. If that block cannot fit, it moves together to a final continuation page with its own header/headings/footer. A row too tall to fit unbroken raises a visible preparation error and does not trigger printing, rather than clipping or dropping the student.

The native print call runs after measured pages are committed, rather than after a fixed timeout. Screen and print share the same measured typography, widths, table/row styles and signature dimensions. CSS page breaks separate those already-calculated pages; CSS is not relied upon to infer row counts or page totals.

## Test results

All browser fixtures use temporary in-memory presentation records, clearly labeled **PRESENTATION FIXTURE — NOT SCHOOL RECORDS**. They never call student-save APIs or enter the offline queue.

| Fixture | Physical PDF pages | Students per page |
|---|---:|---|
| 10 students | 1 | 10 |
| 35 students | 2 | 30, 5 |
| 50 students | 2 | 30, 20 |
| 75 students | 3 | 30, 30, 15 |
| 100 students | 4 | 30, 30, 30, 10 |
| 35 with long full name and 48-character admission number | 2 | 28, 7 |
| 30 at the signature boundary | 2 | 30, then signatures only |

The signature continuation is meaningful content, not an empty/blank page. The differing long-text row count demonstrates that pagination uses actual available dimensions rather than a fixed student count.

Browser checks and independent PDF-text/layout checks verify that every student appears exactly once, numbering is continuous, original order is preserved, headers and table headings repeat, footers match the physical PDF count, both signature fields occur only on the final page, and no text extends outside the paper. All long-name/admission text is retained. All **23 physical pages** across seven real class lists and seven fixture PDFs passed these checks.

- **16 focused tests across three files PASS**: pagination, reused letterhead and lifecycle filtering.
- TypeScript validation **PASS**.
- Production build/PWA generation **PASS**; existing non-blocking Vite config-loader and large-bundle warnings remain.
- Both Classes sort settings and all three register sort settings match printed order.
- All seven real class/stream lists contain their exact ten active students and fit one A4 portrait page each.
- Manual input replacement and duplicate-number rejection verified without creating or modifying a student.

## Existing data and protected scope

Before database access, the isolated container/project label, dedicated volume and database port **58522** were verified. The frontend's actual Supabase URL was verified as **http://127.0.0.1:58521** before normal authorized local login at **http://127.0.0.1:5180**. No hosted Supabase was accessed.

All **23 public-table fingerprints are identical before and after**, including **70 students, seven classes, 1,080 marks, original assessments, revisions, receipts, settings and permissions**. Admission numbers are unchanged. Broadsheet and report-card source/PDF files and protected backend/auth/offline/grading files have identical SHA-256 hashes. No report-card modifications were begun.

## Updated previews

Main gallery: `C:\Users\ADMIN\3D Objects\IUPC SMS\screenshots\index.html`.

Real class lists are updated in place:

- `screenshots/pdfs/class-list-year-7.pdf`
- `screenshots/pdfs/class-list-year-8.pdf`
- `screenshots/pdfs/class-list-year-9.pdf`
- `screenshots/pdfs/class-list-year-10.pdf`
- `screenshots/pdfs/class-list-year-11.pdf`
- `screenshots/pdfs/class-list-year-12.pdf`
- `screenshots/pdfs/class-list-year-13.pdf`

Before/after gallery: `screenshots/class-list-comparison/index.html`, with all seven original/current PDFs preserved under `before/` and `after/`.

Multipage gallery: `screenshots/class-list-fixtures/index.html`, including `class-list-35.pdf`, `class-list-50.pdf`, `class-list-100.pdf`, all other tested sizes, long-text and signature-boundary cases. `verification.json` and `pdf-checks.json` provide browser/data and saved-PDF evidence. These fixture records are not part of the real 70-student dataset.

The existing `.local-migration/report-previews` class-list PDFs and gallery aliases were synchronized. Unrelated screenshots, broadsheets, report cards and historical documents remain preserved. No deployment, commit or push occurred.
