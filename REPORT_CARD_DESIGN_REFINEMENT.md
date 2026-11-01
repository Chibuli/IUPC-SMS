# Premium academic report design refinement

Implemented as a presentation-only refinement of the existing React/browser-print report. The academic engine and all stored school data were left unchanged.

Files modified or added:
- `src/components/AcademicReportSheet.tsx`: three-part masthead, identity layout, presentation-only provisional headings/markers, results panel, SVG progress chart, coordinated approval blocks, writing rules, footer typography.
- `src/index.css`: consolidated report-only styles, bounded handwriting areas for sparse reports, natural-height approval grid, compact dense spacing, fixed A4 width and footer anchoring.
- `src/components/AcademicReportSheet.test.tsx`: presentation regressions, immutable view-model checks, numerical grade checks, additional fictional density/history/punctuation fixtures and before/after gallery generation.
- `scripts/verify-academic-reports.mjs`: adds approval-row gap, grading overlap and character checks; mirrors the live optional-chart omission when space is insufficient.
- `scripts/render-academic-pdfs.py`: rasterizes the actual generated PDFs with a local PyMuPDF utility, extracts text/fonts, and produces contact sheets. The utility dependency is isolated in `.local-migration/pdf-render-tools`; application dependencies and package manifests were not changed.
- `REPORT_CARD_DESIGN_REFINEMENT.md`: this delivery record.

Visual improvements:
- The official logo, centered school name/contact details and right-aligned printing date are retained. A full-width crimson report title separates the masthead from student identity. Empty phone/email fields no longer print dangling labels. Fixture postal wording remains supplied only by fictional fixture data. The motto appears once, in the footer.
- The table retains the engine's automatic term-specific columns and all original values. Fine borders, subtle alternating shading, compact numeric columns, emphasized averages/grades, muted subject codes and a wider teacher column improve reading. Main table type remains 10 CSS px, unchanged from the preceding implementation; dense reports reduce padding rather than type size.
- Results use four primary metrics and a secondary grade/coverage/trend strip. Missing positions remain dashes, with incomplete/provisional reasons immediately below.
- Class teacher, principal, house master and next-term blocks form a single two-column approval grid. Rows use natural content height, with 12 px between rows or 9 px in dense reports. They no longer stretch to fill the page. Sparse reports receive bounded, useful handwriting areas; larger reports use smaller writing areas. Signature/date rules remain blank, actual saved remarks remain intact, and unknown signatories are not invented.
- The grading legend and motto stay at the foot through the grading section's automatic top margin. Spare space does not split the approval rows. There are no fixed vertical coordinates for the house master or next-term section.
- An SVG line chart replaces horizontal bars. It plots existing completed overall term averages, connects only adjacent valid terms and labels missing terms Unavailable. It never plots available-term annual/provisional aggregates. Term 1 and reports with fewer than two valid periods have no chart. Reports above 10 subjects omit it; live measured overflow also removes the optional chart before warning about exceptional remaining overflow.
- The actual full student name remains the centered diagonal background watermark. Its CSS alpha was reduced from 4.5% to 2.2% (Chromium quantizes the observed value to about 2.4%). Long names wrap inside an inset body area. The watermark remains behind content and is marked aria-hidden.
- Term 3 complete coverage displays Annual Avg. Legitimate provisional coverage displays Available Avg, with P beside that subject's average/grade and an explanatory note. Mixed subject coverage displays Annual / available avg and marks only provisional subjects. Equivalent cumulative/available wording applies in Term 2. These are presentation labels; no engine columns, values, grades, statuses or ranks are mutated.
- The graph heading's question mark was a literal source character, not a missing font. It is now an em dash. Grading boundaries remain lower-inclusive and upper-exclusive below the top band, displayed as e.g. 80–<90, with the top band including 100. Chromium embeds Segoe UI font subsets. Actual PDF text extraction found no replacement glyphs or question marks across the final report fixtures; apostrophes, hyphens, dashes, percentages, A* and teacher initials were reviewed.

Local deliverables:
Open `.local-migration/academic-report-review/index.html` for before/after PDF comparisons. Earlier PDFs are preserved under `before/`. Newly added fixtures show an explicit new-fixture note instead of a broken before-preview. Each report also links its actual PDF raster image, named `*-pdf-page-1.png`; six `pdf-contact-*.png` sheets show the complete set. `verification.json` contains layout metrics, and `pdf-render-verification.json` contains actual PDF dimensions, text and font inspection results.

Seventeen academic PDFs were regenerated:
- Complete Terms 1, 2 and 3.
- Joined in Term 2; joined in Term 3.
- Missing Midterm; subject not taken; improving; declining.
- Long student/subject names with 16 subjects for Terms 1, 2 and 3.
- Eight subjects in Term 2; ten subjects in Term 3; fourteen subjects in Term 3.
- Missing intermediate term; punctuated student name.
The existing five fictional class-list PDFs were also regenerated by the shared fixture utility, with their source component/pagination logic unchanged.

Verification actually executed:
- `npm run typecheck`: passed.
- `npx vitest run src supabase/functions`: 255 tests passed across 17 files, preserving all 251 previous tests and adding four presentation tests.
- `npm run build`: passed, including TypeScript, production bundling and PWA generation. Existing config-loader and large-bundle warnings remain.
- Focused report generation/test run: 5 presentation tests passed; focused academic plus presentation run also passed.
- `node scripts/verify-academic-reports.mjs`: passed. All 17 reports are single A4 portrait pages, with zero detected horizontally clipped cells or grading/signoff overlaps. Approval rows remain 9–12 px apart. Class-list totals remain 1/2/2/3/4 pages for 10/35/50/75/100 students, with continuous numbering and the existing blank 60 mm column.
- `python scripts/render-academic-pdfs.py`: rendered every actual report PDF to images, verified one page and A4 portrait dimensions for each, and found zero replacement glyphs/question marks. All 17 rendered pages were visually inspected through the six final contact sheets, with additional full-resolution inspection of complete, provisional and dense long-name cases during refinement. This is PDF raster review, not solely browser screenshots.
- Before/after SHA-256 checks confirmed that the academic engine, grading utility, broadsheet analytics, database adapter, Students page, ReportCards workflow page, class-list component, pagination utility, session and Supabase configuration source files were unchanged. The baseline is saved in `protected-source-hashes.json` locally.
- Numerical checks remain: Term 1 70/80 -> 75/B; Term 2 75/85 -> 80/A; Term 3 75/85/95 -> 85/A; joined Term 2 -> 90/A* provisional; joined Term 3 -> 95/A* provisional. Missing Midterm remains incomplete. Renderer tests compare the report view model before/after rendering and verify no mutation. Provisional cumulative ranks remain unavailable; chart points never connect across an incomplete intermediate term.
- No unscoped test invocation was used. The previously identified SQL/pgTAP file named `supabase/tests/authz.test.ts` remains excluded from Vitest and was not edited or executed against a database.

Remaining limitations:
All supported fictional 3–16-subject scenarios fit one legible page. Arbitrarily long saved remarks, many unusually long subject titles, or larger loads can still exceed A4; the existing live overflow warning retains required information and reports the exception. Handwriting space is necessarily smaller on dense reports. Historical eligibility and historical scale/signatory snapshot limitations documented in `ACADEMIC_REPORT_IMPLEMENTATION.md` remain exactly as before. Mixed subject coverage is defensively covered by a synthetic renderer-only unit fixture; no new eligibility policy or historical facts were introduced.

To regenerate locally: run `npm run build`, run the presentation test with `IUPC_WRITE_ACADEMIC_FIXTURES=1`, unset that variable, then run the two verification scripts above. The Python raster tool uses the isolated local PyMuPDF installation.

Explicit preservation confirmation: academic calculations, ranking logic, tie handling, late-admission policy, missing-mark rules, existing marks, students, admission numbers, broadsheet functionality, authentication, RLS, permissions and synchronization are unchanged. Hosted Supabase was not contacted. No migrations, database writes, resets, reseeding, deployment, commit or push were performed. Only fictional local test data was used.

## Performance graph follow-up — context-aware mapping

This graph-only refinement supersedes the earlier chart behavior described above. Academic calculations, grading/ranking rules, subject trends, enrollment eligibility, missing-result rules and late-admission policy remain unchanged.

Changed files:
- `src/lib/report-performance-graph.ts` (new): pure, non-mutating graph data mapper. Reuses normalized component outputs, existing complete term overall averages, `mean` and the existing `comparePerformance` tolerance/formatting. No graph output is fed back into academic results.
- `src/components/ReportPerformanceGraph.tsx` (new): visible crimson SVG line/markers, percentages, actual available x-axis labels, minimal percentage grid, single-point rendering and explicit unavailable/no-data notes.
- `src/components/AcademicReportSheet.tsx`: graph integration, graph-aligned overall trend display, compact placement inside the existing summary on dense reports, and measured compaction before any exceptional, explicitly explained omission.
- `src/index.css`: chart-only contrast, typography, compact sizes and dense summary placement.
- `src/lib/report-performance-graph.test.tsx` (new): all eight acceptance cases, late-admission partial assessments, missing intermediate terms, unknown history, verified subject exclusions, normalization, zero, unfinalized marks, trend directions, selected-period isolation, immutable results and summary alignment.
- `src/components/AcademicReportSheet.test.tsx`: updated old chart expectations, new fictional acceptance fixtures and before-graph-refinement comparisons. Graph-only fixture generation can skip class-list artifacts.
- `scripts/verify-academic-reports.mjs`: reports-only mode, graph labels/values/segments in verification output, compaction before omission and failure if any tested graph was omitted.
- `REPORT_CARD_DESIGN_REFINEMENT.md`: this follow-up record.

Mapping:
- Term 1: Midterm / End Term averages for the selected Term 1.
- Term 2: existing Term 1 Avg / Term 2 Avg. A verified Term 2 admission instead uses that current term's Midterm / End Term.
- Term 3: existing Term 1 Avg / Term 2 Avg / Term 3 Avg. A verified Term 3 admission instead uses that current term's Midterm / End Term. A Term 2 admission viewing Term 3 gets only Term 2 Avg / Term 3 Avg, with no empty Term 1 slot.
- Assessment averages require complete, verified component coverage across the student's eligible subjects. A verified subject not taken is excluded; a missing required subject component is not averaged around. Thus, a missing Midterm leaves only a valid End Term point, and vice versa, without changing the official incomplete term result.
- Only numeric Complete results in the existing report model are eligible. Existing normalized assessment percentages are reused. Unknown historical eligibility or a missing enrolled term never becomes a guessed late admission. An admission fallback requires the engine's verified N/A pre-enrollment status for every preceding term.
- Missing points are omitted from the plotted point list and named in an Unavailable note. Original sequence indexes are retained: points across an incomplete intermediate term are not connected. Verified pre-enrollment leading terms are omitted entirely, without a fake or empty historical point.
- One point is centered, labeled and valued with no line and trend —. With multiple points, only consecutive actual periods connect. Trend text uses the latest two plotted points only when their original periods are consecutive; it reuses the existing Improving / Stationary / Dropped comparison. The summary's display follows that selected graph sequence. Engine-owned `report.trend`, subject trend fields, grade/point outputs and rankings are not modified.

Presentation and page fitting:
- Title: Performance Trend. The full-width plot has a solid crimson line, solid markers, bold percentage values, x-axis labels and a restrained 0/50/100% grid. This replaces the earlier faint line treatment.
- Reports with more than ten subjects retain a compact graph inside the results panel rather than automatically losing the graph. All numerical summary fields are retained.
- Other reports start with a 100 px chart. Measured overflow reduces its height to 86 px before any omission. Dense embedded charts use a compact view box and 78 px height with legible values. Exceptional omission at the minimum readable size produces both a screen notice and a printed explanation; it is not silent. No graph was omitted in the tested fixtures.

Executed verification:
- `npm run typecheck`: passed.
- Focused graph, presentation and academic tests: passed.
- `npx vitest run src supabase/functions`: 279 tests passed across 18 files, including the prior 255 tests and 24 new graph/integration tests. No unscoped SQL-file test invocation was used.
- `npm run build`: passed, including TypeScript, Vite production bundling and PWA generation. Existing Vite loader/bundle warnings remain.
- Graph-only fictional generation used `IUPC_WRITE_ACADEMIC_FIXTURES=1` and `IUPC_REPORT_GRAPHS_ONLY=1`.
- `node scripts/verify-academic-reports.mjs --reports-only`: all 20 reports passed as one A4 portrait page, with zero clipped cells and no grading/signoff overlap. Every graph was retained. One incomplete Term 3 admission fixture used the shorter chart; all 14/16-subject fixtures retained embedded charts.
- `python scripts/render-academic-pdfs.py`: re-rendered all 20 actual PDFs to PNGs. All rendered pages were inspected through seven contact sheets, with additional full-resolution inspection of Term 1, dense 16-subject and single-point late-admission cases. Extracted text contains no replacement glyphs or question marks.
- Before/after SHA-256 checks confirmed all eleven protected academic/data/broadsheet/student/class-list/auth/offline source files were unchanged. Existing class-list HTML, PDF and screenshot artifacts were also byte-for-byte unchanged.

Acceptance fixture results:

| Case | Fixture | Actual plotted labels | Values (%) | Segments |
| --- | --- | --- | --- | --- |
| A | complete-term-1 | Midterm, End Term | 70, 80 | 1 |
| B | complete-term-2 | Term 1 Avg, Term 2 Avg | 75, 85 | 1 |
| C | complete-term-3 | Term 1 Avg, Term 2 Avg, Term 3 Avg | 75, 85, 95 | 2 |
| D | joined-term-2-view-term-2 | Midterm, End Term | 80, 90 | 1 |
| E | joined-term-3 | Midterm, End Term | 90, 100 | 1 |
| F | joined-term-2 | Term 2 Avg, Term 3 Avg | 85, 95 | 1 |
| G | missing-midterm | End Term | 80 | 0 |
| H | missing-end-term | Midterm | 70 | 0 |

Other PDFs verified: improving, declining, subject-not-taken, medium-8-term-2, medium-10-term-3, large-14-term-3, long-names-term-1, long-names-term-2, long-names-maximum-load, missing-intermediate-term, punctuated-name and joined-term-3-missing-midterm. The latter shows only End Term 100%, with no segment; missing-intermediate-term shows 75% and 95% without connecting across the missing Term 2.

Open `.local-migration/academic-report-review/index.html` for the updated comparisons. The immediately preceding graph versions are preserved under `before-graph-refinement/`. Current `verification.json` records the exact plotted data, and `*-pdf-page-1.png` files are rasterizations of the actual PDFs. The existing isolated local PDF raster utility was reused; no dependency was added for this refinement.

Preservation: academic engine/calculations, grading bands, ranking rules, late-admission policy, existing records/marks/admission numbers, broadsheets, class lists, authentication/permissions, RLS and synchronization/offline logic are unchanged. Hosted Supabase was not contacted. No migration, database write, deployment, commit or push was performed.

## Stage 1 remarks and initials follow-up

Automatic subject remarks and teacher initials were refined without changing calculations, grading/ranking, eligibility, graphs or the report design. See [REPORT_REMARKS_INITIALS_STAGE1.md](REPORT_REMARKS_INITIALS_STAGE1.md) for the exact file inventory, configurable wording rules, historical-assignment limitations, 362 passing tests and 28 verified one-page fictional PDFs. The only print-style adjustment permits long initials to wrap within their existing column.
