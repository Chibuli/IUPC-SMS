import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const BASE = 'http://127.0.0.1:5176'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 1000 })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function signIn(session) {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
  await page.evaluate((s) => {
    localStorage.setItem('iupc.session.v1', JSON.stringify(s))
  }, session)
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle0' })
}

async function clickByText(text) {
  return page.evaluate((label) => {
    const target = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim().includes(label))
    if (!target) return false
    target.click()
    return true
  }, text)
}

/** Sets a controlled input the way a real keystroke would, so React sees it. */
async function setField(selector, value) {
  return page.evaluate(
    (sel, val) => {
      const input = document.querySelector(sel)
      if (!input) return false
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set.call(input, val)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    },
    selector,
    value,
  )
}

async function waitForDialog(timeout = 5000) {
  await page.waitForFunction(() => Boolean(document.querySelector('[role="dialog"]')), { timeout })
}

/* ── 1. admin creates a timetable slot in a free cell ─────────────────── */
await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
await page.evaluate(() => localStorage.clear())
await signIn({ role: 'admin', name: 'Registrar' })

await page.goto(`${BASE}/dashboard/timetable`, { waitUntil: 'networkidle0' })
const before = await page.$$eval('button.slot', (nodes) => nodes.length)

const opened = await page.evaluate(() => {
  const free = document.querySelector('button.slot-empty')
  if (!free) return false
  free.click()
  return true
})
await wait(250)
const modalVisible = await page.evaluate(() => Boolean(document.querySelector('[role="dialog"]')))
check('free cell opens the slot editor', opened && modalVisible)

if (modalVisible) {
  await page.select('[role="dialog"] select:nth-of-type(1)', '').catch(() => {})
  const saved = await clickByText('Save slot')
  await wait(400)
  const after = await page.$$eval('button.slot', (nodes) => nodes.length)
  check('saving a slot adds it to the board', saved && after === before + 1, `${before} → ${after}`)

  const persisted = await page.evaluate(() => {
    const raw = localStorage.getItem('iupc.db.v1')
    if (!raw) return 0
    return JSON.parse(raw).timetableSlots.length
  })
  check('slot write persisted to storage', persisted > 0, `${persisted} rows`)
}

/* ── 2. duplicate booking is blocked by live validation ───────────────── */
const duplicateGuard = await page.evaluate(() => {
  const slot = document.querySelector('button.slot')
  if (!slot) return 'no slots'
  slot.click()
  return 'opened'
})
await wait(250)
if (duplicateGuard === 'opened') {
  // Walk every other period of the same stream until the guard trips.
  const guarded = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]')
    if (!dialog) return { ok: false }
    const periodSelect = dialog.querySelectorAll('select')[2] // class, day, period
    const saveButton = () =>
      [...dialog.querySelectorAll('button')].find((b) => b.textContent?.includes('Save slot'))
    for (const option of [...periodSelect.options]) {
      if (option.value === periodSelect.value) continue
      periodSelect.value = option.value
      periodSelect.dispatchEvent(new Event('change', { bubbles: true }))
      if (saveButton()?.disabled) {
        const alert = dialog.querySelector('[role="alert"]')?.textContent?.trim()
        return { ok: true, period: option.textContent, alert }
      }
    }
    return { ok: false }
  })
  await wait(150)
  check('duplicate stream booking disables save', guarded.ok, guarded.period ?? 'no occupied period found')
  await page.keyboard.press('Escape').catch(() => {})
  await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]')
    const close = dialog?.querySelector('button[aria-label="Close dialog"]')
    close?.click()
  })
}

/* ── 2b. the shell: navigation lives in a sticky top bar ──────────────── */
const shell = await page.evaluate(() => {
  const header = document.querySelector('header')
  const links = [...document.querySelectorAll('header nav a')]
  return {
    rail: Boolean(document.querySelector('aside')),
    header: header ? getComputedStyle(header).position : 'none',
    headerHeight: header ? Math.round(header.getBoundingClientRect().height) : 0,
    links: links.map((a) => a.textContent.trim()),
    active: document.querySelector('header nav a[aria-current="page"]')?.textContent.trim() ?? null,
    mainWidth: Math.round(document.querySelector('main').getBoundingClientRect().width),
    viewport: innerWidth,
  }
})
check(
  'navigation sits in a sticky top bar, not a side rail',
  !shell.rail &&
    shell.header === 'sticky' &&
    shell.links.length === 12 &&
    shell.links.includes('Analysis') &&
    shell.links.includes('Teachers') &&
    shell.active === 'Timetable',
  `${shell.header} · ${shell.headerHeight}px · active ${shell.active}`,
)
check(
  'the timetable page uses the whole window width',
  shell.mainWidth === shell.viewport,
  `${shell.mainWidth}px of ${shell.viewport}px`,
)

/* ── 2c. whole-school master board: drag to move, drop to swap, undo ──── */
await page.goto(`${BASE}/dashboard/timetable`, { waitUntil: 'networkidle0' })
const grid = await page.evaluate(() => {
  const scroller = document.querySelector('.card.overflow-auto')
  const days = [...document.querySelectorAll('th.master-day')]
  return {
    streams: document.querySelectorAll('table.master tbody tr').length,
    cells: document.querySelectorAll('td.master-cell').length,
    days: days.length,
    fits: scroller.scrollWidth <= scroller.clientWidth + 1,
    lastDayRight: Math.round(days[days.length - 1].getBoundingClientRect().right),
    viewport: innerWidth,
    coloured: document.querySelectorAll('table.master button.master-slot[style*="background"]').length,
  }
})
check(
  'whole-school board shows every stream and every period',
  grid.streams === 7 && grid.cells === grid.streams * 40 && grid.days === 5,
  `${grid.streams} streams · ${grid.cells} cells · ${grid.days} days`,
)
check(
  'all five days fit without horizontal scrolling',
  grid.fits && grid.lastDayRight <= grid.viewport,
  `${grid.lastDayRight}px of ${grid.viewport}px`,
)
check('every lesson carries its subject colour', grid.coloured >= 100, `${grid.coloured} coloured cells`)

// Pick-up has two entry points: the grip on a wide cell, the Move… button in
// the editor when the fitted cells are too narrow to hold a handle.
const pickedUp = await page.evaluate(() => {
  const card = document.querySelector('td[data-cell="c-y7|1|1"] button.slot')
  if (!card) return { ok: false }
  const name = card.innerText.split('\n')[0]
  // Read the subject off the stored slot rather than naming it here: which
  // syllabus the generator drops in a cell is not what this check is about.
  const slots = JSON.parse(localStorage.getItem('iupc.db.v1')).timetableSlots
  const origin = slots.find((s) => s.class_id === 'c-y7' && s.day === 1 && s.period === 1)
  card.click()
  return { ok: true, name, subject: origin?.subject_id ?? null }
})
await wait(250)
const moveButton = await page.evaluate(() => {
  const button = [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent?.includes('Move'))
  button?.click()
  return Boolean(button)
})
await wait(200)
const bannerShown = await page.evaluate(() => /Moving/.test(document.body.innerText))
await page.evaluate(() => document.querySelector('td[data-cell="c-y8|5|8"] button.slot-empty')?.click())
await wait(400)
const moved = await page.evaluate(() => {
  const slots = JSON.parse(localStorage.getItem('iupc.db.v1')).timetableSlots
  const from = slots.find((s) => s.class_id === 'c-y7' && s.day === 1 && s.period === 1)
  const to = slots.find((s) => s.class_id === 'c-y8' && s.day === 5 && s.period === 8)
  return {
    vacated: !from,
    landed: to?.subject_id ?? null,
    notice: document.querySelector('[role="status"]')?.innerText.replace(/\s+/g, ' ') ?? '',
  }
})
check(
  'picking a lesson up and placing it moves it across streams',
  pickedUp.ok && moveButton && bannerShown && moved.vacated && moved.landed !== null && moved.landed === pickedUp.subject,
  `${pickedUp.name} (${pickedUp.subject}) → ${moved.landed} · ${moved.notice.slice(0, 60)}`,
)

await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Undo'))?.click())
await wait(350)
const undone = await page.evaluate(() => {
  const slots = JSON.parse(localStorage.getItem('iupc.db.v1')).timetableSlots
  return {
    restored: slots.find((s) => s.class_id === 'c-y7' && s.day === 1 && s.period === 1)?.subject_id ?? null,
    vacatedAgain: !slots.some((s) => s.class_id === 'c-y8' && s.day === 5 && s.period === 8),
  }
})
check(
  'undo puts the lesson back',
  undone.restored === pickedUp.subject && undone.vacatedAgain,
  `restored ${undone.restored}, expected ${pickedUp.subject}`,
)

const beforeSwap = await page.evaluate(() => {
  const slots = JSON.parse(localStorage.getItem('iupc.db.v1')).timetableSlots
  const at = (day, period) =>
    slots.find((s) => s.class_id === 'c-y7' && s.day === day && s.period === period)?.subject_id ?? null
  return { p1: at(2, 1), p2: at(2, 2) }
})
await page.evaluate(() => {
  const card = document.querySelector('td[data-cell="c-y7|2|1"] button.slot')
  const target = document.querySelector('td[data-cell="c-y7|2|2"]')
  const transfer = new DataTransfer()
  card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
})
await wait(400)
const afterSwap = await page.evaluate(() => {
  const slots = JSON.parse(localStorage.getItem('iupc.db.v1')).timetableSlots
  return {
    p1: slots.find((s) => s.class_id === 'c-y7' && s.day === 2 && s.period === 1)?.subject_id,
    p2: slots.find((s) => s.class_id === 'c-y7' && s.day === 2 && s.period === 2)?.subject_id,
  }
})
check(
  'dropping a lesson on a taken cell swaps the two',
  beforeSwap.p1 !== null && afterSwap.p1 === beforeSwap.p2 && afterSwap.p2 === beforeSwap.p1,
  `${beforeSwap.p1}/${beforeSwap.p2} → ${afterSwap.p1}/${afterSwap.p2}`,
)

await page.evaluate(() =>
  [...document.querySelectorAll('[role="tab"]')].find((b) => b.textContent?.trim() === 'Detailed')?.click(),
)
await wait(400)
const detailed = await page.evaluate(() => {
  const scroller = document.querySelector('.card.overflow-auto')
  return {
    grips: document.querySelectorAll('.master-grip').length,
    scrolls: scroller.scrollWidth > scroller.clientWidth,
    compactCards: document.querySelectorAll('.master-slot--compact').length,
  }
})
check(
  'detailed mode brings back wide cards and grip handles',
  detailed.grips > 0 && detailed.compactCards === 0 && detailed.scrolls,
  `${detailed.grips} grips · ${detailed.compactCards} compact cards`,
)

/* ── 2d. class sheet: boxed grid with break and lunch running the height ── */
await page.goto(`${BASE}/dashboard/timetable?view=class`, { waitUntil: 'networkidle0' })
const classSheet = await page.evaluate(() => {
  const table = document.querySelector('.period-board')
  if (!table) return null
  const pauses = [...table.querySelectorAll('tbody td[rowspan]')].map((td) => ({
    label: td.innerText.trim().toUpperCase(),
    rows: Number(td.getAttribute('rowspan')),
    vertical: getComputedStyle(td.firstElementChild).writingMode.startsWith('vertical'),
  }))
  const headers = [...table.querySelectorAll('thead th')]
    .map((th) => th.innerText.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const firstRow = table.querySelector('tbody tr')
  return {
    border: getComputedStyle(table).borderTopWidth,
    headers,
    pauses,
    days: [...table.querySelectorAll('tbody th[scope="row"]')].map((th) => th.innerText.trim().split('\n')[0]),
    periodCells: [...firstRow.children].filter((cell) => !cell.hasAttribute('rowspan')).length,
    collapsed: getComputedStyle(table).borderCollapse,
  }
})
check(
  'class timetable is one boxed sheet with a heavy frame',
  classSheet?.border === '2px' && classSheet?.collapsed === 'collapse',
  `${classSheet?.border} ${classSheet?.collapsed}`,
)
check(
  'period numbers and their times run across the top',
  classSheet?.headers.filter((h) => /^\d/.test(h)).length === 8 && classSheet.headers.some((h) => h.includes('08:00')),
  classSheet?.headers.join(' | ') ?? 'no table',
)
check(
  'break and lunch are vertical columns spanning every day',
  classSheet?.pauses.length === 2 &&
    classSheet.pauses.every((pause) => pause.rows === classSheet.days.length && pause.vertical) &&
    classSheet.pauses.map((pause) => pause.label).join() === 'BREAK,LUNCH',
  JSON.stringify(classSheet?.pauses),
)
check(
  'each weekday is a row in the gutter',
  classSheet?.days.join() === 'Mo,Tu,We,Th,Fr',
  classSheet?.days.join(),
)

/* ── 3. mark entry autosaves and survives a reload ────────────────────── */
await page.goto(`${BASE}/dashboard/exams/ex-1/entry`, { waitUntil: 'networkidle0' })
const input = await page.$('input[aria-label^="Score for"]')
check('mark entry roster renders inputs', Boolean(input))
if (input) {
  const label = await page.evaluate((el) => el.getAttribute('aria-label'), input)
  await input.click()
  await page.keyboard.down('Control')
  await page.keyboard.press('KeyA')
  await page.keyboard.up('Control')
  await page.keyboard.press('Backspace')
  await input.type('77')
  const typedValue = await page.evaluate((el) => el.value, input)
  check('valid score is accepted in the field', typedValue === '77', `value=${typedValue}`)
  await page.keyboard.press('Tab')
  await wait(500)
  const savedFlash = await page.evaluate(() => document.body.innerText.includes('Saved'))
  check('blur saves the mark (Saved confirmation)', savedFlash)

  await page.reload({ waitUntil: 'networkidle0' })
  const value = await page.evaluate((aria) => {
    const el = document.querySelector(`input[aria-label="${aria}"]`)
    return el ? el.value : null
  }, label)
  check('mark persists across reload', value === '77', `value=${value}`)
}

/* ── 4. teacher RBAC: no settings, unassigned subject locked ──────────── */
await page.evaluate(() => localStorage.removeItem('iupc.session.v1'))
await signIn({ role: 'teacher', name: 'Peter Otieno', teacherId: 't-2' })

const sidebar = await page.evaluate(() => document.body.innerText)
check('teacher cannot see Settings', !sidebar.includes('Settings'))

await page.goto(`${BASE}/dashboard/exams/ex-1/entry`, { waitUntil: 'networkidle0' })
const locked = await page.evaluate(() => document.body.innerText)
check(
  'unassigned subject is read-only for teacher',
  /not assigned to your staff profile/i.test(locked),
  locked.includes('Read-only') ? 'banner present' : 'no banner',
)

/* ── 4a. holding a subject is not permission to write it ──────────────── */
await page.goto(`${BASE}/dashboard/exams/ex-2/entry`, { waitUntil: 'networkidle0' })
const ownSubject = await page.evaluate(() => {
  const el = document.querySelector('input[aria-label^="Score for"]')
  return { disabled: el ? el.disabled : null, text: document.body.innerText.replace(/\s+/g, ' ') }
})
check(
  'an assigned subject is still read-only without the grant',
  ownSubject.disabled === true && /not granted you mark-entry permission/i.test(ownSubject.text),
  ownSubject.text.slice(96, 190),
)

/* ── 4b. broadsheets give staff no editable cell ──────────────────────── */
await page.goto(`${BASE}/dashboard/reports`, { waitUntil: 'networkidle0' })
await page.select('.card select', 'Year 10')
await wait(300)
const broadsheet = await page.evaluate(() => {
  const sheet = document.querySelector('.sheet-broadsheet')
  return {
    badge: /Teacher view · read-only/i.test(document.body.innerText),
    notice: /never on a broadsheet/i.test(document.body.innerText),
    editable: sheet ? sheet.querySelectorAll('input, textarea, select, [contenteditable="true"]').length : -1,
    filters: document.querySelectorAll('.card select').length,
    // Year 10 sits English (0500), which is Peter's, and Mathematics (0580),
    // which is not: the sheet must show the first and omit the second.
    scoped: /0500/.test(sheet?.innerText ?? '') && !/0580/.test(sheet?.innerText ?? ''),
  }
})
check(
  'broadsheets give staff no editable cell',
  broadsheet.badge && broadsheet.notice && broadsheet.editable === 0 && broadsheet.filters >= 3,
  `${broadsheet.editable} editable nodes · ${broadsheet.filters} filter selects`,
)
check(
  'a broadsheet shows only the subjects the teacher holds',
  broadsheet.scoped,
  broadsheet.scoped ? 'English present, Mathematics absent' : 'subject scope leaked onto the sheet',
)

/* ── 4c. the register: register a teacher, read-only by default ───────── */
await page.evaluate(() => localStorage.removeItem('iupc.session.v1'))
await signIn({ role: 'admin', name: 'Registrar' })
await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle0' })
const headerButton = await page.evaluate(() =>
  [...document.querySelectorAll('header a')].some((a) => a.getAttribute('href') === '/dashboard/teachers?register=1'),
)
check('the top menu carries a register-teacher button', headerButton)

if (headerButton) await page.click('header a[href="/dashboard/teachers?register=1"]')
await waitForDialog()
const registerForm = await page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"]')
  return {
    title: dialog?.getAttribute('aria-label') ?? '',
    url: `${location.pathname}${location.search}`,
    staffNumber: dialog?.querySelector('[data-field="teacher-employee-id"]')?.value ?? '',
    ticked: [...dialog.querySelectorAll('[data-permission]')].filter((el) => el.checked).length,
    subjects: dialog?.querySelectorAll('[data-subject]').length ?? 0,
  }
})
check(
  'the top-menu button opens the register form',
  registerForm.title === 'Register teacher' && registerForm.url === '/dashboard/teachers' && registerForm.subjects === 23,
  `${registerForm.title} · ${registerForm.subjects} subjects offered`,
)
check(
  'the form pre-fills the next staff number and grants nothing',
  /^EMP-\d{3}$/.test(registerForm.staffNumber) && registerForm.ticked === 0,
  `${registerForm.staffNumber} · ${registerForm.ticked} permissions ticked`,
)

await setField('[data-field="teacher-name"]', 'Jane Kamau')
await setField('[data-field="teacher-email"]', 'g.wanjiru@iupc.academy')
await page.click('[data-action="save-teacher"]')
await wait(250)
const duplicate = await page.evaluate(() => document.querySelector('[role="dialog"] [role="alert"]')?.innerText ?? '')
check('a duplicate staff email is refused', /already signs in with/i.test(duplicate), duplicate)

await setField('[data-field="teacher-email"]', 'j.kamau@iupc.academy')
await page.click('[role="dialog"] [data-subject="sub-ls-glp"]')
await page.click('[role="dialog"] [data-subject="sub-eng"]')
await page.click('[data-action="save-teacher"]')
await wait(300)
const registered = await page.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('iupc.db.v1'))
  const teacher = db.teachers.find((t) => t.email === 'j.kamau@iupc.academy')
  const card = teacher ? document.querySelector(`[data-teacher="${teacher._id}"]`) : null
  return {
    stored: Boolean(teacher),
    permissions: teacher?.permissions.length ?? -1,
    subjects: teacher?.assigned_subject_ids.join() ?? '',
    initials: teacher?.initials ?? '',
    cardText: card?.innerText.replace(/\s+/g, ' ') ?? '',
    notice: document.querySelector('[role="status"]')?.innerText.replace(/\s+/g, ' ') ?? '',
    closed: !document.querySelector('[role="dialog"]'),
  }
})
check(
  'registering writes a read-only record with its subjects',
  registered.stored &&
    registered.permissions === 0 &&
    registered.subjects === 'sub-ls-glp,sub-eng' &&
    registered.initials === 'JK' &&
    registered.closed,
  `${registered.initials} · ${registered.subjects} · ${registered.permissions} permissions`,
)
check(
  'the register says the new account is read-only',
  /read-only account/i.test(registered.cardText) && /read-only account/i.test(registered.notice),
  registered.notice.slice(0, 84),
)

await page.select('[data-filter="access"]', 'entry')
await wait(200)
const byPermission = await page.evaluate(() => [...document.querySelectorAll('[data-teacher]')].map((el) => el.dataset.teacher))
check('staff can be filtered by the permission they hold', byPermission.join() === 't-1', byPermission.join() || 'none')
await page.select('[data-filter="access"]', 'all')
await setField('[data-field="staff-search"]', 'kamau')
await wait(200)
const searched = await page.evaluate(() => [...document.querySelectorAll('[data-teacher]')].map((el) => el.dataset.teacher))
check('the register can be searched by name', searched.length === 1 && !searched.includes('t-1'), searched.join())
await setField('[data-field="staff-search"]', '')

/* ── 4d. settings opens the whole permission list ─────────────────────── */
await page.goto(`${BASE}/dashboard/settings`, { waitUntil: 'networkidle0' })
const settingsText = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
check(
  'settings carries the teacher-permissions section',
  /Teacher permissions/i.test(settingsText) && /Open teacher permissions/.test(settingsText),
  'summary card present',
)

await page.click('[data-action="open-teacher-permissions"]')
await waitForDialog()
const panel = await page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"]')
  return {
    title: dialog?.getAttribute('aria-label') ?? '',
    rows: dialog?.querySelectorAll('[data-permission-row]').length ?? 0,
    entering: [...dialog.querySelectorAll('[data-permission="marks.enter"]')]
      .filter((el) => el.checked)
      .map((el) => el.closest('[data-permission-row]').dataset.permissionRow),
    windowField: Boolean(dialog?.querySelector('[data-field="marks-window"]')),
    windowValue: dialog?.querySelector('[data-field="marks-window"]')?.value ?? '',
    revokeAll: Boolean(dialog?.querySelector('[data-action="revoke-all"]')),
  }
})
check(
  'settings lists every teacher and the permissions they hold',
  panel.title === 'Teacher permissions' && panel.rows === 9 && panel.entering.join() === 't-1' && panel.revokeAll,
  `${panel.rows} teachers · ${panel.entering.join() || 'none'} may enter marks`,
)
check(
  'the panel carries the school-wide marks window, empty while none is set',
  panel.windowField && panel.windowValue === '',
  panel.windowField ? `field empty (${panel.windowValue || 'open'})` : 'field missing',
)

await page.click('[data-permission-row="t-2"] [data-permission="records.view_all_subjects"]')
await wait(200)
const widened = await page.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('iupc.db.v1'))
  const row = document.querySelector('[data-permission-row="t-2"]')
  return {
    stored: db.teachers.find((t) => t._id === 't-2').permissions,
    checked: row.querySelector('[data-permission="records.view_all_subjects"]')?.checked,
    text: row.innerText.replace(/\s+/g, ' '),
  }
})
check(
  'the registrar can add a permission',
  widened.stored.includes('records.view_all_subjects') && widened.checked && /all subjects/i.test(widened.text),
  widened.stored.join() || 'none',
)

const closedAt = await page.evaluate(() => {
  const date = new Date(Date.now() - 3600 * 1000)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
})
await setField('[data-field="marks-window"]', closedAt)
await page.click('[data-action="save-window"]')
await wait(300)
const closedWindow = await page.evaluate(() => JSON.parse(localStorage.getItem('iupc.db.v1')).markWindows[0].closes_at)
const windowCopy = await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText.replace(/\s+/g, ' ') ?? '')
check(
  'the registrar can close marks school-wide',
  Boolean(closedWindow) && new Date(closedWindow).getTime() < Date.now(),
  closedWindow ?? 'not saved',
)
check(
  'the panel reports the deadline it just set',
  /Papers without their own deadline close for teachers on/i.test(windowCopy),
  windowCopy.slice(0, 120),
)

/* ── 4e. the closed window turns a granted paper read-only ────────────── */
await page.evaluate(() => localStorage.removeItem('iupc.session.v1'))
await signIn({ role: 'teacher', name: 'Grace Wanjiru', teacherId: 't-1' })
await page.goto(`${BASE}/dashboard/exams/ex-1/entry`, { waitUntil: 'networkidle0' })
const afterClose = await page.evaluate(() => {
  const el = document.querySelector('input[aria-label^="Score for"]')
  return { disabled: el ? el.disabled : null, text: document.body.innerText.replace(/\s+/g, ' ') }
})
check(
  'the window closing turns a granted paper read-only',
  afterClose.disabled === true && /mark-entry window closed on/i.test(afterClose.text),
  afterClose.text.slice(0, 118),
)

/* ── 4f. add and reduce from the list ─────────────────────────────────── */
await page.evaluate(() => localStorage.removeItem('iupc.session.v1'))
await signIn({ role: 'admin', name: 'Registrar' })
await page.goto(`${BASE}/dashboard/settings`, { waitUntil: 'networkidle0' })
await page.click('[data-action="open-teacher-permissions"]')
await waitForDialog()
await page.click('[data-permission-row="t-1"] [data-permission="marks.after_deadline"]')
await wait(200)
const extended = await page.evaluate(
  () => JSON.parse(localStorage.getItem('iupc.db.v1')).teachers.find((t) => t._id === 't-1').permissions,
)
check(
  'the deadline extension is granted alongside entry',
  extended.join() === 'marks.enter,marks.after_deadline',
  extended.join(),
)

await page.click('[data-permission-row="t-1"] [data-permission="marks.enter"]')
await wait(200)
const reduced = await page.evaluate(
  () => JSON.parse(localStorage.getItem('iupc.db.v1')).teachers.find((t) => t._id === 't-1').permissions,
)
check('revoking marks entry also drops the extension', reduced.length === 0, reduced.join() || 'read-only')

await page.click('[data-permission-row="t-1"] [data-permission="marks.enter"]')
await wait(200)
await page.click('[data-action="clear-window"]')
await wait(300)
const restored = await page.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('iupc.db.v1'))
  return {
    permissions: db.teachers.find((t) => t._id === 't-1').permissions,
    closes: db.markWindows[0].closes_at,
  }
})
check(
  'the window reopens and entry is restored',
  restored.permissions.join() === 'marks.enter' && restored.closes === null,
  `${restored.permissions.join()} · window ${restored.closes ?? 'open'}`,
)

await page.click('[data-permission-row="t-2"] [data-permission="records.view_all_subjects"]')
await wait(200)
const narrowed = await page.evaluate(
  () => JSON.parse(localStorage.getItem('iupc.db.v1')).teachers.find((t) => t._id === 't-2').permissions,
)
check('the registrar can reduce a permission again', narrowed.length === 0, narrowed.join() || 'read-only')

/* ── 5. the granted teacher writes inside the open window ─────────────── */
await page.evaluate(() => localStorage.removeItem('iupc.session.v1'))
await signIn({ role: 'teacher', name: 'Grace Wanjiru', teacherId: 't-1' })
await page.goto(`${BASE}/dashboard/exams/ex-1/entry`, { waitUntil: 'networkidle0' })
const grantedEntry = await page.evaluate(() => {
  const el = document.querySelector('input[aria-label^="Score for"]')
  return el ? !el.disabled : false
})
check('a granted teacher edits their own subject inside the window', grantedEntry)

await page.goto(`${BASE}/dashboard/exams`, { waitUntil: 'networkidle0' })
const examList = await page.evaluate(() => ({
  path: location.pathname,
  subjects: [...document.querySelectorAll('[data-subject-option]')].map((button) => button.textContent.replace(/\s+/g, ' ').trim()),
}))
check('the old exam list hands over to Marks Entry', examList.path === '/dashboard/marks-entry', examList.path)
check(
  'the subject bar only offers the subjects the teacher holds',
  examList.subjects.length > 0 && examList.subjects.every((line) => /Mathematics/.test(line)),
  examList.subjects.join(' | ').slice(0, 90),
)

/* ── 5a. analytics honours the teacher's subject scope ────────────────── */
await page.evaluate(() => localStorage.removeItem('iupc.session.v1'))
await signIn({ role: 'teacher', name: 'Peter Otieno', teacherId: 't-2' })
await page.goto(`${BASE}/dashboard/analysis`, { waitUntil: 'networkidle0' })
const teacherAnalysis = await page.evaluate(() => ({
  options: [...document.querySelectorAll('[data-filter="subject"] option')].map((option) => option.textContent.trim()),
  subjects: document.querySelectorAll('[data-subject]').length,
  banner: /Scoped to your assigned subjects/i.test(document.body.innerText),
}))
check(
  "analytics is scoped to the teacher's assigned subjects",
  teacherAnalysis.options.some((option) => option.startsWith('English - First Language')) &&
    !teacherAnalysis.options.some((option) => option.startsWith('Mathematics')) &&
    teacherAnalysis.subjects === 3 &&
    teacherAnalysis.banner,
  `${teacherAnalysis.options.join(', ')} · ${teacherAnalysis.subjects} subject rows`,
)

/* ── 5b. admitting a student and adding a class ───────────────────────── */
await page.evaluate(() => localStorage.removeItem('iupc.session.v1'))
await signIn({ role: 'admin', name: 'Registrar' })

await page.goto(`${BASE}/dashboard/students`, { waitUntil: 'networkidle0' })
const addStudentVisible = await page.evaluate(() =>
  [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Add student'),
)
check('admin sees an Add student button on the roster', addStudentVisible)

await clickByText('Add student')
await wait(250)
const admissionDialog = await page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"]')
  return dialog
    ? {
        title: dialog.getAttribute('aria-label'),
        admission: dialog.querySelectorAll('input')[1]?.value ?? '',
        classes: [...dialog.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value.startsWith('c-')))?.options
          .length ?? 0,
      }
    : null
})
check(
  'Add student opens an admission form with a numbered admission number',
  admissionDialog?.title === 'Add student' && /^IUPC\/\d{4}\/\d{3}$/.test(admissionDialog.admission) && admissionDialog.classes > 1,
  `${admissionDialog?.admission} · ${admissionDialog?.classes} classes offered`,
)

await page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"]')
  const set = (el, value) => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const inputs = dialog.querySelectorAll('input')
  set(inputs[0], 'Amina Abdalla')
  set(inputs[2], '2012-04-18')
  set(inputs[3], 'Hassan Abdalla')
  set(inputs[4], '+254 711 234 567')
  const classPicker = [...dialog.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value.startsWith('c-')))
  set(classPicker, 'c-y8')
})
await wait(150)
await clickByText('Save student')
await wait(400)
const admitted = await page.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('iupc.db.v1'))
  const student = db.students.find((s) => s.full_name === 'Amina Abdalla' && s.class_id === 'c-y8')
  return {
    total: db.students.length,
    student: student ? { status: student.status, dob: student.date_of_birth, guardian: student.guardian_phone } : null,
    inTable: document.querySelector('table')?.innerText.includes('Amina Abdalla') ?? false,
    notice: document.querySelector('[role="status"]')?.innerText.replace(/\s+/g, ' ') ?? '',
    closed: !document.querySelector('[role="dialog"]'),
  }
})
check(
  'saving admits the student to the chosen stream',
  admitted.student?.status === 'Active' && admitted.student.guardian === '+254 711 234 567' && admitted.inTable && admitted.closed,
  `${admitted.total} on roll · ${admitted.notice.slice(0, 60)}`,
)

await clickByText('Add student')
await wait(250)
await page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"]')
  const set = (el, value) => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const existing = JSON.parse(localStorage.getItem('iupc.db.v1')).students[0].admission_number
  set(dialog.querySelectorAll('input')[0], 'Brian Barasa')
  set(dialog.querySelectorAll('input')[1], existing)
})
await wait(150)
await clickByText('Save student')
await wait(300)
const duplicateAdmission = await page.evaluate(() => ({
  alert: document.querySelector('[role="dialog"] [role="alert"]')?.innerText.trim() ?? null,
  total: JSON.parse(localStorage.getItem('iupc.db.v1')).students.length,
}))
check(
  'a reused admission number is refused',
  Boolean(duplicateAdmission.alert) && duplicateAdmission.total === admitted.total,
  duplicateAdmission.alert ?? 'no alert',
)
await page.evaluate(() => document.querySelector('[aria-label="Close dialog"]')?.click())
await wait(200)

await page.goto(`${BASE}/dashboard/classes`, { waitUntil: 'networkidle0' })
const addClassVisible = await page.evaluate(() =>
  [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Add class'),
)
check('admin sees an Add class button on the classes page', addClassVisible)

await clickByText('Add class')
await wait(250)
await page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"]')
  const set = (el, value) => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  set(dialog.querySelectorAll('input')[0], 'Form 4')
  set(dialog.querySelectorAll('input')[1], 'b')
})
await wait(150)
await clickByText('Save class')
await wait(400)
const classAdded = await page.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('iupc.db.v1'))
  return {
    streams: db.classes.filter((c) => c.class_name === 'Form 4').map((c) => c.stream_name),
    inList: document.body.innerText.includes('Form 4 B'),
    notice: document.querySelector('[role="status"]')?.innerText.replace(/\s+/g, ' ') ?? '',
  }
})
check(
  'saving adds the stream and lists it immediately',
  classAdded.streams.join() === 'B' && classAdded.inList,
  `${classAdded.streams.join()} · ${classAdded.notice.slice(0, 50)}`,
)

await clickByText('Add class')
await wait(250)
await page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"]')
  const set = (el, value) => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  set(dialog.querySelectorAll('input')[0], 'Form 4')
  set(dialog.querySelectorAll('input')[1], 'B')
})
await wait(150)
await clickByText('Save class')
await wait(300)
const duplicateStream = await page.evaluate(() => ({
  alert: document.querySelector('[role="dialog"] [role="alert"]')?.innerText.trim() ?? null,
  streams: JSON.parse(localStorage.getItem('iupc.db.v1')).classes.length,
}))
check(
  'a duplicate class and stream is refused',
  Boolean(duplicateStream.alert) && duplicateStream.streams === 8,
  duplicateStream.alert ?? 'no alert',
)
await page.evaluate(() => document.querySelector('[aria-label="Close dialog"]')?.click())
await wait(200)

const openedFromStream = await page.evaluate(() => {
  const row = [...document.querySelectorAll('li')].find((li) => li.innerText.includes('Form 4 B'))
  const button = [...(row?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.includes('Student'))
  button?.click()
  return Boolean(button)
})
await wait(500)
const presetAdmission = await page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"]')
  if (!dialog) return null
  const select = [...dialog.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value.startsWith('c-')))
  return { path: location.pathname, title: dialog.getAttribute('aria-label'), chosen: select?.selectedOptions[0]?.textContent ?? '' }
})
check(
  "a stream's Student button opens the register on that stream",
  openedFromStream && presetAdmission?.path === '/dashboard/students' && presetAdmission.chosen.trim() === 'Form 4 B',
  presetAdmission ? `${presetAdmission.title} · ${presetAdmission.chosen.trim()}` : 'no dialog',
)
await page.evaluate(() => document.querySelector('[aria-label="Close dialog"]')?.click())

/* ── 5c. report card remarks print blank for handwriting ──────────────── */
await page.goto(`${BASE}/dashboard/report-cards`, { waitUntil: 'networkidle0' })
await page.emulateMediaType('print')
await wait(300)
const remarks = await page.evaluate(() => {
  const sheet = document.querySelector('.sheet-report')
  const subjectRows = [...sheet.querySelectorAll('tbody tr')].filter((tr) => tr.children.length === 7)
  const areas = [...sheet.querySelectorAll('.write-area')]
  return {
    text: sheet.innerText.toUpperCase(),
    remarkCells: subjectRows.map((tr) => tr.children[5].innerText.trim()),
    areaCount: areas.length,
    ruled: areas.every((el) => getComputedStyle(el).backgroundImage !== 'none'),
    textareas: document.querySelectorAll('aside textarea').length,
    panelNote: /remarks are handwritten/i.test(document.querySelector('aside')?.textContent ?? ''),
  }
})
check(
  'report card prints no typed or auto-generated remarks',
  !/COURTEOUS|PROMISING TERM|WELL RESTED|EXCELLENT|NEEDS TO IMPROVE/.test(remarks.text),
  remarks.text.match(/COURTEOUS|PROMISING TERM|WELL RESTED|EXCELLENT|NEEDS TO IMPROVE/)?.[0] ?? 'nothing printed',
)
check(
  'the subject remark column prints blank',
  remarks.remarkCells.length > 0 && remarks.remarkCells.every((cell) => cell === ''),
  `${remarks.remarkCells.length} subject rows`,
)
check(
  'principal and HSE blocks print as ruled writing space',
  remarks.areaCount === 2 && remarks.ruled,
  `${remarks.areaCount} ruled blocks`,
)
check(
  'the editing panel no longer collects remarks',
  remarks.textareas === 0 && remarks.panelNote,
  `${remarks.textareas} textareas`,
)
await page.emulateMediaType('screen')

/* ── 5d. the school can rewrite its own day ────────────────────────────── */
await page.goto(`${BASE}/dashboard/timetable`, { waitUntil: 'networkidle0' })
const bellButton = await page.evaluate(() =>
  [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Periods'),
)
await clickByText('Periods')
await wait(300)
const bellDialog = await page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"]')
  if (!dialog) return null
  return {
    title: dialog.getAttribute('aria-label'),
    rows: dialog.querySelectorAll('input[inputmode="numeric"]').length / 2,
    breakNames: [...dialog.querySelectorAll('input[aria-label^="Break name"]')].map((input) => input.value),
  }
})
check(
  'admin opens the bell schedule with every period and break',
  bellButton &&
    bellDialog?.title === 'Periods & breaks' &&
    bellDialog.rows === 10 &&
    bellDialog.breakNames.join() === 'Break,Lunch',
  bellDialog ? `${bellDialog.rows} rows · ${bellDialog.breakNames.join('/')}` : 'no dialog',
)

// Lengthening a period ripples the rest of the day instead of overlapping it.
await page.evaluate(() => {
  const input = document.querySelector('[aria-label="End time, row 1"]')
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set.call(input, '08:45')
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
await wait(250)
const rippled = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[role="dialog"] input[inputmode="numeric"]')].map((input) => input.value)
  return { firstEnd: rows[1], secondStart: rows[2], secondEnd: rows[3] }
})
check(
  'editing a period time shifts the rest of the day',
  rippled.firstEnd === '08:45' && rippled.secondStart === '08:45' && rippled.secondEnd === '09:25',
  JSON.stringify(rippled),
)

await clickByText('Add period')
await wait(200)
await clickByText('Save schedule')
await wait(400)
const savedBell = await page.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('iupc.db.v1'))
  const entries = db.bellSchedules[0].entries
  return {
    lessons: entries.filter((entry) => entry.kind === 'lesson').length,
    firstEnd: entries[0].end,
    lastEnd: entries[entries.length - 1].end,
    columns: document.querySelectorAll('th.master-period').length / 5,
    closed: !document.querySelector('[role="dialog"]'),
    notice: document.querySelector('[role="status"]')?.innerText.replace(/\s+/g, ' ') ?? '',
  }
})
check(
  'a saved schedule adds the period to the board and to storage',
  savedBell.lessons === 9 && savedBell.firstEnd === '08:45' && savedBell.columns === 9 && savedBell.closed,
  `${savedBell.lessons} periods · ${savedBell.columns} columns · ends ${savedBell.lastEnd}`,
)

// Dropping an unused period is allowed; dropping one with lessons is refused.
await clickByText('Periods')
await wait(300)
await page.evaluate(() => document.querySelector('[aria-label="Remove period 9"]')?.click())
await wait(200)
await clickByText('Save schedule')
await wait(350)
const droppedPeriod = await page.evaluate(() => ({
  periods: JSON.parse(localStorage.getItem('iupc.db.v1')).bellSchedules[0].entries.filter((entry) => entry.kind === 'lesson').length,
  closed: !document.querySelector('[role="dialog"]'),
}))
check(
  'an unused period can be removed',
  droppedPeriod.periods === 8 && droppedPeriod.closed,
  `${droppedPeriod.periods} periods`,
)

await clickByText('Periods')
await wait(300)
await page.evaluate(() => document.querySelector('[aria-label="Remove period 8"]')?.click())
await wait(200)
await clickByText('Save schedule')
await wait(350)
const refusedBell = await page.evaluate(() => ({
  alert: document.querySelector('[role="dialog"] [role="alert"]')?.innerText.replace(/\s+/g, ' ') ?? null,
  open: Boolean(document.querySelector('[role="dialog"]')),
}))
check(
  'a period that still holds lessons cannot be removed',
  refusedBell.open && /periods you removed/i.test(refusedBell.alert ?? ''),
  refusedBell.alert ?? 'no alert',
)
await page.evaluate(() => document.querySelector('[role="dialog"] [aria-label="Close dialog"]')?.click())
await wait(200)

/* ── 5e. academic analytics: figures, filters, exports, print sheet ────── */
await page.goto(`${BASE}/dashboard/analysis`, { waitUntil: 'networkidle0' })

const expectedMetrics = await page.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('iupc.db.v1'))
  const term = db.terms.find((t) => t.is_active) ?? db.terms[0]
  const exams = db.exams.filter((exam) => exam.term_id === term._id)
  const examById = new Map(exams.map((exam) => [exam._id, exam]))
  const roster = db.students.filter((student) => student.status === 'Active' && exams.some((exam) => exam.class_id === student.class_id))
  const values = new Map()
  for (const mark of db.marks) {
    const exam = examById.get(mark.exam_id)
    if (!exam || typeof mark.score !== 'number') continue
    const list = values.get(mark.student_id) ?? []
    list.push((mark.score / exam.max_score) * 100)
    values.set(mark.student_id, list)
  }
  const means = roster
    .map((student) => values.get(student._id) ?? [])
    .filter((list) => list.length)
    .map((list) => list.reduce((sum, value) => sum + value, 0) / list.length)
  const average = means.reduce((sum, value) => sum + value, 0) / means.length
  const passMark = db.gradingScales[0].pass_mark
  let entered = 0
  let expected = 0
  for (const exam of exams) {
    const seats = roster.filter((student) => student.class_id === exam.class_id).length
    const marked = db.marks.filter((mark) => mark.exam_id === exam._id && mark.score !== null).length
    expected += seats
    entered += Math.min(marked, seats)
  }
  return {
    average: average.toFixed(1),
    atRisk: means.filter((value) => value < passMark).length,
    completion: Math.round((entered / expected) * 100),
    subjects: new Set(exams.map((exam) => exam.subject_id)).size,
    classes: new Set(exams.map((exam) => exam.class_id)).size,
  }
})

const analytics = await page.evaluate(() => {
  const metric = (key) => document.querySelector(`[data-metric="${key}"]`)?.innerText.replace(/\s+/g, ' ').trim() ?? ''
  const sheet = document.querySelector('[data-sheet="analysis"]')
  return {
    h1: document.querySelector('h1')?.textContent?.trim() ?? '',
    navActive: document.querySelector('header nav a[aria-current="page"]')?.textContent?.trim() ?? '',
    filters: [...document.querySelectorAll('[data-filter]')].map((el) => el.dataset.filter),
    termOptions: document.querySelectorAll('[data-filter="term"] option').length,
    average: metric('average'),
    completion: metric('completion'),
    topSubject: metric('top-subject'),
    atRisk: metric('at-risk'),
    values: Object.fromEntries(
      [...document.querySelectorAll('[data-metric]')].map((el) => [
        el.dataset.metric,
        el.querySelector('.display-figure')?.textContent?.trim() ?? '',
      ]),
    ),
    grades: [...document.querySelectorAll('[data-grade]')].map((el) => el.dataset.grade),
    subjects: document.querySelectorAll('[data-subject]').length,
    streams: document.querySelectorAll('[data-stream]').length,
    insights: document.querySelectorAll('[data-insight]').length,
    deltas: document.querySelectorAll('[data-module="subjects"] [title*="points vs"]').length,
    sheetHiddenOnScreen: sheet ? getComputedStyle(sheet).display === 'none' : null,
    pageName: document.body.dataset.page ?? null,
    sheetTables: sheet?.querySelectorAll('table').length ?? 0,
    sheetMasthead: /ACADEMIC ANALYTICS/i.test(sheet?.textContent ?? ''),
    hasButtons: ['Export CSV Analytics', 'Download PDF Report'].every((label) =>
      [...document.querySelectorAll('button')].some((button) => button.textContent?.includes(label)),
    ),
  }
})
check('analysis page loads with its title and three filters', analytics.h1 === 'Academic Analytics' && analytics.filters.join() === 'term,class,subject' && analytics.termOptions >= 2, `${analytics.filters.join('/')} · ${analytics.termOptions} terms`)
check('Analysis sits in the nav under Marks Entry and is marked current', analytics.navActive === 'Analysis')
check(
  'four KPI cards carry the scoped figures',
  analytics.values.average === `${expectedMetrics.average}%` &&
    analytics.values.completion === `${expectedMetrics.completion}%` &&
    analytics.values['at-risk'] === String(expectedMetrics.atRisk),
  `${analytics.values.average} · ${analytics.values.completion} · ${analytics.values['at-risk']} at risk (expected ${expectedMetrics.average}% · ${expectedMetrics.completion}% · ${expectedMetrics.atRisk})`,
)
check('KPI cards name the top subject and flag intervention', /[A-Za-z]/.test(analytics.topSubject) && analytics.topSubject.includes('%') && /Intervention|On track/.test(analytics.atRisk), analytics.topSubject.slice(0, 70))
check('term-on-term deltas are shown', analytics.average.includes('vs TERM 3') && analytics.deltas >= 1, `${analytics.deltas} subject deltas`)
check('grade distribution covers the scale plus ungraded students', analytics.grades.includes('A*') && analytics.grades.includes('U') && analytics.grades.includes('Z'), analytics.grades.join(','))
check('subject and stream modules match the scope', analytics.subjects === expectedMetrics.subjects && analytics.streams === expectedMetrics.classes, `${analytics.subjects} subjects · ${analytics.streams} streams`)
check('automated insights are generated from the marks', analytics.insights >= 3, `${analytics.insights} insights`)
check('export and PDF actions are offered', analytics.hasButtons)

// Filtering by subject narrows every module and the header scope.
await page.select('[data-filter="subject"]', 'sub-mat')
await wait(350)
const subjectFilter = await page.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('iupc.db.v1'))
  const term = db.terms.find((t) => t.is_active) ?? db.terms[0]
  const exams = db.exams.filter((exam) => exam.term_id === term._id && exam.subject_id === 'sub-mat')
  const roster = db.students.filter((student) => student.status === 'Active' && exams.some((exam) => exam.class_id === student.class_id))
  const values = new Map()
  for (const mark of db.marks) {
    const exam = exams.find((entry) => entry._id === mark.exam_id)
    if (!exam || typeof mark.score !== 'number') continue
    const list = values.get(mark.student_id) ?? []
    list.push((mark.score / exam.max_score) * 100)
    values.set(mark.student_id, list)
  }
  const means = roster
    .map((student) => values.get(student._id) ?? [])
    .filter((list) => list.length)
    .map((list) => list.reduce((sum, value) => sum + value, 0) / list.length)
  const average = means.reduce((sum, value) => sum + value, 0) / means.length
  return {
    average: average.toFixed(1),
    rows: document.querySelectorAll('[data-subject]').length,
    meta: document.querySelector('header')?.nextElementSibling?.innerText ?? document.body.innerText.slice(0, 600),
    metric: document.querySelector('[data-metric="average"]')?.innerText.replace(/\s+/g, ' ') ?? '',
  }
})
check('subject filter narrows the modules and the average', subjectFilter.rows === 1 && subjectFilter.metric.includes(`${subjectFilter.average}%`), `${subjectFilter.rows} subject row · ${subjectFilter.average}%`)

// Filtering by stream highlights that stream in the comparison table.
await page.select('[data-filter="class"]', 'c-y10')
await wait(350)
const classFilter = await page.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('iupc.db.v1'))
  const term = db.terms.find((t) => t.is_active) ?? db.terms[0]
  const exams = db.exams.filter((exam) => exam.term_id === term._id && exam.class_id === 'c-y10' && exam.subject_id === 'sub-mat')
  const roster = db.students.filter((student) => student.class_id === 'c-y10' && student.status === 'Active')
  const values = db.marks
    .filter((mark) => exams.some((exam) => exam._id === mark.exam_id) && typeof mark.score === 'number')
    .map((mark) => (mark.score / exams.find((exam) => exam._id === mark.exam_id).max_score) * 100)
  const average = values.length ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1) : '—'
  const highlighted = [...document.querySelectorAll('[data-stream]')].filter((el) => el.className.includes('bg-brass'))
  return {
    average,
    metric: document.querySelector('[data-metric="average"]')?.innerText.replace(/\s+/g, ' ') ?? '',
    highlighted: highlighted.map((el) => el.dataset.stream),
    rows: document.querySelectorAll('[data-stream]').length,
    roster: roster.length,
  }
})
check('stream filter highlights the chosen stream in the comparison', classFilter.highlighted.join() === 'c-y10' && classFilter.rows >= 2, `${classFilter.highlighted.join()} of ${classFilter.rows} rows`)
check('stream filter recomputes the campus average', classFilter.metric.includes(`${classFilter.average}%`), classFilter.average + '%')

// Reset restores the full scope.
await clickByText('Reset')
await wait(300)
const resetFilters = await page.evaluate(() => ({
  class: document.querySelector('[data-filter="class"]').value,
  subject: document.querySelector('[data-filter="subject"]').value,
  subjects: document.querySelectorAll('[data-subject]').length,
}))
check('reset restores all classes and subjects', resetFilters.class === 'all' && resetFilters.subject === 'all' && resetFilters.subjects === expectedMetrics.subjects, `${resetFilters.subjects} subject rows`)

// Print sheet: hidden on screen, A4 portrait in print, one masthead.
const printSheet = await page.evaluate(() => {
  const sheet = document.querySelector('[data-sheet="analysis"]')
  return {
    hidden: getComputedStyle(sheet).display === 'none',
    pageName: document.body.dataset.page,
    tables: sheet.querySelectorAll('table').length,
    masthead: /ACADEMIC ANALYTICS/i.test(sheet.textContent),
    scope: sheet.textContent.includes('TERM 1 2026/2027'),
  }
})
check('the PDF report is a print-only sheet with masthead and tables', printSheet.hidden && printSheet.pageName === 'analysis' && printSheet.tables >= 3 && printSheet.masthead && printSheet.scope, `${printSheet.tables} tables · page ${printSheet.pageName}`)

await page.evaluate(() => {
  window.__printed = false
  window.print = () => {
    window.__printed = true
  }
})
await page.evaluate(() => document.querySelector('[data-action="download-pdf"]')?.click())
check('Download PDF Report launches the print dialog', await page.evaluate(() => window.__printed === true))

// CSV export: the file lands on disk and carries every module.
const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iupc-analytics-'))
const client = await page.createCDPSession()
await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir })
await page.evaluate(() => document.querySelector('[data-action="export-csv"]')?.click())
await wait(700)
const csvFiles = fs.readdirSync(downloadDir).filter((file) => file.endsWith('.csv'))
const csvText = csvFiles.length ? fs.readFileSync(path.join(downloadDir, csvFiles[0]), 'utf8') : ''
fs.rmSync(downloadDir, { recursive: true, force: true })
check(
  'CSV export downloads the full analytics workbook',
  csvFiles.length === 1 &&
    /Campus average %/.test(csvText) &&
    /Grade,Students,Share %/.test(csvText) &&
    /Subject,Code,Category/.test(csvText) &&
    /Stream,Students,Average %/.test(csvText) &&
    /Insight/.test(csvText),
  csvFiles[0] ?? 'no file',
)

/* ── 5f. a teacher opens Marks Entry, sets the paper, and the sheet settles ── */
await page.evaluate(() => localStorage.removeItem('iupc.session.v1'))
await signIn({ role: 'teacher', name: 'Grace Wanjiru', teacherId: 't-1' })
await page.goto(`${BASE}/dashboard/marks-entry`, { waitUntil: 'networkidle0' })

// The whole action set the page opens with: exam type, subject, sort, term,
// class, the paper total, print preview and closing the page.
const bar = await page.evaluate(() => ({
  h1: document.querySelector('h1')?.textContent.trim() ?? '',
  types: [...document.querySelectorAll('[data-field="exam-type"] option')].map((option) => option.value),
  terms: document.querySelectorAll('[data-field="term"] option').length,
  classes: document.querySelectorAll('[data-field="class"] option').length,
  sorts: [...document.querySelectorAll('[data-sort]')].map((button) => button.textContent.trim()),
  actions: [...document.querySelectorAll('[data-action]')].map((button) => button.dataset.action),
  outOf: document.querySelector('[data-field="paper-out"]')?.value ?? '',
}))
check(
  'Marks Entry opens on the paper bar — type, term, class, sort, total and both actions',
  bar.h1 === 'Marks Entry' &&
    bar.types.join() === 'CAT 1,CAT 2,Midterm,Endterm,Pre-Mock' &&
    bar.terms >= 2 &&
    bar.classes >= 7 &&
    bar.sorts.join() === 'Adm no.,Name,Gender' &&
    bar.actions.includes('print-preview') &&
    bar.actions.includes('close-page') &&
    Number(bar.outOf) > 0,
  `${bar.types.join('/')} · ${bar.classes} classes · ${bar.actions.join('/')} · out of ${bar.outOf}`,
)

// The subject button is a search over the subjects this account may pick.
await page.type('[data-field="subject-search"]', '0862')
await wait(250)
const subjectMatches = await page.evaluate(() =>
  [...document.querySelectorAll('[data-subject-option]')].map((button) => button.textContent.replace(/\s+/g, ' ').trim()),
)
check(
  'the subject bar filters as a name or Cambridge code is typed',
  subjectMatches.length === 1 && /Mathematics/.test(subjectMatches[0]) && /0862/.test(subjectMatches[0]),
  subjectMatches.join(' | '),
)

await page.click('[data-subject-option="sub-ls-mat"]')
await wait(150)
await page.click('[data-field="subject-search"]', { clickCount: 3 })
await page.keyboard.press('Backspace')
await wait(150)
await page.select('[data-field="exam-type"]', 'CAT 2')
await wait(120)
await page.select('[data-field="class"]', 'c-y8')
await wait(120)
await setField('[data-field="paper-out"]', '50')
await page.evaluate(() => document.querySelector('[data-field="paper-out"]').blur())
await wait(300)

const paperBar = await page.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('iupc.db.v1'))
  return {
    type: document.querySelector('[data-field="exam-type"]').value,
    cls: document.querySelector('[data-field="class"]').selectedOptions[0].textContent.trim(),
    subject: document.querySelector('[data-subject-picked]').textContent.replace(/\s+/g, ' ').trim(),
    hint: document.querySelector('[data-total-hint]').textContent.replace(/\s+/g, ' ').trim(),
    papers: db.exams.filter((e) => e.exam_type === 'CAT 2' && e.class_id === 'c-y8').length,
  }
})
check(
  'class, subject and the paper total drive the bar',
  paperBar.type === 'CAT 2' &&
    /Year 8/.test(paperBar.cls) &&
    /Mathematics · 0862/.test(paperBar.subject) &&
    /2\.0%/.test(paperBar.hint),
  `${paperBar.cls} · ${paperBar.subject} · ${paperBar.hint}`,
)
check(
  'nothing is recorded until a result is keyed in',
  paperBar.papers === 0,
  `${paperBar.papers} recorded CAT 2 papers for Year 8`,
)

const catEntry = await page.evaluate(() => ({
  rows: document.querySelectorAll('input[aria-label^="Score for"]').length,
  roster: JSON.parse(localStorage.getItem('iupc.db.v1')).students.filter((s) => s.class_id === 'c-y8' && s.status === 'Active').length,
  missing: Number(document.querySelector('[data-missing]')?.getAttribute('data-missing') ?? -1),
  names: document.querySelector('[data-missing]')?.innerText.replace(/\s+/g, ' ').slice(0, 90) ?? '',
}))
check(
  'the register lists the class and warns about every result not entered yet',
  catEntry.rows === catEntry.roster && catEntry.missing === catEntry.roster && /not entered/i.test(catEntry.names),
  `${catEntry.rows} rows · ${catEntry.missing} missing`,
)

// One mark, then the percentage column has a number to show.
await page.click('input[aria-label^="Score for"]')
await page.type('input[aria-label^="Score for"]', '40')
await page.keyboard.press('Tab')
await wait(500)
const livePercent = await page.evaluate(() => ({
  percent: document.querySelector('[data-percent]')?.textContent.trim(),
  // 40 on a paper out of 50 is 80% — an A. Grading the raw 40 would say E.
  grade: document.querySelectorAll('tbody tr')[0]?.querySelectorAll('td')[5]?.textContent.trim(),
  counter: document.body.innerText.match(/\b1\/(\d+) entered/)?.[1] ?? null,
}))
check(
  'a score is converted to a percentage and graded from it',
  livePercent.percent === '80.0%' && livePercent.grade === 'A' && livePercent.counter === String(catEntry.roster),
  `40/50 = ${livePercent.percent} · grade ${livePercent.grade} · 1/${livePercent.counter} entered`,
)

const recordedPaper = await page.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('iupc.db.v1'))
  const paper = db.exams.find((e) => e.exam_type === 'CAT 2' && e.class_id === 'c-y8')
  return paper ? { subject: paper.subject_id, term: paper.term_id, max: paper.max_score } : null
})
check(
  'the first result records the paper at the total the teacher set',
  recordedPaper?.subject === 'sub-ls-mat' && recordedPaper?.term === 'term-1' && recordedPaper?.max === 50,
  JSON.stringify(recordedPaper),
)

// A rejected draft never reads as a percentage or a grade, and tabbing through
// untouched rows must not invent marks.
const catExamId = await page.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('iupc.db.v1'))
  return db.exams.find((e) => e.exam_type === 'CAT 2' && e.class_id === 'c-y8')?._id ?? null
})
const rowsBefore = await page.evaluate(
  (id) => JSON.parse(localStorage.getItem('iupc.db.v1')).marks.filter((m) => m.exam_id === id).length,
  catExamId,
)
const second = (await page.$$('input[aria-label^="Score for"]'))[1]
await second.click()
await page.keyboard.press('Tab')
await wait(400)
const blankBlur = await page.evaluate(
  (id) => ({
    marks: JSON.parse(localStorage.getItem('iupc.db.v1')).marks.filter((m) => m.exam_id === id).length,
    secondStatus: document.querySelectorAll('tbody tr')[1]?.lastElementChild?.textContent.trim(),
  }),
  catExamId,
)
check(
  'tabbing past an empty row saves nothing',
  blankBlur.marks === rowsBefore && blankBlur.secondStatus === 'Pending',
  `${blankBlur.marks} marks · row 2 ${blankBlur.secondStatus}`,
)

await second.click()
await page.keyboard.type('999')
await page.keyboard.press('Tab')
await wait(400)
const rejected = await page.evaluate(() => {
  const row = document.querySelectorAll('tbody tr')[1]
  const cells = [...row.querySelectorAll('td')]
  return {
    percent: cells[4].textContent.trim(),
    grade: cells[5].textContent.trim(),
    status: cells[6].textContent.trim(),
    error: /Score must be between 0 and 50/.test(row.textContent),
  }
})
check(
  'an out-of-range score is refused rather than graded',
  rejected.percent === '—' && rejected.grade === '—' && rejected.status === 'Rejected' && rejected.error,
  `${rejected.percent} · ${rejected.grade} · ${rejected.status}`,
)

// Sorting reorders the register without losing the marks already keyed in.
const sortNames = async () =>
  page.$$eval('tbody tr td:nth-child(3) p:first-child', (nodes) => nodes.map((n) => n.textContent.trim()))
await page.click('[data-sort="name"]')
await wait(250)
const byName = await sortNames()
await page.click('[data-sort="gender"]')
await wait(250)
const byGender = await page.evaluate(() =>
  [...document.querySelectorAll('tbody tr td:nth-child(3) p:last-child')].map((n) => n.textContent.trim()),
)
await page.click('[data-sort="adm"]')
await wait(250)
const byAdm = await sortNames()
const expected = await page.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('iupc.db.v1'))
  const roster = db.students.filter((s) => s.class_id === 'c-y8' && s.status === 'Active')
  return {
    name: [...roster].sort((a, b) => a.full_name.localeCompare(b.full_name)).map((s) => s.full_name),
    adm: [...roster].sort((a, b) => a.admission_number.localeCompare(b.admission_number)).map((s) => s.full_name),
  }
})
check(
  'the register sorts by name, admission number and gender',
  byName.join() === expected.name.join() &&
    byAdm.join() === expected.adm.join() &&
    byGender.join() === [...byGender].sort().join(),
  `name ${byName[0]} · adm ${byAdm[0]} · gender ${byGender.slice(0, 3).join('/')}`,
)

await page.evaluate(() => {
  window.__printed = false
  window.print = () => {
    window.__printed = true
  }
})
await page.click('[data-action="print-preview"]')
check('Print preview opens the mark sheet', await page.evaluate(() => window.__printed === true))

// Leaving the page settles the blanks as X, which the paper then carries.
await page.click('[data-action="close-page"]')
await wait(1000)
const settled = await page.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('iupc.db.v1'))
  const paper = [...db.exams].filter((e) => e.exam_type === 'CAT 2' && e.class_id === 'c-y8').pop()
  const marks = paper ? db.marks.filter((m) => m.exam_id === paper._id) : []
  return {
    at: location.pathname,
    roster: db.students.filter((s) => s.class_id === 'c-y8' && s.status === 'Active').length,
    total: marks.length,
    xs: marks.filter((m) => m.score === 'X').length,
    scored: marks.filter((m) => typeof m.score === 'number').map((m) => m.score),
  }
})
check(
  'close page leaves the sheet and records the missing results as X',
  settled.at === '/dashboard' &&
    settled.total === settled.roster &&
    settled.xs === settled.roster - 1 &&
    settled.scored.join() === '40',
  `${settled.total} marks · ${settled.xs} X · ${settled.scored.join(',') || 'no scores'}`,
)

// Coming back to the same choices finds the paper that was recorded.
await page.goto(`${BASE}/dashboard/marks-entry`, { waitUntil: 'networkidle0' })
await page.select('[data-field="exam-type"]', 'CAT 2')
await wait(120)
await page.select('[data-field="class"]', 'c-y8')
await wait(120)
await page.click('[data-subject-option="sub-ls-mat"]')
await wait(250)
const reopened = await page.evaluate(() => {
  const counter = document.querySelector('[data-register-count]')?.textContent.replace(/\s+/g, ' ').trim() ?? ''
  const entered = counter.match(/(\d+)\/(\d+) entered/)
  return {
    percent: document.querySelector('[data-percent]')?.textContent.trim() ?? '',
    counter,
    complete: Boolean(entered) && entered[1] === entered[2] && Number(entered[1]) > 0,
    recorded: /Recorded paper/.test(document.body.innerText),
  }
})
check(
  'the bar finds a paper that was already recorded, marks and all',
  reopened.percent === '80.0%' && reopened.complete && reopened.recorded,
  `${reopened.percent} · ${reopened.counter}`,
)

/* ── 6. guest is read-only ─────────────────────────────────────────────── */
await page.evaluate(() => localStorage.removeItem('iupc.session.v1'))
await signIn({ role: 'guest', name: 'Guest' })
await page.goto(`${BASE}/dashboard/timetable`, { waitUntil: 'networkidle0' })
const guest = await page.evaluate(() => ({
  createSlot: [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('Create slot')),
  text: /Guests can browse and print, but not edit the board/i.test(document.body.innerText),
  grips: document.querySelectorAll('.master-grip').length,
  draggable: [...document.querySelectorAll('button.master-slot')].some((b) => b.draggable),
  freeDisabled: [...document.querySelectorAll('button.slot-empty')].every((b) => b.disabled),
}))
check('guest cannot pick lessons up', guest.grips === 0 && !guest.draggable && guest.freeDisabled, `${guest.grips} grips`)
check('guest sees no create controls', guest.createSlot === false)

await page.goto(`${BASE}/dashboard/students`, { waitUntil: 'networkidle0' })
const guestAdmit = await page.evaluate(() =>
  [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Add student'),
)
await page.goto(`${BASE}/dashboard/classes`, { waitUntil: 'networkidle0' })
const guestAddClass = await page.evaluate(() =>
  [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Add class'),
)
check('guest cannot admit students or add classes', !guestAdmit && !guestAddClass)
await page.goto(`${BASE}/dashboard/timetable`, { waitUntil: 'networkidle0' })
const guestPeriods = await page.evaluate(() =>
  [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Periods'),
)
check('guest cannot re-time the school day', !guestPeriods)
check('guest is told the board is read-only', guest.text)

/* ── 7. the Cambridge catalogue: official codes, offered separately ────── */
await signIn({ role: 'admin', name: 'Registrar' })
await page.goto(`${BASE}/dashboard/subjects`, { waitUntil: 'networkidle0' })
const catalogue = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('[data-subject]')]
  const sections = [...document.querySelectorAll('[data-level]')].map(
    (el) => `${el.dataset.level}=${el.querySelectorAll('[data-subject]').length}`,
  )
  const offered = [...document.querySelectorAll('[data-action="toggle-offered"]')].filter(
    (b) => b.getAttribute('aria-pressed') === 'true',
  ).length
  const codes = cards.map((card) => card.querySelector('.font-mono')?.textContent?.trim() ?? '')
  return {
    cards: cards.length,
    sections,
    offered,
    allCodesNumeric: codes.every((code) => /^\d{4}$/.test(code)),
    legacy: /MA-4024|EN-0500|KI-3130|CS-0417/.test(document.body.innerText),
    meta: document.querySelector('main header')?.innerText.replace(/\s+/g, ' ') ?? '',
    text: document.body.innerText,
  }
})
check(
  'the catalogue carries every Cambridge syllabus with a real code',
  catalogue.cards === 212 && catalogue.allCodesNumeric && !catalogue.legacy,
  `${catalogue.cards} subjects · all codes 4-digit: ${catalogue.allCodesNumeric} · legacy codes present: ${catalogue.legacy}`,
)
check(
  'the catalogue is grouped by syllabus level',
  catalogue.sections.length === 4 && catalogue.sections.every((entry) => /^(Lower Secondary|IGCSE|O Level|AS & A Level)=\d+$/.test(entry)),
  catalogue.sections.join(' · '),
)
check(
  'twenty-three syllabuses are offered and the rest sit in the catalogue',
  catalogue.offered === 23 && /23 offered · 212 in the catalogue/.test(catalogue.meta),
  `${catalogue.offered} offered · ${catalogue.meta.slice(0, 60)}`,
)

await setField('[data-field="subject-search"]', '0580')
await wait(300)
const searchResult = await page.evaluate(() => ({
  rows: [...document.querySelectorAll('[data-subject]')].map((el) => el.innerText.replace(/\s+/g, ' ')),
}))
check(
  'searching the catalogue matches a syllabus code',
  searchResult.rows.length === 1 && /0580/.test(searchResult.rows[0]) && /Mathematics/.test(searchResult.rows[0]),
  searchResult.rows.join(' | ').slice(0, 80),
)

// Offering a catalogue subject adds it to the paper picker.
await setField('[data-field="subject-search"]', 'Agriculture')
await wait(300)
await page.evaluate(() => document.querySelector('[data-subject="sub-igcse-0600"] [data-action="toggle-offered"]')?.click())
await wait(350)
await page.goto(`${BASE}/dashboard/marks-entry`, { waitUntil: 'networkidle0' })
const pickerCodes = await page.evaluate(() =>
  [...document.querySelectorAll('[data-subject-option]')]
    .map((button) => button.textContent.replace(/\s+/g, ' ').trim())
    .join(' | '),
)
check(
  'offering a subject adds it to the marks-entry subject bar with its code',
  /Agriculture\s*0600/.test(pickerCodes) && /Computer Science\s*0478/.test(pickerCodes),
  pickerCodes.slice(0, 140),
)

/* ── 8. the end-of-term performance deck ──────────────────────────────── */
await page.goto(`${BASE}/dashboard/analysis`, { waitUntil: 'networkidle0' })
await wait(400)
const deck = await page.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('iupc.db.v1'))
  const slides = [...document.querySelectorAll('[data-deck="performance"] .deck-slide')]
  const barValues = [...(slides[3]?.querySelectorAll('.deck-bar') ?? [])].map((bar) => ({
    height: Math.round(Number.parseFloat(bar.style.height)),
    label: Number.parseInt(bar.parentElement?.querySelector('span')?.textContent ?? '', 10),
  }))

  // Recompute the closing term's stream means the same way the deck must.
  const terms = [...db.terms]
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
    .filter((term) =>
      db.exams.some(
        (exam) => exam.term_id === term._id && db.marks.some((mark) => mark.exam_id === exam._id && typeof mark.score === 'number'),
      ),
  )
  const closing = terms[terms.length - 1]
  const means = new Map()
  for (const exam of db.exams.filter((entry) => entry.term_id === closing._id)) {
    for (const mark of db.marks.filter((entry) => entry.exam_id === exam._id && typeof entry.score === 'number')) {
      const list = means.get(exam.class_id) ?? []
      list.push((mark.score / exam.max_score) * 100)
      means.set(exam.class_id, list)
    }
  }
  const ranked = [...means.entries()]
    .map(([classId, values]) => ({ classId, mean: values.reduce((a, b) => a + b, 0) / values.length }))
    .sort((a, b) => b.mean - a.mean)
  const shortCode = (classId) => {
    const cls = db.classes.find((entry) => entry._id === classId)
    return `${cls.class_name.match(/\d+/)?.[0] ?? ''}${(cls.stream_name.match(/[A-Za-z]/)?.[0] ?? '').toUpperCase()}`
  }
  const years = new Set(
    db.classes.filter((cls) => db.exams.some((exam) => exam.class_id === cls._id)).map((cls) => cls.class_name),
  )
  const tile = (label) => document.querySelector(`[data-deck-tile="${label}"]`)?.innerText.replace(/\s+/g, ' ') ?? ''

  return {
    slides: slides.length,
    years: years.size,
    expectedSlides: 6 + 2 * years.size,
    titles: slides.map((slide) => slide.querySelector('h3')?.textContent ?? ''),
    tiles: [...document.querySelectorAll('[data-deck-tile]')].map((el) => el.dataset.deckTile),
    bestTile: tile('Best stream'),
    expectedBest: ranked[0] ? { short: shortCode(ranked[0].classId), mean: ranked[0].mean } : null,
    closingName: closing?.name ?? '',
    visible: slides.filter((slide) => getComputedStyle(slide).display !== 'none').length,
    counter: document.querySelector('[data-deck-counter]')?.textContent ?? '',
    barValues,
    recommendations: document.querySelectorAll('[data-deck-recommendation]').length,
    overflow: slides
      .filter((slide) => slide.scrollHeight > slide.clientHeight + 2 || slide.scrollWidth > slide.clientWidth + 2)
      .map((slide) => `${slide.dataset.slide}:${slide.scrollHeight}/${slide.clientHeight}`),
    footers: slides.slice(1, 3).map((slide) => slide.querySelector('.deck-foot')?.textContent ?? ''),
  }
})
check(
  'the deck closes the analytics page with a cover, sections and a conclusion',
  deck.slides === deck.expectedSlides &&
    deck.titles[0] === 'All examined subjects' &&
    deck.titles[1] === 'What this report covers' &&
    deck.titles.includes('Priority strategies for the coming term') &&
    deck.titles.includes('Summary and way forward') &&
    deck.titles.filter((title) => /performance trend$/.test(title)).length === deck.years,
  `${deck.slides} slides (${deck.years} year groups) · ${deck.titles.slice(0, 4).join(' / ')}`,
)
check(
  'headline tiles rank on the closing term alone',
  deck.tiles.length === 5 &&
    deck.expectedBest !== null &&
    deck.bestTile.includes(deck.expectedBest.short) &&
    deck.bestTile.includes(deck.expectedBest.mean.toFixed(1)) &&
    deck.bestTile.includes(deck.closingName),
  `${deck.bestTile} · computed ${deck.expectedBest?.short} ${deck.expectedBest?.mean.toFixed(1)}%`,
)
check(
  'the deck charts draw each bar at the value it labels',
  deck.barValues.length > 0 && deck.barValues.every((bar) => Math.abs(bar.height - bar.label) <= 1),
  `${deck.barValues.length} bars · ${deck.barValues.slice(0, 4).map((b) => `${b.label}@${b.height}`).join(' ')}`,
)
check(
  'one slide shows at a time and the counter tracks it',
  deck.visible === 1 && deck.counter.startsWith('1 /'),
  `${deck.visible} visible · ${deck.counter}`,
)
check(
  'every slide fits its canvas',
  deck.overflow.length === 0,
  deck.overflow.length ? deck.overflow.join(', ') : `${deck.slides} slides measured`,
)
check(
  'the deck footers name the scope and the terms it covers',
  deck.footers.every((line) => /PERFORMANCE ANALYSIS/i.test(line) && /TERM/i.test(line)),
  deck.footers[0]?.slice(0, 90) ?? '',
)

// Paging: buttons and arrow keys both move one slide at a time.
await page.click('[data-action="deck-next"]')
await page.click('[data-action="deck-next"]')
await wait(250)
const afterNext = await page.evaluate(() => document.querySelector('[data-deck-counter]')?.textContent ?? '')
await page.focus('[data-deck="performance"] [role="region"]')
await page.keyboard.press('ArrowLeft')
await wait(200)
const afterLeft = await page.evaluate(() => document.querySelector('[data-deck-counter]')?.textContent ?? '')
await page.keyboard.press('End')
await wait(200)
const atEnd = await page.evaluate(() => ({
  counter: document.querySelector('[data-deck-counter]')?.textContent ?? '',
  nextDisabled: document.querySelector('[data-action="deck-next"]')?.disabled ?? null,
}))
check(
  'buttons and arrow keys page one slide at a time',
  afterNext.startsWith('3 /') && afterLeft.startsWith('2 /') && atEnd.counter.startsWith(`${deck.slides} /`) && atEnd.nextDisabled === true,
  `${afterNext} → ${afterLeft} → ${atEnd.counter}`,
)

// The print route stacks the deck: one slide per landscape page.
await page.goto(`${BASE}/dashboard/analysis?deck=print`, { waitUntil: 'networkidle0' })
await wait(400)
await page.emulateMediaType('print')
await wait(300)
const deckPrint = await page.evaluate(() => {
  const slides = [...document.querySelectorAll('.deck-slide')]
  const first = getComputedStyle(slides[0])
  return {
    page: document.body.dataset.page ?? '',
    visible: slides.filter((slide) => getComputedStyle(slide).display !== 'none').length,
    breakAfter: first.breakAfter || first.pageBreakAfter,
    sheet: getComputedStyle(document.querySelector('[data-sheet="analysis"]')).display,
    nav: getComputedStyle(document.querySelector('.deck-nav')).display,
  }
})
await page.emulateMediaType('screen')
await page.goto(`${BASE}/dashboard/analysis`, { waitUntil: 'networkidle0' })
check(
  'printing the deck gives one slide per page',
  deckPrint.page === 'deck' &&
    deckPrint.visible === deck.slides &&
    deckPrint.breakAfter === 'page' &&
    deckPrint.sheet === 'none' &&
    deckPrint.nav === 'none',
  `${deckPrint.visible} slides on page "${deckPrint.page}" · break ${deckPrint.breakAfter} · sheet ${deckPrint.sheet}`,
)

// The deck follows the class and subject filters.
await wait(300)
await page.select('[data-filter="class"]', 'c-y10')
await wait(400)
const scopedDeck = await page.evaluate(() => ({
  streams: document.querySelectorAll('[data-deck-insight]').length,
  cover: document.querySelector('[data-deck="performance"] .deck-slide h3')?.textContent ?? '',
  foot: document.querySelector('[data-deck="performance"] .deck-slide .deck-foot')?.textContent ?? '',
}))
check(
  'the deck re-scopes to the filtered stream',
  scopedDeck.streams === 1 && /Year 10 A/.test(scopedDeck.foot),
  `${scopedDeck.streams} stream · ${scopedDeck.foot.slice(0, 70)}`,
)

// A teacher's deck stays inside their subject scope.
await page.evaluate(() => localStorage.removeItem('iupc.session.v1'))
await signIn({ role: 'teacher', name: 'Peter Otieno', teacherId: 't-2' })
await page.goto(`${BASE}/dashboard/analysis`, { waitUntil: 'networkidle0' })
await wait(350)
await page.select('[data-filter="subject"]', 'sub-eng')
await wait(400)
const teacherDeck = await page.evaluate(() => ({
  cover: document.querySelector('[data-deck="performance"] .deck-slide h3')?.textContent ?? '',
  slides: document.querySelectorAll('[data-deck="performance"] .deck-slide').length,
  options: [...document.querySelectorAll('[data-filter="subject"] option')].map((option) => option.textContent.trim()),
}))
check(
  "a teacher's deck is scoped to their subject",
  /English - First Language 0500/.test(teacherDeck.cover) &&
    // One subject covers fewer year groups than the whole school, so its deck is
    // shorter — but it still carries the cover, contents and conclusion frame.
    teacherDeck.slides < deck.slides &&
    teacherDeck.slides > 6 &&
    !teacherDeck.options.some((option) => option.startsWith('Mathematics')),
  `${teacherDeck.cover} · ${teacherDeck.slides} slides`,
)

console.log('\n' + (results.every((r) => r.ok) ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'))
await browser.close()
process.exit(results.every((r) => r.ok) ? 0 : 1)
