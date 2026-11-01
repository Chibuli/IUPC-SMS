import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

// Fictional local fixtures. Intercept every backend request BEFORE navigation;
// no request can reach hosted services. The production auth/queue code is reused.
const base = process.env.IUPC_MARKS_TEST_ORIGIN ?? 'http://127.0.0.1:5174'
assert.equal(new URL(base).hostname, '127.0.0.1')
const output = path.resolve('.local-migration/marks-entry-review')
await mkdir(output, { recursive: true })
const id = n => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const school=id(1), userId=id(2), teacher=id(3), term=id(4), math=id(5), english=id(6), empty=id(7), classId=id(8), otherClass=id(9), exam=id(10)
const learners = Array.from({length:22},(_,i)=>({id:id(100+i),school_id:school,class_id:i===21?otherClass:classId,full_name:`Fictional ${String.fromCharCode(65+i)} Learner`,admission_number:`FIX/${String(i+1).padStart(3,'0')}`,gender:i%2?'Male':'Female',status:'Active',archived:false,guardian_name:'',guardian_phone:''}))
const tables = {
  memberships:{school_id:school,role:'teacher',teacher_id:teacher,active:true}, profiles:{full_name:'Fictional Teacher',active:true},
  schools:[{id:school,name:'IUPC Academy',code:'FIX',city:'Mombasa',motto:'We make sure that everyone blossoms.'}],
  teachers:[{id:teacher,school_id:school,full_name:'Fictional Teacher',employee_id:'FIX-T',email:'marks@example.invalid',active:true}],
  teacher_permissions:[{teacher_id:teacher,permission:'marks.enter'}],
  teacher_subjects:[math,english,empty].map(subject_id=>({teacher_id:teacher,subject_id})),
  teacher_classes:[classId,otherClass].map(class_id=>({teacher_id:teacher,class_id})),
  terms:[{id:term,school_id:school,name:'Term 1',academic_year:'2026/2027',is_active:true,start_date:'2026-09-01'}],
  subjects:[{id:math,name:'Mathematics',code:'0580'},{id:english,name:'English Language',code:'0500'},{id:empty,name:'Integrated Science',code:'0654'}].map(s=>({...s,school_id:school,category:'Core',level:'IGCSE',offered:true})),
  classes:[{id:classId,school_id:school,class_name:'Year 7',stream_name:'A'},{id:otherClass,school_id:school,class_name:'Year 8',stream_name:'A'}],
  students:learners, exams:[{id:exam,school_id:school,term_id:term,class_id:classId,subject_id:math,exam_name:'CAT 1',exam_type:'CAT 1',max_score:100,status:'open',editing_deadline:null}],
  marks:[{id:id(70),school_id:school,exam_id:exam,student_id:learners[0].id,score:72,updated_at:'2026-10-01T12:00:00Z'}],
}
const exp=Math.floor(Date.now()/1000)+3600, encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url')
const user={id:userId,email:'marks@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01'}
const session={access_token:`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:userId,exp,role:'authenticated',aud:'authenticated'})}.${encode('fictional')}`,refresh_token:'fictional',expires_in:3600,expires_at:exp,token_type:'bearer',user}
const checks=[], images=[], errors=[], layouts=[]
let scenario='launch', requests=0, writes=0, failEnrollment=false, rejectWrites=false
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,args:['--no-sandbox','--disable-gpu','--disable-background-networking','--no-first-run']})
const context=await browser.createBrowserContext(), page=await context.newPage()
page.on('dialog',async dialog=>{ if (scenario!=='unsaved selection protection') { errors.push(`Unexpected selection confirmation in ${scenario}`); await dialog.dismiss() } })
page.setDefaultTimeout(12000)
page.on('pageerror',error=>errors.push(error.message))
await page.setViewport({width:1366,height:768,deviceScaleFactor:1})
await page.setRequestInterception(true)
page.on('request',request=>{
 const url=new URL(request.url())
 if(/^\/(auth|rest|functions)\/v1\//.test(url.pathname)) {
  requests++
  const headers={'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':request.headers()['access-control-request-headers']??'*','access-control-expose-headers':'content-range'}
  const reply=(body,status=200)=>{if(url.pathname.endsWith('/marks'))headers['content-range']=`*/${body.length??0}`;void request.respond({status,headers,contentType:'application/json',body:JSON.stringify(body)})}
  if(request.method()==='OPTIONS')return reply({})
  if(url.pathname==='/auth/v1/user')return reply(user)
  if(url.pathname.endsWith('/rpc/verify_student_enrollments'))return failEnrollment ? reply({message:'Fictional verification failure'},500) : reply(learners.map((s,i)=>({student_id:s.id,certainty:'verified_enrolled',subject_ids:[i===20?english:math]})))
  if(url.pathname.endsWith('/rpc/apply_offline_write')) {
   writes++; const envelope=JSON.parse(request.postData()??'{}')
   assert.equal(envelope.operation,'marks.setScore')
   if(rejectWrites)return reply({code:'42501',message:'mark entry is closed'},403)
   const p=envelope.payload
   tables.marks=tables.marks.filter(m=>m.student_id!==p.studentId||m.exam_id!==p.examId)
   tables.marks.push({id:id(200+writes),school_id:school,exam_id:p.examId,student_id:p.studentId,score:typeof p.score === 'number'?p.score:null,score_code:typeof p.score === 'string'?p.score:null,updated_at:new Date().toISOString()})
   setTimeout(()=>reply({accepted:true,result:{}}),180)
   return
  }
  if(!['GET','HEAD'].includes(request.method()))return void request.abort('blockedbyclient')
  return reply(tables[url.pathname.split('/').at(-1)]??[])
 }
 if(url.origin===base)return void request.continue()
 return void request.abort('blockedbyclient')
})
const check=(name,fn)=>{fn();checks.push(name)}
const shot=async name=>{await page.screenshot({path:path.join(output,`${name}.png`),fullPage:false});images.push(name)}
const score=student=>`[data-student-row="${student.id}"] input`
const fill=async(selector,value)=>{await page.focus(selector);await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.keyboard.press('Backspace');await page.keyboard.type(value)}
const select=async(subject)=>{await page.click('[role=combobox]');await page.click(`[data-subject-option="${subject}"]`)}
try {
 await page.goto(base,{waitUntil:'networkidle0'})
 await page.evaluate(async value=>{const {supabase}=await import('/src/data/supabase.ts');const result=await supabase.auth.setSession(value);if(result.error)throw result.error},session)
 await page.waitForSelector('.overview-page')
 await page.goto(`${base}/dashboard/marks-entry`,{waitUntil:'networkidle0'})
 await page.waitForSelector('[data-student-row]')
 await page.emulateMediaType('print')
 const printedHeading=await page.$eval('.print-only.sheet > p',el=>el.innerText.replace(/\s+/g,' ').trim())
 assert(printedHeading.includes('Year 7 A \u00b7 Term 1'),'Printed heading preserves the middle-dot separator after the class')
 assert(!printedHeading.includes('Year 7 A ?'),'No literal question-mark separator in print output')
 assert.equal(await page.$$eval('.print-only.sheet thead th',nodes=>nodes.length),7)
 await page.pdf({path:path.join(output,'marks-entry-print-separator.pdf'),format:'A4',printBackground:true})
 await page.emulateMediaType('screen')
 checks.push('Rendered print heading uses middle dot; original seven-column marks sheet retained')
 console.log('Completed:',scenario); scenario='register and responsive layout'
 checks.push('Subject enrollment excludes unrelated class and subject students')
 assert.equal(await page.$$eval('[data-student-row]',nodes=>nodes.length),20)
 assert.equal(await page.$(score(learners[20])),null)
 for(const [width,height] of [[1920,1080],[1366,768],[1280,720],[768,900],[390,844]]) {
  await page.setViewport({width,height,deviceScaleFactor:1})
  const metrics=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth,table:document.querySelector('.marks-table').getBoundingClientRect().top,rows:[...document.querySelectorAll('[data-student-row]')].filter(el=>el.getBoundingClientRect().bottom<innerHeight).length}))
  layouts.push({width,height,...metrics})
  assert(metrics.scroll<=width+1,'No page-level horizontal overflow')
  if(width>=1280) {assert(metrics.table<480,`Register starts at ${metrics.table}`);assert(metrics.rows>=3,'At least three rows visible on laptop')}
  await shot(`workspace-${width}`)
 }
 await page.$eval('.marks-table-scroll',el=>{el.scrollLeft=el.scrollWidth})
 assert(await page.$eval('.marks-table-scroll',el=>el.scrollLeft>0),'Mobile table exposes score/status through horizontal scroll')
 await shot('mobile-score-columns')
 await page.click(score(learners[0]));await shot('mobile-score-focus')
 await page.$eval('.marks-table-scroll',el=>{el.scrollLeft=0})
 checks.push('Responsive 1920/1366/1280/768/390 layouts; visible register on laptops; horizontal mobile score access')
 await page.setViewport({width:1366,height:768,deviceScaleFactor:1})
 console.log('Completed:',scenario); scenario='combobox'
 await page.click('[role=combobox]');assert(await page.$('[role=listbox]'));await shot('subject-open')
 await fill('[role=combobox]','Math');assert.equal(await page.$$eval('[role=option]',nodes=>nodes.length),1)
 await fill('[role=combobox]','0580');assert.equal(await page.$eval('[role=option]',el=>el.textContent.includes('Mathematics')),true);await shot('subject-search')
 await page.keyboard.press('Enter');assert.equal(await page.$('[role=listbox]'),null)
 assert((await page.$eval('[role=combobox]',el=>el.value)).includes('Mathematics'))
 await page.focus('[role=combobox]');await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter')
 assert((await page.$eval('[role=combobox]',el=>el.value)).includes('English'))
 assert.equal(await page.$$eval('[data-student-row]',nodes=>nodes.length),1)
 await page.click('[role=combobox]');await page.keyboard.press('Escape');assert.equal(await page.$('[role=listbox]'),null)
 await page.click('[role=combobox]');await page.click('#marks-register-heading');assert.equal(await page.$('[role=listbox]'),null)
 await select(empty);assert((await page.$eval('.marks-register',el=>el.innerText)).includes('No eligible students'));await shot('empty-register')
 await select(math)
 checks.push('Search name/code; mouse/arrow/Enter selection; Escape/outside close; retained selection; enrolled-only roster; empty state')
 console.log('Completed:',scenario); scenario='keyboard validation and submission'
 const writesBeforeEntry=writes
 await fill(score(learners[1]),'101');await page.keyboard.press('Enter');await page.waitForSelector('[aria-invalid=true]');assert.equal(writes,writesBeforeEntry)
 assert((await page.$eval('[data-student-row]',el=>el.parentElement.innerText)).includes('between 0 and 100'))
 await fill(score(learners[1]),'80');await page.keyboard.press('Enter');await page.keyboard.press('Enter')
 await page.waitForFunction(selector=>document.activeElement===document.querySelector(selector),{},score(learners[2]))
 assert.equal(writes,writesBeforeEntry+1,'Repeated Enter and blur must not duplicate a request')
 assert.equal(await page.$eval(`[data-percent="${learners[1].id}"]`,el=>el.textContent),'80.0%')
 await page.keyboard.press('ArrowDown');assert.equal(await page.$eval(score(learners[3]),el=>el===document.activeElement),true)
 await page.keyboard.press('ArrowUp');assert.equal(await page.$eval(score(learners[2]),el=>el===document.activeElement),true)
 await shot('keyboard-entry')
 for(const [index,value] of [[2,'X'],[3,'Y']]) {await fill(score(learners[index]),value);await page.keyboard.press('Enter');await page.waitForFunction(selector=>document.activeElement!==document.querySelector(selector),{},score(learners[index]));assert.equal(await page.$eval(`[data-percent="${learners[index].id}"]`,el=>el.textContent),'\u2014')}
 checks.push('Validation and normalization; X/Y remain codes; Enter advances once; Up/Down navigation')
 await page.click('[data-sort=name]');assert.equal(await page.$eval(score(learners[1]),el=>el.value),'80')
 await page.click('[data-sort=gender]');assert.equal(await page.$eval(score(learners[2]),el=>el.value),'X')
 await page.click('[data-sort=adm]')
 assert((await page.$eval('.marks-progress',el=>el.innerText)).includes('4 of 20'))
 checks.push('Sorting retains student-score identity; existing recorded-outcome progress counts X/Y')
 console.log('Completed:',scenario); scenario='unsaved selection protection'
 await fill(score(learners[5]),'120')
 await page.click('[role=combobox]')
 let confirmations=0
 page.once('dialog',async dialog=>{confirmations++;await dialog.dismiss()})
 await page.click(`[data-subject-option="${english}"]`)
 assert.equal(confirmations,1);assert((await page.$eval('[role=combobox]',el=>el.value)).includes('Mathematics'))
 await fill(score(learners[5]),'81');await page.keyboard.press('Enter');await page.waitForFunction(selector=>document.activeElement!==document.querySelector(selector),{},score(learners[5]))
 checks.push('Assessment switch cancellation preserves unsaved invalid input')
 console.log('Completed:',scenario); scenario='offline pending result'
 await page.evaluate(async()=>{Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});const {setOnline}=await import('/src/lib/offline.ts');setOnline(false)})
 await fill(score(learners[6]),'67');await page.keyboard.press('Enter')
 await page.waitForFunction(()=>document.querySelector('[data-save-status]').textContent.includes('pending synchronization'))
 await shot('pending-sync');assert((await page.$eval(`[data-student-row="${learners[6].id}"]`,el=>el.innerText)).includes('Pending sync'))
 checks.push('Offline capture labels local pending state without implying acceptance')
 console.log('Completed:',scenario); scenario='rejected recovery visibility'
 rejectWrites=true
 await page.evaluate(async()=>{Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>true});const {setOnline,syncNow}=await import('/src/lib/offline.ts');setOnline(true);await syncNow()})
 await page.waitForFunction(()=>document.querySelector('.marks-table').innerText.includes('Rejected'))
 await shot('rejected-result');checks.push('Rejected result and reason remain visible in the correct row')
 console.log('Completed:',scenario); scenario='no subject selected'
 await page.evaluate(async()=>{const {getDb,replaceDatabase}=await import('/src/data/db.ts');window.__marksFixture=getDb();replaceDatabase({...getDb(),subjects:getDb().subjects.filter(subject=>subject._id!==getDb().exams[0].subject_id)})})
 assert((await page.$eval('.marks-register',el=>el.innerText)).includes('Select a subject'));assert.equal(await page.$('[data-student-row]'),null)
 await shot('no-subject')
 await page.evaluate(async()=>{const {replaceDatabase}=await import('/src/data/db.ts');replaceDatabase(window.__marksFixture)})
 checks.push('No-subject guidance for an unresolved selection; original initial subject selection retained')
 console.log('Completed:',scenario); scenario='class refresh and locked state'
 await page.select('[data-field=class]',otherClass);assert.equal(await page.$$eval('[data-student-row]',nodes=>nodes.length),1)
 await page.select('[data-field=class]',classId)
 await page.evaluate(async()=>{const {getDb,replaceDatabase}=await import('/src/data/db.ts');const db=getDb();replaceDatabase({...db,exams:db.exams.map(exam=>({...exam,status:'locked'}))})})
 assert.equal(await page.$$eval('.marks-table input',nodes=>nodes.every(el=>el.disabled)),true)
 await shot('locked');checks.push('Class refresh and existing locked-paper permission')
 console.log('Completed:',scenario); scenario='sticky measurements'
 await page.evaluate(()=>scrollTo(0,350))
 const sticky=await page.evaluate(()=>({header:document.querySelector('.workspace-header').getBoundingClientRect().bottom,context:document.querySelector('.marks-context').getBoundingClientRect().top}))
 assert(sticky.context>=sticky.header-1,'Sticky context does not overlap school navigation')
 await page.waitForFunction(()=>document.querySelector('.marks-table th').getBoundingClientRect().top>=document.querySelector('.marks-context').getBoundingClientRect().bottom-1)
 await shot('sticky-register')
 checks.push('Measured sticky context clears existing navigation; inner table has its own sticky header')
 console.log('Completed:',scenario); scenario='unresolved enrollment'
 failEnrollment=true;await page.reload({waitUntil:'networkidle0'})
 await page.waitForSelector('.marks-notice[role=alert]');assert.equal(await page.$('[data-student-row]'),null)
 assert(!(await page.$eval('.marks-register',el=>el.innerText)).includes('No eligible students'))
 await shot('enrollment-error');checks.push('Verification errors display unresolved state, not an empty enrollment claim')
 assert.deepEqual(errors,[])
 await writeFile(path.join(output,'index.html'),`<!doctype html><meta charset="utf-8"><title>Fictional Marks Entry review</title><style>body{font:15px system-ui;max-width:1450px;margin:24px auto;background:#f7f4f5;color:#30252b}img{max-width:100%;border:1px solid #ddd}h1{color:#a90f2d}</style><h1>Marks Entry - fictional local review</h1><p>No real school data or hosted requests. ${checks.length} verification groups passed.</p>${images.map(name=>`<h2>${name}</h2><a href="${name}.png"><img loading="lazy" src="${name}.png" alt="${name}"></a>`).join('')}`)
 const results={passed:checks,layouts,images:images.length,interceptedRequests:requests,mockedWrites:writes,gallery:path.join(output,'index.html')}
 await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2))
 console.log(JSON.stringify(results,null,2))
} catch(error) {await shot('failure');console.error('FAILED SCENARIO:',scenario);throw error}
finally {await context.close();await browser.close()}
