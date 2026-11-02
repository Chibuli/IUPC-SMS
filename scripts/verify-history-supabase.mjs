import assert from 'node:assert/strict'
import { readFile,writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { createServer } from 'vite'

const out='.local-migration/phase2b-review', config=JSON.parse(await readFile(`${out}/local-stack.json`,'utf8'))
assert.equal(new URL(config.url).hostname,'127.0.0.1');assert(config.db.startsWith('iupc-history-e2e-'))
assert.equal(execFileSync('docker',['inspect','--format','{{index .Config.Labels "iupc.test"}}',config.db],{encoding:'utf8'}).trim(),'history-final')
const sql=text=>execFileSync('docker',['exec','-i',config.db,'psql','-X','-h','/tmp','-U','postgres','-v','ON_ERROR_STOP=1','-At'],{input:text,encoding:'utf8'}).trim()
let school='62000000-0000-4000-8000-000000000001',student='67000000-0000-4000-8000-000000000002',term=n=>`66000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const classA='64000000-0000-4000-8000-000000000001',classB='64000000-0000-4000-8000-000000000002',math='65000000-0000-4000-8000-000000000001',english='65000000-0000-4000-8000-000000000002'
const checks=[],clients={},sessions={}
const ok=(name,condition)=>{assert(condition,name);checks.push(name);console.log('PASS: '+name)}
const snapshotSQL="select jsonb_build_object('students',(select jsonb_agg(to_jsonb(x) order by id) from public.students x),'marks',(select jsonb_agg(to_jsonb(x) order by id) from public.marks x),'subjects',(select jsonb_agg(to_jsonb(x) order by student_id,subject_id) from public.student_subjects x),'classes',(select jsonb_agg(to_jsonb(x) order by id) from public.classes x),'exams',(select jsonb_agg(to_jsonb(x) order by id) from public.exams x),'reports',(select jsonb_agg(to_jsonb(x) order by id) from public.report_cards x))::text"
let before=sql(snapshotSQL)
const server=await createServer({configFile:false,server:{middlewareMode:true},optimizeDeps:{noDiscovery:true,entries:[]},logLevel:'error'})
const {planHistoryTransition}=await server.ssrLoadModule('/src/lib/enrollment-history-transitions.ts')
const {effectiveHistory,correctionInput}=await server.ssrLoadModule('/src/lib/enrollment-history-management.ts')
function client(fetcher){return createClient(config.url,config.anonKey,{auth:{persistSession:false,autoRefreshToken:false},...(fetcher?{global:{fetch:fetcher}}:{})})}
async function read(c=clients.admin){const result=await c.rpc('read_enrollment_history',{target_school:school,target_student:student});assert.equal(result.error,null,result.error?.code);return result.data}
const input=patch=>({term_id:term(1),coverage_kind:'whole_term',start_precision:'term_start',end_precision:'term_end',evidence_state:'confirmed',source_type:'class_register',source_reference:'FICTIONAL API EVIDENCE',reason:'Fictional verified API history',...patch})
async function request(c,steps,{version,id=crypto.randomUUID()}={}){return c.rpc('apply_enrollment_history_change',{target_school:school,target_student:student,request_id:id,expected_version:version??(await read(c)).version,steps})}
async function apply(steps){const result=await request(clients.admin,steps);assert.equal(result.error,null,result.error?.code);assert.equal(result.data.applied,true);return result.data}
async function transition(axis,row,extra={}){const snap=await read();return apply(planHistoryTransition(snap,{axis,row,date:'2099-02-01',source:'transfer_record',reference:'FICTIONAL API TRANSITION',reason:'Fictional verified transition',...extra}))}
try {
 for(const [kind,credentials] of Object.entries(config.users)){
  const c=client(),result=await c.auth.signInWithPassword({email:credentials.email,password:credentials.password})
  assert.equal(result.error,null,`${kind} local password login failed`);assert.equal(result.data.user.id,credentials.id)
  clients[kind]=c;sessions[kind]=result.data.session;checks.push(`Real local Auth password login: ${kind}`)
 }
 const registration=await clients.admin.rpc('save_student',{input_row:{school_id:school,admission_number:'FICTIONAL-E2E-'+crypto.randomUUID().slice(0,8),full_name:'Fictional API History Learner',gender:'Female',date_of_birth:null,class_id:classA,guardian_name:'',guardian_phone:'',status:'Active'},subject_ids:[math]});assert.equal(registration.error,null,registration.error?.code);student=registration.data;ok('Existing student registration and current subject assignment through real API',Boolean(student));before=sql(snapshotSQL)
 const empty=await read();ok('Actual authenticated read: empty history remains unresolved',empty.school.length===0)
 const admitted=await apply([{key:'school',axis:'school',input:input({school_state:'enrolled',entry_kind:'admission'})}]);ok('Verified school admission through PostgREST RPC',Boolean(admitted.ids.school))
 const placed=await apply([{key:'class',axis:'class',input:input({school_history_id:admitted.ids.school,class_id:classA,subject_scope_complete:true})}]);ok('Verified class placement through RPC',Boolean(placed.ids.class))
 const subject=await apply([{key:'subject',axis:'subject',input:input({class_history_id:placed.ids.class,subject_id:math,subject_state:'enrolled'})}]);ok('Verified subject eligibility through RPC',Boolean(subject.ids.subject))
 const persisted=await read();ok('Authoritative history read persists across client requests',persisted.school.length===1&&persisted.class.length===1&&persisted.subject.length===1)
 await transition('subject',persisted.subject[0],{nextSubject:english});ok('Subject change transaction through authenticated API',effectiveHistory((await read()).subject).length===3)
 const snap2=await read();await transition('class',effectiveHistory(snap2.class)[0],{date:'2099-03-01',nextClass:classB,subjects:[english],completeSubjects:true});ok('Class transfer and dependent immutable revisions through API',effectiveHistory((await read()).class).length===2)
 const snap3=await read();await transition('school',effectiveHistory(snap3.school)[0],{date:'2099-04-01'});ok('Withdrawal and dependent history committed atomically',effectiveHistory((await read()).school).some(r=>r.school_state==='not_enrolled'))
 const snap4=await read();await transition('school',effectiveHistory(snap4.school).find(r=>r.school_state==='not_enrolled'),{date:'2099-04-15'});ok('School return through API without inferred class/subjects',effectiveHistory((await read()).school).some(r=>r.entry_kind==='return'))
 const snap5=await read(),returned=effectiveHistory(snap5.school).find(r=>r.entry_kind==='return')
 await apply([{key:'correction',axis:'school',input:{...correctionInput(returned),reason:'Fictional documentary correction',source_reference:'FICTIONAL CORRECTED REGISTER'}}])
 const corrected=await read();ok('Correction appends immutable revision',corrected.school.some(r=>r.id===returned.id)&&corrected.school.some(r=>r.supersedes_id===returned.id))
 const ver=corrected.version, raceSteps=[{key:'race',axis:'school',input:input({term_id:term(2),school_state:'enrolled'})}]
 const race=await Promise.all([request(clients.admin,raceSteps,{version:ver}),request(clients.admin2,raceSteps,{version:ver})])
 ok('Two real administrator API requests: one success, one stale conflict',race.filter(r=>!r.error).length===1&&race.some(r=>r.error?.code==='PT409'))
 const overlap=await request(clients.admin,raceSteps);ok('Overlapping verified period rejected via API',overlap.error?.code==='23514')
 const stale=await request(clients.admin,raceSteps,{version:ver});ok('Stale API snapshot rejected',stale.error?.code==='PT409')
 const prior=await read(), rollback=await request(clients.admin,[{key:'valid',axis:'school',input:input({term_id:term(3),school_state:'enrolled'})},...raceSteps])
 ok('Multi-record RPC fails partway with constraint error',rollback.error?.code==='23514')
 ok('Whole transaction rolled back; no partial evidence',JSON.stringify(await read())===JSON.stringify(prior))
 const raw=await clients.admin.from('student_school_enrollment_history').update({reason:'Forbidden overwrite'}).eq('id',returned.id).select()
 ok('Direct historical UPDATE cannot bypass immutable mutation contract',raw.error?.code==='42501')
 const insert=await clients.admin.from('student_school_enrollment_history').insert({school_id:school,student_id:student,term_id:term(3)})
 ok('Direct historical INSERT denied',insert.error?.code==='42501')
 const del=await clients.admin.from('student_school_enrollment_history').delete().eq('id',returned.id)
 ok('Direct history DELETE denied',del.error?.code==='42501')
 for(const kind of ['teacher','other']){
  const r=await clients[kind].rpc('read_enrollment_history',{target_school:school,target_student:student});ok(`${kind} cannot read private history through RPC`,r.error?.code==='42501')
  const w=await request(clients[kind],raceSteps,{version:(await read()).version});ok(`${kind} cannot write history through RPC`,w.error?.code==='42501')
  const t=await clients[kind].from('student_school_enrollment_history').select('id');ok(`${kind} table read respects RLS`,!t.error&&t.data.length===0)
 }
 const cross=await clients.admin.rpc('read_enrollment_history',{target_school:'62000000-0000-4000-8000-000000000002',target_student:'67000000-0000-4000-8000-000000000003'});ok('Client-supplied other-school scope refused',cross.error?.code==='42501')
 const anon=client(),anonRead=await anon.rpc('read_enrollment_history',{target_school:school,target_student:student});ok('Unauthenticated RPC read refused',anonRead.error?.code==='42501')
 const anonWrite=await request(anon,raceSteps,{version:(await read()).version});ok('Unauthenticated RPC write refused',anonWrite.error?.code==='42501')
 const opened=await read(clients.revoked)
 sql(`update public.memberships set active=false where user_id='${config.users.revoked.id}'`)
 const revoked=await request(clients.revoked,raceSteps,{version:opened.version});ok('Membership revoked after opening: valid Auth JWT cannot authorize save',revoked.error?.code==='42501')
 const revokedRead=await clients.revoked.rpc('read_enrollment_history',{target_school:school,target_student:student});ok('Revoked member cannot read history',revokedRead.error?.code==='42501')
 let discard=true;const actualFetch=globalThis.fetch
 const interrupted=client(async(...args)=>{const response=await actualFetch(...args);if(discard&&String(args[0]).includes('/rpc/apply_enrollment_history_change')){await response.arrayBuffer();discard=false;throw new TypeError('Deliberately lost local response after real server commit')}return response})
 await interrupted.auth.signInWithPassword({email:config.users.admin.email,password:config.users.admin.password})
 const payload={id:crypto.randomUUID(),version:(await read()).version},retrySteps=[{key:'uncertain',axis:'school',input:{term_id:term(3),reason:'Fictional lost-response case',coverage_kind:'unknown'}}]
 const uncertain=await request(interrupted,retrySteps,payload);ok('Client loses response after actual database transaction',Boolean(uncertain.error))
 const afterLoss=await read(),retry=await request(clients.admin,retrySteps,payload)
 ok('Same transaction retry retrieves authoritative receipt',!retry.error&&retry.data.applied===true&&retry.data.change_id===payload.id)
 const duplicate=await request(clients.admin,retrySteps,payload);ok('Already completed transaction retry returns identical receipt',JSON.stringify(duplicate.data)===JSON.stringify(retry.data))
 ok('Retries create no additional revisions',JSON.stringify(await read())===JSON.stringify(afterLoss))
 ok('Students/accepted marks/current subjects/classes/exams/report records unchanged',sql(snapshotSQL)===before)
 await writeFile(`${out}/supabase-api-results.json`,JSON.stringify({checks,passed:checks.length,versions:config.images,postgres:config.postgres,auth:'real local GoTrue password sessions',transport:'actual Kong/PostgREST; real PostgreSQL RLS; no mocked responses',credentialPolicy:'No service-role JWT or hosted credentials used'},null,2))
 console.log(JSON.stringify({passed:checks.length,checks},null,2))
} finally {await server.close();for(const c of Object.values(clients))await c.auth.signOut({scope:'local'})}
