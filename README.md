# IUPC Academy — School Management System

A working front-end build of the system specified in [DOCUMENTATION.md](DOCUMENTATION.md), white-labelled for **IUPC Academy**. React 19 + TypeScript + Vite 8 + Tailwind CSS v4, with a local persistence layer standing in for the backend.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

Node `^20.19` or `>=22.12` is required by Vite 8.

### Install it on your phone

Two ways to get it onto a phone: an **Android APK** you copy across and tap, or the **installable web
app** for both Android and iPhone.

#### Android APK

```bash
npm run apk     # first run fetches the toolchain (~2 GB) and Gradle; later runs take about a minute
```

That writes **`IUPC-Academy.apk`** in the project root (and
`android/app/build/outputs/apk/debug/app-debug.apk`): ~4 MB, package `com.iupc.academy`,
`minSdkVersion 23`, so **Android 6 and newer — Android 8 included**. Copy it to the phone by USB,
email or Drive, tap it, and allow installation from that app once. It opens as a normal app with its
own launcher icon; no browser chrome and no store account.

It is **debug-signed**, which is exactly what makes a sideloaded install work. A Play Store release
would need a keystore and a signing config, which this project does not ship.

`npm run toolchain` ([scripts/android-toolchain.sh](scripts/android-toolchain.sh)) fetches JDK 21 and
the Android SDK into `.android/` with **no administrator rights**; delete that folder afterwards to
reclaim ~2 GB, and the APK is unaffected. `npm run android:sync` alone re-copies a web build into the
native project.

#### Installable web app (Android and iPhone)

The same app installs straight from a browser. Browsers only offer installation from a **secure
origin**, so the trick on a real device is to make the device see the build at `localhost` — which is
a secure origin even over USB.

```bash
npm run build
npm run preview                    # serves dist on http://127.0.0.1:4173

# Android over USB, with adb (Android platform-tools) on the laptop:
adb reverse tcp:4173 tcp:4173      # the phone's localhost:4173 → the laptop's localhost:4173
# then open http://localhost:4173 in Chrome on the phone
```

- **Android (Chrome):** open that address → ⋮ menu → **Install app** (older builds word it *Add to Home
  screen*).
- **iPhone (Safari):** there is no `adb` equivalent, so host the build over HTTPS and open it in
  Safari → Share → **Add to Home Screen**.

A plain `http://192.168.x.x` LAN address opens and runs fine, but Chrome will not install from it and
the offline cache will not register. Either way, once it is on the phone it opens with no connection;
anything keyed with no signal is kept on the device and queued for when the connection returns.

`npm run verify:offline` asserts the web-app half against the built bundle.

### Demo sign-in

| Role | Username | Password |
| --- | --- | --- |
| Administrator | `admin` (or `registrar@iupc.academy`) | `iupc` |
| Teacher (Grace Wanjiru — Maths, Physics) | `g.wanjiru@iupc.academy` | `iupc` |
| Guest | "Preview as guest" button | — |

Seeded staff share the demo password. `j.odhiambo@iupc.academy` (Joseph Odhiambo) deliberately has
none: he stands for a teacher the registrar has just recorded, so he is the quickest way to try the
sign-up flow — open **Create your account** and use his address.

**Sign-up is invitation-only.** A teacher cannot create an account with an email the registrar has
not recorded first: type any other address and the form refuses it and keeps the submit button
disabled. Once the address is on the register, the teacher picks their own password there, and from
then on that password — not the demo one — opens their account. Teachers who forget a password are
cleared back to sign-up from **Reset sign-in** on their staff card.

`npm run verify:signup` drives all of that through the real pages.

## What is built

All twelve modules from §5 of the specification:

1. **Overview** — live status header, term scoping, exam progress, recent marks, score-code legend.
2. **Students** — searchable roster, admission form (numbered admission number, class, guardian, duplicate guard, save-and-add-another) and a per-student record with marks, position and conduct.
3. **Classes & Teachers** — streams with a live roster count, add-class dialog, per-stream admission shortcut, and a read-only staff snapshot that links to the register.
4. **Teachers** — the staff register: register a teacher from the top-menu button on any page, set the subjects they teach, review the permissions they hold, and remove a record (refused while the teacher still holds timetable lessons). Every account starts read-only; it sees only the records of the subjects assigned to it. Each card shows whether the account is active or still awaiting sign-up, with a sign-in reset for a forgotten password.
5. **Timetable** — a whole-school switchboard (every stream on a row, all five days across the header) that fits the week on one screen without sideways scrolling: cells are colour-coded by subject with a legend, and lessons are dragged to a new cell, swapped with the lesson already there, or picked up (grip / Move…) for touch and keyboard, with undo on every move. Plus a Detailed card view, class and teacher views, a **fully editable bell schedule** (period count, start/end times, and any number of named breaks, with times rippling down the day as you edit), 12-week rotation, week-only slots, clash detection, slot editor, an A3 master print, and A4 class/teacher sheets drawn like the school's stock forms — one 2 px frame, hairline rules, weekdays down the gutter, period numbers over their clock times, and BREAK/LUNCH as full-height vertical columns.
6. **Subjects** — syllabus codes, categories, teacher mapping.

All twelve modules install as a phone app and work with no connection, which is what the marks loop
needs in the field: the shell is served from the device cache, every write lands in a durable outbox
first, and a header pill reads `Offline · 7 waiting` → `Sending…` → `Synced`, with the queued records
listed by name and a **Sync now** action. See [DOCUMENTATION.md §5.13](DOCUMENTATION.md).

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
               offline.ts — outbox, connectivity, ordered flush, transport seam
  components/  ui.tsx (primitives) · permissions.tsx (grants) · SyncStatus.tsx (sync pill + queue)
               design tokens in index.css
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
npm run verify:offline    # installable manifest + icons, offline boot, offline capture, drain on reconnect
npm run verify:signup     # the sign-up gate: unregistered emails refused, chosen passwords enforced, reset
npm run icons             # regenerate the home-screen icons and the Android launcher/splash art
npm run apk               # build the installable Android APK (see "Install it on your phone")
```

`verify:offline` is the odd one out: it serves the production build on its own port (4178), because
the service worker only exists in a real build.

Last run: typecheck and build clean; master timetable 1 page (420×297 mm), class timetable 1 page (297×210 mm), broadsheet 2 pages (297×210 mm each), report card 1 page (210×297 mm), analytics 1 page (210×297 mm); **87/87** end-to-end checks pass; the Android APK builds and verifies as debug-signed with package `com.iupc.academy`, `minSdkVersion 23`, `targetSdkVersion 35` and the app's own files inside; **39/39** route/viewport combinations clean, with no console or network errors in the print run; **22/22** offline and installed-app checks pass — the app boots from cache with the network cut, records keyed offline survive reopening the app and drain to `Synced` on reconnect.

## Known limits

- No backend, no real authentication. Accounts are demo credentials hashed in the client; `localStorage` is the database. Do not deploy this as-is with real student data. The same applies to the permission model: `canEditExam()` is enforced in the browser, so the checks must move server-side with the `api` seam before marks are trustworthy.
- **The offline queue has nowhere to send to yet.** Records keyed offline are durable on the device and drain in order, but with no server (`VITE_SYNC_URL`) the transport acknowledges them locally and two devices never see each other's records — there is no conflict resolution between devices keyed on the same paper.
- **The APK is debug-signed and Android-only.** `npm run apk` produces a sideloadable debug APK; there is no Play Store listing and no iOS build (an `ios/` project would need a Mac with Xcode). A release APK or `.aab` needs a keystore and a signing config, which this project does not ship.
- The logo is IUPC's supplied artwork (`public/iupc-logo.png`), and `npm run icons` cuts everything the app ships from it: the favicon, the PWA icons, the Android launcher, adaptive and splash assets, plus `public/iupc-crest.png` (top-bar emblem) and `public/iupc-wordmark.png` (mastheads, sign-in). The emblem is lifted out by measurement — it is the tallest single ink shape in the artwork — not by a crop fraction, and the same pass keeps the app's crest and wordmark true to the source. The mark's dome is crimson and its figure black, so the icons keep the artwork's own white ground: on a crimson ground the dome would vanish into it. Mastheads carry IUPC's published details: campus at Off Mount Kenya Road, Nyali, Mombasa; official mail through P.O. Box 1468-00606, Nairobi; +254 788 175 518 / +254 768 334 453; info@iupceducation.com. Staff sign-in addresses still use the demo `@iupc.academy` domain.
- The Memon originals that set these formats are kept as reference material (not shipped assets): `reference/report/memon-report-card.docx` for the report card and `reference/broadsheets/` for the four photographed results sheets.
- Double periods are not modelled: a slot's key is `(day, period)`. Adding them changes that key to a span.
- Room clashes warn rather than block; only stream double-booking blocks a save.
