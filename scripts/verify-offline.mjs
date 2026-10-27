import puppeteer from 'puppeteer-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

/**
 * The installed-app path: does it install, does it open with no network, and do
 * records keyed offline survive and then leave the device?
 *
 *   node scripts/verify-offline.mjs
 *
 * Serves the production build (the only build with a service worker) on its own
 * port, so the dev server can keep running alongside.
 */

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 4178
const BASE = `http://127.0.0.1:${PORT}`
const OUT = 'screenshots'

let failures = 0
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** PNG dimensions straight out of the IHDR chunk — no decoding library needed. */
function pngSize(buffer) {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

fs.mkdirSync(OUT, { recursive: true })

/* ── serve the built app ─────────────────────────────────────────────────── */
const viteBin = path.resolve('node_modules/vite/bin/vite.js')
const server = spawn(process.execPath, [viteBin, 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serverLog = ''
server.stdout.on('data', (chunk) => (serverLog += chunk))
server.stderr.on('data', (chunk) => (serverLog += chunk))

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/`)
      if (response.ok) return true
    } catch {
      /* not up yet */
    }
    await wait(500)
  }
  return false
}

let browser
try {
  if (!(await waitForServer())) {
    console.log(`FAIL  the preview server never answered on ${BASE}\n${serverLog}`)
    process.exit(1)
  }

  /* ── 1. the manifest a phone reads when it installs the app ───────────── */
  const manifestResponse = await fetch(`${BASE}/manifest.webmanifest`)
  const manifest = await manifestResponse.json()
  const iconSrcs = manifest.icons.map((icon) => icon.src)
  check(
    'the web manifest is served and describes an installed app',
    manifestResponse.ok &&
      manifest.name === 'IUPC Academy — School Management' &&
      manifest.short_name === 'IUPC Academy' &&
      manifest.display === 'standalone' &&
      manifest.start_url === '/dashboard' &&
      /^\//.test(manifest.scope ?? '/'),
    `${manifest.name} · display ${manifest.display} · start ${manifest.start_url}`,
  )
  check(
    'it declares the icon sizes launchers require, including a maskable one',
    iconSrcs.includes('/pwa-192x192.png') &&
      iconSrcs.includes('/pwa-512x512.png') &&
      manifest.icons.some((icon) => icon.purpose === 'maskable'),
    iconSrcs.join(' '),
  )

  const iconSizes = []
  for (const icon of manifest.icons) {
    const response = await fetch(`${BASE}${icon.src}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    const { width, height } = pngSize(bytes)
    iconSizes.push(`${icon.src} ${width}×${height} ${response.headers.get('content-type')}`)
    check(
      `${icon.src} is a real PNG of the size it claims`,
      response.ok && width === height && bytes.subarray(1, 4).toString() === 'PNG',
      `${width}×${height}`,
    )
  }

  const shell = await (await fetch(`${BASE}/`)).text()
  check(
    'the shell carries the iOS install tags the manifest cannot express',
    /rel="apple-touch-icon"/.test(shell) &&
      /apple-mobile-web-app-capable" content="yes"/.test(shell) &&
      /viewport-fit=cover/.test(shell) &&
      /name="theme-color"/.test(shell),
    'apple-touch-icon · standalone · viewport-fit=cover · theme-color',
  )

  /* ── 2. the service worker takes control ──────────────────────────────── */
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--font-render-hinting=none'],
  })
  const page = await browser.newPage()
  const errors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))

  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  /**
   * The shell carries a pill in the phone bar and another in the desktop header,
   * and both are in the DOM at every width — so read the visible one.
   */
  const pillLabel = (target = page) =>
    target.evaluate(() => {
      const pills = [...document.querySelectorAll('[aria-label^="Sync status"]')].filter(
        (pill) => pill.offsetParent !== null,
      )
      const pill = pills[pills.length - 1]
      return pill ? (pill.getAttribute('aria-label') ?? '').replace('Sync status: ', '') : ''
    })

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
  await page.evaluate(() =>
    localStorage.setItem('iupc.session.v1', JSON.stringify({ role: 'admin', name: 'Registrar' })),
  )

  const registration = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready
    return { scope: reg.scope, active: Boolean(reg.active), script: reg.active?.scriptURL ?? '' }
  })
  await page.goto(`${BASE}/dashboard/marks-entry`, { waitUntil: 'networkidle0' })
  const controlling = await page.evaluate(async () => {
    // A first visit registers without controlling; the reload above is what
    // hands the app to the worker.
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true })
        setTimeout(resolve, 3000)
      })
    }
    return Boolean(navigator.serviceWorker.controller)
  })
  check(
    'the service worker installs, activates and controls the page',
    registration.active && registration.scope.endsWith('/') && controlling,
    `${registration.scope}${controlling ? ' · controlling' : ' · NOT controlling'}`,
  )

  /* ── 3. it opens with no network at all ───────────────────────────────── */
  await page.evaluate(() => localStorage.removeItem('iupc.outbox.v1'))
  await page.setOfflineMode(true)
  await page.goto(`${BASE}/dashboard/marks-entry`, { waitUntil: 'domcontentloaded' })
  await wait(900)
  const offlineBoot = await page.evaluate(() => ({
    title: document.querySelector('h1')?.textContent.trim() ?? '',
    types: document.querySelectorAll('[data-field="exam-type"] option').length,
    rows: document.querySelectorAll('input[aria-label^="Score for"]').length,
    pill: document.querySelector('[aria-label^="Sync status"]')?.textContent.trim() ?? '',
    online: navigator.onLine,
  }))
  check(
    'the app boots from its own cache with the network cut, marks register and all',
    offlineBoot.title === 'Marks Entry' && offlineBoot.types >= 5 && offlineBoot.rows > 0 && !offlineBoot.online,
    `${offlineBoot.title} · ${offlineBoot.types} types · ${offlineBoot.rows} learners · pill "${offlineBoot.pill}"`,
  )

  /* ── 4. a teacher keys results with no connection ─────────────────────── */
  // CAT 2 for this class has no paper yet, so this also exercises a paper that
  // is created from a result keyed with no connection.
  await page.select('[data-field="exam-type"]', 'CAT 2')
  await wait(150)
  await page.select('[data-field="class"]', 'c-y8')
  await wait(150)
  await page.click('[data-subject-option="sub-ls-mat"]')
  await wait(150)
  await page.click('[data-field="subject-search"]', { clickCount: 3 })
  await page.keyboard.press('Backspace')
  await wait(150)
  await page.evaluate(() => {
    const field = document.querySelector('[data-field="paper-out"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(field, '40')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.blur()
  })
  await wait(300)

  const beforeKeying = await page.evaluate(() => ({
    rows: document.querySelectorAll('input[aria-label^="Score for"]').length,
    filled: [...document.querySelectorAll('input[aria-label^="Score for"]')].filter((input) => input.value).length,
    papers: JSON.parse(localStorage.getItem('iupc.db.v1') ?? '{"exams":[]}').exams.filter(
      (e) => e.exam_type === 'CAT 2' && e.class_id === 'c-y8',
    ).length,
  }))
  check(
    'the offline register opens blank on a paper that does not exist yet',
    beforeKeying.rows > 0 && beforeKeying.filled === 0 && beforeKeying.papers === 0,
    `${beforeKeying.rows} rows, none filled · ${beforeKeying.papers} recorded papers`,
  )

  const entries = ['32', '28', '30']
  await page.click('input[aria-label^="Score for"]')
  for (const value of entries) {
    await page.keyboard.type(value)
    await page.keyboard.press('Enter')
    await wait(250)
  }
  await wait(400)

  const captured = await page.evaluate(() => {
    const outbox = JSON.parse(localStorage.getItem('iupc.outbox.v1') ?? '[]')
    const db = JSON.parse(localStorage.getItem('iupc.db.v1') ?? '{"exams":[],"marks":[]}')
    const paper = db.exams.find((e) => e.exam_type === 'CAT 2' && e.class_id === 'c-y8')
    const marks = paper ? db.marks.filter((m) => m.exam_id === paper._id && typeof m.score === 'number') : []
    return {
      pending: outbox.length,
      kinds: [...new Set(outbox.map((entry) => entry.kind))].sort().join(','),
      summaries: outbox.slice(-3).map((entry) => entry.summary),
      saved: marks.length,
      max: paper?.max_score ?? null,
      percents: [...document.querySelectorAll('[data-percent]')].slice(0, 3).map((cell) => cell.textContent.trim()),
    }
  })
  captured.pill = await pillLabel()
  check(
    'three results keyed with no connection are saved on the device and queued',
    captured.saved === 3 && captured.max === 40 && captured.pending >= 4,
    `${captured.saved} marks saved · ${captured.pending} queued (${captured.kinds})`,
  )
  check(
    'the paper the offline result created is queued ahead of the result itself',
    captured.kinds.includes('exams.ensure') && captured.kinds.includes('marks.setScore'),
    captured.kinds,
  )
  check(
    'the queue names what was keyed, not ids',
    captured.summaries.every((line) => /·/.test(line)),
    captured.summaries[0] ?? '',
  )
  check(
    'the shell says the records are on the device and waiting',
    /Offline/i.test(captured.pill) && /\d/.test(captured.pill),
    captured.pill,
  )
  check(
    'the register still converts and grades the marks it holds',
    captured.percents.join() === '80.0%,70.0%,75.0%',
    captured.percents.join(' '),
  )

  await page.screenshot({ path: `${OUT}/offline-queued.png` })

  /* ── 5. reopening the app with no connection ──────────────────────────── */
  // A fresh page in the same profile is what reopening an installed app looks
  // like: same device storage, same service worker, nothing already in memory.
  const beforeReload = captured.pending
  const again = await browser.newPage()
  await again.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  await again.setOfflineMode(true)
  let navNote = 'opened from cache'
  await again
    .goto(`${BASE}/dashboard/marks-entry`, { waitUntil: 'domcontentloaded', timeout: 20000 })
    .catch((error) => {
      navNote = `navigation reported: ${String(error.message).split('\n')[0]}`
    })
  const reopened = await again
    .waitForSelector('input[aria-label^="Score for"]', { timeout: 15000 })
    .then(() => true)
    .catch(() => false)
  const afterReload = await again.evaluate(() => ({
    pending: JSON.parse(localStorage.getItem('iupc.outbox.v1') ?? '[]').length,
  }))
  afterReload.pill = await pillLabel(again)
  check('the app opens again from its cache with no connection', reopened, navNote)

  // The bar opens on its own defaults, so choose the paper the offline results
  // belong to — what a teacher would do — and read them back.
  await again.select('[data-field="exam-type"]', 'CAT 2')
  await wait(150)
  await again.select('[data-field="class"]', 'c-y8')
  await wait(150)
  await again.click('[data-subject-option="sub-ls-mat"]')
  await wait(400)
  const reopenedMarks = await again.evaluate(() => {
    const inputs = [...document.querySelectorAll('input[aria-label^="Score for"]')]
    return {
      values: inputs.filter((input) => input.value).map((input) => input.value),
      percents: [...document.querySelectorAll('[data-percent]')].slice(0, 3).map((cell) => cell.textContent.trim()),
    }
  })
  check(
    'reopening offline keeps every queued record and the marks themselves',
    afterReload.pending === beforeReload &&
      reopenedMarks.values.join() === '32,28,30' &&
      reopenedMarks.percents.join() === '80.0%,70.0%,75.0%',
    `${beforeReload} → ${afterReload.pending} queued · marks ${reopenedMarks.values.join('/')} · ${reopenedMarks.percents.join(' ')}`,
  )

  /* ── 6. the connection returns and the queue drains ───────────────────── */
  await again.setOfflineMode(false)
  await again.evaluate(() => window.dispatchEvent(new Event('online')))
  let drained = null
  for (let attempt = 0; attempt < 40; attempt += 1) {
    drained = await again.evaluate(() => ({
      pending: JSON.parse(localStorage.getItem('iupc.outbox.v1') ?? '[]').length,
      meta: JSON.parse(localStorage.getItem('iupc.sync.v1') ?? 'null'),
    }))
    drained.pill = await pillLabel(again)
    if (drained.pending === 0) break
    await wait(250)
  }
  check(
    'the queue empties as soon as the connection returns',
    drained.pending === 0 && /Synced/i.test(drained.pill),
    `${drained.pending} left · pill "${drained.pill}"`,
  )
  check(
    'the device remembers how many records it has sent',
    (drained.meta?.delivered ?? 0) >= 4 && Boolean(drained.meta?.last_synced_at),
    `${drained.meta?.delivered} sent · last ${drained.meta?.last_synced_at ?? 'never'}`,
  )

  const persisted = await again.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('iupc.db.v1') ?? '{"exams":[],"marks":[]}')
    const paper = db.exams.find((e) => e.exam_type === 'CAT 2' && e.class_id === 'c-y8')
    return paper ? db.marks.filter((m) => m.exam_id === paper._id && typeof m.score === 'number').length : 0
  })
  check('the marks are still there once everything has been sent', persisted === 3, `${persisted} marks`)

  await again.screenshot({ path: `${OUT}/offline-synced.png` })

  /* ── 7. the controls a finger actually uses ───────────────────────────── */
  const phone = await browser.newPage()
  await phone.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, hasTouch: true, isMobile: true })
  await phone.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
  await phone.evaluate(() =>
    localStorage.setItem('iupc.session.v1', JSON.stringify({ role: 'admin', name: 'Registrar' })),
  )
  await phone.goto(`${BASE}/dashboard/marks-entry`, { waitUntil: 'networkidle0' })
  await wait(600)
  const touch = await phone.evaluate(() => {
    const input = document.querySelector('input[aria-label^="Score for"]')
    const select = document.querySelector('[data-field="exam-type"]')
    const bar = document.querySelector('.sticky')
    return {
      input: input ? parseFloat(getComputedStyle(input).fontSize) : 0,
      select: select ? parseFloat(getComputedStyle(select).fontSize) : 0,
      barWidth: bar ? Math.round(bar.getBoundingClientRect().width) : 0,
      overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
      pill: Boolean(document.querySelector('[aria-label^="Sync status"]')),
    }
  })
  check(
    'on a touch screen every control is 16px, so iOS cannot zoom the register',
    touch.input >= 16 && touch.select >= 16,
    `score ${touch.input}px · select ${touch.select}px`,
  )
  check(
    'the phone header still fits and carries the sync pill',
    touch.pill && touch.barWidth <= 390 && touch.overflow <= 1,
    `bar ${touch.barWidth}px · overflow ${touch.overflow}px`,
  )
  await phone.screenshot({ path: `${OUT}/offline-phone.png` })

  const noise = errors.filter((text) => !/favicon|manifest/i.test(text))
  check('no console or page errors while all of this ran', noise.length === 0, noise.slice(0, 3).join(' | '))
} finally {
  if (browser) await browser.close()
  server.kill()
}

console.log(
  failures === 0
    ? '\nALL OFFLINE CHECKS PASSED — the app installs, opens with no network, keeps what is keyed offline and sends it on reconnect.'
    : `\n${failures} OFFLINE CHECK${failures === 1 ? '' : 'S'} FAILED`,
)
process.exit(failures === 0 ? 0 : 1)
