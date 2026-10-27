# IUPC Academy — build brief v2 (decisions locked, still no code)

**Product:** IUPC Academy school management system, white-labelled for the school.
**Stack:** React 19 · TypeScript · Vite · Tailwind CSS v4 · React Router · the `api` seam from
`DOCUMENTATION.md` §10.
**Interface:** the timetable's interface grammar, applied to every module.
**Source of truth:** `DOCUMENTATION.md` (no original Meridian code exists — confirmed).

---

## 1. Decisions locked

| # | Decision | Consequence |
|---|---|---|
| 1 | **White-label IUPC Academy.** One campus, no product split. | Remove `/signup`, the "Register a school" link, the plan step and the school-code field. Sign-in = role + username + password. One seeded `schools` row. |
| 2 | **No original source.** Build from the documentation. | The doc is the specification, not a description of code we can copy. Every convention below is declared here once, then enforced. |
| 3 | **The timetable interface becomes the system interface.** | The whole app adopts the timetable's page grammar (§2), not a generic dashboard look. |

Still retained from the doc even under white-label: **`school_id` on every row.** IUPC is the only
tenant today; the column costs nothing and makes a second campus a data change rather than a
migration. Same reasoning applies to `role` on the session.

---

## 2. The interface grammar (the timetable's language, system-wide)

The timetable in §5.4 is the most developed screen, so its structure becomes the template. Every
module is assembled from the same six parts, in this order:

1. **Header with a live status summary** — `PageHeader` (title, subtitle, action cluster, bottom
   rule) plus one sentence of state computed from data: "No clashes" / "3 clashes", "4 of 6 exams
   open", "24 of 30 entered". Never a decorative header.
2. **One compact toolbar row** — term, week, class/stream, search and filters in a single row
   above the content, sticky on scroll. This is the timetable's term/week/class row generalised.
3. **A dense, goal-oriented surface** — a grid with sticky row/column headers (timetable board),
   or a table with a sunken header, 11 px uppercase labels, hairline dividers and **tabular
   numerals**. No card-grid dashboards for data that has rows.
4. **Cells with a strict hierarchy** — the timetable's `subject → code → teacher → room` ordering is
   the model: primary value, secondary code, then context, then metadata. Applied to mark rows,
   exam rows, student rows.
5. **Two severities of inline validation** — blocking error vs savable warning, shown live in the
   editor before commit (timetable: stream already booked = block; teacher double-booked = warn).
   Every editor from now on behaves this way.
6. **A print twin for every artefact** — dedicated print component, `.no-print` chrome, a named
   `@page` rule, `print-color-adjust: exact`, masthead (crest, school name, address, phone,
   document title, scope, term) and a footer (generated date, school · term · scope, page size).

### Module-by-module application

| Module | Surface | Print twin |
|---|---|---|
| Overview | Stat strip + "exams in term" table with progress badges | none |
| Students | Filter row + dense table, slide-over detail | Class list (portrait, numbered, signatures) |
| Classes & Teachers | Stream grid (counts) + staff table with subject chips | Class list |
| **Timetable** | Board: days × periods, sticky headers, clash styling | A4 landscape, days as rows, BREAK/LUNCH lanes |
| Subjects | Grouped list by category with rule + count | none |
| Terms | Table with active badge | none |
| Exams | Table: progress bar, window badge, actions | none |
| Mark Entry | Roster grid, keyboard movement, autosave flash | Mark sheet (portrait, X/Y legend) |
| Broadsheets | A4 landscape sheet in-page | A4 landscape, `@page broadsheet` |
| Report Cards | Edit panel beside live A4 portrait preview | A4 portrait, one per student |
| Settings | Form sections — **exception, see below** | none |

**Where the grammar must not apply:** the sign-in screen, the signup-style long forms and
Settings stay editorial and quiet. A records-office grid applied to a password field is worse, not
more consistent. Same for empty states — reuse `EmptyState`, never invent a new blank slate.

### Identity (unchanged unless IUPC supplies assets)

Crimson `#C8102E` / deep `#A30014`, brass `#C5A059` / `#876B27`, ink `#111827`, paper `#F9FAFB`,
raised `#FFFFFF`, sunken `#F3F4F6`, rule `#E5E7EB`, ok/warn/danger `#15803D` / `#D97706` /
`#DC2626`. Inter + JetBrains Mono, tabular numerals everywhere a score or rank appears, 2 px
crimson focus ring. Swap the crest to IUPC's; retheme the tokens in one place if they supply
brand colours later.

---

## 3. Rename inventory (12 hits, two of them need migration)

| Location | Current | Becomes |
|---|---|---|
| `DOCUMENTATION.md` title, §1 (×2) | "Meridian — School Management System" | "IUPC Academy — School Management System" |
| Session key §2 | `meridian.session.v1` | `iupc.session.v1`, **reading the old key once** |
| Database key §10 | `meridian.db.v1` | `iupc.db.v1`, **same read-through migration** |
| Demo password §3/§12/§13 | `meridian` | `iupc` |
| §11 kit folder | `ui/stitch_meridian_school_management_ui/` | not needed |
| §11 crest | `public/iupc-logo.png` | already named IUPC, but the asset is **not on disk** (only listed in the doc's tree) — need the real file |
| §13 seeds | Riverside `RVA-01`, Memon `M-A 001` | IUPC Academy only (+ optional demo campus) |
| Mastheads §5.4/§5.9/§5.10 | from school record | IUPC Academy name, address, phone |

Under white-label the seeded `schools` row also carries the address, phone and email that the
print mastheads need — collect those before the first print test.

---

## 4. Timetable scope for v1

In, exactly as §5.4: 8 periods with break/lunch lanes, Mon–Fri, 12 teaching weeks with real dates
from the first Monday on/after 1 September, class and teacher views, slot CRUD ("every week" /
"only week N"), teacher-clash detection with header count and CLASH badges, one-page A4 landscape
print with masthead and footer.

Open (decide at build time, cheap to change): **room clashes** — recommend a savable *warning*,
since `room` already exists on the slot; **double periods** — the only item that alters the schema
(`(day, period)` → span), so decide before the first migration; **exam timetable** and **staff
substitution** — out of v1; **term copy** — out of v1 (rebuild per term).

---

## 5. What happens on approval (first increment only)

1. Scaffold: Vite + React + TS + Tailwind v4 (pinned; Node 20.19+/22.12+, Tailwind ≥ 4.2.2 for
   the Vite 8 plugin), ESLint + Prettier + Vitest + Playwright, lockfile committed.
2. Tokens and the six-part grammar as primitives in `components/ui.tsx` (PageHeader, Badge,
   GradePill, EmptyState, StatCard, Toolbar, PrintSheet).
3. Shell: sidebar with the four nav groups, sign-in without the school code, session on
   `iupc.session.v1` with legacy read-through.
4. A local `api` seam + seeded IUPC Academy school, one term, two classes, subjects.
5. **Stop for review** — no timetable yet. The grammar and shell get approved on one screen
   before the module is built on top of it.

---

## 6. Still missing (small, non-blocking)

- IUPC's official crest file, plus the address, phone and email for print mastheads.
- Confirmation of the demo username (assumed `admin` / `iupc`).
- Whether double periods are needed in v1 (schema-relevant) and whether room clashes block or warn.
