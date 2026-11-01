import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// Fictional read-only UI fixtures only. All external traffic is blocked.
const base = process.env.IUPC_AUTH_TEST_ORIGIN ?? 'http://127.0.0.1:5173'
assert.equal(new URL(base).hostname, '127.0.0.1')
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const school = id(1), userId = id(2), teacher = id(3), term = id(4), math = id(5), english = id(6), classId = id(7), student = id(8)
const exp = Math.floor(Date.now()/1000)+3600
const encode = x => Buffer.from(JSON.stringify(x)).toString('base64url')
const token = `${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:userId,exp,role:'authenticated',aud:'authenticated'})}.${encode('fictional-signature')}`
const user = {id:userId,email:'dashboard@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01'}
const session = {access_token:token,refresh_token:'fictional',expires_in:3600,expires_at:exp,token_type:'bearer',user}
const routes = ['/dashboard','/dashboard/students','/dashboard/classes','/dashboard/teachers','/dashboard/timetable','/dashboard/subjects','/dashboard/terms','/dashboard/marks-entry','/dashboard/analysis','/dashboard/reports','/dashboard/report-cards']
const profile = await mkdtemp(path.join(os.tmpdir(),'iupc-dashboard-ui-'))
const screenshots = path.resolve('.local-migration/dashboard-ui-previews')
await mkdir(screenshots,{recursive:true})
let browser, activePage, scenario = 'launch', forbiddenWrites = 0, logouts = 0
const errors = []
const requests = []
try {
  browser = await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,waitForInitialPage:false,protocolTimeout:15000,timeout:15000,userDataDir:profile,args:['--no-sandbox','--disable-gpu','--disable-background-networking','--disable-component-update','--no-first-run']})
  async function open(role,empty=false) {
    const context = await browser.createBrowserContext(), page = await context.newPage()
    activePage = page; page.on('pageerror',e=>errors.push(e.message)); page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(30000)
    await page.setRequestInterception(true)
    page.on('request',request=>{
      const url = new URL(request.url())
      if(url.pathname.startsWith('/auth/v1/') || url.pathname.startsWith('/rest/v1/') || url.pathname.startsWith('/functions/v1/')) {
        requests.push(`${request.method()} ${url.pathname}`)
        const headers = {'access-control-allow-origin':base,'access-control-allow-methods':'GET, HEAD, POST, PUT, DELETE, OPTIONS','access-control-expose-headers':'content-range','access-control-allow-headers':request.headers()['access-control-request-headers']??'authorization,apikey,content-type,x-client-info'}
        const reply = (body,status=200)=>{if(url.pathname.endsWith('/marks')&&Array.isArray(body))headers['content-range']=`*/${body.length}`;return void request.respond({status,headers,contentType:'application/json',body:JSON.stringify(body)})}
        if(request.method()==='OPTIONS') return reply({},200)
        if(url.pathname==='/auth/v1/user') return reply(user)
        if(url.pathname==='/auth/v1/logout') {logouts++;return reply({})}
        if(url.pathname==='/rest/v1/rpc/verify_student_enrollments') return reply([])
        if(!['GET','HEAD'].includes(request.method())) {forbiddenWrites++;return void request.abort('blockedbyclient')}
        const table = url.pathname.split('/').at(-1)
        if(table==='memberships') return reply({school_id:school,role,teacher_id:role==='teacher'?teacher:null,active:true})
        if(table==='profiles') return reply({full_name:`Fictional ${role==='admin'?'Registrar':'Teacher'}`,active:true})
        if(table==='schools') return reply([{id:school,name:'IUPC Academy',code:'UI-TEST',logo_url:null,crest_url:null}])
        const rows = empty ? {} : {
          terms:[{id:term,name:'TERM 1',academic_year:'2026/2027',is_active:true,start_date:'2026-09-07'}],
          teachers:[{id:teacher,school_id:school,full_name:'Fictional Teacher',email:user.email,employee_id:'UI-TEST',initials:'FT',active:true}],
          teacher_subjects:[{teacher_id:teacher,subject_id:math}],
          classes:[{id:classId,school_id:school,class_name:'Year 7',stream_name:'A'},{id:id(9),school_id:school,class_name:'Year 8',stream_name:'A'}],
          subjects:[{id:math,school_id:school,name:'Mathematics',code:'UI-MATH',category:'Core',level:'Lower Secondary',offered:true},{id:english,school_id:school,name:'English',code:'UI-ENG',category:'Core',level:'Lower Secondary',offered:true}],
          students:[{id:student,school_id:school,class_id:classId,full_name:'Fictional Learner',admission_number:'UI-001',status:'Active',archived:false},{id:id(10),school_id:school,class_id:classId,full_name:'Archived Fixture',admission_number:'UI-002',status:'Active',archived:true}],
          exams:[{id:id(11),term_id:term,subject_id:math,class_id:classId,exam_name:'Mathematics assessment',exam_type:'Assessment',max_score:100,exam_date:'2026-10-31',status:'open'},{id:id(12),term_id:term,subject_id:english,class_id:classId,exam_name:'English assessment',exam_type:'Assessment',max_score:100,exam_date:'2026-10-30',status:'locked'}],
          marks:[{id:id(13),school_id:school,exam_id:id(11),student_id:student,score:72,updated_at:'2026-10-31T12:00:00Z',entered_by:userId},...(role==='admin'?[{id:id(14),school_id:school,exam_id:id(12),student_id:student,score:88,updated_at:'2026-10-30T12:00:00Z',entered_by:userId}]:[])],
        }
        return reply(rows[table]??[])
      }
      if(url.origin===base) return void request.continue()
      return void request.abort('blockedbyclient')
    })
    await page.goto(base,{waitUntil:'networkidle0'})
    const setupResult = await page.evaluate(async value=>{ const {supabase}=await import('/src/data/supabase.ts'); const result=await supabase.auth.setSession(value);return {error:result.error?.message??null,hasSession:Boolean(result.data.session)} },session)
    assert.equal(setupResult.error,null);assert.equal(setupResult.hasSession,true)
    await page.waitForSelector('.overview-page')
    return {page,context}
  }
  for(const role of ['admin','teacher']) {
    scenario = `${role} responsive navigation`
    const {page,context}=await open(role)
    for(const width of [1440,1280,768,390]) {
      await page.setViewport({width,height:900,deviceScaleFactor:1})
      await page.goto(`${base}/dashboard`,{waitUntil:'networkidle0'})
      await page.waitForSelector('.overview-page')
      const metrics=await page.$$eval('.overview-stats .display-figure',nodes=>nodes.map(n=>n.textContent.trim()))
      assert.deepEqual(metrics,['1','2','2',role==='admin'?'2':'1'],'Existing filtered calculations stay intact')
      const body=await page.$eval('.overview-page',el=>el.innerText)
      assert(body.includes('TERM 1')&&body.includes('2026/2027')&&body.includes('IUPC Academy'))
      assert(body.includes(role==='admin'?'80':'72'),'Existing mean score is preserved')
      assert(!body.includes('Archived Fixture'))
      const dimensions=await page.evaluate(()=>({page:document.documentElement.scrollWidth,width:innerWidth,table:document.querySelector('.overview-exam-table')?.getBoundingClientRect().width}))
      assert(dimensions.page<=width+1,`No horizontal page overflow for ${role} at ${width}px`)
      const expected=role==='admin'?[...routes,'/dashboard/settings']:routes
      if(width>=1024) {
        assert.equal(await page.$eval('.workspace-header',el=>getComputedStyle(el).backgroundColor),'rgb(169, 15, 45)')
        assert.equal(await page.$eval('.workspace-nav',el=>getComputedStyle(el).scrollbarWidth),'none','Navigation scrollbar is visually hidden, not disabled')
        assert.equal(await page.$eval('.workspace-nav',el=>getComputedStyle(el).overflowX),'auto')
        const headingHeight=await page.$eval('.overview-heading',el=>el.getBoundingClientRect().height)
        assert(headingHeight<=168,'Overview heading stays compact at desktop widths')
        assert(await page.$$eval('.overview-stats > .card',nodes=>nodes.every(el=>el.getBoundingClientRect().height<156)),'Statistics cards retain readable figures with less whitespace')
        const actual=await page.$$eval('.workspace-nav a',nodes=>nodes.map(n=>n.getAttribute('href')))
        assert.deepEqual(actual,expected)
        const tops=await page.$$eval('.workspace-nav a',nodes=>nodes.map(n=>n.getBoundingClientRect().top))
        assert(tops.every(top=>Math.abs(top-tops[0])<1),'Desktop menu stays on one row')
        assert.equal(await page.$eval('.workspace-nav a[aria-current="page"]',el=>el.getAttribute('href')),'/dashboard')
        const canScroll=await page.$eval('.workspace-nav',el=>el.scrollWidth>el.clientWidth)
        if(canScroll) {
          await page.$eval('.workspace-nav',el=>{el.scrollLeft=0})
          const bounds=await page.$eval('.workspace-nav',el=>{const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})
          await page.mouse.move(bounds.x,bounds.y)
          await page.mouse.wheel({deltaX:240,deltaY:0})
          await page.waitForFunction(()=>document.querySelector('.workspace-nav').scrollLeft>0)
        }
        await page.focus('.workspace-nav a:last-child')
        assert(await page.evaluate(()=>{const a=document.querySelector('.workspace-nav a:last-child').getBoundingClientRect();return a.right<=innerWidth+1}),'Last navigation module remains keyboard-reachable')
      } else {
        await page.click('button[aria-label="Open navigation"]')
        await page.waitForSelector('[role="dialog"][aria-label="Workspace navigation"]')
        assert.equal(await page.$eval('button[aria-label="Open navigation"]',el=>el.getAttribute('aria-expanded')),'true')
        assert.deepEqual(await page.$$eval('.workspace-drawer-nav a',nodes=>nodes.map(n=>n.getAttribute('href'))),expected)
        if(width===390) await page.screenshot({path:path.join(screenshots,`${role}-drawer-390.png`),fullPage:false})
        assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Close navigation')
        await page.keyboard.down('Shift');await page.keyboard.press('Tab');await page.keyboard.up('Shift')
        assert.equal(await page.evaluate(()=>document.activeElement.textContent.trim()),'Sign out')
        await page.keyboard.press('Tab')
        assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Close navigation')
        await page.keyboard.press('Escape')
        await page.waitForFunction(()=>!document.querySelector('.workspace-drawer-panel'))
        assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Open navigation')
      }
      const registerLinks=await page.$$eval('a[href="/dashboard/teachers?register=1"]',nodes=>nodes.length)
      assert.equal(registerLinks>0,role==='admin')
      assert.equal((await page.$$('a[href="/dashboard/settings"]')).length>0,role==='admin')
      if(width===390) {
        await page.focus('.overview-exam-table tbody a')
        assert(await page.evaluate(()=>{const link=document.querySelector('.overview-exam-table tbody a').getBoundingClientRect();return link.x>=0&&link.right<=innerWidth}),'Exam actions remain keyboard-reachable inside the mobile table scroller')
        await page.evaluate(()=>{document.querySelector('.overview-exam-table [role="region"]').scrollLeft=0;window.scrollTo(0,0)})
      }
      await page.screenshot({path:path.join(screenshots,`${role}-${width}.png`),fullPage:true})
    }
    // Route selection closes the drawer and preserves route/active state.
    await page.click('button[aria-label="Open navigation"]')
    await page.click('.workspace-drawer-nav a[href="/dashboard/students"]')
    await page.waitForFunction(()=>location.pathname==='/dashboard/students'&&!document.querySelector('.workspace-drawer-panel'))
    await page.click('button[aria-label="Open navigation"]')
    assert.equal(await page.$eval('.workspace-drawer-nav a[aria-current="page"]',el=>el.getAttribute('href')),'/dashboard/students')
    await page.keyboard.press('Escape')
    await page.goto(`${base}/dashboard`,{waitUntil:'networkidle0'})
    assert.equal(await page.$eval('.overview-heading a[href="/dashboard/timetable"]',el=>el.textContent.trim()),'Open timetable')
    assert(await page.$('.overview-heading a[href="/dashboard/marks-entry"]'))
    await page.click('button[aria-label="Open navigation"]')
    await page.setViewport({width:1280,height:900})
    await page.waitForFunction(()=>!document.querySelector('.workspace-drawer-panel')&&document.body.style.overflow!=='hidden')
    await page.setViewport({width:390,height:900})
    await page.click('button[aria-label="Sign out"]')
    await page.waitForFunction(()=>location.pathname==='/')
    console.log(`PASS ${role}: 1440/1280/768/390px, actual fixture calculations, permitted routes, active states, desktop scroll, mobile focus/Escape, quick actions and logout`)
    await context.close()
  }
  scenario='empty school overview'
  {
    const {page,context}=await open('admin',true)
    assert.deepEqual(await page.$$eval('.overview-stats .display-figure',nodes=>nodes.map(n=>n.textContent.trim())),['0','0','0','0'])
    const text=await page.$eval('.overview-page',el=>el.innerText)
    assert(text.includes('No exams scheduled')&&text.includes('No marks entered')&&text.includes('Not configured'))
    assert(!text.includes('undefined'))
    await context.close()
    console.log('PASS empty school overview uses truthful zero/empty states and no invented term or metrics')
  }
  assert.equal(forbiddenWrites,0);assert.equal(logouts,2);assert.deepEqual(errors,[])
  console.log('PASS no hosted writes, emails, new accounts or unmocked service requests; no browser runtime errors')
} catch(error) {
  console.error('FAIL dashboard UI scenario:',scenario)
  console.error(JSON.stringify({errors,requests,text:await activePage?.evaluate(()=>document.body.innerText.slice(0,1000)).catch(()=>null),state:await activePage?.evaluate(async()=>({scope:(await import('/src/data/backend.ts')).getAccountScope(),counts:Object.fromEntries(Object.entries((await import('/src/data/db.ts')).getDb()).map(([key,value])=>[key,value.length]))})).catch(()=>null)}))
  throw error
} finally {
  if(browser) await browser.close()
  const resolved=path.resolve(profile)
  assert(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('iupc-dashboard-ui-'))
  await rm(resolved,{recursive:true,force:true})
}
