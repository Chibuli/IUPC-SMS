import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import { mkdtemp, rm, access } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/** Authenticated offline reload check, using fictional API responses only.
 * Requires an existing local Vite dev server; does not build or start one.
 * Effects: temporary Chrome profile, sessionStorage snapshot/auth, one IndexedDB
 * queued mark, mocked receipt acceptance. No real API writes or screenshots.
 * Backend connectivity is simulated; this does not verify production SW caching.
 */
const base = process.env.OFFLINE_CHECK_ORIGIN ?? 'http://127.0.0.1:5173'
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Local dev server only')
const ids = Object.fromEntries(['user','school','class','subject','student','term','exam'].map((name, i) => [name, `10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`]))
ids.teacher = '10000000-0000-4000-8000-000000000008'
const user = { id: ids.user, aud: 'authenticated', role: 'authenticated', email: 'offline-check@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }
const tables = {
  memberships: { school_id: ids.school, role: 'teacher', teacher_id: ids.teacher, active: true },
  profiles: { full_name: 'Offline Test Teacher', active: true },
  teachers: [{ id: ids.teacher, school_id: ids.school, full_name: 'Offline Test Teacher', email: user.email, employee_id: 'TEST-1', initials: 'TT', active: true, created_at: new Date().toISOString() }],
  teacher_permissions: [{ teacher_id: ids.teacher, permission: 'marks.enter' }],
  teacher_subjects: [{ teacher_id: ids.teacher, school_id: ids.school, subject_id: ids.subject }],
  teacher_classes: [{ teacher_id: ids.teacher, school_id: ids.school, class_id: ids.class }],
  schools: [{ id: ids.school, name: 'Offline Test School', code: 'TEST', address: '', postal: '', city: '', contact_email: '', phone_number: '', motto: '' }],
  classes: [{ id: ids.class, school_id: ids.school, class_name: 'Year 7', stream_name: 'A' }],
  subjects: [{ id: ids.subject, school_id: ids.school, name: 'Mathematics', code: 'MAT', category: 'General', level: 'Lower Secondary', offered: true }],
  students: [{ id: ids.student, school_id: ids.school, full_name: 'Fictional Learner', admission_number: 'TEST/1', class_id: ids.class, status: 'Active', gender: 'Female', guardian_name: '', guardian_phone: '', archived: false }],
  terms: [{ id: ids.term, school_id: ids.school, name: 'Term 1', academic_year: 2026, is_active: true, start_date: '2026-01-01' }],
  exams: [{ id: ids.exam, school_id: ids.school, term_id: ids.term, class_id: ids.class, subject_id: ids.subject, exam_name: 'Test CAT', exam_type: 'CAT 1', max_score: 100, status: 'open', editing_deadline: null }],
  marks: [],
}
let offline = false
let accepted = 0
const otherUser = { ...user, id: '20000000-0000-4000-8000-000000000001', email: 'other-check@example.invalid' }
const otherSchool = '20000000-0000-4000-8000-000000000002'
let identity = user
let allowIdentityLookup = false
let heldWrite = null
const audit = []
const profile = await mkdtemp(path.join(os.tmpdir(), 'iupc-offline-check-'))
let browser
let page
let step = 'launch'
const pageErrors = []
try {
  browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true, waitForInitialPage: false, protocolTimeout: 15000, timeout: 15000, userDataDir: profile, args: ['--no-sandbox', '--disable-gpu', '--disable-background-networking', '--disable-component-update', '--no-first-run'] })
  step = 'new page'
  page = await browser.newPage()
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.setRequestInterception(true)
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/auth/v1/') || url.pathname.startsWith('/rest/v1/')) {
      // Every backend request is intercepted, including requests to unexpected hosts.
      if (offline && !(allowIdentityLookup && url.pathname === '/auth/v1/user')) return void request.abort('internetdisconnected')
      if (request.method() === 'OPTIONS') return void request.respond({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': request.headers()['access-control-request-headers'] ?? '*' } })
      let body
      const token = request.headers().authorization?.replace(/^Bearer /, '')
      let requester
      try { requester = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub } catch { requester = null }
      const isOther = requester === otherUser.id
      if (url.pathname === '/auth/v1/user') body = identity
      else if (url.pathname === '/auth/v1/logout') body = {}
      else if (url.pathname.endsWith('/rpc/verify_student_enrollments')) body = [{ student_id: ids.student, certainty: 'verified_enrolled', subject_ids: [ids.subject] }]
      else if (url.pathname.endsWith('/rpc/apply_offline_write')) {
        const envelope = JSON.parse(request.postData() ?? '{}')
        assert.equal(envelope.operation, 'marks.setScore')
        assert.equal(requester, ids.user, 'Only the original account may send the queued mark')
        audit.push('dispatch')
        heldWrite = async () => {
          accepted++
          tables.marks = [{ id: 'test-mark', school_id: ids.school, exam_id: ids.exam, student_id: ids.student, score: envelope.payload.score, score_code: null, remarks: '', updated_at: new Date().toISOString() }]
          await request.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ accepted: true, result: {} }) })
        }
        return
      } else if (request.method() !== 'GET') return void request.abort('blockedbyclient')
      else {
        const table = url.pathname.split('/').at(-1)
        audit.push(`${requester}:${table}`)
        body = isOther ? table === 'memberships' ? { school_id: otherSchool, role: 'admin', active: true } : table === 'profiles' ? { full_name: 'Other Test Account', active: true } : table === 'schools' ? [{ ...tables.schools[0], id: otherSchool, name: 'Other Test School' }] : [] : tables[table] ?? []
      }
      return void request.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) })
    }
    if (url.origin === new URL(base).origin) return void request.continue()
    return void request.abort('blockedbyclient')
  })
  const setConnectivity = async value => {
    offline = !value
    await page.evaluate(value => {
      window.__offlineCheckOnline = value
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => window.__offlineCheckOnline })
      window.dispatchEvent(new Event(value ? 'online' : 'offline'))
    }, value)
  }
  await page.goto(base, { waitUntil: 'networkidle0' })
  const exp = Math.floor(Date.now() / 1000) + 3600
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  const signIn = async nextUser => {
    identity = nextUser
    const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: nextUser.id, exp, aud: 'authenticated', role: 'authenticated' })}.test-signature`
    await page.evaluate(async token => {
      const { supabase } = await import('/src/data/supabase.ts')
      const { error } = await supabase.auth.setSession({ access_token: token, refresh_token: 'fictional-test-refresh-token' })
      if (error) throw error
    }, token)
  }
  const labels = () => page.evaluate(() => [...document.querySelectorAll('[aria-label^="Sync status:"]')].map(node => node.getAttribute('aria-label')))
  await signIn(user)
  step = 'initial authenticated snapshot'
  await page.waitForFunction(() => sessionStorage.getItem('iupc.school.snapshot.v1'))
  step = 'initial marks-entry route'
  // Enter through the app after initial authentication has finished, so this
  // check isolates offline reload rather than an initial deep-link redirect.
  await page.waitForSelector(`a[href="/dashboard/exams/${ids.exam}/entry"]`)
  await page.click(`a[href="/dashboard/exams/${ids.exam}/entry"]`)
  const field = 'input[aria-label="Score for Fictional Learner"]'
  await page.waitForSelector(field)
  await setConnectivity(false)
  await page.evaluate(selector => {
    window.__prematureSaved = false
    window.__acceptanceConfirmed = false
    window.__savedObserver = new MutationObserver(() => {
      const row = document.querySelector(selector)?.closest('tr')
      if (!window.__acceptanceConfirmed && /\bSaved\b/.test(row?.innerText ?? '')) window.__prematureSaved = true
    })
    window.__savedObserver.observe(document.body, { childList: true, subtree: true, characterData: true })
  }, field)
  await page.click(field)
  await page.keyboard.type('42')
  await page.keyboard.press('Tab')
  step = 'offline mark persistence'
  await page.waitForFunction(async () => {
    const { readAll } = await import('/src/lib/offline-store.ts')
    return (await readAll()).some(record => record.state === 'Pending')
  })
  assert.equal(accepted, 0)
  assert.equal(await page.evaluate(() => window.__prematureSaved), false, 'A queued score must not display Saved before acceptance')
  await page.evaluateOnNewDocument(() => {
    window.__offlineCheckOnline = false
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => window.__offlineCheckOnline })
  })
  await page.reload({ waitUntil: 'networkidle0' })
  step = 'offline reload marks-entry restoration'
  await page.waitForSelector(field)
  await page.waitForFunction(selector => document.querySelector(selector)?.value === '42', {}, field)
  assert.equal(new URL(page.url()).pathname, `/dashboard/exams/${ids.exam}/entry`, 'Offline restoration must preserve the requested route')
  const state = await page.evaluate(async () => {
    const { getAccountScope } = await import('/src/data/backend.ts')
    const { readAll } = await import('/src/lib/offline-store.ts')
    return { scope: getAccountScope(), records: await readAll() }
  })
  assert.equal(state.scope.verified, false)
  assert.equal(state.records.length, 1)
  assert.equal(state.records[0].state, 'Pending')
  assert.equal(state.records[0].userId, ids.user)
  assert.equal(state.records[0].schoolId, ids.school)
  assert((await labels()).every(label => !label.includes('Synced')))
  console.log('PASS offline reload restores scoped school data and queued score without acceptance')

  allowIdentityLookup = true
  step = 'other-account isolation'
  await signIn(otherUser)
  await page.waitForFunction(() => !sessionStorage.getItem('iupc.school.snapshot.v1') && !document.querySelector('input[aria-label="Score for Fictional Learner"]'))
  const isolation = await page.evaluate(async originalUser => {
    const { getDb } = await import('/src/data/db.ts')
    const { readAll } = await import('/src/lib/offline-store.ts')
    const { currentActor, syncNow } = await import('/src/lib/offline.ts')
    const actor = await currentActor()
    await syncNow({ userId: originalUser, schoolId: '10000000-0000-4000-8000-000000000002' })
    return { actor, students: getDb().students.length, records: await readAll() }
  }, ids.user)
  assert.equal(isolation.actor, null)
  assert.equal(isolation.students, 0)
  assert.equal(isolation.records[0].userId, ids.user)
  assert.equal(accepted, 0)
  await setConnectivity(true)
  step = 'other-account reconnection'
  await page.waitForFunction(async otherSchool => (await import('/src/data/backend.ts')).getAccountScope()?.schoolId === otherSchool && (await import('/src/data/backend.ts')).getAccountScope()?.verified, {}, otherSchool)
  await page.evaluate(async () => { const { syncNow } = await import('/src/lib/offline.ts'); await syncNow() })
  assert.equal(heldWrite, null)
  assert.equal(accepted, 0)
  assert(!(await page.evaluate(() => document.body.innerText)).includes('Fictional Learner'))
  console.log('PASS another authenticated account/school cannot view or synchronize the original queued mark')

  audit.length = 0
  step = 'owner revalidation and delayed acceptance'
  await signIn(user)
  await page.waitForFunction(async schoolId => (await import('/src/data/backend.ts')).getAccountScope()?.schoolId === schoolId && (await import('/src/data/backend.ts')).getAccountScope()?.verified, {}, ids.school)
  await page.evaluate(() => { void import('/src/lib/offline.ts').then(({ syncNow }) => syncNow()) })
  for (let attempt = 0; !heldWrite && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 100))
  assert(heldWrite, 'The original account must dispatch after revalidation')
  assert(audit.indexOf(`${ids.user}:memberships`) >= 0 && audit.indexOf(`${ids.user}:memberships`) < audit.indexOf('dispatch'))
  assert(audit.indexOf(`${ids.user}:profiles`) >= 0 && audit.indexOf(`${ids.user}:profiles`) < audit.indexOf('dispatch'))
  assert((await labels()).every(label => !label.includes('Synced')), 'No success before acceptance')
  assert.equal(accepted, 0)
  console.log('PASS synchronization does not display success while acceptance is withheld')
  await heldWrite()
  await page.waitForFunction(async () => {
    const { getAccountScope } = await import('/src/data/backend.ts')
    const { readAll } = await import('/src/lib/offline-store.ts')
    return getAccountScope()?.verified && (await readAll()).length === 0
  })
  assert.equal(accepted, 1)
  await page.waitForFunction(() => [...document.querySelectorAll('[aria-label^="Sync status:"]')].some(node => node.getAttribute('aria-label').includes('Synced')))
  console.log('PASS reconnect revalidates membership before mocked acceptance and queue removal')
  await page.evaluate(async () => { const { supabase } = await import('/src/data/supabase.ts'); await supabase.auth.signOut({ scope: 'local' }) })
  await page.waitForFunction(() => !sessionStorage.getItem('iupc.school.snapshot.v1'))
  console.log('PASS sign-out removes the school snapshot')
  step = 'missing-session redirect protection'
  await page.goto(`${base}/dashboard/exams/${ids.exam}/entry`, { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => window.location.pathname === '/')
  assert.equal(await page.$(field), null)
  console.log('PASS no valid session redirects to login without exposing marks-entry data')
} catch (error) {
  console.log('FAIL at step:', step)
  console.log('Diagnostics:', JSON.stringify({ url: page?.url(), pageErrors, audit }))
  if (page) console.log('Browser state:', JSON.stringify(await page.evaluate(async () => ({ text: document.body.innerText.slice(0, 600), hasSnapshot: Boolean(sessionStorage.getItem('iupc.school.snapshot.v1')), scope: (await import('/src/data/backend.ts')).getAccountScope() })).catch(() => null)))
  throw error
} finally {
  try { if (browser) await browser.close() }
  finally {
    const resolved = path.resolve(profile)
    assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('iupc-offline-check-'), 'Cleanup must remain within the dedicated temporary profile')
    await rm(resolved, { recursive: true, force: true })
    await assert.rejects(access(resolved))
    console.log('PASS temporary Chrome profile and all fictional browser storage removed')
  }
}
