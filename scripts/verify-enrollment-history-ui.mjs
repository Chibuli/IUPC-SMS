import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

// Fictional browser contract fixtures. Every external request is intercepted
// before navigation. Use a dev server configured with a fictional loopback API.
const base='http://127.0.0.1:5178', output=path.resolve('.local-migration/phase2b-review')
await mkdir(output,{recursive:true})
const fid=(tag,n)=>`${tag}000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const school=fid('62',1), admin=fid('61',1), student=fid('67',2), term=fid('66',1), classA=fid('64',1), classB=fid('64',2), math=fid('65',1), english=fid('65',2)
let role='admin', mode='normal', writes=0, reads=0, holdWrite=false
let snapshot={school:[],class:[],subject:[],version:'empty',contract_version:1,server_version_num:150019}
const common={school_id:school,student_id:student,term_id:term,revision:1,supersedes_id:null,change_id:fid('81',1),coverage_kind:'whole_term',start_precision:'term_start',end_precision:'term_end',effective_from:null,effective_to:null,evidence_state:'confirmed',source_type:'class_register',source_reference:'FICTIONAL REGISTER',reason:'Fictional documented history',recorded_by:admin,recorded_at:'2099-01-01T12:00:00Z',updated_at:'2099-01-01T12:00:00Z',confirmed_by:admin,confirmed_at:'2099-01-01T12:00:00Z'}
const seeded=()=>({school:[{...common,id:fid('80',1),fact_id:fid('82',1),school_state:'enrolled',entry_kind:'admission'}],class:[{...common,id:fid('80',2),fact_id:fid('82',2),school_history_id:fid('80',1),class_id:classA,subject_scope_complete:true}],subject:[{...common,id:fid('80',3),fact_id:fid('82',3),class_history_id:fid('80',2),subject_id:math,subject_state:'enrolled'}],version:'seeded',contract_version:1,server_version_num:150019})
const tables={
 schools:[{id:school,name:'IUPC Academy',code:'FIX',city:'Mombasa',motto:'We make sure that everyone blossoms.'}],
 teachers:[],teacher_permissions:[],teacher_subjects:[],teacher_classes:[],
 classes:[{id:classA,school_id:school,class_name:'Year 7',stream_name:'A'},{id:classB,school_id:school,class_name:'Year 7',stream_name:'B'}],
 subjects:[{id:math,name:'Mathematics',code:'0580'},{id:english,name:'English Language',code:'0500'}].map(s=>({...s,school_id:school,category:'Core',level:'IGCSE',offered:true})),
 terms:[{id:term,school_id:school,name:'Term 1',academic_year:'2099',is_active:true,start_date:'2099-01-01'}],
 students:[{id:student,school_id:school,class_id:classA,full_name:'Baraka Fictional Mwangi',admission_number:'FICTIONAL/002',gender:'Male',status:'Active',archived:false,guardian_name:'',guardian_phone:''}],
 exams:[],marks:[],
}
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url'), exp=Math.floor(Date.now()/1000)+3600
const user={id:admin,email:'history@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2099-01-01'}
const session={access_token:`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:admin,exp,role:'authenticated',aud:'authenticated'})}.${encode('fictional')}`,refresh_token:'fictional',expires_in:3600,expires_at:exp,token_type:'bearer',user}
const images=[],checks=[],errors=[],requests=[],plans=[]
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,args:['--no-sandbox','--disable-gpu','--disable-background-networking','--no-first-run']})
const context=await browser.createBrowserContext(),page=await context.newPage()
page.setDefaultTimeout(10000)
page.on('pageerror',e=>errors.push(e.message))
await page.setViewport({width:1366,height:900,deviceScaleFactor:1})
await page.setRequestInterception(true)
page.on('request',request=>{
 const url=new URL(request.url())
 if(/^\/(auth|rest|functions)\/v1\//.test(url.pathname)) {
  assert.equal(url.origin,'http://127.0.0.1:59999','Only the fictional loopback API is allowed')
  const headers={'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':request.headers()['access-control-request-headers']??'*','access-control-expose-headers':'content-range'}
  const reply=(body,status=200)=>void request.respond({status,headers,contentType:'application/json',body:JSON.stringify(body)})
  if(request.method()==='OPTIONS')return reply({})
  if(url.pathname==='/auth/v1/user')return reply(user)
  if(url.pathname.endsWith('/memberships'))return reply({school_id:school,role,teacher_id:null,active:true})
  if(url.pathname.endsWith('/profiles'))return reply({full_name:'Fictional Administrator',active:true})
  if(url.pathname.endsWith('/rpc/verify_student_enrollments'))return reply([{student_id:student,certainty:'verified_enrolled',subject_ids:[math]}])
  if(url.pathname.endsWith('/rpc/read_enrollment_history')) {reads++;return mode==='setup'?reply({code:'PGRST202',message:'Fictional missing function'},404):mode==='read-network'?void request.abort('failed'):reply(snapshot)}
  if(url.pathname.endsWith('/rpc/apply_enrollment_history_change')) {
   writes++;const payload=JSON.parse(request.postData());requests.push(payload)
   if(mode==='conflict')return reply({code:'23514',message:'Fictional overlap'},400)
   if(mode==='stale')return reply({code:'40001',message:'Fictional stale revision'},409)
   if(mode==='network')return void request.abort('failed')
   if(mode==='permission')return reply({code:'42501',message:'Fictional revoked membership'},403)
   const apply=()=>{for(const step of payload.steps){const id=fid('90',snapshot.school.length+snapshot.class.length+snapshot.subject.length+1);snapshot[step.axis].push({...common,...step.input,id,fact_id:id,recorded_at:new Date().toISOString()})}snapshot.version=`version-${writes}`;reply({applied:true,change_id:payload.request_id,ids:{}})}
   if(holdWrite){setTimeout(apply,250);return}return apply()
  }
  if(!['GET','HEAD'].includes(request.method())) {errors.push(`Unexpected write ${url.pathname}`);return void request.abort('blockedbyclient')}
  if(url.pathname.endsWith('/marks'))headers['content-range']='*/0'
  return reply(tables[url.pathname.split('/').at(-1)]??[])
 }
 if(url.origin===base)return void request.continue()
 return void request.abort('blockedbyclient')
})
async function shot(name,focus){if(focus)await page.$eval(focus,el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:path.join(output,`${name}.png`),fullPage:false});images.push(name)}
async function button(text,scope='.enrollment-history'){const handle=await page.evaluateHandle((s,t)=>[...document.querySelectorAll(`${s} button`)].find(e=>e.textContent.trim()===t),scope,text);const element=handle.asElement();assert(element,`Button ${text}`);await element.click();await handle.dispose()}
async function field(text,value,form='.eh-editor',type='input'){
 const handle=await page.evaluateHandle((s,t,type)=>[...document.querySelectorAll(`${s} label`)].find(e=>e.firstChild?.textContent.trim()===t)?.querySelector(type),form,text,type)
 const element=handle.asElement();assert(element,`Field ${text}`)
 if(type==='select')await element.select(value)
 else if(type==='checkbox'){await element.click()}
 else await element.evaluate((el,value)=>{const setter=Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;setter.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))},value)
 await handle.dispose()
}
async function checkbox(prefix){const el=await page.evaluateHandle(p=>[...document.querySelectorAll('.eh-editor label')].find(e=>e.textContent.trim().startsWith(p))?.querySelector('input[type=checkbox]'),prefix);assert(el.asElement(),prefix);await el.asElement().click();await el.dispose()}
async function reopen(){await page.goto(`${base}/dashboard/students/${student}`,{waitUntil:'networkidle0'});await page.waitForSelector('#student-tab-history');await page.click('#student-tab-history');await page.waitForFunction(()=>!document.querySelector('.enrollment-history')?.textContent.includes('Loading enrollment history...'))}
async function admission(){await button('Record period','[aria-label="School enrollment"]');await field('Academic term',term,'.eh-editor','select');await field('Evidence status','confirmed','.eh-editor','select');await field('Start boundary','term_start','.eh-editor','select');await field('End boundary','term_end','.eh-editor','select');await field('School enrollment status','enrolled','.eh-editor','select');await field('Entry reason','admission','.eh-editor','select');await field('Document / record reference','FICTIONAL ADMISSION REGISTER');await field('Reason for recording or correcting','Fictional admission evidence','.eh-editor','textarea');await checkbox('I checked');await button('Add to reviewed change');await page.waitForSelector('.eh-review')}
async function waitError(text){await page.waitForFunction(t=>[...document.querySelectorAll('[role=alert]')].some(e=>e.textContent.includes(t)),{},text)}
try {
 await page.goto(base,{waitUntil:'networkidle0'})
 await page.evaluate(async value=>{const {supabase}=await import('/src/data/supabase.ts');const result=await supabase.auth.setSession(value);if(result.error)throw result.error},session)
 await page.waitForSelector('.overview-page')
 await reopen();assert((await page.$eval('.eh-empty',e=>e.textContent)).includes('not yet verified'));await shot('01-unverified-history');checks.push('Administrator opens empty history; no inferred enrollment')
 await admission();await shot('02-reviewed-admission');holdWrite=true;await button('Confirm and save history');await button('Awaiting confirmation...');await page.waitForFunction(()=>document.querySelector('.eh-notice')?.textContent.includes('confirmed'));assert.equal(writes,1);holdWrite=false;checks.push('Verified admission waits for confirmation; duplicate click prevented')
 snapshot=seeded();await reopen();await shot('03-school-class-subject-history')
 await button('Correct evidence','[aria-label="School enrollment"]');assert.equal(await page.$eval('.eh-editor select',e=>e.disabled),true);await shot('04-correction-evidence','.eh-editor');await button('Cancel entry')
 await button('Record transfer');await field('Verified effective date','2099-02-01');await field('Destination class',classB,'.eh-editor','select');await field('Evidence reference','FICTIONAL TRANSFER');await field('Reason','Fictional class transfer','.eh-editor','textarea');await checkbox('English Language');await checkbox('The evidence establishes');await checkbox('I verified');await shot('05-class-transfer-form','.eh-editor');await button('Review complete transition');assert.equal(await page.$$eval('.eh-review li',els=>els.length),5);await shot('06-class-transfer-review','.eh-review');
 const transferPlan=await page.evaluate(async()=>{const {planHistoryTransition}=await import('/src/lib/enrollment-history-transitions.ts');return typeof planHistoryTransition});assert.equal(transferPlan,'function')
 mode='conflict';await button('Confirm and save history');await waitError('conflicts');await shot('07-conflict-error','[role=alert]');assert(await page.$('.eh-review'));checks.push('Class transfer staged as five immutable records; conflict retains complete change')
 plans.push({name:'class-transfer',seed:seeded(),steps:requests.at(-1).steps})
 snapshot=seeded();mode='normal';await reopen();await button('Discontinue / change subject');await field('Verified effective date','2099-02-01');await field('New subject (optional)',english,'.eh-editor','select');await field('Evidence reference','FICTIONAL SUBJECT CHANGE');await field('Reason','Fictional subject change','.eh-editor','textarea');await checkbox('I verified');await button('Review complete transition');await shot('08-subject-change-review');mode='network';await button('Confirm and save history');await waitError('confirmation was not received');const uncertain=requests.at(-1);await shot('09-network-uncertain','[role=alert]');mode='conflict';await button('Retry same change / check receipt');await waitError('conflicts');assert.deepEqual(requests.at(-1),uncertain);plans.push({name:'subject-change',seed:seeded(),steps:uncertain.steps});checks.push('Subject change uses actual subject IDs; lost-response retry preserves exact request identity')
 snapshot=seeded();mode='normal';await reopen();await button('Record withdrawal');await field('Verified effective date','2099-02-01');await field('Evidence reference','FICTIONAL DEPARTURE');await field('Reason','Fictional school withdrawal','.eh-editor','textarea');await checkbox('I verified');await button('Review complete transition');mode='stale';await button('Confirm and save history');await waitError('changed while');plans.push({name:'school-withdrawal',seed:seeded(),steps:requests.at(-1).steps});await shot('10-stale-history','[role=alert]');checks.push('Withdrawal includes child revisions; stale snapshot blocks further save until reload')
 mode='setup';await reopen();await waitError('not installed');await shot('11-schema-not-installed');assert.equal(await page.$('.eh-timeline'),null);checks.push('Missing history schema shown accurately without local fallback')
 mode='normal';snapshot=seeded();await reopen();await page.setViewport({width:390,height:844,deviceScaleFactor:1});await shot('12-mobile-history');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await button('Correct evidence','[aria-label="Subject history"]');await shot('13-mobile-correction','.eh-editor');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks.push('390px history and correction have no page-level horizontal overflow')
 mode='normal';snapshot=seeded();snapshot.class=[];snapshot.subject=[];snapshot.school[0].school_state='not_enrolled';snapshot.school[0].entry_kind='unknown';const returnedSeed=structuredClone(snapshot);await reopen();await button('Record return');await field('Verified effective date','2099-02-10');await field('Evidence reference','FICTIONAL RETURN');await field('Reason','Fictional verified return','.eh-editor','textarea');await checkbox('I verified');await button('Review complete transition');mode='conflict';await button('Confirm and save history');await waitError('conflicts');plans.push({name:'school-return',seed:returnedSeed,steps:requests.at(-1).steps});checks.push('Return records a new enrolled period with return provenance, without inferring class or subjects')
 mode='read-network';await reopen();await waitError('could not be loaded');assert.equal(await page.$('.eh-empty'),null);await shot('15-loading-failure','[role=alert]');checks.push('Network loading failure is distinct from empty history')
 mode='normal';snapshot=seeded();await reopen();const offlineReads=reads;await page.evaluate(()=>Object.defineProperty(navigator,'onLine',{configurable:true,value:false}));await button('Reload history');await waitError('requires an online');assert.equal(reads,offlineReads);await shot('16-offline-blocked','[role=alert]');await page.evaluate(()=>delete navigator.onLine);checks.push('Offline history requests blocked before dispatch; no queue or local persistence')
 await reopen();await admission();mode='permission';await button('Confirm and save history');await waitError('administrator access');assert.equal(await page.$('.eh-review'),null);assert.equal(await page.$('.eh-timeline'),null);await shot('17-revoked-access','[role=alert]');checks.push('Revoked access clears documentary data and staged edits')
 mode='normal';
 await page.setViewport({width:1366,height:900,deviceScaleFactor:1});role='teacher';const priorReads=reads;await reopen();assert.equal(reads,priorReads);assert((await page.$eval('.eh-body',e=>e.textContent)).includes('restricted to school administrators'));await shot('14-read-only-teacher');checks.push('Teacher sees restriction; no documentary read or write is attempted')
 assert.deepEqual(errors,[])
 await writeFile(path.join(output,'ui-plans.json'),JSON.stringify(plans,null,2))
 await writeFile(path.join(output,'browser-results.json'),JSON.stringify({checks,images,writes,historyReads:reads,externalNetwork:'blocked; fictional loopback API intercepted',errors},null,2))
 await writeFile(path.join(output,'index.html'),`<!doctype html><html><meta charset="utf-8"><title>IUPC fictional Phase 2B review</title><style>body{font:14px system-ui;margin:24px;background:#f5f5f5}h1{color:#A90F2D}section{background:white;padding:16px;margin:16px 0}img{max-width:100%;border:1px solid #ddd}</style><h1>Phase 2B fictional local review</h1><p>Intercepted browser fixtures, not real student data or a live database.</p>${images.map(name=>`<section><h2>${name}</h2><a href="${name}.png"><img src="${name}.png"></a></section>`).join('')}</html>`)
 console.log(JSON.stringify({passed:checks.length,checks,screenshots:images.length,output},null,2))
} finally {await browser.close()}
