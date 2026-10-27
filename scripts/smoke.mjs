import puppeteer from 'puppeteer-core'
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const p = await b.newPage()
const errors = []
p.on('pageerror', e => errors.push(e.message))
p.on('console', m => m.type() === 'error' && errors.push(m.text()))
await p.goto('http://127.0.0.1:5176/', { waitUntil: 'networkidle0' })
await p.evaluate(() => localStorage.setItem('iupc.session.v1', JSON.stringify({ role: 'admin', name: 'Registrar' })))
for (const route of ['/dashboard', '/dashboard/reports', '/dashboard/report-cards', '/dashboard/timetable']) {
  await p.goto('http://127.0.0.1:5176' + route, { waitUntil: 'networkidle0' })
  const h1 = await p.evaluate(() => document.querySelector('h1')?.textContent?.trim())
  console.log(route, '->', h1)
}
console.log('errors:', errors.length ? errors.join(' | ') : 'none')
await b.close()
process.exit(errors.length ? 1 : 0)
