/**
 * Screenshot helper (not part of the app): captures the two documents on screen
 * plus print-media renders at the printable A4 content width.
 */
import puppeteer from 'puppeteer-core'
const BASE = 'http://127.0.0.1:5176'
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const p = await b.newPage()
await p.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
await p.evaluate(() => localStorage.setItem('iupc.session.v1', JSON.stringify({ role: 'admin', name: 'Registrar' })))

for (const [route, file, width, height] of [
  ['/dashboard/report-cards', 'report-card', 1200, 1350],
  ['/dashboard/reports', 'broadsheet', 1300, 1000],
]) {
  await p.setViewport({ width, height, deviceScaleFactor: 1 })
  await p.goto(BASE + route, { waitUntil: 'networkidle0' })
  await new Promise((r) => setTimeout(r, 400))
  await p.screenshot({ path: `screenshots/${file}.jpg`, type: 'jpeg', quality: 82 })
}

for (const [route, file, width, height] of [
  ['/dashboard/report-cards', 'report-print', 718, 1047],
  ['/dashboard/reports', 'broadsheet-print', 733, 520],
  ['/dashboard/timetable', 'timetable-print', 1062, 733],
]) {
  await p.setViewport({ width, height, deviceScaleFactor: 1 })
  await p.goto(BASE + route, { waitUntil: 'networkidle0' })
  await p.emulateMediaType('print')
  await new Promise((r) => setTimeout(r, 300))
  await p.screenshot({ path: `screenshots/${file}.jpg`, type: 'jpeg', quality: 88, fullPage: true })
  await p.emulateMediaType('screen')
}
await b.close()
