import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// Focused routing tests only. Every Auth/REST response is fictional and mocked;
// external requests are blocked. No database, real account, email or screenshots.
const base = process.env.IUPC_AUTH_TEST_ORIGIN ?? 'http://127.0.0.1:5173'
assert.equal(new URL(base).hostname, '127.0.0.1', 'Auth tests must use a local development server')
const userId = '10000000-0000-4000-8000-000000000011'
const schoolId = '10000000-0000-4000-8000-000000000012'
const teacherId = '10000000-0000-4000-8000-000000000013'
const exp = Math.floor(Date.now() / 1000) + 3600
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: userId, exp, role: 'authenticated', aud: 'authenticated' })}.fictional-signature`
const user = { id: userId, email: 'routing-test@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }
const authSession = { access_token: token, refresh_token: 'fictional-refresh-token', expires_in: 3600, expires_at: exp, token_type: 'bearer', user }
const profile = await mkdtemp(path.join(os.tmpdir(), 'iupc-auth-routing-'))
let browser
let activePage
const pendingAssets = new Set()
const pageErrors = []
let scenario = 'launch'
let passwordWrites = 0
let pkceExchanges = 0
let recoveryRequests = 0
let invitationRequests = 0
let teacherRegistrations = 0
let signupRequests = 0
try {
  browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true, waitForInitialPage: false, protocolTimeout: 15000, timeout: 15000, userDataDir: profile, args: ['--no-sandbox', '--disable-gpu', '--disable-background-networking', '--disable-component-update', '--no-first-run'] })
  async function newPage({ role = 'admin', membership = true, failFirstInvitation = false } = {}) {
    const registeredTeachers = []
    let invitationAttempts = 0
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    activePage = page
    page.on('pageerror', error => pageErrors.push(error.message))
    page.setDefaultTimeout(10000)
    page.setDefaultNavigationTimeout(30000)
    await page.setRequestInterception(true)
    page.on('request', request => {
      const url = new URL(request.url())
      if (url.origin === base && !url.pathname.startsWith('/auth/') && !url.pathname.startsWith('/rest/')) pendingAssets.add(url.pathname)
      if (url.pathname.startsWith('/auth/v1/') || url.pathname.startsWith('/rest/v1/') || url.pathname.startsWith('/functions/v1/')) {
        const corsHeaders = {
          'access-control-allow-origin': base,
          'access-control-allow-methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
          'access-control-expose-headers': 'content-range',
          'access-control-allow-headers': request.headers()['access-control-request-headers'] ?? 'authorization, apikey, content-type, x-client-info',
        }
        if (request.method() === 'OPTIONS') return void request.respond({ status: 204, headers: corsHeaders })
        let body
        if (url.pathname === '/auth/v1/signup') { signupRequests++; return void request.abort('blockedbyclient') }
        if (url.pathname === '/functions/v1/provision-staff') {
          const input = JSON.parse(request.postData())
          assert.equal(input.schoolId, schoolId)
          assert.equal(role, 'admin')
          if (input.action === 'status') body = { statuses: Object.fromEntries(registeredTeachers.map(t => [t.id, invitationAttempts ? 'invitation_pending' : 'requires_attention'])) }
          else {
            assert.equal(input.teacherId, teacherId)
            invitationRequests++; invitationAttempts++
            if (failFirstInvitation && invitationAttempts === 1) return void request.respond({ status: 503, headers: corsHeaders, contentType: 'application/json', body: JSON.stringify({ error: 'Fictional SMTP failure' }) })
            body = { accepted: true, status: 'invitation_pending', invitation: invitationAttempts > (failFirstInvitation ? 2 : 1) ? 'existing' : 'accepted' }
          }
        } else if (url.pathname === '/rest/v1/rpc/save_teacher') {
          const input = JSON.parse(request.postData())
          assert.equal(input.target_school, schoolId)
          assert.equal(input.target_teacher, null)
          teacherRegistrations++
          registeredTeachers.push({ id: teacherId, school_id: schoolId, ...input.teacher_data, initials: 'FT', active: true })
          body = teacherId
        } else if (url.pathname === '/auth/v1/user') {
          if (request.method() === 'PUT') {
            assert.equal(request.headers().authorization, `Bearer ${token}`)
            assert.equal(typeof JSON.parse(request.postData()).password, 'string')
            passwordWrites++
          }
          body = user
        } else if (url.pathname === '/auth/v1/token') {
          if (url.searchParams.get('grant_type') === 'pkce') {
            assert(JSON.parse(request.postData()).code_verifier)
            pkceExchanges++
          }
          body = authSession
        } else if (url.pathname === '/auth/v1/recover') {
          assert.equal(url.searchParams.get('redirect_to'), `${base}/auth/callback?setup=1`)
          recoveryRequests++
          body = {}
        } else if (url.pathname === '/auth/v1/logout') body = {}
        else if (!['GET','HEAD'].includes(request.method())) return void request.abort('blockedbyclient')
        else {
          const table = url.pathname.split('/').at(-1)
          body = table === 'memberships' ? membership ? { school_id: schoolId, role, teacher_id: role === 'teacher' ? teacherId : null, active: true } : null
            : table === 'profiles' ? { full_name: 'Fictional Routing User', active: true }
            : table === 'schools' ? [{ id: schoolId, name: 'Fictional Routing School', code: 'ROUTING', address: '', postal: '', city: '', contact_email: '', phone_number: '', motto: '' }]
            : table === 'teachers' ? role === 'teacher' ? [{ id: teacherId, school_id: schoolId, full_name: 'Fictional Routing User', email: user.email, employee_id: 'TEST', initials: 'FR', active: true }] : registeredTeachers
            : []
        }
        if (url.pathname.endsWith('/marks') && Array.isArray(body)) corsHeaders['content-range'] = `*/${body.length}`
        return void request.respond({ status: 200, headers: corsHeaders, contentType: 'application/json', body: JSON.stringify(body) })
      }
      if (url.origin === base) return void request.continue()
      return void request.abort('blockedbyclient')
    })
    page.on('requestfinished', request => pendingAssets.delete(new URL(request.url()).pathname))
    page.on('requestfailed', request => pendingAssets.delete(new URL(request.url()).pathname))
    return { context, page }
  }
  const setup = 'input[autocomplete="new-password"]'
  const implicitLink = type => `${base}/auth/callback?setup=1#${new URLSearchParams({ access_token: token, refresh_token: 'fictional-refresh-token', expires_in: '3600', expires_at: String(exp), token_type: 'bearer', type })}`
  async function completePassword(page) {
    await page.waitForSelector(setup)
    await page.focus(setup)
    await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift')
    assert.equal(await page.evaluate(()=>document.activeElement.textContent.trim()),'Update password')
    await page.keyboard.press('Tab')
    assert.equal(await page.$eval(setup,el=>el===document.activeElement),true)
    await page.screenshot({path:path.resolve('.local-migration/auth-ui-previews/password-setup.png'),fullPage:true})
    await page.type(setup, 'Fictional-Password-Only-42')
    await page.evaluate(selector => document.querySelector(selector).closest('form').requestSubmit(), setup)
    await page.waitForFunction(() => document.body.innerText.includes('Password updated. Sign in with your new password.'))
    await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent === 'Continue').click())
    await page.waitForFunction(() => window.location.pathname === '/' && !document.querySelector('input[autocomplete="new-password"]'))
    await page.waitForFunction(async () => { const { data } = await (await import('/src/data/supabase.ts')).supabase.auth.getSession(); return !data.session })
  }

  scenario = 'login-page activation guidance without public registration'
  {
    const { page, context } = await newPage()
    await page.goto(base, { waitUntil: 'networkidle0' })
    await page.click('[data-action="activate-teacher"]')
    await page.waitForSelector('[data-field="teacher-activation-help"]')
    assert((await page.$eval('[data-field="teacher-activation-help"]', el => el.textContent)).includes('contact your school administrator'))
    assert.equal(await page.$(setup), null)
    assert.equal(signupRequests, 0)
    console.log('PASS activation guidance requires administrator registration and email verification; no public signup or invitation request')
    await context.close()
  }

  scenario = 'Stitch authentication responsive presentation'
  {
    const { page, context } = await newPage()
    const screenshotRoot = path.resolve('.local-migration/auth-ui-previews')
    await mkdir(screenshotRoot, { recursive: true })
    for (const [width, height] of [[320,740], [390,844], [768,1024], [1024,768], [1280,600], [1280,720], [1366,768], [1440,650], [1440,900], [1920,1080], [1280,480]]) {
      await page.setViewport({ width, height, deviceScaleFactor: 1 })
      await page.goto(base, { waitUntil: 'networkidle0' })
      await page.waitForSelector('[data-auth-layout="diagonal"]')
      const layout = await page.evaluate(() => {
        const rect = selector => { const r=document.querySelector(selector).getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom} }
        const logo=document.querySelector('.auth-logo')
        return { overflow:document.documentElement.scrollWidth>innerWidth, pageHeight:document.documentElement.scrollHeight, activation:rect('[data-action="activate-teacher"]'), footer:rect('.auth-footer'), logoLoaded:logo.complete&&logo.naturalWidth>0, logoSource:logo.getAttribute('src'), logo:rect('.auth-logo'), brand:rect('.auth-brand'), panel:rect('.auth-panel'), email:rect('[data-field="signin-email"]'), submit:rect('[data-action="signin-submit"]'), desktopDiagonal:getComputedStyle(document.querySelector('.auth-layout'),'::before').clipPath, mobileDiagonal:getComputedStyle(document.querySelector('.auth-panel'),'::before').clipPath, text:document.body.innerText }
      })
      assert.equal(layout.overflow, false, `No horizontal overflow at ${width}px`)
      assert.equal(layout.logoLoaded, true)
      assert.equal(layout.logoSource, '/iupc-wordmark.png')
      assert(layout.logo.width >= 140)
      assert(layout.email.x >= 0 && layout.email.right <= width)
      assert(layout.submit.height >= 44)
      assert(layout.activation.height >= 44, 'Activation keeps an accessible touch target')
      assert(layout.text.includes('Navigating the Future, Empowering the Leaders of Today and Tomorrow'))
      assert(layout.text.includes('We make sure that everyone blossoms.'))
      assert(!/Staff \/ Faculty|Select portal access|256-Bit|Accredited|Partner Campuses|2024|2025|Powered by/i.test(layout.text))
      if (width < 960) {
        assert(layout.brand.bottom <= layout.panel.y + 1)
        assert.notEqual(layout.mobileDiagonal, 'none')
        if (width < 600) assert(layout.brand.height < 325, 'Phone branding stays compact')
      } else {
        assert(layout.email.x > width / 2)
        assert.notEqual(layout.desktopDiagonal, 'none')
        if (height >= 600) {
          assert(layout.pageHeight <= height + 1, `Complete default login fits ${width}x${height}: document height ${layout.pageHeight}`)
          assert(layout.activation.bottom <= height && layout.footer.bottom <= height, 'Activation and footer are visible without scrolling')
        } else {
          assert(layout.pageHeight > height, 'Very short windows retain natural scrolling instead of clipping')
        }
      }
      if ([390,768,1440].includes(width) && (width !== 1440 || height === 900)) await page.screenshot({ path:path.join(screenshotRoot,`login-${width}.png`),fullPage:true })
      if (width === 1280 && height === 600) await page.screenshot({ path:path.join(screenshotRoot,'login-1280x600.png'),fullPage:true })
    }
    await page.setViewport({width:390,height:844,deviceScaleFactor:1})
    await page.goto(base,{waitUntil:'networkidle0'})
    await page.type('[data-field="signin-password"]','Fictional-Visibility-Only')
    await page.click('button[aria-label="Show password"]')
    assert.equal(await page.$eval('[data-field="signin-password"]',el=>el.type),'text')
    await page.click('button[aria-label="Hide password"]')
    assert.equal(await page.$eval('[data-field="signin-password"]',el=>el.type),'password')
    await page.$eval('[data-field="signin-password"]',el=>{el.value=''})
    await page.click('[data-action="activate-teacher"]')
    assert.equal(await page.$eval('[data-action="activate-teacher"]',el=>el.getAttribute('aria-expanded')),'true')
    await page.screenshot({path:path.join(screenshotRoot,'activation-390.png'),fullPage:true})
    await page.evaluate(()=>[...document.querySelectorAll('button')].find(el=>el.textContent==='Forgot password?').click())
    await page.waitForSelector('.auth-recovery')
    assert.equal(await page.$eval('.auth-recovery button.auth-submit',el=>el.disabled),true)
    await page.screenshot({path:path.join(screenshotRoot,'recovery-390.png'),fullPage:true})
    await page.focus('[data-field="signin-email"]')
    await page.keyboard.press('Tab')
    assert.equal(await page.$eval('[data-field="signin-password"]',el=>el===document.activeElement),true)
    assert.equal(signupRequests,0)
    console.log('PASS responsive login at 320–1920px; desktop login/activation/footer fit at 600–1080px heights; short windows scroll; logo, diagonal layout, touch targets and Auth controls preserved')
    await context.close()
  }

  for (const failFirstInvitation of [false, true]) {
    scenario = failFirstInvitation ? 'saved teacher and invitation retry' : 'registration and invitation'
    const beforeRegistrations = teacherRegistrations, beforeInvitations = invitationRequests
    const { page, context } = await newPage({ failFirstInvitation })
    await page.goto(base, { waitUntil: 'networkidle0' })
    await page.type('[data-field="signin-email"]', user.email)
    await page.type('[data-field="signin-password"]', 'Fictional-Login-Only-42')
    await page.click('[data-action="signin-submit"]')
    await page.waitForFunction(() => window.location.pathname === '/dashboard')
    await page.goto(`${base}/dashboard/teachers`, { waitUntil: 'networkidle0' })
    await page.click('[data-action="register-teacher"]')
    await page.type('[data-field="teacher-name"]', 'Fictional Teacher')
    await page.type('[data-field="teacher-email"]', 'teacher@example.invalid')
    await page.click('[data-action="save-teacher"]')
    await page.waitForFunction(() => document.body.innerText.includes('was registered successfully.'))
    await page.waitForSelector(`[data-teacher="${teacherId}"]`)
    assert.equal(teacherRegistrations, beforeRegistrations + 1)
    assert.equal(invitationRequests, beforeInvitations + 1)
    if (failFirstInvitation) {
      assert((await page.$eval('[role="status"]', el => el.textContent)).includes('registered successfully'))
      await page.evaluate(id => [...document.querySelector(`[data-teacher="${id}"]`).querySelectorAll('button')].find(el => el.textContent.includes('Check / send secure invitation')).click(), teacherId)
      await page.waitForFunction(() => document.body.innerText.includes('Invitation accepted by the email service'))
      assert.equal(teacherRegistrations, beforeRegistrations + 1)
      assert.equal(invitationRequests, beforeInvitations + 2)
    }
    assert.equal(await page.$('[data-action="reset-signin"]'), null)
    assert.equal(await page.$('[data-account="active"]'), null)
    console.log(`PASS ${scenario}; hosted password-reset controls absent and no password-hash activation claim`)
    await context.close()
  }

  scenario = 'invitation callback and password setup'
  {
    const { page, context } = await newPage({ role: 'teacher' })
    await page.goto(implicitLink('invite'), { waitUntil: 'networkidle0' })
    await completePassword(page)
    assert.equal(passwordWrites, 1)
    console.log('PASS invitation callback establishes Auth session, allows password setup and returns to signed-out login')
    await context.close()
  }

  scenario = 'PKCE recovery with an existing authenticated session'
  {
    const { page, context } = await newPage()
    await page.goto(base, { waitUntil: 'networkidle0' })
    await page.type('[data-field="signin-email"]', user.email)
    await page.type('[data-field="signin-password"]', 'Fictional-Login-Only-42')
    await page.click('[data-action="signin-submit"]')
    await page.waitForFunction(() => window.location.pathname === '/dashboard')
    assert.equal(await page.$(setup), null)
    await page.evaluate(async email => {
      const { supabase } = await import('/src/data/supabase.ts')
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/callback?setup=1` })
      if (error) throw error
    }, user.email)
    assert.equal(recoveryRequests, 1)
    await page.goto(`${base}/auth/callback?setup=1&code=fictional-code`, { waitUntil: 'networkidle0' })
    await completePassword(page)
    assert.equal(pkceExchanges, 1)
    assert.equal(passwordWrites, 2)
    console.log('PASS ordinary login is preserved; existing authenticated PKCE recovery can update password and sign out')
    await context.close()
  }

  scenario = 'invalid callback and missing membership'
  {
    const { page, context } = await newPage({ membership: false })
    await page.goto(`${base}/auth/callback?setup=1&error=access_denied&error_code=otp_expired`, { waitUntil: 'networkidle0' })
    await page.waitForFunction(() => document.body.innerText.includes('This sign-in link is invalid or expired.'))
    assert.equal(await page.$(setup), null)
    await page.goto(implicitLink('invite'), { waitUntil: 'networkidle0' })
    await page.waitForSelector(setup)
    assert.equal(await page.$eval('[role="dialog"]',el=>el.getAttribute('aria-modal')),'true')
    assert.equal(await page.evaluate(async () => (await import('/src/data/backend.ts')).getAccountScope()), null)
    assert.equal(passwordWrites, 2)
    console.log('PASS invalid links cannot set passwords; valid Auth setup does not grant school membership')
    await context.close()
  }

  scenario = 'failed activation cannot reuse an existing login for password setup'
  {
    const { page, context } = await newPage()
    await page.goto(base, { waitUntil: 'networkidle0' })
    await page.type('[data-field="signin-email"]', user.email)
    await page.type('[data-field="signin-password"]', 'Fictional-Login-Only-42')
    await page.click('[data-action="signin-submit"]')
    await page.waitForFunction(() => window.location.pathname === '/dashboard')
    for (const suffix of ['?setup=1&code=fictional-without-verifier', '?setup=1&error=access_denied&error_code=otp_expired']) {
      await page.goto(`${base}/auth/callback${suffix}`, { waitUntil: 'networkidle0' })
      await page.waitForFunction(() => document.body.innerText.includes('This sign-in link is invalid or expired.'))
      assert.equal(await page.$(setup), null)
      assert.equal(passwordWrites, 2)
    }
    await page.goto(`${base}/auth/callback?setup=1&email=teacher@example.invalid`, { waitUntil: 'networkidle0' })
    assert.equal(await page.$(setup), null)
    assert.equal(signupRequests, 0)
    console.log('PASS expired/missing-verifier links cannot reuse a prior login; email/setup flag alone cannot open password setup')
    await context.close()
  }

  scenario = 'teacher session restoration'
  {
    const { page, context } = await newPage({ role: 'teacher' })
    await page.goto(base, { waitUntil: 'networkidle0' })
    await page.evaluate(async session => { const { supabase } = await import('/src/data/supabase.ts'); await supabase.auth.setSession(session) }, authSession)
    await page.waitForFunction(() => window.location.pathname === '/dashboard')
    await page.reload({ waitUntil: 'networkidle0' })
    await page.waitForFunction(() => document.body.innerText.includes('TEACHER'))
    assert.equal(await page.$(setup), null)
    assert.equal(await page.$('a[href="/dashboard/settings"]'), null)
    console.log('PASS ordinary teacher session restores its role without opening password setup')
    await context.close()
  }
} catch (error) {
  console.error('FAIL focused authentication scenario:', scenario)
  console.error('Fictional browser diagnostics:', JSON.stringify({ pageErrors, pendingAssets: [...pendingAssets], text: await activePage?.evaluate(() => document.body.innerText.slice(0, 700)).catch(() => null) }))
  throw error
} finally {
  try { if (browser) await browser.close() }
  finally {
    const resolved = path.resolve(profile)
    assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('iupc-auth-routing-'))
    await rm(resolved, { recursive: true, force: true })
    console.log('PASS temporary authentication profile and fictional browser storage removed')
  }
}
