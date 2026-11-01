import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import puppeteer from 'puppeteer-core'
import { loadEnv } from 'vite'

const production = loadEnv('production', process.cwd(), 'VITE_')
const development = loadEnv('development', process.cwd(), 'VITE_')
const assets = await fs.readdir('dist/assets')
const bundle = (await Promise.all(assets.filter(file => file.endsWith('.js')).map(file => fs.readFile(path.join('dist/assets', file), 'utf8')))).join('\n')
assert(bundle.includes('https://jqwppkakayhxttazenus.supabase.co'), 'Hosted project must be bundled')
assert(bundle.includes(production.VITE_SUPABASE_PUBLISHABLE_KEY), 'Production publishable key must be bundled')
// React Router uses http://localhost as a URL-parsing base; auth-js contains
// an unused standalone-client default at :9999. Neither is this app's API URL.
const localLiterals = [...bundle.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/g)].map(match => match[0])
assert(localLiterals.every(url => ['http://localhost', 'http://localhost:9999'].includes(url)), 'Unexpected local endpoint found in production bundle')
if (development.VITE_SUPABASE_URL !== production.VITE_SUPABASE_URL) {
  assert(!bundle.includes(development.VITE_SUPABASE_URL), 'Configured development endpoint found in production bundle')
}
if (development.VITE_SUPABASE_PUBLISHABLE_KEY !== production.VITE_SUPABASE_PUBLISHABLE_KEY) {
  assert(!bundle.includes(development.VITE_SUPABASE_PUBLISHABLE_KEY), 'Development key found in production bundle')
}
assert(!/sb_secret_[A-Za-z0-9_-]{12,}/.test(bundle), 'Privileged key found in production bundle')
for (const file of ['sw.js','manifest.webmanifest','_redirects','_headers']) await fs.access(path.join('dist', file))
console.log('PASS production artifact targets hosted Supabase; no configured development endpoint, development key, or sb_secret key bundled')
console.log(`NOTE ${localLiterals.length} inert localhost literals remain in upstream Router/Auth libraries; this is not a literal-free bundle`)

const base = 'http://127.0.0.1:4173'
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'iupc-production-check-'))
let browser
const pageErrors = []
try {
  browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true, userDataDir: profile,
    args: ['--no-sandbox','--disable-gpu','--disable-background-networking','--no-first-run'] })
  async function openPage() {
    const page = await browser.newPage()
    page.setDefaultTimeout(15000)
    page.on('pageerror', e => pageErrors.push(e.message))
    await page.setRequestInterception(true)
    page.on('request', request => {
      if (new URL(request.url()).origin === base) return void request.continue()
      // No hosted Auth, database, email, or external font traffic during rehearsal.
      return void request.abort('blockedbyclient')
    })
    return page
  }
  const page = await openPage()
  await page.goto(base, { waitUntil: 'networkidle0' })
  await page.waitForSelector('[data-field="signin-email"]')
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  console.log('PASS production service worker installs and controls the application')
  await page.goto(`${base}/auth/callback?setup=1&error=access_denied&error_code=otp_expired`, { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => document.body.innerText.includes('This sign-in link is invalid or expired.'))
  assert.equal(await page.$('input[autocomplete="new-password"]'), null)
  await page.goto(`${base}/dashboard/reports`, { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => window.location.pathname === '/')
  console.log('PASS built SPA handles callback URLs and protects direct report routes without a session')
  await page.close()
  const offlinePage = await openPage()
  await offlinePage.setOfflineMode(true)
  await offlinePage.goto(base, { waitUntil: 'networkidle0' })
  await offlinePage.waitForSelector('[data-field="signin-email"]')
  assert.equal(await offlinePage.$('input[autocomplete="new-password"]'), null)
  assert.deepEqual(pageErrors, [])
  console.log('PASS a newly opened offline tab loads the cached production shell without exposing school records')
} finally {
  if (browser) await browser.close()
  const resolved = path.resolve(profile)
  assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('iupc-production-check-'))
  await fs.rm(resolved, { recursive: true, force: true })
}
