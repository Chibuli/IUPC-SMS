import puppeteer from 'puppeteer-core'
const BASE = 'http://127.0.0.1:5176'
const routes = ['/dashboard','/dashboard/students','/dashboard/classes','/dashboard/teachers','/dashboard/timetable','/dashboard/subjects','/dashboard/terms','/dashboard/marks-entry','/dashboard/analysis','/dashboard/exams/ex-1/entry','/dashboard/reports','/dashboard/report-cards','/dashboard/settings']
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const p = await b.newPage()
const errors = []
p.on('pageerror', e => errors.push(e.message))
p.on('console', m => m.type() === 'error' && errors.push(m.text()))
await p.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
await p.evaluate(() => localStorage.setItem('iupc.session.v1', JSON.stringify({ role: 'admin', name: 'Registrar' })))
let bad = 0
for (const width of [1440, 1024, 390]) {
  await p.setViewport({ width, height: 900 })
  for (const route of routes) {
    await p.goto(BASE + route, { waitUntil: 'networkidle0' })
    await new Promise(r => setTimeout(r, 200))
    const m = await p.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      win: window.innerWidth,
      body: document.body.innerText.trim().length,
      h1: document.querySelector('h1')?.textContent?.trim() ?? null,
    }))
    const overflow = m.doc - m.win
    const ok = overflow <= 1 && m.body > 60 && m.h1
    if (!ok) bad++
    console.log(`${ok ? 'ok  ' : 'BAD '} ${width}px ${route.padEnd(28)} overflow=${overflow} text=${m.body} h1=${m.h1}`)
  }
}
console.log(errors.length ? 'ERRORS:\n' + [...new Set(errors)].join('\n') : 'no console errors')
await b.close()
process.exit(bad || errors.length ? 1 : 0)
