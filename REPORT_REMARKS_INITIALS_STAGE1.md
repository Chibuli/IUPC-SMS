# Stage 1 — automatic subject remarks and teacher initials

Implemented locally as a targeted report refinement. No Stage 2 editing, persisted fields, approval workflow, external AI service or new dependency was added.

Exact project files changed:
1. `src/lib/subject-remarks.ts` — new centralized presentation policy, achievement mapping and deterministic short-remark utility.
2. `src/lib/report-teacher.ts` — new pure name formatter and separate period-specific assignment resolver.
3. `src/lib/academic-report.ts` — integrates those two utilities into the existing subject row. Calculation, eligibility, grade resolution, trend comparison, overall aggregation and ranking sections remain unchanged.
4. `src/lib/subject-remarks.test.ts` — focused remark/category/status/configuration tests.
5. `src/lib/report-teacher.test.ts` — formatting and assignment tests.
6. `src/lib/subject-remarks-integration.test.ts` — term/cumulative/annual/provisional/missing-result and real report integration tests.
7. `src/lib/academic-report.test.ts` — updates two legacy generic-remark expectations for the authorized wording change; also asserts the original configured band remark remains unchanged.
8. `src/components/AcademicReportSheet.test.tsx` — adds fictional PDF scenarios, before/after gallery links and snapshots preserving all non-presentation results for the original 20 fixtures.
9. `src/index.css` — one targeted teacher-cell wrapping rule. Table widths, fonts, chart styles, page grid and signature spacing were not changed.
10. `scripts/verify-academic-reports.mjs` — Stage 1 graph-data/sizing preservation checks, graph/signoff overlap checks and captured teacher-initial text.
11. `REPORT_REMARKS_INITIALS_STAGE1.md` — this engineering record.
12. `REPORT_CARD_DESIGN_REFINEMENT.md` — pointer to this Stage 1 record.

Remark decision rules:
- The utility accepts an already-resolved grade band, configured bands, existing result status, eligibility verification and existing subject-level trend. It does not accept a score, calculate an average, assign a grade or produce a rank.
- Configured bands are ordered by their existing lower score boundaries. A centralized nine-band presentation preset maps descending positions to: highest, very strong, strong, satisfactory, developing, below expectations, support, support, support. This is a wording policy, not a new grading scale; no letter labels, score thresholds or point values are hardcoded into the mapping.
- For other valid band counts, relative band position maps across the seven categories, with the top/bottom bands anchored to highest/support. A three-band scale therefore maps to highest/satisfactory/support. A single band with no achievement hierarchy uses neutral “Result recorded.” The optional source-level `gradeCategories` presentation override can customize a particular scale without changing grades, database fields or school settings.
- The catalogue has a configured upper limit of 32 characters and seven words. Current phrases are concise, encouraging and free of claims about attitude, conduct, homework or attendance. Every generated phrase was measured against the actual existing remark cell/font and fits its width. No report font or column was shrunk or widened.
- Existing Improving, Stationary and Dropped subject trend strings select the corresponding catalogue variant. Numeric differences are not recalculated or classified using a new tolerance. With no comparison, the baseline phrase is used; unavailable history is never called stationary.
- High stationary achievement gets “Consistently outstanding” or “Consistently strong.” High achievement with decline gets “Strong; regain consistency,” not a weak-performance label. Lower achievement gets constructive improvement/support wording.

Term and status handling:
- Term 1 uses its completed subject grade and baseline wording. The existing subject trend is term-to-term and has no previous term here. The graph's Midterm-to-End Term movement is intentionally not substituted for a previous-term subject comparison.
- Term 2 uses the already-calculated cumulative grade plus the existing Term 1-to-Term 2 subject trend.
- Term 3 uses the already-calculated annual/available-term grade plus the existing Term 2-to-Term 3 subject trend. No annual grade is recomputed in the remark utility.
- Verified provisional grades can receive performance remarks while their existing provisional labels and missing cumulative positions remain unchanged. First eligible terms without a prior subject comparison use baseline wording. For example, a Term 3 admission can have an improving internal graph but a baseline subject remark; those are different comparisons.
- Missing one required component yields INC. Both current components pending/unentered yield Pending in the remark cell, while the existing term result stays incomplete. An explicit current component irregularity yields Irregularity. N/T, N/A and Unresolved remain explicit. An incomplete historical term is never averaged around for ordinary praise.
- Unknown historical eligibility withholds ordinary praise even when numeric component marks exist. It does not change the engine's numerical fields or eligibility policy.
- The existing accepted remark-override facility remains respected for valid results. No editing facility was added, and invalid/incomplete results do not display positive overrides. Existing override text is not silently truncated or overwritten.

Teacher initials:
- The source is the actual registered `Teacher.full_name`, not cached initials or the mark entrant. Stored names and cached initials are not rewritten.
- NFC normalization, whitespace cleanup, case-insensitive removal of recognized leading Mr/Mrs/Ms/Miss/Dr/Prof titles and uppercase initials give `Mr. Collins Sammy -> C.S.`, `Faith  Mbithe Kavita -> F.M.K.` and `Dr. Mary Wanjiku -> M.W.`.
- Each meaningful hyphenated component contributes an initial: `Anne-Marie O'Neill -> A.M.O.`. Apostrophes remain inside one component. Single names produce one dotted initial; blank, missing or title-only names produce a dash. No meaningful component is truncated. Unusually long initials wrap in the existing teacher column.
- Assignment resolution remains the authoritative timetable filtered by exact school, selected term ID, class and subject. Repeated periods for one teacher are deduplicated. Missing teacher records, missing period assignments, cross-school records or multiple distinct teachers resolve to a dash.
- No primary-teacher/priority field exists in the inspected model, so ambiguous co-teaching is not resolved by database ordering. Current broad subject permissions and the mark entrant are never treated as historical assignments. No permission path was added.

Examples from regenerated fictional PDFs:

| Fixture | Grade/trend basis | Display remark / initials |
| --- | --- | --- |
| complete-term-1 | 75%, B, no previous subject term | Good work; aim higher / C.F.S. |
| complete-term-2 | cumulative 80%, A, improving | Very good progress / C.F.S. |
| complete-term-3 | annual 85%, A, improving | Very good progress / C.F.S. |
| declining | annual B, dropped | Good; regain consistency |
| joined-term-2-view-term-2 | provisional A, no prior comparison | Very good performance |
| joined-term-2 | provisional A*, improving across Terms 2–3 | Excellent progress |
| joined-term-3 | provisional A*, no prior subject term | Outstanding achievement |
| missing-midterm / missing-end-term | incomplete affected subject | INC |
| subject-not-taken | verified excluded subject | N/T |
| stationary-high-achievement | A*, unchanged | Consistently outstanding |
| stationary-support-needed | low configured band, unchanged | Continued support needed |
| high-achievement-14/16-subjects | A*, improving | Excellent progress; graph retained |
| assigned-teacher-title | Mr. Collins Sammy; stale cached initials | C.S. |
| historical-teacher-term-1 / term-2 | exact different period assignments | C.F.S. / M.W. |
| assigned-teacher-long-initials | Prof. Mary-Anne Wanjiku Otieno Njeri Achieng | M.A.W.O.N.A., wrapped without clipping |

Executed validation:
- Focused remarks, initials, integration, academic, presentation and graph tests: 148 passed across six files.
- `npx vitest run src supabase/functions`: 362 tests passed across 21 files, preserving the prior 279 regressions and adding 83 focused tests. The two prior generic-remark expectations were legitimately updated; their grade assertions and configured band data remain intact.
- `npm run typecheck`: passed.
- `npm run build`: passed, including TypeScript, Vite production bundling and PWA generation. Existing Vite config-loader/large-bundle warnings remain.
- `node scripts/verify-academic-reports.mjs --reports-only --stage1`: all 28 fictional reports passed as single A4 portrait pages, with zero clipped cells, zero graph/remarks overlap and all graphs visible. There was no additional graph compaction compared with the preceding implementation. No table width, font, graph algorithm or graph size was changed to make remarks fit.
- The original 20 fixture snapshots compare every calculated field/status/grade/band/position and mapped graph result before/after, excluding only the intended remark and initials strings. All comparisons passed.
- Source comparisons confirm assessment normalization, term/cumulative/eligibility/trend functions, period selection/subject results/band resolution, overall averages and ranking sections are byte-for-byte unchanged. Protected-source hashes confirm the grading utility, broadsheets, student/data/auth/offline modules, graph utility/component and actual report rendering component are unchanged. The only intentional protected-style change is teacher-cell wrapping. Class-list artifacts remain byte-for-byte unchanged.
- `python scripts/render-academic-pdfs.py`: rasterized all 28 actual PDFs. All ten contact sheets were visually inspected, with additional full-resolution review of ordinary Term 3, 16-subject high achievement and long teacher initials. PDF text checks found no replacement glyphs/question marks. Visual checks covered short meaningful remarks, historical initials, wrapping, watermark, graph, results, signatures, grading key and footer.
- Initial density checks caught an overlong praise phrase and non-wrapping long initials. The phrase catalogue was shortened and teacher text wrapping enabled; final checks passed without modifying fixture marks or compromising graph visibility.

Review and reproducibility:
Open `.local-migration/academic-report-review/index.html`. The before-stage PDFs are retained in `before-stage1/`; additional fixture cases have an explicit new-fixture note. Every PDF has a matching actual-PDF raster `*-pdf-page-1.png`. `verification.json`, `pdf-render-verification.json`, `remark-widths.json` and `stage1-preservation-verification.json` provide local evidence. The auxiliary font-measurement script is local-only at `.local-migration/measure-stage1-remarks.mjs`.

To reproduce: build, run the presentation test with `IUPC_WRITE_ACADEMIC_FIXTURES=1` and `IUPC_REPORT_GRAPHS_ONLY=1`, unset both variables, then run the PDF verifier with `--reports-only --stage1` and the existing PDF raster script. The optional baseline comparison uses the fictional snapshots already captured under `before-stage1/baselines/`.

Remaining limitations:
Historical teacher assignments can only be recovered while reliable period-specific timetable rows and teacher records remain available. Teacher display-name history is not separately versioned. There is no recorded primary teacher for multiple assignments; these remain unresolved. Historical enrollment and grading-scale snapshot limitations described in `ACADEMIC_REPORT_IMPLEMENTATION.md` remain unchanged. The achievement categories are an explicit presentation policy and can be adjusted centrally for a differently structured school scale. Exceptionally long legacy manual overrides or many unusually long multi-component teacher names can still exceed the existing page capacity; they are not silently truncated. None of the 28 tested reports has that limitation.

Preservation confirmation: academic calculations, grading bands and grade points, current-term/cumulative rankings, accepted marks/statuses, student/teacher records, admission numbers, school settings, broadsheets, class lists, authentication/permissions/RLS, offline marking and synchronization are unchanged. Hosted Supabase was not contacted. No migration, reseeding, actual-record mutation, deployment, commit or push occurred. Only explicitly fictional in-memory/local fixture records were used. No Stage 2 feature was implemented.
