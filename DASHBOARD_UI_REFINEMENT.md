# Dashboard and navigation UI refinement

Implemented locally on 31 October 2026. This is a presentation update to the existing React app; no hosted changes or publication.

## Files changed

- `src/AppLayout.tsx`: shared desktop/mobile headers, official logo presentation, navigation styles and drawer accessibility.
- `src/pages/Dashboard.tsx`: Overview heading, cards, exam table, recent marks and term-summary presentation. Existing data expressions, filters, ordering, mean calculation and permission decisions are retained.
- `src/components/ui.tsx`: a shared class on the existing page-heading component.
- `src/index.css`: shared crimson tokens, workspace shell/navigation/page headings, and Overview-scoped detailed styles.
- `scripts/verify-dashboard.mjs`: fictional, network-isolated administrator/teacher dashboard and navigation checks.
- `package.json`: `verify:dashboard` command.
- This report. Local production/PWA `dist/` artifacts were rebuilt.

## Header and navigation

The primary crimson token now matches the existing login palette, `#A90F2D`, with `#880B23` for its deeper state. The login's Auth variable aliases the shared token without changing its appearance. Existing primary buttons, focus treatments and form accents inherit the consistent palette.

The shared header shows the existing school logo/name, Academic Workspace subtitle, unchanged sync control, current user/role, administrator-only Register teacher link and unchanged sign-out action. The existing native Academy wordmark is used as the fallback; no artwork is modified. No verified higher-resolution matching original was available, so branding remains compact.

At desktop widths (1024px and above), all permitted navigation links remain in one horizontally scrollable row. Active links have a white background/crimson text; icons are consistently shown. Keyboard focus can reveal offscreen links, and the active route is brought into view. No route names, paths or role filters were changed.

Mobile and portrait-tablet navigation uses the grouped drawer. It supports an expanded-state button, labeled dialog, close button, Escape dismissal, focus containment/restoration, body-scroll locking and closure when returning to desktop width. Register teacher remains administrator-only. Current account and sign-out remain accessible. A skip-to-main-content link improves keyboard access.

## Overview presentation

A white heading card presents the existing greeting/title, school name, actual active term/year, stream/lesson information and the existing timetable/marks links. Absent term data uses a truthful placeholder instead of displaying `undefined`.

Statistics retain their exact existing values, with larger figures, consistent icon containers and restrained crimson/navy/gold/green accents. Existing examinations, progress, editing/read-only labels, recent marks/grades, mean, marks count and grading scale appear in white cards with soft borders, rounded corners and restrained shadows. No sample data is embedded in the application. No upcoming-exam logic, new calculations or backend queries were introduced.

Desktop statistics use four columns; tablet uses two; phone uses one readable column. Main-page horizontal overflow is prevented without clipping functionality. The examination table retains a labeled, keyboard-focusable internal horizontal scroller so actions remain reachable on phones. Other modules retain their existing internal interfaces while sharing the improved shell, primary colors and page headings.

## Verification

- Application TypeScript: PASS.
- Production build and PWA generation: PASS. Existing non-blocking config-loader and bundle-size warnings remain.
- Focused existing frontend suite: **129 tests passed across eight files**.
- Existing mocked Auth UI suite: **nine scenario groups passed**, including teacher invitation/setup, failed-link protection, recovery, login, roles and responsive login presentation.
- New dashboard/navigation checks: administrator and teacher at **1440, 1280, 768 and 390px**. Verified fixture-derived counts/means, archive exclusion, term information, all permitted routes, Settings/Register teacher visibility, single-row desktop navigation, keyboard reachability, drawer Escape/focus/resize handling, route selection, quick-action targets and logout. Empty-school checks verify zero/empty states without invented academic data. Mobile exam actions remain reachable inside the table scroller.
- All browser service responses are fictional. External requests and unauthorized mutation requests are blocked. No real users, emails, records or configuration were touched.

Run locally with a dev server on port 5173: `npm run verify:dashboard`. For another local port, set `IUPC_AUTH_TEST_ORIGIN` to its `http://127.0.0.1:PORT` origin.

Previews: `.local-migration/dashboard-ui-previews/admin-1440.png`, `admin-1280.png`, `admin-768.png`, `admin-390.png`, `admin-drawer-390.png` and corresponding teacher previews. All visible people/records in these screenshots are fictional test fixtures.

## Limits and protected scope

The source logo remains low-resolution; no substitute or artificial sharpening was introduced. Long desktop navigation rows intentionally scroll; narrow exam tables intentionally scroll inside their card. There are no known horizontal page-overflow issues at the tested widths.

Supabase authentication, teacher activation, memberships, role permissions, RLS, migrations, Edge Functions, offline marks, synchronization, calculations, report generation and timetable logic were not edited. No dependencies were installed. No Git operations or deployment occurred. This visual verification does not establish production readiness or live hosted workflow validation.
