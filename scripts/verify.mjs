import puppeteer from 'puppeteer-core'
import { PDFDocument } from 'pdf-lib'
import fs from 'node:fs'

const BASE = 'http://127.0.0.1:5176'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = 'screenshots'
const PRINT_VIEW = { width: 1122, height: 794 } // A4 landscape at 96 dpi
const PRINT_VIEW_A3 = { width: 1587, height: 1123 } // A3 landscape at 96 dpi
const PRINT_VIEW_PORTRAIT = { width: 794, height: 1122 } // A4 portrait at 96 dpi

fs.mkdirSync(OUT, { recursive: true })

const browser = await puppeteer.launch({
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
page.on('requestfailed', (req) => errors.push(`requestfailed: ${req.url()} ${req.failure()?.errorText ?? ''}`))
page.on('response', (res) => {
  if (res.status() >= 400) errors.push(`http ${res.status()}: ${res.url()}`)
})

async function signIn() {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => {
    localStorage.setItem('iupc.session.v1', JSON.stringify({ role: 'admin', name: 'Registrar' }))
  })
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle0' })
}

await signIn()

const shots = [
  ['dashboard', '/dashboard', 900],
  ['timetable', '/dashboard/timetable', 1000],
  ['timetable-class', '/dashboard/timetable?view=class', 1000],
  ['timetable-teacher', '/dashboard/timetable?view=teacher', 1000],
  ['analysis', '/dashboard/analysis', 1180],
  ['mark-entry', '/dashboard/exams/ex-1/entry', 820],
  ['broadsheet', '/dashboard/reports', 1120],
  ['report-card', '/dashboard/report-cards', 1200],
  ['students', '/dashboard/students', 820],
  ['classes', '/dashboard/classes', 820],
  ['teachers', '/dashboard/teachers', 900],
  ['settings', '/dashboard/settings', 900],
  ['subjects', '/dashboard/subjects', 1100],
]

for (const [name, path, height] of shots) {
  await page.emulateMediaType('screen')
  await page.setViewport({ width: 1440, height, deviceScaleFactor: 1 })
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0' })
  await new Promise((resolve) => setTimeout(resolve, 300))
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log(`shot ${name.padEnd(12)} ${path}`)
}

// ── the staff register: page, phone, register form and permission panel ───
await page.setViewport({ width: 1440, height: 1160 })
await page.goto(`${BASE}/dashboard/teachers?register=1`, { waitUntil: 'networkidle0' })
await new Promise((resolve) => setTimeout(resolve, 400))
await page.screenshot({ path: `${OUT}/teacher-register.png` })
console.log('shot teacher-register  /dashboard/teachers?register=1')

await page.evaluate(() => document.querySelector('[role="dialog"] [aria-label="Close dialog"]')?.click())
await page.goto(`${BASE}/dashboard/teachers`, { waitUntil: 'networkidle0' })
await new Promise((resolve) => setTimeout(resolve, 300))
await page.screenshot({ path: `${OUT}/teachers.png` })

await page.setViewport({ width: 390, height: 1100 })
await new Promise((resolve) => setTimeout(resolve, 300))
await page.screenshot({ path: `${OUT}/teachers-390.png` })
console.log('shot teachers          /dashboard/teachers (+ 390px)')

await page.setViewport({ width: 1440, height: 1180 })
await page.goto(`${BASE}/dashboard/settings`, { waitUntil: 'networkidle0' })
await new Promise((resolve) => setTimeout(resolve, 250))
await page.evaluate(() => document.querySelector('[data-action="open-teacher-permissions"]')?.click())
await new Promise((resolve) => setTimeout(resolve, 400))
await page.screenshot({ path: `${OUT}/teacher-permissions.png` })
console.log('shot teacher-permissions  /dashboard/settings (panel open)')

// ── the performance deck: cover slide in the gallery, stack in print ────
await page.setViewport({ width: 1440, height: 900 })
await page.goto(`${BASE}/dashboard/analysis`, { waitUntil: 'networkidle0' })
await new Promise((resolve) => setTimeout(resolve, 400))
await page.evaluate(() => document.querySelector('[data-deck="performance"]')?.scrollIntoView({ block: 'start' }))
await new Promise((resolve) => setTimeout(resolve, 400))
await page.screenshot({ path: `${OUT}/deck.png` })
console.log('shot deck             /dashboard/analysis (deck in view)')

// Four representative slides, clipped to the canvas: the deck's palette and
// clustered columns are the point of the thing, so they belong in the gallery.
for (const [slide, file] of [
  [1, 'deck-cover.png'],
  [3, 'deck-summary.png'],
  [4, 'deck-overall.png'],
  [19, 'deck-recommendations.png'],
]) {
  for (let step = 1; step < slide; step++) {
    await page.click('[data-action="deck-next"]')
    await new Promise((resolve) => setTimeout(resolve, 120))
  }
  await new Promise((resolve) => setTimeout(resolve, 220))
  const box = await page.evaluate(() => {
    const el = document.querySelector('[data-deck="performance"] .deck-slide:not([data-active="false"])')
    const rect = el.getBoundingClientRect()
    return {
      x: Math.round(rect.x + window.scrollX),
      y: Math.round(rect.y + window.scrollY),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }
  })
  await page.screenshot({ path: `${OUT}/${file}`, clip: box })
  console.log(`shot ${file.padEnd(17)} /dashboard/analysis (slide ${slide})`)
  await page.goto(`${BASE}/dashboard/analysis`, { waitUntil: 'networkidle0' })
  await new Promise((resolve) => setTimeout(resolve, 260))
  await page.evaluate(() => document.querySelector('[data-deck="performance"]')?.scrollIntoView({ block: 'start' }))
  await new Promise((resolve) => setTimeout(resolve, 200))
}

await page.setViewport(PRINT_VIEW)
await page.goto(`${BASE}/dashboard/analysis?deck=print`, { waitUntil: 'networkidle0' })
await page.emulateMediaType('print')
await new Promise((resolve) => setTimeout(resolve, 300))
const deckPrint = await page.evaluate(() => {
  const slides = [...document.querySelectorAll('.deck-slide')]
  const first = slides[0]?.getBoundingClientRect()
  return `${slides.filter((slide) => getComputedStyle(slide).display !== 'none').length} slides :: ${
    first ? `${Math.round(first.width)}x${Math.round(first.height)}px` : 'no slides'
  }`
})
await page.screenshot({ path: `${OUT}/deck-print-preview.png` })
await page.emulateMediaType('screen')

// ── print-media preview + real A4 PDFs ───────────────────────────────────
async function printPreview(path, file, selector = '.sheet', viewport = PRINT_VIEW) {
  await page.setViewport(viewport)
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0' })
  await page.emulateMediaType('print')
  await new Promise((resolve) => setTimeout(resolve, 250))
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true })
  const text = await page.evaluate((sel) => {
    const sheet = document.querySelector(sel)
    if (!sheet) return 'MISSING PRINT SHEET'
    const rect = sheet.getBoundingClientRect()
    return `${Math.round(rect.width)}x${Math.round(rect.height)}px :: ${sheet.innerText.replace(/\s+/g, ' ').slice(0, 180)}`
  }, selector)
  await page.emulateMediaType('screen')
  return text
}

async function pdf(path, file, landscape, format = 'A4', viewport = PRINT_VIEW) {
  // A fresh page per document: a prior fullPage screenshot / print emulation on
  // the shared tab leaks layout state and silently adds a blank second page.
  const printPage = await browser.newPage()
  await printPage.setViewport(format === 'A3' ? PRINT_VIEW_A3 : viewport)
  await printPage.goto(`${BASE}${path}`, { waitUntil: 'networkidle0' })
  await new Promise((resolve) => setTimeout(resolve, 250))
  await printPage.pdf({
    path: `${OUT}/${file}`,
    format,
    landscape,
    printBackground: true,
    margin: { top: '8mm', right: '8mm', bottom: '8mm', left: '8mm' },
  })
  await printPage.close()
  const doc = await PDFDocument.load(fs.readFileSync(`${OUT}/${file}`))
  const sizes = doc.getPages().map((p) => {
    const { width, height } = p.getSize()
    const mm = (pt) => Math.round((pt / 72) * 25.4)
    return `${mm(width)}x${mm(height)}mm`
  })
  console.log(`pdf  ${file.padEnd(22)} ${doc.getPageCount()} page(s) · ${sizes.join(', ')}`)
  return doc.getPageCount()
}

const masterPreview = await printPreview('/dashboard/timetable', 'master-print-preview.png', '.sheet-master', PRINT_VIEW_A3)
const timetablePreview = await printPreview('/dashboard/timetable?view=class', 'timetable-print-preview.png')
const broadsheetPreview = await printPreview('/dashboard/reports', 'broadsheet-print-preview.png')
const broadsheetPage2 = await printPreview('/dashboard/reports', 'broadsheet-page-2-preview.png', '.sheet-broadsheet:nth-of-type(2)')
const reportPreview = await printPreview('/dashboard/report-cards', 'report-card-print-preview.png')
const analysisPreview = await printPreview(
  '/dashboard/analysis',
  'analysis-print-preview.png',
  '[data-sheet="analysis"]',
  PRINT_VIEW_PORTRAIT,
)

const counts = {
  master: await pdf('/dashboard/timetable', 'master.pdf', true, 'A3'),
  timetable: await pdf('/dashboard/timetable?view=class', 'timetable.pdf', true),
  broadsheet: await pdf('/dashboard/reports', 'broadsheet.pdf', true),
  reportCard: await pdf('/dashboard/report-cards', 'report-card.pdf', false),
  analysis: await pdf('/dashboard/analysis', 'analysis.pdf', false, 'A4', PRINT_VIEW_PORTRAIT),
  deck: await pdf('/dashboard/analysis?deck=print', 'deck.pdf', true),
}

console.log('\n--- print sheets (print media) ---')
console.log('master     ', masterPreview)
console.log('timetable  ', timetablePreview)
console.log('broadsheet ', broadsheetPreview)
console.log('broadsheet 2', broadsheetPage2)
console.log('report card', reportPreview)
console.log('analytics  ', analysisPreview)
console.log('deck       ', deckPrint)

console.log('\n--- console / network errors ---')
console.log(errors.length ? [...new Set(errors)].join('\n') : 'none')

console.log('\n--- pages ---', JSON.stringify(counts))

// The documents are specifications, not screenshots: the timetable and report
// card are single-sheet, the results sheet is deliberately two (matrix, then
// subject analysis).
// The deck is one landscape page per slide: cover, contents, executive summary,
// overall performance, a trend and a detailed slide per year group, then
// recommendations and the conclusion. Its length follows the year groups in
// scope, so the expected page count is the slide count the page reports.
const deckSlides = Number(String(deckPrint).match(/^(\d+) slides/)?.[1] ?? 0)
const expected = { master: 1, timetable: 1, broadsheet: 2, reportCard: 1, analysis: 1, deck: deckSlides }
const wrong = Object.entries(expected).filter(([key, value]) => counts[key] !== value)
if (wrong.length) {
  console.log('\nPAGE COUNT MISMATCH:', wrong.map(([key, value]) => `${key} expected ${value}, got ${counts[key]}`).join('; '))
}

await browser.close()
process.exit(wrong.length || errors.length ? 1 : 0)
