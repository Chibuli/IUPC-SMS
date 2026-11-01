# Marks Entry workspace refinement

Baseline checkpoint: `be9f3fbf545f57565f1ae90634ea63b0761b03c5`. The local checkpoint preserves this parent without rewriting its history.

## Files changed

- `src/pages/MarksEntry.tsx`
- `src/pages/MarksEntry.css`
- `src/components/SubjectCombobox.tsx`
- `src/pages/MarksEntry.workspace.test.tsx`
- `scripts/verify-marks-entry.mjs`
- `MARKS_ENTRY_WORKSPACE_REDESIGN.md`

## Workspace and subject selection

The page now has a compact title/action row, five-control desktop configuration grid, and a subject combobox whose results float over the page instead of consuming register space. It searches configured subject names, Cambridge codes, categories and levels. Arrow keys move the active option, Enter selects, Escape/outside click/Tab close the popup, and a checkmark identifies the actual selection independently of the highlighted option. Accessible labels, listbox semantics and active-descendant IDs are supplied. Initial subject selection and linked-paper selection are retained.

The register is the main card, with selected class/subject/exam/term/year and maximum marks above it. Sorting moved beside the register title. Desktop context positioning measures the existing navigation using ResizeObserver. The table scrolls independently; its sticky headings measure clearance under the context when the outer page scrolls. No application navigation or shared page styles were edited. All new CSS uses marks-specific selectors.

The original operational-student and verified subject-enrollment checks are reused. Previously all class members were rendered, with ineligible inputs disabled; the screen now renders the existing eligible roster only. Verified unrelated subjects/classes never appear as editable rows. Unknown, failed, malformed or differently scoped term enrollment produces an explicit unresolved notice, separate from a verified empty subject register. Reload register reloads the existing application; it does not introduce an enrollment query or authorization path. The printed marks sheet retains its existing contents.

## Keyboard, validation and saving

The existing parser, percentage/grade functions, paper creation, setScore API, offline queue and outcome handling remain the save path. Enter still saves before moving forward, arrows navigate the visible sorted roster, and blur retains its existing save behavior. Focus is visibly marked at input and row level. Navigation scrolls the next input into view. Identical in-flight row/value saves are coalesced and repeated Enter is guarded so Enter plus blur does not duplicate the submission. Different draft values have distinct save keys. Save exceptions produce row-linked feedback.

An assessment-change confirmation now protects input that has not yet reached a recorded or queued result. The comparison uses the existing score parser, so equivalent numeric representations are not falsely marked dirty. Queued results remain recoverable through the unchanged account-isolated queue. Errors are associated with their input through aria-invalid/aria-describedby and remain visible in the row. Rejected/blocked queue reasons are retained.

Editing permission, recorded entry progress, and save/synchronization feedback have separate areas. Unsaved input, local pending synchronization, synchronization in progress, retry-needed, acceptance unconfirmed, accepted, rejected and review-needed states use existing data. The UI never treats a local queued result as accepted. Progress retains the existing definition: non-null recorded outcomes, including X/Y, among eligible students; a pending-only or rejected-only draft adds no recorded mark. X remains missing marks and Y remains irregularity, shown explicitly beside the result status. Configured scale information and keyboard/result help remain discoverable in a compact disclosure.

## Responsive and visual verification

No page-level horizontal overflow at any tested size. At narrow widths controls wrap and all original columns remain available through the labelled, keyboard-focusable table scroll region. Student identity and admission numbers are retained. On a 390px device the configuration takes vertical space; scrolling down and across the register is expected. Desktop and laptop controls stay in a single row.

| Viewport | Table top (px) | Complete rows initially visible |
| --- | ---: | ---: |
| 1920 x 1080 | 476.0 | 10 |
| 1366 x 768 | 476.0 | 4 |
| 1280 x 720 | 476.0 | 3 |
| 768 x 900 | 572.6 | 5 |
| 390 x 844 | 785.2 | 0 |

Generated 17 fictional local screenshot previews and visually inspected the rendered output, including laptop/tablet/mobile layouts, subject popup and code search, empty/unresolved subject, keyboard focus, pending/rejected results, locked access, and sticky alignment. The local gallery is `.local-migration/marks-entry-review/index.html`; measurements and browser results are in `results.json` beside it. Generated screenshots are ignored artifacts.

The browser verifier intercepts all auth/database/function requests with fictional responses before navigation. It aborts other external traffic. Real session, permission and queue code is exercised against intercepted responses; no hosted service or actual school record is used. Its six writes in the final run were mocked fixture requests only.

## Checks executed

- `npm.cmd run typecheck`: passed.
- `npx.cmd vitest run src/pages/MarksEntry.workspace.test.tsx src/data/load-marks.test.ts src/lib/offline-outcomes.test.ts src/lib/enrollment-certainty.test.ts src/lib/analytics.test.ts`: 123 tests passed across five files, including 22 workspace cases.
- `node scripts/verify-marks-entry.mjs`: all 13 browser scenario groups passed; 17 screenshots and the fictional print PDF generated.
- `npm.cmd run build`: passed, including PWA output. Existing Vite native-config-loader, bundle-size and plugin-timing warnings remain.
- `git diff --check`: passed.
- No exhaustive unscoped suite or SQL tests were run. The known incorrectly named SQL `supabase/tests/authz.test.ts` is outside the selected test scope.

To reproduce the browser review, start a local Vite server on port 5174, then run `node scripts/verify-marks-entry.mjs`. Set `IUPC_MARKS_TEST_ORIGIN` for a different loopback port and `CHROME_PATH` if Chrome is installed elsewhere. No new dependencies are required.

## Existing limitations and unchanged scope

The application loads school data in the existing session initializer before mounting Marks Entry. Whole-school loading and initial-load failures remain owned by that workflow; this page adds no pretend loading spinner or parallel fetching layer. Enrollment-verification failure is separately displayed and tested. The existing backend verifies subject enrollment only for its explicitly active term; selecting another historical term therefore remains unresolved unless authoritative scope is already available. Current class membership is never substituted for subject/term verification.

The existing default first-subject selection remains. The no-subject screenshot deliberately models an unresolved linked selection rather than changing the initial-selection policy. This was local Chromium validation, not a live-server acceptance test or a physical-device/screen-reader certification.

Academic calculations, maximum-mark normalization, grading bands/points, accepted results, enrollment eligibility, permissions, authentication, offline synchronization, pending/rejected recovery, broadsheets, report cards/graphs/remarks/rankings, class lists, student data and admission numbers were not modified. No database/schema/migration/configuration change, dependency installation, hosted Supabase access, push or deployment occurred. Pre-existing untracked operational notes and environment templates were left untouched.

## Print-separator regression correction and local commit review

The printed heading separator following the class name was unintentionally changed from U+00B7 (middle dot) to an ASCII U+003F (question mark) during the earlier source-text transformation. This was a literal source substitution, not a PDF font/encoding limitation. Only that character was restored in the production print markup. The entire print-only section was compared with the baseline checkpoint and now matches exactly, including nearby text, table and signatures.

A focused component assertion checks the rendered heading separator and seven-column structure. The browser verifier now also checks the actual print-media heading and emits `.local-migration/marks-entry-review/marks-entry-print-separator.pdf`. The PDF was rasterized with the existing local PyMuPDF tooling and visually inspected; extracted PDF text confirms `Year 7 A · Term 1`, no replacement glyphs, and the retained column/signature structure. This fictional fixture fits one A4 portrait page. The rendered image is `marks-entry-print-separator-page-1.png` beside the PDF. Both are local ignored review artifacts and are excluded from the commit.

The six implementation paths listed above are the complete local commit scope. Pre-existing environment templates, operational notes, the design ZIP and the incorrectly named SQL test remain untracked and untouched. No actual student data or credentials are included; browser session values and records in the verifier are explicitly fictional. TypeScript, the 123-test focused suite and the production build were each executed successfully for this correction; staged whitespace and sensitive-content checks are required before committing.
