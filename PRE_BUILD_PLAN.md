# Meridian — pre-build plan

**Purpose:** decisions and prerequisites to settle *before* writing code for the school
management system described in `DOCUMENTATION.md`.
**Date:** 2026-10-21

---

## 0. Reality check first (read this before anything else)

`DOCUMENTATION.md` describes a working app. That app is **not in this folder**:

| Doc claims | Present on disk |
|---|---|
| `src/` (pages, data, lib, components) | **missing** |
| `package.json`, `vite.config.ts`, `index.html` | **missing** |
| `schools/ classes/ … timetableSlots/` JSONL snapshot | **missing** |
| `screenshots/`, `ui/stitch_meridian_school_management_ui/` | **missing** |

And `SETUP_PACKAGE_(KEY=2113).zip` is not it either: the archive contains **zero** `.ts`,
`.tsx`, `.js`, `.json`, `.html` or `.css` files (verified against its full 571-entry listing).
It is the dropper analysed in `TIMETABLE_INSPECTION.md`.

So there is no "architecture of the timetable application" to build on here. You have two
paths, and picking one is the first task:

- **A — Recover the original project.** If Meridian was built somewhere else (a git remote,
  another machine, a cloud IDE), restore it and verify it builds. Cheapest by far: you get
  81 seeded timetable slots, the print stylesheets and the design tokens for free.
- **B — Rebuild from `DOCUMENTATION.md` as a specification.** The document is genuinely good
  spec material (§5.4 timetable, §8 grading, §9 data model). But it describes ~11 modules, and
  a rebuild is weeks, not days — plan it as a greenfield project, not a repair.

Do not start either path until §1 is answered.

---

## 1. Three architecture decisions to lock before line one

### 1.1 Backend and auth (the doc's #1 limitation)

The doc's own migration plan is: *replace `src/data/db.ts` with Convex calls; nothing else
changes*. That is the lowest-friction choice because the `api` seam is already Convex-shaped
(`api.marks.setScore`, `api.timetable.save`, async, returns rows).

| Option | Fit | Trade-off |
|---|---|---|
| **Convex** ([docs](https://docs.convex.dev)) — reactive DB, serverless functions, file storage, auth | Matches the existing seam 1:1; realtime timetable and mark updates come free; logos go to its file storage; RBAC lives in server functions | Vendor-shaped data layer; queries live in TypeScript functions, not SQL |
| **Better Auth** ([docs](https://www.better-auth.com/docs)) **+ Neon Postgres** ([docs](https://neon.tech/docs)) | Framework-agnostic TS auth, real SQL you can query/back up with standard tools, portable forever | You must add an API server; the `api` seam becomes an HTTP client; realtime needs extra work |
| **Clerk** ([docs](https://clerk.com/docs)) + Postgres | Fastest path to good sign-in UI, orgs and invitations | B2B org modelling for "schools" is a slight impedance mismatch; long-term cost per user |

**Recommendation:** Convex if the goal is to ship this term with the fewest moving parts;
Better Auth + Neon if this is going to be sold to many schools and you want standard SQL
portability. Decide now — it determines whether `db.ts` is replaced or rewritten.

### 1.2 Identity model: a school code is not an identity

Today a "session" is `{role, schoolId, teacherId}` in `localStorage`, and credentials live on
the `schools` row (`admin_username`, `admin_password_hash`) plus a copy on `teachers`.

Before building, replace that with:

- **users** (email, password hash) — one person, many schools.
- **memberships** (`user_id`, `school_id`, `role`, optional `teacher_id`) — this is what the
  school code now resolves *after* authentication, not instead of it.
- **invites** (`school_id`, email or single-use token, role, expiry, accepted_at) so the
  `/invite/{code}` URL in §5.3 becomes a real claim flow.
- **passwords** hashed with Argon2id or bcrypt **server-side**. The doc is candid that
  salted SHA-256 in the browser is not a KDF; budget for fixing it now, not later.
- **guest** = a scoped, expiring read-only share link, not an unauthenticated role selector.

### 1.3 Print/PDF strategy

Print-first is the product's identity (A4 landscape timetable, landscape broadsheet, portrait
report card). Choose the production path **before** writing templates, because print CSS is
the most expensive thing to change:

- **Browser print dialog** — exactly what the doc does today. Fine for a single teacher
  printing one timetable.
- **Server-side PDF** (Playwright/Chromium rendering the same print routes) — needed for
  bulk report cards at end of term, emailing cards to guardians, and archiving immutable
  signed copies.
- **JS PDF library** (e.g. `react-pdf`) — only if you need pixel-exact control; you lose the
  HTML/CSS tooling the current design depends on.

Recommendation: keep the HTML print sheets, add headless-Chromium rendering as the export
service. One template, two consumers.

---

## 2. Data model changes to make before any migration

`DOCUMENTATION.md` §9 lists 12 tables. These gaps will hurt within the first term:

1. **No membership table** (see §1.2) — a school can have exactly one administrator today.
2. **Credentials on domain rows** (`schools.admin_password_hash`, `teachers.password_hash`) —
   move to `users`; never join a password hash into a page query.
3. **`marks` has no uniqueness or audit.** Add `unique(exam_id, student_id)`, plus
   `entered_by` and a `mark_revisions` table (old value, new value, actor, timestamp). When a
   parent disputes a grade, this is the only honest answer.
4. **Positions are computed on read.** Fine for 7 students. At 300 students × 12 subjects ×
   3 exams the broadsheet is ~10k rows per term, and a report card must reproduce the position
   *as published*, not as recalculated later. Decide now: snapshot ranks at publish time
   (`exam_publish` / `term_result` rows) or accept drifting historical documents.
5. **`timetableSlots.week = null` means "every week".** There is no "weeks 1–6", no rotating
   fortnight, no term-to-term copy. Add an explicit week pattern field.
6. **No lifecycle on exams.** `editing_deadline` is the only gate; add `draft → open →
   locked → published`, enforced server-side.
7. **No soft delete / `updated_at`** on most tables, no cascade rules documented for
   `exams → marks` deletion (the UI deletes marks silently behind a confirm).
8. **Timetable has no room clash detection** (only teacher clashes), no double-periods, no
   exam timetable, no staff absence/substitution. Those are the next four feature requests.
9. **PII:** `students.date_of_birth`, guardian name and phone are personal data about minors.
   Decide retention, who may read them, and whether they need field-level restriction.

---

## 3. Security acceptance criteria (write these as tests, not prose)

Multi-tenancy bugs in a school system are the whole risk. Before building UI beyond a slice:

- [ ] Every read is scoped by `school_id` taken from the **session**, never from a request
      parameter.
- [ ] Cross-tenant test: signed in to school A, request school B's student/exam/mark ids →
      `403`/`404`, never data.
- [ ] Teacher write test: teacher can save marks only where `exam.subject_id` ∈ their
      assignments, and only while the exam is open.
- [ ] Deadline enforcement is **server-side**; the client clock is untrusted (the current
      demo compares against `Date.now()` in the browser).
- [ ] Sign-in is rate-limited and lockout-aware; invites are single-use with expiry; password
      reset exists (it does not today).
- [ ] Mark writes are audited (see §2.3).
- [ ] A guest link cannot reach Settings, marks, or any write endpoint.

---

## 4. Toolchain, pinned

The doc claims React 19 · TypeScript 7 · Vite 8 · Tailwind v4 · Router 7. Verify, don't assume:

- **Vite 8** is stable (Mar 2026), 8.1 released Jun 2026; it requires **Node 20.19+ or
  22.12+** and defaults to the Rolldown bundler — check every plugin against it
  ([announcement](https://vite.dev/blog/announcing-vite8)).
- **Tailwind v4 + Vite 8:** the `@tailwindcss/vite` plugin only supports Vite 8 from
  v4.2.2 (Mar 2026) — pin at least that
  ([discussion](https://github.com/tailwindlabs/tailwindcss/discussions/19624)).
- **TypeScript 7** exists, but the native compiler can break type-level plugins; if it fights
  you, pin TS 5.x for the build and move later. This is a build-time choice, not an
  architecture one.
- Pin exact versions and **commit the lockfile**; add `.nvmrc` / `engines` so all machines and
  CI agree.
- Add what the project admits it lacks: ESLint + Prettier, **Vitest** (grading, analytics,
  CSV, clash detection — all pure functions, test them before any UI), **Playwright** (print
  snapshots to PDF, one per artefact).
- CI from day one: `typecheck → lint → unit → build → print snapshots`.

---

## 5. Build order (thin vertical slice, not module-by-module)

1. **Scaffold + tokens + shell.** Port §6 design tokens (crimson `#C8102E`, brass `#C5A059`,
   ink, paper), Inter/JetBrains Mono, `PageHeader`/`Badge`/`GradePill` primitives.
2. **`api` seam with the real adapter behind a flag.** Keep the local adapter for demos; one
   page (Overview) reading live data proves the seam.
3. **Grading + analytics as pure modules, fully tested.** `gradeFor(score, scale)`,
   `parseScoreInput`, positions with ties, SD, CSV with BOM/quoting. This is the product's
   actual value and the cheapest thing to get right.
4. **CRUD before reports.** Students, classes/streams, teachers, subjects — the doc admits
   these are read-only today, which means **you cannot onboard a real school at all**. Add
   CSV import at the same time.
5. **Timetable** (hardest): slot CRUD, clash detection, week model, then the A4 landscape
   print sheet. Expect the print layout to take as long as the board.
6. **Exams → Mark Entry** with server-enforced locking and keyboard flow.
7. **Broadsheet → Report Cards** with publish snapshots, then bulk PDF.
8. **Settings/privacy**: logo upload, grading scale editor, export-everything, delete-school.

---

## 6. Before the first real school touches it

- [ ] Seed data is demo-only; onboarding path is CSV import + admin invite.
- [ ] Staging environment separate from production data.
- [ ] Backups with a **restore drill** (a backup you have never restored is a rumour).
- [ ] Error monitoring and audit-log review.
- [ ] Data-processing agreement for minors' data; retention and deletion policy; who can
      export what.
- [ ] A paper fallback plan for results week — schools will not accept "the system is down"
      during report cards.
- [ ] Acceptable-use note for staff: the deadline lock is real, marks are audited.

---

## 7. Decisions to answer before building

1. Recover the original Meridian project, or rebuild from the doc?
2. Backend: Convex (fast, seam-compatible) or Better Auth + Neon Postgres (portable SQL)?
3. Bulk PDF now, or browser print for the pilot?
4. Are published positions immutable snapshots? (Say yes if report cards are ever disputed.)
5. Single-school pilot or multi-campus from day one? (Changes tenancy tests and onboarding.)
6. Which timetable gaps are in scope for v1: room clashes, double periods, exam timetable,
   substitution?
7. Who owns the PII policy, and what is the retention period after a student leaves?

---

## Appendix — what the timetable spec actually gives you

§5.4 is the strongest part of the document and is buildable as written:

- 8 periods (08:00–08:40 … 14:00–14:40) with break and lunch lanes, Mon–Fri, 12 teaching
  weeks, week dates derived from the first Monday on/after 1 September.
- Class view and teacher view; the teacher picker is fixed to the signed-in teacher.
- Slot = class + day + period + subject + teacher + room, with "every week" or "only week N".
- Clash = same teacher booked into two streams at the same day/period → red inset, tinted
  background, `CLASH` badge, count in the header.
- Print: days as rows, periods as columns, full-height BREAK/LUNCH lanes, ruled grid,
  masthead with logo/term/week/date range/lesson count, `@page timetable { size: A4
  landscape; margin: 8mm }`, one page per schedule.

Missing and worth adding in v1: room clashes, double-period spans, an exam timetable distinct
from the lesson timetable, and staff absence/substitution.
