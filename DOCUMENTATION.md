# Meridian — School Management System

**Complete documentation** · Version 1 · October 2026

Meridian is a browser-based school management system for secondary schools. It covers the whole
academic loop: who is enrolled, who teaches what, when lessons happen, how exams are marked, how
results are analysed, and what gets printed and signed at the end of a term.

The app is a single-page React + TypeScript front-end seeded from a Convex database snapshot. All
data currently lives in the browser (in-memory store persisted to `localStorage`), behind an async
`api` seam that is shaped like Convex client calls — so the UI can later be pointed at a live
backend by rewriting one module.

---

## Table of contents

1. [What the software does](#1-what-the-software-does)
2. [Roles and access control](#2-roles-and-access-control)
3. [Sign-in and school registration](#3-sign-in-and-school-registration)
4. [The application shell and navigation](#4-the-application-shell-and-navigation)
5. [Module-by-module feature reference](#5-module-by-module-feature-reference)
   - [5.1 Overview dashboard](#51-overview-dashboard)
   - [5.2 Students](#52-students)
   - [5.3 Classes & Teachers](#53-classes--teachers)
   - [5.4 Teachers](#54-teachers)
   - [5.5 Timetable](#55-timetable)
   - [5.6 Subjects](#56-subjects)
   - [5.7 Academic Terms](#57-academic-terms)
   - [5.8 Marks Entry](#58-marks-entry)
   - [5.9 Academic Analytics](#59-academic-analytics)
   - [5.10 Broadsheets](#510-broadsheets)
   - [5.11 Report Cards](#511-report-cards)
   - [5.12 Settings](#512-settings)
6. [UI and design system](#6-ui-and-design-system)
7. [Printing and export](#7-printing-and-export)
8. [Grading engine](#8-grading-engine)
9. [Data model](#9-data-model)
10. [Data layer, persistence and the backend seam](#10-data-layer-persistence-and-the-backend-seam)
11. [Project structure](#11-project-structure)
12. [Running the app on your laptop](#12-running-the-app-on-your-laptop)
13. [Seed / demo data](#13-seed--demo-data)
14. [Screenshot gallery](#14-screenshot-gallery)
15. [Verification performed](#15-verification-performed)
16. [Known limitations and roadmap](#16-known-limitations-and-roadmap)
17. [Glossary](#17-glossary)

---

## 1. What the software does

Meridian is the operational record for one school campus ("campus" and "school" are used
interchangeably). A user signs in with a **school code** plus an account, and lands in a workspace
scoped to that campus only.

The core loop the software supports:

1. **Set up the campus** — profile, logo, subjects, classes/streams, teachers, academic terms.
2. **Build the weekly timetable** — assign subject + teacher + room to a day/period for each class,
   with automatic detection of teacher double-booking.
3. **Open a paper** — a paper belongs to one term, one subject, one class/stream and one paper type,
   with the total it is marked out of. It is recorded the first time a result is keyed in, so no
   exam has to be created before the marks exist.
4. **Enter marks** — a fast keyboard-driven register with auto-save, `X` / `Y` special codes, and
   role- and deadline-based locking.
5. **Analyse** — term-scoped analytics (KPIs, grade distribution, subject and stream comparison), an
   A4 landscape broadsheet with positions, totals, means, standard deviations, subject summaries and
   grade distribution, and an end-of-term **performance deck** that presents the same marks as a
   printable slide report.
6. **Publish** — an A4 portrait official report card per student, with grades, ranks, remarks blocks,
   attendance, grading key and signature lines.
7. **Print or export** — every analytical artefact is print-first, with CSV export for the
   broadsheet and browser "Save as PDF" for the rest.

The identity of the product is "**Academic Prestige · Operational Precision**": dense tabular data,
strict numeric alignment, institutional typography, crimson and gold accents on a neutral paper
canvas. It deliberately looks like a records office tool, not a consumer dashboard.

---

## 2. Roles and access control

Three roles exist. They mirror the roles intended for a live Convex Auth deployment.

| Role | How you get it | Capabilities |
| --- | --- | --- |
| **Administrator** | School code + administrator username/email + password | Everything: campus settings, subjects, terms, exams, deadlines, deletion, grading scales, the staff register, permission grants, all marks and reports |
| **Teacher** | School code + staff email/username + password | Read-only campus data for the subjects assigned to their staff profile; writes marks only when the registrar has granted mark entry *and* the mark-entry window is open |
| **Guest** | School code only, via "Preview this campus as a guest" | Read-only browsing of every page except Settings |

### The permission model

A teacher account is **read-only until the registrar grants something**, and three separate things
decide what that teacher can do:

| Dimension | Stored on | What it decides |
| --- | --- | --- |
| **Subject access** | `teacher.assigned_subject_ids` | *Which* records the account sees at all. Marks Entry, broadsheets, the overview and analytics all filter to this list. |
| **Permissions** | `teacher.permissions[]` | *What* the account may write. Empty by default — there is no implied right to write a subject just because the teacher holds it. |
| **Mark-entry window** | `exam.editing_deadline`, else `markWindows[0].closes_at` | *When* that writing is allowed. |

The catalogue in [`src/lib/permissions.ts`](src/lib/permissions.ts) is deliberately small: every entry
is enforced somewhere, so it is a contract rather than a wish list.

| Permission | Effect |
| --- | --- |
| `marks.enter` | Write marks for assigned subjects while the window is open. |
| `marks.after_deadline` | Keep editing once the window has closed. Needs `marks.enter` (revoking entry drops it); a locked or published paper still refuses everyone. |
| `records.view_all_subjects` | Widen the read scope to every subject and stream in the school, still read-only. |

The school-wide window is the registrar's term-level deadline, set in Settings; a deadline on one paper
overrides it. With no window set, papers without their own deadline stay open for teachers who may
enter marks.

Where the grants are made:

- **Teachers** (`/dashboard/teachers`) — the staff register: register a teacher, set the subjects they
  teach, review the permissions they hold and remove a record.
- **Settings → Teacher permissions** — the list of every teacher with their permissions, one-click
  reduction back to read-only, a “make every teacher read-only” reset, and the school-wide window.
  The register’s manage dialog edits the same catalogue through the same component.

Enforcement points:

- `RequireAuth` redirects to the sign-in screen when no campus session exists.
- The navigation bar hides **Settings** from non-administrators.
- Create/delete controls (subjects, terms, exams, timetable slots, grading scales, staff records)
  render only for administrators.
- `canEditExam()` in [`src/session.tsx`](src/session.tsx) decides mark-entry editability; the session
  also exposes `can(permission)` and `subjectScope` (the id list a teacher may see, or `null` for
  every subject) so every page derives its scope from one place:

```ts
admin  → editable, unless the paper is locked or published
teacher→ editable only if exam.subject_id ∈ teacher.assigned_subject_ids
         AND teacher.permissions ⊇ ['marks.enter']
         AND (the paper's deadline — else the school-wide window — is still open
              OR teacher.permissions ⊇ ['marks.after_deadline'])
guest  → never editable
```

The order matters: a paper outside the teacher's subject list is refused before anything about
permissions, so the reason they read is the one that actually blocks them. Mark Entry shows that
reason in a banner — "This subject is not assigned to your staff profile", "Your account is read-only
— the registrar has not granted you mark-entry permission", "The mark-entry window closed on <date> —
this paper is read-only", or "This exam has been locked by the administrator".

Broadsheets are read-only for staff at every permission level: there is no write path on
`/dashboard/reports` for anyone, and the teacher view says so on the page.

The session (`role`, `schoolId`, optional `teacherId`) is persisted in `localStorage` under
`meridian.session.v1`, so a reload keeps you signed in.

> **Security note:** this is a front-end demonstration layer. Passwords are salted and hashed with
> SHA-256 via WebCrypto (`salt:password`), but SHA-256 is not a password KDF, and all checks happen
> in the browser. Production requires server-side enforcement.

---

## 3. Sign-in and school registration

### Sign-in screen (`/`)

Split layout: a dark editorial panel on the left with the product statement and campus identity, and
the credential card on the right.

- **Role selector** — Administrator or Teacher tab; the form changes its username label accordingly.
- **School code** field (e.g. `RVA-01`), matched case- and whitespace-insensitively.
- **Username / email** and **password** with a show/hide toggle.
- **Continue with Google** — a local stand-in for OAuth: it opens a mocked Google account chooser
  listing the campus's administrator and teacher accounts, and signs in with the selected one.
- **Preview this campus as a guest (read-only)** — enters with the guest role.
- **Demo campus hint** — when the code matches a seeded campus, the card reveals the demo
  credentials (`admin` / `meridian`, or staff email / `meridian`).
- **Register a school** link to the three-step sign-up flow.
- Validation errors are announced inline in an alert region; the password field is never echoed.

### School registration (`/signup`)

A three-step wizard on the same charcoal/crimson identity:

1. **Campus details** — school name, unique school code (auto-suggested from the name, e.g.
   "Riverside Academy" → `RA-01`), address, phone, optional logo upload.
2. **Administrator** — administrator email and password (minimum 8 characters, confirm field). The
   email becomes the administrator's username.
3. **Plan** — explains that billing is not connected yet and lets the administrator create the
   campus anyway.

Successful registration creates the school record, stores salted credentials, and returns the user
to sign-in. Codes are validated as 2–16 characters (letters, numbers, spaces, hyphens) and must be
unique across all campuses.

---

## 4. The application shell and navigation

- **Desktop:** a sticky charcoal **top bar** (100 px, never scrolls away) rather than a side rail, so
  every page owns the full window width. Row one carries the campus mark (logo + name + workspace
  label) on the left and, on the right, **Register teacher** (administrators) beside the signed-in
  user (name, role badge, Sign out). Row two is the grouped navigation, all twelve destinations
  visible at once, with thin rules between groups.
- The bar is sticky: on a long page it stays pinned above the content.
- **Responsive:** below 1280 px the nav items drop their icons to stay on one line; below 768 px the
  bar collapses to the compact mobile header (drawer toggle, campus mark, sign-out) and the full
  grouped navigation opens as a dark drawer. Layout collapses to one column, tables scroll
  horizontally, and action rows wrap.
- **Main region:** max-width 6xl content column with generous padding; page headers use a bottom
  rule and an action cluster. The timetable is the exception — it runs the full window width (capped
  at 1600 px) because forty period columns need it.

Navigation groups:

| Group | Items |
| --- | --- |
| Main | Overview |
| Academic Community | Students · Classes · Timetable · Subjects |
| Assessment Engine | Terms · Marks Entry · Analysis · Broadsheets · Report Cards |
| System | Settings *(administrators only)* |

Active items are solid crimson with a white label; inactive items are muted white on charcoal. The
campus mark, the account block and the group rules are the only things the bar adds; there is no
title of the current page, because each page states its own name in its header.
Role badges are gold for Administrator, neutral for Teacher, and outline-with-eye for Guest.

---

## 5. Module-by-module feature reference

### 5.1 Overview dashboard

`/dashboard` · [`src/pages/Dashboard.tsx`](src/pages/Dashboard.tsx)

- Welcome header personalised by role: teacher sees their name and assigned subjects; administrator
  sees the "full control" description; guest sees a read-only notice.
- Four stat cards: **Active students** (with total on roll), **Classes & streams**, **Subjects**,
  **Exams this term** (with the active term).
- **Exams in {active term}** list: subject · exam name, class/stream, date, max score, and a progress
  badge showing `entered/roster` (green when complete, red "Read-only" when the window has expired).
  Each row opens that paper on the Marks Entry bar. Teachers only see papers for their assigned
  subjects.
- **Recent marks** feed: last six updated marks with student avatar, subject, date, score and a
  colour-coded grade pill.
- A gold legend strip explains the `X` (missing marks) and `Y` (examination irregularity) codes.

### 5.2 Students

`/dashboard/students` and `/dashboard/students/:studentId` · [`src/pages/Students.tsx`](src/pages/Students.tsx)

- Search across name, admission number and guardian phone.
- Filters: status (All / Active / Alumni) and class/stream; sort by name, admission number or class.
- Result count line reflects the filtered set versus the total roll.
- Wide table: student (avatar, name, admission number), class/stream, gender, guardian contact,
  status badge, and a row action to open the detail panel.
- Empty states distinguish "no matches" (with a clear-filters action) from "no students on roll".
- **Student detail drawer** (right-hand slide-over, deep-linkable by student id):
  - Identity header with avatar, name, admission number, class and status.
  - Facts grid: admission number, class, gender, date of birth, guardian, guardian phone, status.
  - **Term average** calculated from the student's numeric marks with its letter grade.
  - **Performance** list: subject, exam name/date, score and grade, or the raw `X`/`Y` code.
  - **Notes & attachments**: administrator/teacher can add a note (author name + timestamp) and
    delete notes; attachments show a paperclip with the file name. Notes are stored per student.
- **Add student** (administrators) sits in the page header — full width beneath the title on phones,
  aligned right on desktop — and in the empty state. Non-administrators see a one-line read-only
  note in that slot instead, so the missing button is explained rather than silent. It opens an
  admission form: full name, admission number, class, gender, date of birth, guardian name and phone.
  The admission number is pre-filled from the campus `IUPC/<year>/<nnn>` sequence — the next free
  number — and a duplicate is refused with an inline error naming the number already on roll. The
  class defaults to the roster's current filter. **Save & add another** keeps the dialog open on the
  same class for bulk admission, and every save raises a dismissible confirmation above the table.
- The student's detail drawer still has no edit form: guardian details, gender and class are fixed at
  admission, and the roster comes from the seed snapshot plus whatever has been admitted since.

### 5.3 Classes & Teachers

`/dashboard/classes` · [`src/pages/Classes.tsx`](src/pages/Classes.tsx)

- Four stat cards: active students, streams (and how many class names they belong to), staff, and
  subjects.
- **Teacher invitation link** (administrators only): a permanent, campus-scoped URL of the form
  `{origin}/invite/{school-code}` with a copy-to-clipboard button and confirmation state.
- **Classes & streams** grid: one card per class name, one row per stream with its live active-student
  count, a **Student** action (administrators) that jumps to the roster with that stream pre-selected
  and the admission form open, and a **Print list** action (disabled when the roster is empty).
- **Add class** (administrators) is the page header's primary action, matching the roster page
  (full width on phones), and opens a two-field dialog — class name (with the existing groups as
  suggestions) and stream label, stored in upper case — and refuses a duplicate pair. The new stream
  appears in the grid immediately with a zero roster, ready for admission.
- **Staff directory**: each teacher with avatar, name, email, employee id, the subjects they hold and
  their access badge. This is a read-only snapshot of the staff register: subject load is edited on
  `/dashboard/teachers` and permissions in Settings → Teacher permissions, so there is one write path
  per fact.
- **Subjects taught here**: compact list of the campus catalog with a shortcut to add subjects.
- **Class list sheet** (A4 portrait print preview): campus masthead and logo, "Class List" title,
  class, stream, student count and print date, then a numbered table of **admission number ·
  student name · gender**, plus a fifth **blank column** (4.5cm, ruled, deliberately empty) for a
  handwritten remark, with signature lines for **Class teacher** and **Head teacher**.
  Selecting a stream opens the preview; printing produces a clean one-page list.

### 5.4 Teachers

`/dashboard/teachers` · [`src/pages/Teachers.tsx`](src/pages/Teachers.tsx)

The staff register is where a teacher record is created, and the only place subject access is set.
One card per teacher carries:

- **Identity** — name, staff email (the sign-in address) and staff number, with the access badge in the
  corner: **Marks entry** or **Read-only**.
- **Teaches** — the subject codes the teacher holds. This is the read scope: exams, broadsheets, the
  overview and analytics show a teacher only the subjects on this list.
- **Permissions** — the grants they hold, or "No write permissions — read-only account".
- **Manage / Remove** (administrators) — a dialog over the same fields, showing the permission
  catalogue as checkboxes. The highest staff number in use pre-fills the next one, and both the email
  and the staff number must be unique. A teacher who still holds lessons on the timetable cannot be
  removed; the refusal names how many lessons to reassign first.
- **Find staff** filter and **Permissions** filter (all / may enter marks / read-only).

A **Register teacher** button sits in the top menu on every page for administrators, and again in the
page header. The top-menu button deep-links to `/dashboard/teachers?register=1`, which opens the form
immediately — registering a teacher is one click from anywhere. There is no invitation link and no
default password: a registered teacher signs in with their staff email and the demo password until a
real backend lands.

The **How access works** note at the foot of the page states the model in one place: subject access
scopes what a teacher sees, permissions decide what they may write, and every account starts read-only.
For the whole-school view of grants — every teacher, their permissions, one-click reduction and the
term's mark-entry window — see Settings.

### 5.5 Timetable

`/dashboard/timetable` · [`src/pages/Timetable.tsx`](src/pages/Timetable.tsx), printed styles in
[`src/index.css`](src/index.css)

The most developed module, with two distinct faces: an interactive screen board and a traditional
printed sheet.

**Periods, breaks and the calendar**

The school day is data, not code: it lives in the `bellSchedules` table (one row per school) and the
**Periods** button on the timetable opens the editor for it. Nothing about the day is hard-coded.

- The seeded day is eight 40-minute periods with a 20-minute break after period 3 and an hour for
  lunch after period 6: 08:00–08:40, 08:40–09:20, 09:20–10:00, *break*, 10:20–11:00, 11:00–11:40,
  11:40–12:20, *lunch*, 13:20–14:00, 14:00–14:40.
- **A period's number is its position among the lesson rows.** `TimetableSlot.period` therefore keeps
  pointing at the same lesson when a clock time changes, and lessons never move because the bell did.
- **Editing a time ripples the rest of the day** by the same amount, so the bell stays continuous:
  lengthening period 1 to 08:45 pushes period 2 to 08:45–09:25 and so on. The board, both print
  sheets, the slot editor and the clash logic all read the same schedule.
- **New periods are appended** at the end of the day (maximum 14 lesson periods, 6 breaks). Because
  appending cannot renumber an existing period, adding a period can never move a scheduled lesson.
- **Breaks are rows too**: insert one after any period (the rest of the day shifts back by its
  length), rename it ("Break", "Lunch", "Assembly"), or delete it (the rest of the day moves up).
- **Shortening the day is guarded**: a period that still holds lessons cannot be removed — the editor
  refuses with "N scheduled lessons sit in the periods you removed" until they are moved or deleted.
- Validation is live and specific: rows must be valid `HH:MM`, run in order, not overlap, and each
  end must be after its start.
- Monday–Friday, 12 teaching weeks per term.
- Week dates are derived from the first Monday on/after 1 September of the term's academic year;
  each column header shows the actual date (e.g. "Mo 07 Sep"), so "Week 5" is a real calendar week.

**View modes**

- **Whole school** (the default) — the master switchboard: one row per stream, every day's periods
  across the header, so the whole week is visible and editable in one place.
- **Class timetable** — pick a class/stream and the week is drawn as a boxed form: days down the
  rows, periods across the columns, with BREAK and LUNCH running vertically through the table.
- **Teacher timetable** — pick a staff member; same sheet, with the stream they are taking in
exchange for the subject name.

Filters: term, week, class *or* teacher, all in one compact toolbar above the board. `?view=class`,
`?view=teacher` or `?view=school` in the URL opens that mode directly.

**The master switchboard** (`src/components/SchoolBoard.tsx`)

- Classes on rows, day × period on the column headers: Monday–Friday × every lesson period in the bell
  schedule (40 columns with the seeded eight-period day).
- **Fit week is the default: all five days are on screen, no horizontal scrolling.** The grid
  measures its container and divides the width across the 40 period columns; the timetable route is
  also the one page that lifts the app's reading-column cap, so a large monitor gives the week more
  room (≈36 px per period at 1920 px, ≈25 px at 1440 px).
- Cells are therefore **colour-coded blocks**: the subject's colour fills the cell, its two-letter
  code sits centred, and teacher initials appear when the column is wide enough. A legend under the
  board maps every colour and code to its subject, and a periods line carries the times that no
  longer fit inside each column header.
- **Detailed** in the toolbar switches back to full-width cards — subject name, room, teacher,
  grip handles — which scroll sideways as before. The choice is per visit, not stored.
- The class column and both header rows stay pinned wherever the grid does scroll (narrow screens,
  detailed mode), so a lesson two days away still shows which day and period it belongs to.
- A free period is a dashed empty cell; each stream row counts its loaded periods (`35/40`).
- **Drag to move.** Dropping a lesson on a free cell moves it there; dropping it on another lesson
  trades the two places, including across streams. A teacher double-booking is allowed — staffing is
  a judgement call — and reported in the notice strip ("… is now double-booked with Year 8 A"), so
  the move is never silently unsafe. Two lessons can never share one stream's period: that becomes a
  swap.
- **Every move is undoable** from the notice strip, and the destination cell flashes.
- **Pick-up-to-place** for touch and keyboard: with wide cells the grip (`⋮⋮`) on a card starts it;
  at any density **Move…** in the slot editor does the same. Then click or tap the destination cell;
  `Esc` cancels.
- **Clash detection:** every slot whose teacher is booked into more than one stream at the same
  day/period is flagged (`buildConflicts`). Conflicts get a red inset bar, a tinted background and a
  `CLASH` badge; the page header shows "N clashes" or "No clashes".
- The class and teacher boards are drawn as the printed form (see below), not as cards:
  `table.period-board`, a 2 px frame, hairline rules, a two-letter day in the gutter, the period
  number and its clock times in the header, and BREAK/LUNCH as full-height columns whose captions
  are rotated bottom-to-top. Drag-to-move works inside the stream exactly as on the master board.

**Creating and editing slots** (administrators)

- "Create timetable slot" opens a modal with class, day, period, subject, assigned teacher, room, and
  a repeat option: **Every week** or **Only week N**.
- Live validation before saving: a hard error if the chosen stream already has a lesson in that
  day/period; a warning (still savable) if the teacher is already booked elsewhere at that time.
- Existing slots open the same modal in edit mode, with a delete action.
- Saving writes through `api.timetable.save`, so cards, clashes and prints update immediately.

**Printing — whole-school master grid (A3 landscape)**

With the teacher and class views the grid prints on one **A4 landscape** sheet. The whole-school view
prints the master grid instead, because forty period columns only read on larger paper:

- **Classes down the rows, day × period across the columns**, one letter-size cell per lesson.
- Each cell prints the **subject code** (`MA`, `BI`, `EN`) in the subject's accent colour with the
  teacher's initials beneath; a clash cell is tinted with a small `CLASH` stamp.
- The two-row header carries the day names and the period number under each.
- Under the grid: a key of subject codes and teacher initials, the `Head of Academics` signature line
  and the generation date.
- `@page master { size: A3 landscape; margin: 8mm }`, one page. Table height is a minimum, so four
  streams share the page and a large school grows onto more rather than squeezing names out.

**Printing — class / teacher sheet (A4 landscape)**

The screen board is `no-print`. A dedicated print sheet renders only for print, replicating the
frame-and-rule layout of the school's stock timetable forms:

- **Days down the rows, periods across the columns**, inside a single **2 px black frame** with
  hairline rules; free periods are blank paper, not "Free" labels.
- Header: the period number large with its clock times beneath (`1 / 08:00–08:40`).
- **BREAK and LUNCH are columns spanning the full height of the table** between periods 3/4 and 6/7,
  captioned vertically (bottom-to-top) in the same frame — they are not just gaps.
- The gutter carries the weekday as a large two-letter mark (`Mo`, `Tu`, `We`, `Th`, `Fr`) with the
  actual date beneath.
- Class cell hierarchy: **subject → room → teacher initials**; teacher cell hierarchy:
  **class/stream → room → subject code**. The three lines are pushed to the top, middle and foot of
  the cell, as on the printed original.
- Masthead: a small `MEMO · term · week` line and the campus name above the frame, then the sheet
  title in large centred capitals ("CLASS FORM 1 A" / "TEACHER GRACE WANJIRU").
- Footer beneath the frame: `Timetable generated: <date>` on the left, term · week · lesson count ·
  `A4 landscape` on the right.
- Conflict cells keep a restrained red tint and a small `CLASH` stamp.
- `@page timetable { size: A4 landscape; margin: 8mm }`, with `print-color-adjust: exact`.
- Both class and teacher schedules fit on **one A4 page** (`Export PDF` simply opens the print dialog,
  where "Save as PDF" is chosen).

### 5.6 Subjects

`/dashboard/subjects` · [`src/pages/Subjects.tsx`](src/pages/Subjects.tsx), catalogue in
[`src/data/catalogue.ts`](src/data/catalogue.ts), helpers in [`src/lib/subjects.ts`](src/lib/subjects.ts)

- **The catalogue is Cambridge's own, transcribed from the published subject lists** — 212 syllabuses
  across Cambridge Lower Secondary (13), Cambridge IGCSE (105, including the 9-1 variants), Cambridge
  O Level (35) and Cambridge International AS & A Level (59). Each row carries Cambridge's real
  syllabus code (`0580` Mathematics, `9709` AS & A Level Mathematics, `0862` Lower Secondary
  Mathematics), never a school-minted one. A subject that exists at several levels is one row per
  level, because each is a separate syllabus with its own code and grading.
- **Every code was checked against Cambridge's published subject links**, not typed from memory: the
  syllabus-code lists on the four level pages were diffed against the catalogue and matched exactly —
  nothing invented, nothing missing, and no name disagreeing with Cambridge's own. Cambridge Primary
  (17 syllabuses in the `00xx` range) is deliberately absent: this campus starts at Lower Secondary.
- Grouped into level sections with a rule and an `offered · listed` count, cards carrying the syllabus
  code, the school's faculty grouping and how many exams and lessons reference the subject.
- **Offered is separate from listed.** The catalogue holds everything Cambridge examines; only what
  this campus offers appears in the timetable, in new exam papers, in the printed keys and in the
  staff register's subject picker. A subject is offered or withdrawn from its card, and the seed
  offers the twenty-three this campus actually teaches across Years 7–13.
- Filters: free-text search over name, code and faculty; syllabus level; and offered / not offered.
- Administrators can add a subject (name, code, faculty, syllabus level — `School subjects` for
  anything Cambridge does not examine) and delete one — deletion is blocked with an explanation if
  any exam uses it.
- Subjects are campus-scoped or global (`school_id` optional, so catalog entries can be shared).

### 5.7 Academic Terms

`/dashboard/terms` · [`src/pages/Terms.tsx`](src/pages/Terms.tsx)

- Exactly **one active term** per campus at a time; activating one deactivates the others.
- Term cards show name, academic year, Active/Closed badge, exam count and distinct subject count,
  and either "Open for evaluation" or a "Make active" action for administrators (teachers see
  "Read-only").
- Adding a term captures name (uppercased) and academic year.
- An informational aside explains that activating a term re-routes new exams, mark entry and printed
  reports, while previous terms keep their records.

### 5.8 Marks Entry

`/dashboard/marks-entry` · [`src/pages/MarksEntry.tsx`](src/pages/MarksEntry.tsx)

One page does the whole job: pick the paper, then key the results into the register. Nothing has to be
created first — the paper bar and the register are the same screen. `/dashboard/exams` redirects here,
and `/dashboard/exams/:examId/entry` opens this page with that paper already picked, so the
overview's row actions and any older link still land in the right place.

**The paper bar** — everything a teacher chooses before entering a mark:

- **Exam type** — a dropdown of the five papers this campus sets: **CAT 1 · CAT 2 · Midterm ·
  Endterm · Pre-Mock**.
- **Subject** — a searchable list of the subjects this account may pick (a teacher's own subjects;
  everything the campus offers for the registrar). Typing filters on name, Cambridge code, syllabus
  level or faculty, and the list scrolls for browsing. The chosen subject and its code are echoed
  under the list.
- **Term** and **class/stream** — the term opens on the active one.
- **Sort the register** — **Adm no. · Name · Gender**, the three orders a teacher marking a paper
  asks for; marks survive a re-sort.
- **Paper is out of** — the total the paper is marked out of, echoed live as a conversion
  (`1 mark = 2.0% · 25 = 50%`) so the paper is sanity-checked before anything is keyed in. Changing it
  re-reads every percentage and grade on that paper.
- **Print preview** prints the paper's sheet; **Close page** leaves for the overview.

**Papers are recorded, not created.** A paper is identified by the four choices above. The first
result keyed into the register records it — term, class, subject, type, the total, and today's date.
Until then the bar reads *"New paper — nothing saved yet"* and the page writes nothing at all, so
browsing the bar cannot litter the term with empty papers. Returning to the same four choices finds
that paper with its marks; the bar then reads *Recorded paper*.

**The register** — under the bar, one row per learner on the class roll:

- Columns: **#**, **admission number**, **student** (name with gender beneath), **score**, live
  **%**, live **grade**, and **status**.
- Auto-save on blur; `Enter` commits and advances to the next student, `ArrowUp` / `ArrowDown` move
  between fields. Each save flashes "Saved", or an inline error.
- Accepts a number within `0…out of`, or the codes `X` (missing marks) and `Y` (examination
  irregularity). Invalid input is rejected rather than stored, and a rejected draft shows no
  percentage and no grade — a typo must not read as an `A*`. Tabbing through a blank row writes
  nothing; clearing a keyed score returns that row to Pending.
- **Missing-result warning:** a banner names every learner with no recorded outcome and says what
  leaving will do; it shrinks row by row as scores are keyed in (`11 results are not entered —
  Moses Mutiso, …`).
- **Settling on leave:** if the teacher leaves a *recorded* paper with blanks still open (in-app
  navigation, reload or tab close), the register settles itself and writes **X** for each missing
  result, which is what the printed codes already mean. The write is armed 250 ms after mount, so a
  StrictMode double-mount or a page opened only to read never marks anyone, and a browser
  `beforeunload` prompt stands in the way of closing the tab while blanks remain. A paper that was
  never recorded is left untouched.
- **Print preview** produces a clean A4 portrait mark sheet with the campus masthead, the paper's
  scope and the X/Y legend footer, on `@page report`.

**Read-only enforcement** is the same gate mark entry has always used: a paper is writable only while
its subject is assigned to that staff profile, the account holds `marks.enter`, the school-wide window
set in Settings has not closed (or the account also holds `marks.after_deadline`), and the paper is not
locked or published. The blocking reason is stated in a red banner and every input is disabled, so a
read-only paper stays readable and printable but cannot be written — the settle-on-leave write is
skipped entirely. Per-paper `editing_deadline`, `locked` and `published` still exist in the model (the
seed locks Year 11's History paper and publishes all of last term), but the window itself is managed
school-wide in Settings rather than paper by paper.

### 5.9 Academic Analytics

`/dashboard/analysis` · [`src/pages/Analysis.tsx`](src/pages/Analysis.tsx), engine in
[`src/lib/analysis.ts`](src/lib/analysis.ts)

A term-scoped read of campus performance for administrators and teachers; teachers see only their
assigned subjects, and guests can browse and export but not edit.

**Filters:** term (the active term by default, and closed terms with retained results), class/stream
and subject. The subject list only offers subjects examined that term, so a filter cannot silently
empty the page for a paper the term never sat. Every filter change recomputes all modules.

**KPI strip**

- **Campus average score** — the mean of each student's mean paper percentage, with a green or red
  badge for the change on the previous term. The change averages only subjects examined in both
  terms, so different paper sets are never compared as though they were the same.
- **Exam completion rate** — marks entered over expected marks for the scoped papers, plus how many
  papers are complete.
- **Top performing subject** — the highest subject average, with paper and entry counts.
- **At-risk students** — active students whose average is below the grading scale's pass mark, named
  on the card and broken down per stream in the comparison table.

**Modules**

- **Grade distribution** — every band of the active scale as a bar, with counts, shares and a `Z` row
  for students with no numeric mark.
- **Subject performance** — subject-by-subject averages as bars, best first, with entry counts and the
  change on the previous term where that subject was examined in both.
- **Stream & class comparison** — for the selected term and subject across all streams: students,
  average, top student, submission progress (complete / in progress / not started) and at-risk count.
  The stream chosen in the filter is highlighted.
- **Automated insights** — up to four sentences generated from the marks (biggest riser, at-risk
  concentration, strongest and weakest subject, outstanding marks, stream spread) in a callout card
  with a crimson left rule.

**Export:** **Export CSV Analytics** writes a UTF-8 (BOM) workbook containing the KPI summary, grade
distribution, subject table, stream table and insights. **Download PDF Report** prints a dedicated
one-page A4 portrait report (`@page analysis`) with the school masthead, KPI strip and every module;
the interactive page is `.no-print`.

**Performance deck (end of the page)** — the same marks presented as the department's printed
end-of-term report, as slides. Engine in [`src/lib/deck.ts`](src/lib/deck.ts), slides in
[`src/components/PerformanceDeck.tsx`](src/components/PerformanceDeck.tsx).

- **Cross-term by design.** The deck follows the class/stream and subject filters (what is being
  reported on) and deliberately ignores the term selector, because it is a term-on-term comparison.
  It reads up to the last four terms that hold marks in scope.
- **A slide pair per year group:** cover, contents, executive summary, overall performance, a trend
  slide and a detailed slide for each year group, recommendations and conclusion — twenty slides with
  the seven seeded year groups. The count follows the data, not a fixed deck.
- **KPI tiles** (best stream, top improver, most challenged, peak average, improving *n* of *m*) are
  all ranked on the **closing term** — the newest term any stream in scope is marked in — so "best"
  and "most challenged" are never two different terms in disguise. Streams with no marks in the
  closing term are named as such instead of being ranked against streams that have them.
- **Clustered column charts** drawn in the deck's own palette: teal, gold and coral for the first three
  terms in order on the overall slide, stream colours on the year slides, with dashed gridlines, value labels above each
  column and a legend.
- **Everything on a slide is derived from marks.** Challenges are measured facts (a term closed
  weaker than it opened, learners below the pass mark, outstanding marks, an unrepeated ceiling);
  recommended actions follow from those facts, then a short set of *standing* strategies (marked as
  such) fills the slide out. Nothing is asserted that the data does not measure, and "not marked yet"
  is reported as itself.
- **Navigation:** previous/next, the slide counter, arrow keys, `Home`/`End`, and an **All slides**
  toggle that also sets `?deck=print`.
- **Printing the deck:** **Print slides** switches to `?deck=print`, which puts the deck on `@page
  deck` (A4 landscape) and drops the analytics sheet, giving **one slide per page**; the same URL can
  be opened directly and printed from the browser.

### 5.10 Broadsheets

`/dashboard/reports` · [`src/pages/Reports.tsx`](src/pages/Reports.tsx), analytics in
[`src/lib/analytics.ts`](src/lib/analytics.ts)

The term's analytical master sheet for a class (or all streams of a class).

**Filters:** class, stream (with a "Check All Streams" switch), and demographic (Both / Boys Only /
Girls Only).

**On-screen sheet (A4 landscape)** — a paper-like article rather than a UI table:

- Masthead: school name and scope on the left; address, telephone and print date on the right.
- Title line composed from the exam set, scope and term — e.g. *"End Term Results — 8 G · TERM 1,
  2026/2027"* — using the single exam's name when only one exam is in scope.
- Main table: **Rank · Name of student (with admission number) · MG (mean grade) · Score (total) ·
  Avg (mean) · SD (standard deviation) · Comp (subjects completed)**, then one column per exam,
  labelled with the subject code and exam name.
- Cell rendering: numeric score plus a small grade letter; `X` and `Y` codes rendered as themselves;
  `—`/blank for subjects not taken.
- **Subject summary** block: average, grade, entry count, highest and lowest per column.
- **Grade distribution** summary: counts per grade band, plus `Z` for students with no grades.
- Footer legend for `X`, `Y`, `Z` and "subject not taken", plus a class-teacher signature line and
  school details.
- Positions are computed on the mean; ties share a rank; rows display in admission-number order.

**Actions:** **Export to Excel** (UTF-8 CSV with BOM, quoted fields, filename
`broadsheet-{class}-{term}.csv`) and **Print / PDF** (A4 landscape, `@page broadsheet`).
Teachers get a read-only variant of the page.

### 5.11 Report Cards

`/dashboard/report-cards` · [`src/pages/ReportCards.tsx`](src/pages/ReportCards.tsx)

The official end-of-term document, one student at a time, with an editing panel beside a live A4
portrait preview.

**Document**

- Campus crest/logo (with fallback to the academy crest, then a monogram), school name, address
  (street and postal address split onto separate lines), contact details.
- Student block: name, admission number, class/stream, gender, term and academic year, attendance.
- **Subject table:** code, subject, score, percentage, grade, points, teacher initials, an empty
  remark cell and subject rank out of the class size. Blank rows pad short subject lists so the table
  always looks complete.
- Term totals: total percentage out of `subjects × 100`, mean grade, and class position.
- **Grading key:** the active scale's bands, grade letters and points printed as a compact legend.
- **Remarks blocks:** Class teacher's remarks split into academic, activities and conduct lines, with
  the class teacher's name; Principal's remarks with signature; HSE master's remarks with signature.
  Every remark field, including the subject table's remark column, prints **blank**: the blocks are
  ruled writing space that teachers fill in by hand on the printed card, so no stored text is ever
  reproduced there.
- **Next term** dates (begins / ends) and the date printed.
- Student navigation (previous/next) and term history, so a card can be reviewed per term.

**Editing panel** (administrators): attendance days present/total, class teacher name and next-term
dates. Saving upserts the record for that student + term (`api.reportCards.upsert`), and the preview
updates live. Remarks are deliberately not edited here — they are handwritten on the sheet — but the
legacy `academic`/`activities`/`conduct`/`principal`/`hse` fields stay in the record and are preserved
on save so old data is never destroyed.

**Print:** `@page report { size: A4 portrait }`, one page per student.

### 5.12 Settings

`/dashboard/settings` · [`src/pages/Settings.tsx`](src/pages/Settings.tsx) · administrators only

- **Campus profile** — name, code, address, contact email and phone as read-only facts; **school logo
  upload/replace/remove**. Logos are resized to a maximum 384 px edge and stored as data URLs so they
  survive reloads and appear in the top bar, class lists, broadsheets, report cards and timetable.
  Accepts PNG, JPG, WebP, GIF or SVG up to 5 MB; transparent formats stay PNG, photographs become
  JPEG.
- **Grading scale** — edit the active band table (grade, minimum score, points, remark), add or
  remove bands, set the scale name and pass mark, and save it as a custom scale. Saved custom scales
  are listed with their band count and can be deleted. A one-click action restores the default
  institutional scale.
- **Teacher permissions** — the whole-school view of grants: how many teachers may write, how many are
  read-only, and the current school-wide marks window, with an **Open teacher permissions** button that
  opens the list. There, every teacher appears with their subject access, their existing grants as
  checkboxes, a **Read-only** action that clears them, and a **Make every teacher read-only** reset
  behind a confirmation. The panel also sets the term's **marks close after** time (or leaves it open),
  which is the deadline every paper without its own inherits.
- **Restore snapshot** — a destructive, confirmed action that discards all local edits and reloads the
  original Convex snapshot.
- **About panel** — version, stack, and the meaning of the `X` / `Y` codes.

---

## 6. UI and design system

### Visual identity

Derived from the supplied design kit ("Academic Prestige, Operational Precision"):

| Token | Value | Use |
| --- | --- | --- |
| Crimson | `#C8102E` (deep `#A30014`) | Primary actions, active nav, key accents |
| Brass / honours gold | `#C5A059` (deep `#876B27`) | Prestige accents, active term, badges, grade `A*` |
| Ink | `#111827` | Top bar, headings, primary text |
| Paper | `#F9FAFB` | App canvas |
| Raised / sunken | `#FFFFFF` / `#F3F4F6` | Cards / wells and table headers |
| Rule | `#E5E7EB` | Hairline borders |
| OK / Warn / Danger | `#15803D` / `#D97706` / `#DC2626` | Status semantics |

- **Typography:** Inter throughout (`--font-display` and `--font-sans`), JetBrains Mono for code-like
  figures. Headings use tight negative tracking; labels use uppercase micro-caps with wide tracking.
- **Numerals:** every table and `.data-figure` uses tabular numerals so scores and positions align
  vertically — a deliberate records-office choice.
- **Focus:** 2 px crimson outline with 2 px offset on all focusable elements.
- **Motion:** 200 ms transitions on colour, border, shadow and a 1 px hover lift on cards; a subtle
  fade-in on dashboard rows. Reduced-motion users are not forced through large animation.

### Component primitives (`src/components/ui.tsx`)

- `PageHeader` — title, subtitle, action cluster, bottom rule.
- `Badge` — neutral, brass, ok, danger, ink, crimson tones.
- `GradePill` — colour-banded Cambridge grade chip (`A*` gold, `A`/`B` green, `C`/`D` slate,
  `E`/`F` amber, `G`/`U` red, `X` amber, `Y` red).
- `Avatar` — image or initials fallback.
- `SchoolLogo` — uploaded logo → fallback crest → monogram, with broken-image recovery (never renders a
  broken glyph).
- `EmptyState` — icon, title, hint, optional action; compact variant for panels.
- `StatCard` — label, large tabular figure, hint, icon, coloured top strip.
- `TopBar` — sticky header: campus mark, grouped navigation with role filtering, account and Sign out.

### Layout patterns

- Cards: white, 1 px rule, 8 px radius, 1 px ambient shadow; 200 ms hover lift to gold border.
- Tables: sunken header row, uppercase 11 px labels, hairline dividers, generous row height.
- Forms: `input-field` with crimson focus ring; labels are 11 px uppercase micro-caps.
- Print: `.no-print` hides interactive chrome; print-only sheets use named CSS `@page` rules.

### Accessibility

Semantic headings, `aria-label`s on icon-only buttons and selects, `role="alert"` error regions,
`role="dialog"` with `aria-modal` on modals/drawers, `role="tablist"`/`aria-selected` on the timetable
mode switch, labelled score inputs, visible focus rings, and text alternatives on grade/clash badges.

---

## 7. Printing and export

| Artefact | Orientation | Page rule | Trigger |
| --- | --- | --- | --- |
| Whole-school master timetable | A3 landscape | `@page master` | Print / PDF from the whole-school view |
| Timetable (class or teacher) | A4 landscape | `@page timetable` | Print timetable / Export PDF |
| Broadsheet | A4 landscape | `@page broadsheet` | Print / PDF |
| Report card | A4 portrait | `@page report` | Print |
| Academic analytics | A4 portrait | `@page analysis` | Download PDF Report |
| Performance deck | A4 landscape | `@page deck` | Print slides (`?deck=print`) |
| Class list | A4 portrait | `@page classlist` | Print list |
| Marks entry sheet | A4 portrait | `@page report` | Print preview |
| Broadsheet data | — | — | Export to Excel (CSV) |

Printing rules:

- Named pages isolate each document type so a single browser print dialog cannot mix formats.
- `print-color-adjust: exact` preserves the charcoal timetable header, crimson accents and grade
  colours.
- Interactive shells (top bar, toolbar, filters, hover affordances) are `.no-print`; dedicated print
  components render at print time only.
- Timetable, broadsheet and analytics sheets are verified to fit one page; report cards are one page
  per student.
- "Export PDF" uses the browser print dialog with **Save as PDF** — there is no bundled PDF library.

---

## 8. Grading engine

[`src/lib/grading.ts`](src/lib/grading.ts)

Default institutional scale (used when a campus has no custom scale):

| Grade | Min score | Points | Remark |
| --- | --- | --- | --- |
| A* | 90 | 9 | Excellent |
| A | 80 | 8 | Very Good |
| B | 70 | 7 | Good |
| C | 60 | 6 | Average |
| D | 50 | 5 | Below Average |
| E | 40 | 4 | Needs to Improve |
| F | 30 | 3 | Weak |
| G | 20 | 2 | Very Weak |
| U | 0 | 1 | Ungraded |

Behaviour:

- **Active scale:** the newest custom scale for the campus wins; otherwise the default bands apply.
- **Lookup:** bands are sorted by minimum score descending and the first match wins, so a score of 87
  is an `A`, not an `A*`.
- **Bands are percentages, not raw marks.** A paper carries its own total, so a mark is graded through
  it: `gradeForMark(41, 50)` is 82% and earns an `A`, while grading the raw 41 would wrongly say `E`.
  `percentOf`, `gradeForMark` and `pointsForMark` are the only grade paths for a mark; `gradeFor`
  itself takes an already-computed percentage (term averages).
- **Special codes:** `X` = missing marks (absent or incomplete assessment) and `Y` = examination
  irregularity. Both pass through grading untouched and never contribute to totals, means or
  positions.
- **Remarks:** a custom band's own remark is preferred; otherwise conventional remarks are mapped by
  grade letter.
- **Input parsing:** `parseScoreInput` accepts a number within `0…max_score`, an empty value (clears
  the mark), `X` or `Y`, and returns a human-readable error otherwise.

Derived analytics ([`src/lib/analytics.ts`](src/lib/analytics.ts)):

- Subject columns sorted by syllabus code then name.
- Per-student total and mean over numeric marks only; mean grade derived from the mean.
- Positions by mean descending, ties sharing a rank, displayed in admission-number order.
- Per-subject ranks for report cards; per-subject average, grade, entry count, highest, lowest and
  standard deviation for the broadsheet.
- Overall strip for the page footer: mean score, mean points, mean grade, total average and student
  count.
- Grade distribution including `Z` (no grades) for the term summary.

---

## 9. Data model

[`src/data/types.ts`](src/data/types.ts) mirrors the Convex schema. Fourteen tables:

| Table | Purpose | Key fields |
| --- | --- | --- |
| `schools` | Campus identity and administrator credentials | `name`, `code`, `address`, `contact_email`, `phone_number`, `logo_url`, `admin_username`, `admin_password_hash/salt` |
| `classes` | Class + stream pairs | `school_id`, `class_name`, `stream_name` |
| `teachers` | Staff register: identity, subject access and permission grants | `school_id`, `full_name`, `email`, `employee_id`, `assigned_subject_ids[]` (read scope), `permissions[]` (`marks.enter`, `marks.after_deadline`, `records.view_all_subjects`; empty = read-only), `initials` |
| `subjects` | Cambridge-aligned catalog | `name`, `code`, `category`, optional `school_id` |
| `students` | Roster | `admission_number`, `full_name`, `gender`, `date_of_birth`, `class_id`, `photo_url`, guardian name/phone, `status` (`Active` \| `Alumni`) |
| `terms` | Evaluation windows | `name`, `academic_year`, `is_active` |
| `exams` | Assessments | `term_id`, `subject_id`, `class_id`, `exam_name`, `exam_type`, `max_score`, `exam_date`, `teacher_id`, `editing_deadline` |
| `marks` | Scores | `exam_id`, `student_id`, `score` (number \| `X` \| `Y` \| null), `remarks`, `updated_at` |
| `gradingScales` | Custom band tables | `name`, `pass_mark`, `bands[]` (`grade`, `min_score`, `points`, `remark`) |
| `reportCards` | Term report per student | attendance, class teacher/principal names, remarks (academic, activities, conduct, principal, HSE), next-term dates, `updated_at` |
| `notes` | Student notes | `student_id`, `body`, `author_name`, optional `file_id`/`file_name`, `created_at` |
| `timetableSlots` | Weekly schedule | `term_id`, `class_id`, `day`, `period` (position of a lesson row in the bell schedule), `subject_id`, `teacher_id`, `room`, `week` (null = every week) |
| `bellSchedules` | The school day | `school_id`, `entries[]` (`id`, `kind` (`lesson` \| `break`), `label`, `start`, `end`), `updated_at` |
| `markWindows` | The school-wide mark-entry window, one row per school | `school_id`, `closes_at` (ISO datetime, or null for "open until a paper sets its own"), `updated_at` |

Identity conventions follow Convex: every row has `_id` and `_creationTime`; local inserts get ids
prefixed `loc` so seeded and locally-created rows are distinguishable.

---

## 10. Data layer, persistence and the backend seam

[`src/data/db.ts`](src/data/db.ts) · [`src/data/snapshot.ts`](src/data/snapshot.ts)

- **Seed:** `loadSnapshot()` parses the JSONL export at the repository root (one folder per table,
  `documents.jsonl`) and imports the rows as Vite `?raw` strings. It needs no network at runtime.
- **Store:** a single in-memory `Database`, mirrored to `localStorage` under `meridian.db.v1`.
  Mutations replace the top-level object identity and notify subscribers, so `useDb()` (built on
  `useSyncExternalStore`) re-renders every consumer.
- **Resilience:** corrupt or unavailable storage is ignored rather than crashing; a database saved
  before the timetable module existed is back-filled with seeded slots, while an explicit empty array
  is preserved (so deleting all slots sticks).
- **API seam:** `api` exposes `schools.create`, `marks.setScore/setRemarks`,
  `exams.ensure/setMaxScore`, `gradingScales.save/remove`,
  `timetable.save/remove`, `notes.create/remove`, `reportCards.upsert`, plus `resetDatabase()`.
  All are `async` and return row objects or `{ ok: true }`, matching the shape of Convex
  mutations/queries.
- **Raw edits:** `mutate(fn)` is used by term, subject, logo and grading-scale operations that edit
  the tree directly.
- **Migration path:** replacing this module with Convex client calls is the only change needed to go
  from local storage to a live deployment — no page reads the snapshot files directly.

Credentials live in [`src/data/auth.ts`](src/data/auth.ts): random 16-byte salt + SHA-256 of
`salt:password`, campus lookup normalised by code, seeded demo campuses migrated on first attempt,
and school registration validating name, unique code, email and password length.

---

## 11. Project structure

```
.
├── DOCUMENTATION.md             ← this file
├── index.html                   App shell, favicon, Inter + JetBrains Mono fonts
├── package.json                 Scripts and dependencies
├── vite.config.ts               Vite dev/preview on 127.0.0.1:5173 / :4173
├── src
│   ├── main.tsx                 React root, router, session provider
│   ├── App.tsx                  Routes and auth guard
│   ├── AppLayout.tsx            Top-bar shell, grouped nav, role badge, sign out
│   ├── session.tsx              Session context, RBAC, canEditExam
│   ├── index.css                Tailwind v4 theme, primitives, print stylesheets
│   ├── components/ui.tsx        Shared primitives and navigation
│   ├── data
│   │   ├── types.ts             Domain model
│   │   ├── db.ts                In-memory store, persistence, api seam
│   │   ├── snapshot.ts          JSONL seed loader
│   │   └── auth.ts              Credentials, sign-in, school registration
│   ├── components/permissions.tsx
│   │                            Access badges, permission toggles, registrar panel
│   ├── lib
│   │   ├── grading.ts           Bands, grades, points, score parsing
│   │   ├── permissions.ts       Permission catalogue, access summary, window helpers
│   │   ├── analytics.ts         Broadsheet builder, ranks, CSV, print helpers
│   │   ├── analysis.ts          Academic analytics: KPIs, distributions, insights, CSV
│   │   └── image.ts             Logo intake and downscaling
│   └── pages                    One file per module (see §5)
├── schools/ classes/ teachers/ subjects/ students/ terms/ exams/ marks/
├── gradingScales/ reportCards/ notes/ timetableSlots/
│                                Convex snapshot export (tables/documents.jsonl)
├── public/iupc-logo.png         Default crest
├── screenshots/                 UI, print and PDF verification captures
└── ui/stitch_meridian_school_management_ui/
                                 Design-kit references and DESIGN.md notes
```

**Stack:** React 19 · TypeScript 7 · Vite 8 · Tailwind CSS v4 (`@tailwindcss/vite`) · React Router 7 ·
Lucide icons · Framer Motion. No test runner, linter or backend is configured.

---

## 12. Running the app on your laptop

### What you need

- **Node.js `^20.19.0` or `>=22.12.0`** (Vite 8's requirement), with npm. Check with `node -v`
  and `npm -v`.
- A modern browser (Chrome, Edge, Firefox or Safari).
- About 200 MB free disk for `node_modules` (roughly 164 MB installed), and no database server —
  persistence is browser-local.

### Install and start

```bash
# from the project folder
npm install          # first time only
npm run dev          # http://127.0.0.1:5173
```

Open `http://127.0.0.1:5173` and sign in with a seeded campus:

| Field | Value |
| --- | --- |
| School code | `RVA-01` (Riverside Academy) or `M-A 001` (Memon Academy) |
| Role | Administrator |
| Username | `admin` |
| Password | `meridian` |

Teacher sign-in uses the staff email as the username with the same password. You can also click
**Preview this campus as a guest**, or register a brand-new campus from **Register a school**.

### Other commands

```bash
npm run typecheck    # tsc -b --pretty false
npm run build        # type-check + production bundle into dist/
npm run preview      # serve the built bundle on http://127.0.0.1:4173
```

The dev server binds to `127.0.0.1` only, so it is reachable from your machine but not your local
network. To demo on a phone or tablet, start Vite with `npm run dev -- --host 0.0.0.0` and open the
`Network` URL it prints (same Wi-Fi required).

### Good to know

- Data is per-browser. Clearing site data, using a different browser or a private window gives you a
  fresh copy of the snapshot. **Settings → Restore snapshot** does the same deliberately.
- `localStorage` holds the whole database and campus logos; a very large logo library can approach
  browser storage limits (logos are capped at 384 px to keep this small).
- Fonts load from Google Fonts. Fully offline use needs those files self-hosted.
- To point at a real backend later, replace the `api` object in `src/data/db.ts` with Convex client
  calls; pages already treat it as async and database-shaped.

---

## 13. Seed / demo data

The shipped snapshot contains:

| Table | Rows |
| --- | --- |
| schools | 1 (IUPC Academy `IUPC-01`, Mombasa) |
| classes | 7 (Year 7 A … Year 13 A — one class per year group) |
| teachers | 8 (Grace Wanjiru may enter marks; the other seven are read-only) |
| subjects | 212 (the whole Cambridge catalogue; the 23 below are offered) |
| students | 84 (12 per class, every name distinct) |
| terms | 2 (Term 3 2025/2026 closed, Term 1 2026/2027 active) |
| exams | 98 (49 per term — one paper per subject per class) |
| marks | 1,131 (588 in the active term, the rest in the closed term) |
| grading scales | 1 (A*–U institutional scale, 40% pass) |
| report cards | 1 |
| notes | 1 |
| timetable slots | 228 |
| bell schedules | 1 (eight periods and two breaks) |
| mark windows | 1 (no school-wide deadline until the registrar sets one) |

The campus is a Cambridge school from Year 7 to Year 13, and **each year group sits its own
syllabuses** — the subject list is what that year is examined in, and it drives its papers, marks and
timetable:

| Year | Papers | Syllabuses |
| --- | --- | --- |
| 7, 8, 9 | 8 each | Lower Secondary: English `0861`, Mathematics `0862`, Science `0893`, Computing `0860`, Global Perspectives `1129`, Humanities `0839`, Art & Design `0073`, Physical Education `0081` |
| 10, 11 | 8 each | IGCSE: English - First Language `0500`, Mathematics `0580`, Biology `0610`, Chemistry `0620`, Physics `0625`, Computer Science `0478`, History `0470`, Business Studies `0450` |
| 12 | 5 | AS: Mathematics `9709`, Physics `9702`, Chemistry `9701`, Computer Science `9618`, Economics `9708` |
| 13 | 4 | A Level: Mathematics `9709`, Biology `9700`, Chemistry `9701`, Psychology `9990` |

Every class is marked in both terms, so the deck has a term-on-term trend for all seven year groups;
Year 11's History paper is deliberately closed with a past deadline, which is how the read-only path
after a deadline is visible on first load.

The timetable seed is substantial enough to demonstrate a full teaching week, teacher conflicts and
one-page prints (the A3 master fits all seven streams because its row height is shared across the
roll rather than fixed). Lessons are placed against **teacher availability**: eight staff cannot stand
in seven rooms at once, so a class takes the next syllabus on its list rather than double-booking
someone. Exactly one clash is then planted on purpose (Year 7 A and Year 8 A, Grace Wanjiru), which is
what the `CLASH` badge and the clash counter are there to show.

**Seed versions.** `SEED_VERSION` in [`src/data/db.ts`](src/data/db.ts) is `3`. A browser holding an
older demo (Form 1–3, 24 students) rebuilds the demo tables from the seed on load: the old classes,
roll, papers and marks cannot be merged into a Years 7–13 campus without orphans (students sitting in
classes that no longer exist). Catalogue entries the registrar added by hand *do* survive, because a
subject references no class, paper or learner. Staff registered before permissions existed inherit
the seed's grants by id and are read-only otherwise.

---

## 14. Screenshot gallery

**Sign-in and shell**

![Sign-in screen](screenshots/login-ui-review.png)

**Students, classes, teachers, subjects, terms, exams**

![Student directory](screenshots/students-ui-review.png)
![Staff register with permissions](screenshots/teachers.png)
![Registering a teacher](screenshots/teacher-register.png)
![Teacher permissions in Settings](screenshots/teacher-permissions.png)
![The register on a phone](screenshots/teachers-390.png)
![Classes and staff directory](screenshots/classes-ui-final.png)
![Subject catalogue with official Cambridge codes](screenshots/subjects.png)
![Academic terms](screenshots/terms-ui-final.png)
![Marks Entry](screenshots/mark-entry.png)

**Timetable**

![Class timetable board](screenshots/timetable-class.png)
![Teacher timetable board](screenshots/timetable-teacher.png)
![Slot editor modal](screenshots/timetable-modal.png)
![Printed A4 timetable](screenshots/timetable-print-sheet.png)
![Rendered PDF page](screenshots/timetable-pdf-page.png)

**Performance deck**

![Deck cover slide](screenshots/deck-cover.png)
![Executive summary slide](screenshots/deck-summary.png)
![Overall performance chart](screenshots/deck-overall.png)
![Recommendations slide](screenshots/deck-recommendations.png)
![The deck in print layout](screenshots/deck-print-preview.png)

**Reports**

![Academic analytics](screenshots/analysis.png)
![Printed report card](screenshots/report-card.png)
![Class list print preview](screenshots/class-list-after-redesign.png)

Generated PDFs: [teacher timetable](screenshots/timetable-a4.pdf) ·
[class timetable](screenshots/timetable-a4-class.pdf).

---

## 15. Verification performed

Checks run against the current code:

- `npx tsc --noEmit` → exit 0.
- `npm run build` (`tsc -b && vite build`) → exit 0, with only the expected single-chunk
  `> 500 kB` advisory.
- Teacher timetable PDF: **1 page**, 41 lessons, no empty cells in the seeded teacher week.
- Class timetable PDF: **1 page**, 40 cells, 28 lessons, 12 blank periods.
- Print and Export PDF each invoke `window.print()` once and restore the original document title.
- Broadsheet CSV opens cleanly in Excel (UTF-8 BOM, escaped fields).
- Browser passes: no console errors, no failed network requests, correct class/teacher rendering,
  conflict badges visible, editing and auto-save working.
- Responsive checks at mobile widths for sign-in, classes and the timetable.
- **Staff register and permissions:** the top-menu register button opening the form and consuming its
  `?register=1` flag, the next staff number being pre-filled, a duplicate email being refused, a new
  record landing read-only with its subjects, the permission and search filters, the Settings list of
  every teacher, adding and reducing a permission, the deadline extension being dropped with the entry
  it depends on, and the school-wide window turning a granted paper read-only before being reopened —
  all asserted.
- **Academic analytics:** the campus average, completion rate and at-risk count are checked against
  figures recomputed from storage; subject and class filters, reset, teacher subject scoping, the
  downloaded CSV contents, PDF wiring and the print-only sheet are all asserted; the analysis PDF is
  **1 page** at 210×297 mm, and the page reports no horizontal overflow or console errors at 1440,
  1024 and 390 px.
- **Cambridge catalogue:** all 212 subjects render with four-digit numeric codes and no school-minted
  code left anywhere; the four level sections carry the right counts; twenty-three are offered; searching by
  code narrows to one card; and offering a subject makes it selectable in the Marks Entry subject bar.
- **Marks Entry:** the paper bar is checked for its five paper types, term and class pickers, the
  three sorts, the paper total and both page actions; the subject bar is checked to narrow to one
  syllabus as a Cambridge code is typed; nothing is written to storage until the first result is
  keyed in, and that first result is checked to record the paper at the total the teacher set; the
  live percentage and grade, the blank-row blur, the out-of-range rejection, all three sorts, print
  preview, the missing-result warning, the settle-on-leave X marks and finding an already recorded
  paper again are all asserted; the mark sheet prints on `@page report` as **1 page**, and
  `/dashboard/exams` is checked to hand over to `/dashboard/marks-entry`.
- **Performance deck:** the slide count matches `6 + 2 × year groups`; the best-stream tile is checked
  against the closing-term means recomputed from storage, including the term it names; every chart bar
  is checked to sit at the value it labels; one slide shows at a time and the counter tracks it;
  buttons and arrow keys page one slide at a time; no slide overflows its canvas; the deck re-scopes
  to a filtered stream and to a teacher's subject; and the deck PDF is **12 pages** at 297×210 mm —
  one slide per page (twenty slides with the seven year groups).

There is **no unit-test runner and no lint script** in the project; validation is the headless-Chrome
suites under `scripts/` (e2e, layout, print/PDF, smoke, migration), type-checking and the production
build.

---

## 16. Known limitations and roadmap

**Current limitations**

- **Front-end only.** No server, no multi-user sync; data is browser-local and clearing storage loses
  edits (recoverable via Restore snapshot).
- **Demo authentication.** SHA-256 with salt is not a password KDF; the Google flow is a mocked
  account chooser. Both must be replaced by real Convex Auth/OAuth.
- **No PDF library.** "Export PDF" uses the system print dialog.
- **Students and classes can be created, not edited.** Admission and new-stream dialogs write through
  `api.students.create` / `api.classes.create`, but there is no edit or delete form for a student, a
  stream or a teacher, no CSV import, and no guardian or photo management. Deleting a stream would
  orphan its students and slots, so it is deliberately absent.
- **A mis-keyed paper cannot be deleted.** A paper is recorded by the first result keyed in, and its
  total can be changed from the bar, but choosing the wrong type, class or term leaves a paper that
  the UI cannot remove — Settings → Restore snapshot is the way back.
- **Invitation link is presented, not enforced.** `/invite/{code}` has no route or claim flow.
- **Single-campus session.** No campus switcher once signed in.
- **No audit trail, soft delete, or offline/conflict handling** for edits.

**Natural next steps**

1. Replace `src/data/db.ts` with Convex queries/mutations and move RBAC to server-side functions.
2. Editing students and streams (guardian changes, transfers between streams, alumni promotion), with
   CSV import and guardian management.
3. Complete the invitation and teacher-onboarding flow, including password reset.
4. Timetable term copy/repeat, room-based clash detection, and drag-to-move slots.
5. Report card bulk generation with a print queue, plus principal sign-off workflow.
6. Fee, attendance-register and communication modules.
7. A layout switcher for the timetable print: traditional days-as-rows vs. the card grid.
8. Automated tests (Vitest + Playwright) for grading, analytics, RBAC and print output.

---

## 17. Glossary

| Term | Meaning |
| --- | --- |
| **Campus / school** | A tenant in the system; all records are campus-scoped |
| **Class / stream** | A year group (e.g. 8) and its section (e.g. G), stored as one `classes` row |
| **Stream** | A subdivision of a class with its own roster |
| **Term** | An evaluation window; exactly one is active per campus |
| **Exam** | An assessment for one term + subject + class, with a max score |
| **Mark** | A student's score or code for one exam |
| **X** | Missing marks (absent or incomplete assessment) |
| **Y** | Examination irregularity (disciplinary or malpractice flag) |
| **Z** | Broadsheet-only marker for a student with no graded subjects |
| **MG** | Mean grade across entered subjects |
| **Position / rank** | Place in the class by mean; ties share a rank |
| **Broadsheet** | The term's class-level master result sheet |
| **Report card** | The official per-student term document |
| **Editing deadline** | Timestamp after which an exam's marks become read-only |
| **Clash** | One teacher booked into two streams at the same day/period |
| **Slot** | A timetable entry: class + day + period + subject + teacher + room |
