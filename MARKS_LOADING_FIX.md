# Complete marks retrieval — verified locally

Verified 1 November 2026 against the existing isolated fictional dataset only:
frontend `http://127.0.0.1:5180`, Supabase API `58521`, database `58522`, Docker project `iupc-report-inspection-20261031`.

## Root cause and correction

`loadSchoolDatabase` previously fetched marks with one unpaginated school-filtered SELECT. The authenticated local Data API returned 1,000 rows while its exact authorized count was 1,080. There was no second page. The school snapshot cache could retain this truncated result.

The marks adapter now reads stable ascending immutable IDs using keyset pagination, at most 500 rows per request. It retains the authenticated client, school filter and server RLS context. It checks account/school scope between pages, rejects duplicates, out-of-order IDs, wrong-school rows, failed/incomplete pages and missing counts, and confirms the final authorized count. An unsuccessful load throws before committing any partial school snapshot. Pagination also accommodates a server cap below 500. The page budget derives from the initial authorized count; it does not keep requesting pages indefinitely. This is not a database snapshot transaction for concurrent score edits.

Cache format version 2 rejects legacy snapshots that could contain truncated marks. Existing users need one successful online refresh before using the new cache offline. The separate offline queue and its operations are unchanged.

## Verified results

| Class | Students | Midterm marks | End Term marks | Total marks | Complete term rows |
|---|---:|---:|---:|---:|---:|
| Year 7 A | 10 | 80 | 80 | 160 | 10 |
| Year 8 A | 10 | 80 | 80 | 160 | 10 |
| Year 9 A | 10 | 80 | 80 | 160 | 10 |
| Year 10 A | 10 | 80 | 80 | 160 | 10 |
| Year 11 A | 10 | 80 | 80 | 160 | 10 |
| Year 12 A | 10 | 70 | 70 | 140 | 10 |
| Year 13 A | 10 | 70 | 70 | 140 | 10 |
| **Total** | **70** | **540** | **540** | **1,080** | **70** |

- Actual app snapshot: **1,000 before → 1,080 after**, in pages of **500 / 500 / 80**. All 1,080 IDs are unique, and every student/exam/score association matches independently paginated source records.
- Year 13: **60 before → 140 after** (the previous inspection recorded the 60-row truncation). Both periods now have 70 marks. Each period and the combined term have 10 complete students.
- All seven combined-term broadsheet calculation results match calculations using the full source dataset, including totals, means, grades, completion and ranks. Each separate assessment-period calculation also has 10 complete students per class. The existing UI continues to show its existing combined-term broadsheet; no new period filter was introduced.
- Representative Year 13 report: all **14 assessments** displayed; total **1,298 / 1,400**, average **92.7%**, grade **A***. Displayed scores, total, average and grade verified against source values without changing formulas or templates.
- Real existing offline reconciliation: a browser-local `Uncertain` entry for an already accepted request was reconciled through its authenticated receipt. Outcome `Accepted`; entry removed; refreshed app still contains 1,080 marks. No new score submission was made.
- Marks, mark revisions and write receipts have identical database fingerprints before and after verification. Cache version 2 contains all 1,080 marks.
- Anonymous mark access denied; the authenticated selected-school filter returned no rows for a different school ID. The pagination tests cover an RLS-filtered teacher subset, and existing mocked browser checks cover teacher routes and role restoration. A real teacher sign-in was not repeated because this isolated environment has no provisioned teacher Auth login. No authorization implementation or policies were changed.

## Files changed

- `src/data/load-marks.ts` — bounded complete authorized retrieval.
- `src/data/backend.ts` — integrate retrieval and verify session/school scope.
- `src/data/school-cache.ts` — reject legacy incomplete snapshots.
- `src/data/load-marks.test.ts` — pagination and partial-load regression coverage above 1,000 rows.
- `src/data/backend.test.ts` — compatible query mock and legacy-cache regression.
- `package.json` — include the regression suite in `test:focused`.
- `scripts/verify-auth.mjs`, `scripts/verify-dashboard.mjs` — teach existing fictional API mocks count/HEAD responses needed by complete retrieval.
- `.local-migration/report-inspection/verify-marks-fixed.mjs` — protected isolated verification helper; no credentials embedded.
- This report and generated local verification artifacts.

## Checks

- TypeScript `tsc --noEmit`: **PASS**.
- Focused suite: **141 tests across 9 files PASS**, including marks loading, backend, enrollment certainty, student lifecycle, analytics/report formula parity and offline outcomes.
- Existing dashboard browser suite: **PASS** for admin/teacher permitted routes and responsive layouts; fictional API responses only.
- Existing authentication browser suite: **PASS**, including teacher role restoration and protected account setup; fictional API responses only.
- Production Vite/PWA build: **PASS**. Existing non-blocking warnings remain for bundle size and a future native Vite configuration-loader compatibility change.

## Corrected previews

- [Year 13 report screenshot](.local-migration/marks-loading-fixed-previews/year13-report-card.png)
- [Year 13 report PDF](.local-migration/marks-loading-fixed-previews/year13-report-card.pdf)
- [Year 13 broadsheet screenshot](.local-migration/marks-loading-fixed-previews/year13-broadsheet.png)
- [Year 13 broadsheet PDF](.local-migration/marks-loading-fixed-previews/year13-broadsheet.pdf)
- [Machine-readable verification](.local-migration/marks-loading-fixed-previews/verification.json)

Earlier `.local-migration/report-previews` exports document the original inspection and have not been regenerated. Use the corrected previews above for this fix.

No remaining blocker to the local marks-loading fix. Hosted Supabase was not accessed. No schema, migration, RLS, authentication, accepted mark, grading, report-template or production-data changes were made. No deployment or Git operations were performed.
