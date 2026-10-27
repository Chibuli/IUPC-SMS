# IUPC Academy — School Management System

A working front-end build of the system specified in [DOCUMENTATION.md](DOCUMENTATION.md), white-labelled for **IUPC Academy**. React 19 + TypeScript + Vite 8 + Tailwind CSS v4, with a local persistence layer standing in for the backend.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

Node `^20.19` or `>=22.12` is required by Vite 8.

### Demo sign-in

| Role | Username | Password |
| --- | --- | --- |
| Administrator | `admin` (or `registrar@iupc.academy`) | `iupc` |
| Teacher (Grace Wanjiru — Maths, Physics) | `g.wanjiru@iupc.academy` | `iupc` |
| Guest | "Preview as guest" button | — |

## What is built

All twelve modules from §5 of the specification:

1. **Overview** — live status header, term scoping, exam progress, recent marks, score-code legend.
2. **Students** — searchable roster, admission form (numbered admission number, class, guardian, duplicate guard, save-and-add-another) and a per-student record with marks, position and conduct.
3. **Classes & Teachers** — streams with a live roster count, add-class dialog, per-stream admission shortcut, and a read-only staff snapshot that links to the register.
4. **Teachers** — the staff register: register a teacher from the top-menu button on any page, set the subjects they teach, review the permissions they hold, and remove a record (refused while the teacher still holds timetable lessons). Every account starts read-only; it sees only the records of the subjects assigned to it.
5. **Timetable** — a whole-school switchboard (every stream on a row, all five days across the header) that fits the week on one screen without sideways scrolling: cells are colour-coded by subject with a legend, and lessons are dragged to a new cell, swapped with the lesson already there, or picked up (grip / Move…) for touch and keyboard, with undo on every move. Plus a Detailed card view, class and teacher views, a **fully editable bell schedule** (period count, start/end times, and any number of named breaks, with times rippling down the day as you edit), 12-week rotation, week-only slots, clash detection, slot editor, an A3 master print, and A4 class/teacher sheets drawn like the school's stock forms — one 2 px frame, hairline rules, weekdays down the gutter, period numbers over their clock times, and BREAK/LUNCH as full-height vertical columns.
6. **Subjects** — syllabus codes, categories, teacher mapping.
7. **Academic Terms** — 12-week terms, dates, active-term switching.
8. **Marks Entry** — one page for the whole job: a paper bar (exam type, searchable subject list, sort, term, class, the total the paper is marked out of) over the register. No paper has to be created first — the first result keyed in records it. Keyboard-first entry (`X` missing, `Y` irregularity), block-on-invalid validation, autosave, sort by admission number / name / gender, print preview and a close-page action, plus read-only enforcement: a paper is writable only while the registrar has granted mark entry, the subject is assigned to that teacher, and the mark-entry window is still open.
9. **Academic Analytics** — term/class/subject-filtered KPI strip (campus average with term-on-term change, completion rate, top subject, at-risk count), grade-distribution and subject bars, an all-streams comparison table, generated insights, a CSV workbook and a one-page A4 PDF report.
10. **Broadsheets** — the two-page results document: page 1 is the ranked cohort matrix (`score-grade` per paper, MC/score/avg/SD/comp), page 2 the per-subject analysis (grade, average, entry, highest, lowest, mean points, grade distribution). A4 landscape, CSV export, ties share a rank.
11. **Report Cards** — the A4 portrait academic report: subject table (CAT %, grade, points, position, subject-teacher initials), term performance with improvement against the previous term, class-teacher / principal / HSE remark blocks, next-term dates and a grading key, all on one sheet. Every remark field — including the table's remark column — prints blank with ruled lines, because remarks are written by hand on the printed card.
12. **Settings** — school identity, grading scale editor, **teacher permissions** (every teacher with their grants, add or reduce them, one-click “make every teacher read-only”, and the term's school-wide marks close time), data reset.

## Interface language

A sticky charcoal **top bar** carries the campus mark, the twelve destinations and the account, so every page owns the full window width — the timetable needs all of it. For administrators it also carries a **Register teacher** button that opens the staff register's form from any page. Below 768 px it collapses to a compact header plus a drawer.

The timetable's records-office grammar is the system-wide interface: a header carrying a live status summary, one compact sticky toolbar, dense sticky grids with sunken headers and tabular figures, a strict `subject → code → teacher → room` hierarchy in cells, two severities of inline validation (blocking vs. savable warning), and a print twin for every artefact. Sign-in, long forms and Settings deliberately stay editorial instead — see [IUPC_NEXT_STEP.md](IUPC_NEXT_STEP.md).

## Structure

```
src/
  data/        types.ts · seed.ts (IUPC dataset) · db.ts (localStorage + api seam) · auth.ts
  lib/         grading.ts · timetable.ts · analytics.ts · analysis.ts · permissions.ts · format.ts · print.ts
  components/  ui.tsx (primitives) · permissions.tsx (grants) · design tokens in index.css
  pages/       one file per module
  session.tsx  role, teacher identity, can() · subjectScope · canEditExam() / canEditPaper()
scripts/       headless-Chrome verification (see below)
```

Persistence is `localStorage` under `iupc.db.v1` / `iupc.session.v1`, with one-time reads of the old `meridian.*` keys. Every write goes through the `api` object in `src/data/db.ts`, so swapping in a real backend is a single-module change.

The demo dataset is a Cambridge school from Year 7 to Year 13: seven classes, twelve learners each (84 on roll), eight syllabuses for Years 7–11, five for Year 12 and four for Year 13, with a paper for every subject in every class, a closed term behind the active one, and a full teaching week on the board.

The seeded school record carries a `SEED_VERSION` (currently `3`, the Years 7–13 campus). Raising it rebuilds the demo tables in browsers that already hold an older database — the old Form 1–3 roll cannot be merged into a new campus without orphans — and keeps any catalogue subject the registrar added by hand, which stands alone.

## Verification

With the dev server running on port 5176 (`npm run dev -- --port 5176 --strictPort`, or edit the `BASE` constant in each script):

```bash
npm run typecheck   # tsc --noEmit
npm run build       # typecheck + production bundle
npm run verify:print   # screenshots + real PDFs (A3 master, A4 class, analytics), asserts 1 / 1 / 2 / 1 / 1 pages
npm run verify:e2e     # master drag/swap/undo, slot create/clash guard, mark autosave across reload, register + permission grants, RBAC
npm run verify:layout  # 13 routes x 3 viewports: no horizontal overflow, no console errors
npm run verify:smoke   # four key routes mount their page and log no console errors
npm run verify:migration  # a stored database picks up the current school details without losing marks
```

Last run: typecheck and build clean; master timetable 1 page (420×297 mm), class timetable 1 page (297×210 mm), broadsheet 2 pages (297×210 mm each), report card 1 page (210×297 mm), analytics 1 page (210×297 mm); **87/87** end-to-end checks pass; **39/39** route/viewport combinations clean, with no console or network errors in the print run.

## Known limits

- No backend, no real authentication. Accounts are demo credentials hashed in the client; `localStorage` is the database. Do not deploy this as-is with real student data. The same applies to the permission model: `canEditExam()` is enforced in the browser, so the checks must move server-side with the `api` seam before marks are trustworthy.
- The logo is IUPC's supplied artwork, trimmed into `public/iupc-wordmark.png` (mastheads, sign-in) and `public/iupc-crest.png` (top-bar emblem) by `scripts/trim-logo.mjs`. Mastheads carry IUPC's published details: campus at Off Mount Kenya Road, Nyali, Mombasa; official mail through P.O. Box 1468-00606, Nairobi; +254 788 175 518 / +254 768 334 453; info@iupceducation.com. Staff sign-in addresses still use the demo `@iupc.academy` domain.
- The Memon originals that set these formats are kept as reference material (not shipped assets): `reference/report/memon-report-card.docx` for the report card and `reference/broadsheets/` for the four photographed results sheets.
- Double periods are not modelled: a slot's key is `(day, period)`. Adding them changes that key to a span.
- Room clashes warn rather than block; only stream double-booking blocks a save.
