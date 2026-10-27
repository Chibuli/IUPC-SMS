import puppeteer from 'puppeteer-core'

/**
 * The sign-up gate, driven through the real page.
 *
 * The rule under test is that an account exists only for an address the
 * registrar has already recorded: an unknown address is refused, a recorded one
 * lets that teacher choose their own password, and from then on the password
 * they chose is the only one that opens the account.
 */
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

async function signInAs(session) {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
  await page.evaluate((s) => localStorage.setItem('iupc.session.v1', JSON.stringify(s)), session)
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle0' })
}

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

async function clickByAction(action, last = false) {
  return page.evaluate(
    (sel, wantLast) => {
      const nodes = [...document.querySelectorAll(`[data-action="${sel}"]`)]
      const target = wantLast ? nodes[nodes.length - 1] : nodes[0]
      if (!target) return false
      target.click()
      return true
    },
    action,
    last,
  )
}

async function clickByText(text) {
  return page.evaluate((label) => {
    const target = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim().includes(label))
    if (!target) return false
    target.click()
    return true
  }, text)
}

const status = () =>
  page.evaluate(() => {
    const node = document.querySelector('[data-field="signup-status"]')
    if (!node) return null
    return { state: node.dataset.state, text: node.textContent?.trim() ?? '', tone: node.className.includes('text-danger') ? 'danger' : node.className.includes('text-warn') ? 'warn' : 'ok' }
  })

const submitDisabled = () =>
  page.evaluate(() => document.querySelector('[data-action="submit-signup"]')?.disabled ?? null)

const alertText = () =>
  page.evaluate(() => document.querySelector('[role="alert"]')?.textContent?.trim() ?? null)

const pathname = () => page.evaluate(() => location.pathname)

const staffRow = (email) =>
  page.evaluate((address) => {
    const raw = localStorage.getItem('iupc.db.v1')
    if (!raw) return null
    const teacher = JSON.parse(raw).teachers.find((t) => t.email === address)
    if (!teacher) return null
    return {
      hash: teacher.password_hash ?? null,
      salt: teacher.password_salt ?? null,
      activated: teacher.activated_at ?? null,
      permissions: teacher.permissions,
      subjects: teacher.assigned_subject_ids,
    }
  }, email)

const NEW_EMAIL = 'a.mutiso@iupc.academy'
const NEW_PASSWORD = 'Mwangaza#2026'
const UNKNOWN_EMAIL = 'stranger@example.com'
const AWAITING_EMAIL = 'j.odhiambo@iupc.academy'

/* ── 0. clean slate ────────────────────────────────────────────────────── */
await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle0' })
check('sign-in page shows the create-account entry point', await page.evaluate(() => Boolean(document.querySelector('[data-action="open-signup"]'))))

const openSignUp = await clickByAction('open-signup', true)
await wait(200)
check('create-account view opens', openSignUp && (await page.evaluate(() => Boolean(document.querySelector('[data-field="signup-email"]')))))

/* ── 1. an address the register does not carry cannot sign up ──────────── */
await setField('[data-field="signup-email"]', UNKNOWN_EMAIL)
await wait(150)
const unknown = await status()
check('an unregistered email is refused before any password is involved', unknown?.state === 'unknown' && unknown.tone === 'danger', unknown?.text?.slice(0, 80))
check('submit is disabled for an unregistered email', (await submitDisabled()) === true)

await setField('[data-field="signup-password"]', NEW_PASSWORD)
await setField('[data-field="signup-confirm"]', NEW_PASSWORD)
await wait(150)
check('a good password cannot bypass the register check', (await submitDisabled()) === true)

/* ── 2. the registrar records the teacher ─────────────────────────────── */
await signInAs({ role: 'admin', name: 'Registrar' })
await page.goto(`${BASE}/dashboard/teachers?register=1`, { waitUntil: 'networkidle0' })
await wait(300)
await setField('[data-field="teacher-name"]', 'Alice Mutiso')
await setField('[data-field="teacher-email"]', NEW_EMAIL)
const registered = await page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"]')
  const save = [...(dialog?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.includes('Register teacher'))
  const nameOk = document.querySelector('[data-field="teacher-name"]')?.value === 'Alice Mutiso'
  if (!save || !nameOk) return false
  save.click()
  return true
})
await wait(400)
const created = await staffRow(NEW_EMAIL)
check('admin registers the teacher from the top bar', registered && Boolean(created))
check('a newly registered teacher holds no password', created?.hash === null && created?.activated === null)
check(
  'the register reports the new account as awaiting sign-up',
  (await page.evaluate(() => document.querySelector('[data-count="awaiting-signup"]')?.textContent?.trim() ?? '')) !== '',
  await page.evaluate(() => document.querySelector('[data-count="awaiting-signup"]')?.textContent?.trim() ?? ''),
)

/* ── 3. the recorded address can now create an account ────────────────── */
await page.evaluate(() => localStorage.removeItem('iupc.session.v1'))
await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
await clickByAction('open-signup', true)
await wait(200)
await setField('[data-field="signup-email"]', NEW_EMAIL)
await wait(150)
const found = await status()
check('a recorded email is recognised, with the teacher named', found?.state === 'awaiting' && found.tone === 'ok' && found.text.includes('Alice Mutiso'), found?.text?.slice(0, 90))
check('an empty password still blocks submit for a recorded email', (await submitDisabled()) === true)

await setField('[data-field="signup-password"]', NEW_PASSWORD)
await setField('[data-field="signup-confirm"]', NEW_PASSWORD)
await wait(150)
check('submit unlocks for a recorded email once a password is chosen', (await submitDisabled()) === false)

/* ── 4. password policy ────────────────────────────────────────────────── */
await setField('[data-field="signup-password"]', 'short')
await setField('[data-field="signup-confirm"]', 'short')
await wait(150)
check('a password under the minimum length is refused', (await submitDisabled()) === true)

await setField('[data-field="signup-password"]', NEW_PASSWORD)
await setField('[data-field="signup-confirm"]', `${NEW_PASSWORD}x`)
await wait(150)
check('a mismatched confirmation is refused', (await submitDisabled()) === true)

await setField('[data-field="signup-confirm"]', NEW_PASSWORD)
await wait(150)
check('a matching, long enough password is accepted', (await submitDisabled()) === false)

/* ── 5. sign-up writes a credential and signs the teacher in ──────────── */
await clickByAction('submit-signup')
await wait(700)
check('sign-up lands in the workspace', (await pathname()) === '/dashboard', await pathname())

const activated = await staffRow(NEW_EMAIL)
check('the account now carries a per-teacher salt and hash', Boolean(activated?.salt) && Boolean(activated?.hash) && activated.salt !== activated.hash)
check('the activation is stamped', Boolean(activated?.activated))
check(
  'the chosen password is never stored in the clear',
  await page.evaluate(
    (secret) => !JSON.stringify(localStorage).includes(secret),
    NEW_PASSWORD,
  ),
)

const sessionRole = await page.evaluate(() => JSON.parse(localStorage.getItem('iupc.session.v1') ?? 'null')?.role ?? null)
check('sign-up signs the teacher in as a teacher, not an administrator', sessionRole === 'teacher', String(sessionRole))

/* ── 6. the password they chose is the one that works ─────────────────── */
await page.evaluate(() => localStorage.removeItem('iupc.session.v1'))
await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
await page.evaluate(() => {
  const tab = [...document.querySelectorAll('[role="tab"]')].find((b) => b.textContent?.trim() === 'Teacher')
  tab?.click()
})
await wait(200)
await setField('[data-field="signin-username"]', NEW_EMAIL)
await setField('[data-field="signin-password"]', 'iupc')
await clickByAction('signin-submit')
await wait(500)
check('the old shared demo password no longer opens a new account', (await alertText())?.includes('not correct'), await alertText())

await setField('[data-field="signin-password"]', NEW_PASSWORD)
await clickByAction('signin-submit')
await wait(600)
check('the password the teacher chose signs them in', (await pathname()) === '/dashboard', await pathname())

/* ── 7. a recorded teacher with no password is told why ───────────────── */
await page.evaluate(() => localStorage.removeItem('iupc.session.v1'))
await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
await page.evaluate(() => {
  const tab = [...document.querySelectorAll('[role="tab"]')].find((b) => b.textContent?.trim() === 'Teacher')
  tab?.click()
})
await setField('[data-field="signin-username"]', AWAITING_EMAIL)
await setField('[data-field="signin-password"]', 'iupc')
await clickByAction('signin-submit')
await wait(500)
const awaitingAlert = await alertText()
check('signing in as someone who never signed up explains the state', Boolean(awaitingAlert?.includes('Create your account')), awaitingAlert)
check('and the page offers the sign-up route for that address', await page.evaluate(() => document.querySelectorAll('[data-action="open-signup"]').length > 0))

/* ── 8. the awaiting account can complete sign-up ─────────────────────── */
await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
await clickByAction('open-signup', true)
await wait(200)
await setField('[data-field="signup-email"]', AWAITING_EMAIL)
await wait(150)
const joseph = await status()
check("the seeded awaiting account is offered its own sign-up", joseph?.state === 'awaiting' && joseph.text.includes('Joseph Odhiambo'), joseph?.text?.slice(0, 90))
check(
  'the sign-up shows the subjects the registrar assigned',
  await page.evaluate(() => document.querySelector('[data-field="signup-status"]')?.textContent?.includes('Business Studies') ?? false),
)
await setField('[data-field="signup-password"]', 'Odhiambo#771')
await setField('[data-field="signup-confirm"]', 'Odhiambo#771')
await wait(150)
await clickByAction('submit-signup')
await wait(700)
check('an awaiting teacher completes sign-up and enters', (await pathname()) === '/dashboard', await pathname())
const josephAfter = await staffRow(AWAITING_EMAIL)
check('his credential and his permissions are both kept', Boolean(josephAfter?.hash) && Array.isArray(josephAfter?.permissions), `${josephAfter?.subjects?.length ?? 0} subjects, ${josephAfter?.permissions?.length ?? 0} permissions`)

/* ── 9. the registrar can reset a forgotten password ──────────────────── */
await signInAs({ role: 'admin', name: 'Registrar' })
await page.goto(`${BASE}/dashboard/teachers`, { waitUntil: 'networkidle0' })
await page.evaluate((id) => {
  const card = document.querySelector(`[data-teacher="${id}"]`)
  card?.querySelector('[data-action="reset-signin"]')?.click()
}, 't-8')
await wait(300)
await clickByAction('confirm-reset-signin')
await wait(400)
const josephReset = await staffRow(AWAITING_EMAIL)
check('reset sign-in clears the credential but keeps the record', josephReset?.hash === null && josephReset.subjects.length === 2)
check('reset does not disturb permissions', Array.isArray(josephReset?.permissions))

await page.evaluate(() => localStorage.removeItem('iupc.session.v1'))
await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
await page.evaluate(() => {
  const tab = [...document.querySelectorAll('[role="tab"]')].find((b) => b.textContent?.trim() === 'Teacher')
  tab?.click()
})
await setField('[data-field="signin-username"]', AWAITING_EMAIL)
await setField('[data-field="signin-password"]', 'Odhiambo#771')
await clickByAction('signin-submit')
await wait(500)
check('after a reset the old password stops working', (await alertText())?.includes('no password yet'), await alertText())

/* ── 10. the seeded demo logins still work ────────────────────────────── */
await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
await setField('[data-field="signin-username"]', 'admin')
await setField('[data-field="signin-password"]', 'iupc')
await clickByAction('signin-submit')
await wait(600)
check('the documented administrator login still works', (await pathname()) === '/dashboard', await pathname())

await page.evaluate(() => localStorage.removeItem('iupc.session.v1'))
await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
await page.evaluate(() => {
  const tab = [...document.querySelectorAll('[role="tab"]')].find((b) => b.textContent?.trim() === 'Teacher')
  tab?.click()
})
await setField('[data-field="signin-username"]', 'g.wanjiru@iupc.academy')
await setField('[data-field="signin-password"]', 'iupc')
await clickByAction('signin-submit')
await wait(600)
check('the documented teacher login still works', (await pathname()) === '/dashboard', await pathname())

/* ── 11. mobile width has no horizontal overflow ──────────────────────── */
await page.setViewport({ width: 390, height: 844 })
await page.evaluate(() => localStorage.removeItem('iupc.session.v1'))
await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
await clickByAction('open-signup', true)
await wait(300)
const overflowSignUp = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
check('the create-account view fits a phone', overflowSignUp <= 0, `${overflowSignUp}px overflow`)
await setField('[data-field="signup-email"]', NEW_EMAIL)
await wait(200)
const overflowStatus = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
check('the register status card fits a phone', overflowStatus <= 0, `${overflowStatus}px overflow`)

await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('failed:')
  for (const entry of failed) console.log(`  - ${entry.name}${entry.detail ? ` (${entry.detail})` : ''}`)
  process.exit(1)
}
