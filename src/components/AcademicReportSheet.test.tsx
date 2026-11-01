import {it,expect} from 'vitest'
import {renderToStaticMarkup} from 'react-dom/server'
import {academicFixture,lateFixture} from '../test/academic-report-fixtures'
import {buildAcademicReport,reportPosition} from '../lib/academic-report'
import {buildReportGraph} from '../lib/report-performance-graph'
import {DEFAULT_BANDS} from '../lib/grading'
import {AcademicReportSheet} from './AcademicReportSheet'
import {RosterTable} from './ClassListPrint'
import {BroadsheetHeader} from './BroadsheetHeader'
const record={attendance_present:0,attendance_total:0,class_teacher:'',academic:'',activities:'',conduct:'',principal:'',hse:'',next_term_begins:'',next_term_ends:''}
it('renders real report templates and optionally exports entirely fictional local inspection files',async()=>{
  const scenarios:[string,ReturnType<typeof academicFixture>,number][]=[['complete-term-1',academicFixture(),1],['complete-term-2',academicFixture(),2],['complete-term-3',academicFixture(),3],['joined-term-2',lateFixture(2),3],['joined-term-3',lateFixture(3),3],['missing-midterm',academicFixture(),1],['subject-not-taken',academicFixture(),3],['improving',academicFixture(),3],['declining',academicFixture(),3],['long-names-maximum-load',academicFixture(16),3]]
  scenarios[5][1].db.marks.splice(0,1)
  scenarios[6][1].evidence.forEach(e=>e.subjectIds=e.subjectIds.filter(id=>id!=='subject-1'))
  scenarios[8][1].db.marks.filter(m=>m.exam_id.startsWith('exam-3-')).forEach(m=>m.score=60)
  const long=scenarios[9][1];long.student.full_name='Fictional Alexander Bartholomew Wanjala Mwangi Abdulrahman Longname';long.db.subjects[0].name='Environmental management and integrated agricultural science'
  scenarios.push(['long-names-term-1',structuredClone(long),1],['long-names-term-2',structuredClone(long),2])
  scenarios.push(['medium-8-term-2',academicFixture(8),2],['medium-10-term-3',academicFixture(10),3],['large-14-term-3',academicFixture(14),3])
  const gap=academicFixture();gap.db.marks=gap.db.marks.filter(m=>!m.exam_id.startsWith('exam-2-'))
  scenarios.push(['missing-intermediate-term',gap,3])
  const punctuation=academicFixture();punctuation.student.full_name="Fictional Anne-Marie O'Neill D\u2019Souza"
  scenarios.push(['punctuated-name',punctuation,3])
  scenarios.push(['joined-term-2-view-term-2',lateFixture(2),2])
  const missingEnd=academicFixture();missingEnd.db.marks=missingEnd.db.marks.filter(m=>m.exam_id!=='exam-1-0-1')
  scenarios.push(['missing-end-term',missingEnd,1])
  const lateMissingMid=lateFixture(3);lateMissingMid.db.marks=lateMissingMid.db.marks.filter(m=>m.exam_id!=='exam-3-0-0')
  scenarios.push(['joined-term-3-missing-midterm',lateMissingMid,3])
  const titled=academicFixture();titled.db.teachers[0].full_name='Mr. Collins Sammy';titled.db.teachers[0].initials='STALE'
  scenarios.push(['assigned-teacher-title',titled,3])
  const teacherLong=academicFixture();teacherLong.db.teachers[0].full_name='Prof. Mary-Anne Wanjiku Otieno Njeri Achieng';teacherLong.db.teachers[0].initials='STALE'
  scenarios.push(['assigned-teacher-long-initials',teacherLong,3])
  const history=academicFixture();history.db.teachers.push({...history.db.teachers[0],_id:'teacher-history',full_name:'Dr. Mary Wanjiku',initials:'STALE'})
  history.db.timetableSlots.filter(slot=>slot.term_id==='term-2').forEach(slot=>slot.teacher_id='teacher-history')
  scenarios.push(['historical-teacher-term-1',history,1],['historical-teacher-term-2',history,2])
  for(const count of [14,16]){
    const high=academicFixture(count)
    high.db.marks.forEach(mark=>mark.score=mark.exam_id.startsWith('exam-1-')?90:mark.exam_id.startsWith('exam-2-')?95:100)
    scenarios.push([`high-achievement-${count}-subjects`,high,3])
  }
  const stationary=academicFixture();stationary.db.marks.forEach(mark=>mark.score=95);scenarios.push(['stationary-high-achievement',stationary,3])
  const support=academicFixture();support.db.marks.forEach(mark=>mark.score=20);scenarios.push(['stationary-support-needed',support,3])
  const fs=await import('node:fs/promises')
  const out='.local-migration/academic-report-review'
  let css=''
  if(process.env.IUPC_WRITE_ACADEMIC_FIXTURES){const name=(await fs.readdir('dist/assets')).find(f=>f.endsWith('.css'))!;css=await fs.readFile('dist/assets/'+name,'utf8');await fs.mkdir(out,{recursive:true})}
  const files:string[]=[]
  for(const [name,f,t] of scenarios){
    if(process.env.IUPC_WRITE_ACADEMIC_FIXTURES)f.db.schools[0].logo_url='data:image/png;base64,'+(await fs.readFile('public/iupc-wordmark.png')).toString('base64')
    const report=buildAcademicReport(f.db,f.student,`term-${t}`,f.student.class_id,DEFAULT_BANDS,f.evidence)
    const baselinePath=`${out}/before-stage1/baselines/${name}.json`
    const preserved=JSON.parse(JSON.stringify({report:{...report,rows:report.rows.map(({remark,initials,...rest})=>rest)},currentPosition:reportPosition(report,[report]),cumulativePosition:reportPosition(report,[report],true),graph:buildReportGraph(report)}))
    if(process.env.IUPC_CAPTURE_STAGE1_BASELINE){await fs.mkdir(`${out}/before-stage1/baselines`,{recursive:true});await fs.writeFile(baselinePath,JSON.stringify(preserved,null,2))}
    else {const baseline=await fs.readFile(baselinePath,'utf8').catch(()=>null);if(baseline)expect(preserved).toEqual(JSON.parse(baseline))}
    const beforeRender=structuredClone(report)
    const html=renderToStaticMarkup(<AcademicReportSheet school={f.db.schools[0]} student={f.student} cls={f.db.classes[0]} report={report} population={[report]} bands={DEFAULT_BANDS} record={record}/>)
    expect(report).toEqual(beforeRender)
    if(t===3 && name.startsWith('joined-')) {expect(html).toContain('Available Avg');expect(html).toContain('report-provisional-marker');expect(html).not.toContain('>Annual Avg<')}
    expect(html).not.toContain('progress ?');expect(html).not.toContain('progress-track')
    expect(html).toContain('Not recorded');expect(html).toContain('Current-term position');expect(html).toContain('Cumulative position');expect(html).toContain(`data-report-term="${t}"`);expect(html).toContain('student-watermark');expect(html).toContain('We make sure that everyone blossoms.')
    expect(html.match(/<tr>/g)).toHaveLength(f.db.subjects.length+1)
    for(const band of DEFAULT_BANDS)expect(html).toContain(`<strong>${band.grade}</strong>`)
    if(name==='long-names-maximum-load'){expect(html).toContain('report-progress-embedded');expect(html).toContain('data-graph-point=')}
    if(process.env.IUPC_WRITE_ACADEMIC_FIXTURES){await fs.writeFile(`${out}/${name}.html`,`<!doctype html><html><meta charset="utf-8"><title>Fictional fixture: ${name}</title><style>${css}</style><body data-page="report">${html}</body></html>`);files.push(name)}
  }
  for(const count of [10,35,50,75,100]){
    const f=academicFixture();const students=Array.from({length:count},(_,i)=>({...f.student,_id:`fictional-${i}`,admission_number:`FIX/${String(i+1).padStart(3,'0')}`,full_name:i%7===0?'Fictional Alexander Bartholomew Mwangi Longname':`Fictional Learner ${i+1}`}))
    const table=renderToStaticMarkup(<RosterTable students={students}/>);expect(table).toContain('<th scope="col"></th>');expect(table.match(/<td><\/td>/g)).toHaveLength(count);expect(table).toContain('width:60mm')
    if(process.env.IUPC_WRITE_ACADEMIC_FIXTURES&&!process.env.IUPC_REPORT_GRAPHS_ONLY){const header=renderToStaticMarkup(<BroadsheetHeader school={{...f.db.schools[0],logo_url:'data:image/png;base64,'+(await fs.readFile('public/iupc-wordmark.png')).toString('base64')}} title="Class list — Year 9 fictional fixture" detail={`${count} fictional students`}/>);await fs.writeFile(`${out}/class-list-${count}.html`,`<!doctype html><html><meta charset="utf-8"><style>${css}</style><body data-page="classlist"><div id="fixture-source"><div class="classlist-page-header">${header}</div>${table}<div class="classlist-signatures"><div>Class teacher — signature &amp; date</div><div>Head teacher — signature &amp; date</div></div><footer class="classlist-footer"><span>Class register</span><span>Page 1 of 1</span></footer></div></body></html>`);files.push(`class-list-${count}`)}
  }
  const comparisonFolder='before-stage1'
  const previousFiles=files.length?await fs.readdir(`${out}/${comparisonFolder}`).catch(()=>[] as string[]):[]
  if(files.length)await fs.writeFile(`${out}/index.html`,`<!doctype html><html><meta charset="utf-8"><title>IUPC fictional local report review</title><style>body{font:15px system-ui;padding:25px;background:#f5f4f5;color:#29252a}h1{color:#a90f2d}article{margin:20px 0;padding:20px;background:white;border:1px solid #ddd;border-radius:6px}.comparison{display:grid;grid-template-columns:1fr 1fr;gap:20px}iframe{width:100%;height:700px;border:1px solid #ddd}a{color:#a90f2d}small{color:#666}</style><h1>IUPC Academy | fictional report design review</h1><p>All records are fictional. Before/after PDF comparisons remain local. Raster images below were rendered from the actual generated PDFs.</p>${files.map(f=>`<article><h2>${f}</h2><p><a href="${f}.pdf">Revised PDF</a> | <a href="${f}.html">HTML</a>${f.startsWith('class-list')?'':` | <a href="${f}-pdf-page-1.png">Actual PDF image</a>`}</p><div class="comparison"><div><h3>Before</h3>${previousFiles.includes(f+'.pdf')?`<iframe loading="lazy" title="Before: ${f}" src="${comparisonFolder}/${f}.pdf"></iframe>`:'<p>Additional fixture created for this design review.</p>'}</div><div><h3>Revised</h3><iframe loading="lazy" title="Revised: ${f}" src="${f}.pdf"></iframe></div></div></article>`).join('')}</html>`)
})

it('preserves fixture numerical grades and provisional coverage exactly through rendering',()=>{
  const scenarios:[ReturnType<typeof academicFixture>,number,number,string][]=[[academicFixture(),1,75,'B'],[academicFixture(),2,80,'A'],[academicFixture(),3,85,'A'],[lateFixture(2),3,90,'A*'],[lateFixture(3),3,95,'A*']]
  for(const [f,t,average,grade] of scenarios){
    const report=buildAcademicReport(f.db,f.student,`term-${t}`,f.student.class_id,DEFAULT_BANDS,f.evidence)
    expect(report.cumulative.value).toBe(average);expect(report.rows[0].band?.grade).toBe(grade)
    const before=structuredClone(report)
    const html=renderToStaticMarkup(<AcademicReportSheet school={f.db.schools[0]} student={f.student} report={report} population={[report]} bands={DEFAULT_BANDS} record={record}/>)
    expect(report).toEqual(before)
    if(report.cumulative.status.startsWith('Provisional')){expect(html).toContain('Cumulative position unavailable');expect(html).toContain(report.cumulative.status);expect(html).toContain('Available Avg')}
  }
})
it('never joins chart points across an incomplete intermediate term',()=>{
  const f=academicFixture();f.db.marks=f.db.marks.filter(m=>!m.exam_id.startsWith('exam-2-'))
  const report=buildAcademicReport(f.db,f.student,'term-3',f.student.class_id,DEFAULT_BANDS,f.evidence)
  const html=renderToStaticMarkup(<AcademicReportSheet school={f.db.schools[0]} student={f.student} report={report} population={[report]} bands={DEFAULT_BANDS} record={record}/>)
  expect(html).toContain('Unavailable');expect(html).not.toContain('data-progress-segment=');expect(html).toContain('Performance Trend')
  expect(report.cumulative.value).toBeNull()
})
it('labels mixed subject coverage per subject without calling all numeric results annual',()=>{
  const f=academicFixture(),late=lateFixture(3)
  const report=buildAcademicReport(f.db,f.student,'term-3',f.student.class_id,DEFAULT_BANDS,f.evidence)
  const lateReport=buildAcademicReport(late.db,late.student,'term-3',late.student.class_id,DEFAULT_BANDS,late.evidence)
  // A synthetic renderer-only view model verifies defensive mixed-coverage presentation.
  report.rows[0]=lateReport.rows[0]
  report.cumulative={value:null,status:'Unresolved — mixed subject coverage'}
  const before=structuredClone(report)
  const html=renderToStaticMarkup(<AcademicReportSheet school={f.db.schools[0]} student={f.student} report={report} population={[report]} bands={DEFAULT_BANDS} record={record}/>)
  expect(html).toContain('Annual / available avg');expect(html.match(/class="report-provisional-marker"/g)).toHaveLength(2)
  expect(html).toContain('Unmarked numeric averages cover all required terms.');expect(report).toEqual(before)
})
it('prints only configured contacts and a single footer motto, retaining saved remarks and unavailable signatories',()=>{
  const f=academicFixture();f.db.schools[0].address='';f.db.schools[0].postal='';f.db.schools[0].city='Mombasa, Kenya'
  const report=buildAcademicReport(f.db,f.student,'term-1',f.student.class_id,DEFAULT_BANDS,f.evidence)
  const html=renderToStaticMarkup(<AcademicReportSheet school={f.db.schools[0]} student={f.student} report={report} population={[report]} bands={DEFAULT_BANDS} record={{...record,principal:'Continue your careful work.'}}/>)
  expect(html).not.toContain('Tel:');expect(html.match(/We make sure that everyone blossoms./g)).toHaveLength(1)
  expect(html).toContain('Continue your careful work.');expect(html).toContain('House master’s remarks');expect(html).not.toContain('Fictional report inspection')
})
