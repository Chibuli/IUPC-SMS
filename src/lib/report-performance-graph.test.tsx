import {describe,it,expect} from 'vitest'
import {renderToStaticMarkup} from 'react-dom/server'
import {academicFixture,lateFixture} from '../test/academic-report-fixtures'
import {buildAcademicReport,reportPosition} from './academic-report'
import {buildReportGraph} from './report-performance-graph'
import {DEFAULT_BANDS} from './grading'
import {ReportPerformanceGraph} from '../components/ReportPerformanceGraph'
import {AcademicReportSheet} from '../components/AcademicReportSheet'

type Fixture=ReturnType<typeof academicFixture>
const reportFor=(f:Fixture,term:number)=>buildAcademicReport(f.db,f.student,`term-${term}`,f.student.class_id,DEFAULT_BANDS,f.evidence)
const missing=(component:0|1,joinTerm=1)=>{
  const f=joinTerm===1?academicFixture():lateFixture(joinTerm)
  f.db.marks=f.db.marks.filter(mark=>mark.exam_id!==`exam-${joinTerm}-0-${component}`)
  return f
}
describe('performance graph presentation mapping',()=>{
  const cases:[string,Fixture,number,string[],number[],number][]=[
    ['A complete Term 1',academicFixture(),1,['Midterm','End Term'],[70,80],1],
    ['B complete Term 2',academicFixture(),2,['Term 1 Avg','Term 2 Avg'],[75,85],1],
    ['C complete Term 3',academicFixture(),3,['Term 1 Avg','Term 2 Avg','Term 3 Avg'],[75,85,95],2],
    ['D joined Term 2 / Term 2 report',lateFixture(2),2,['Midterm','End Term'],[80,90],1],
    ['E joined Term 3 / Term 3 report',lateFixture(3),3,['Midterm','End Term'],[90,100],1],
    ['F joined Term 2 / Term 3 report',lateFixture(2),3,['Term 2 Avg','Term 3 Avg'],[85,95],1],
    ['G missing Midterm',missing(0),1,['End Term'],[80],0],
    ['H missing End Term',missing(1),1,['Midterm'],[70],0],
  ]
  it.each(cases)('%s',(_,f,term,labels,values,segments)=>{
    const report=reportFor(f,term),before=structuredClone(report)
    const graph=buildReportGraph(report)
    expect(graph.points.map(point=>point.label)).toEqual(labels)
    expect(graph.points.map(point=>point.value)).toEqual(values)
    expect(graph.trend).toBe(values.length>1?'Improving +10.0 pp':'—')
    const html=renderToStaticMarkup(<ReportPerformanceGraph graph={graph}/>)
    expect(html.match(/data-graph-point=/g)??[]).toHaveLength(values.length)
    expect(html.match(/data-progress-segment=/g)??[]).toHaveLength(segments)
    expect(html).toContain('Performance Trend');expect(report).toEqual(before)
    if(f.evidence.some(e=>e.eligibility==='pre-enrollment'))expect(reportPosition(report,[report],true)).toBe('—')
  })
  it.each([0,1] as const)('shows a single current-term component for a Term 3 admission missing component %i',component=>{
    const graph=buildReportGraph(reportFor(missing(component,3),3))
    expect(graph.mode).toBe('assessment');expect(graph.points).toHaveLength(1);expect(graph.points[0].value).toBe(component===0?100:90);expect(graph.trend).toBe('—')
  })
  it('leaves a real intermediate gap disconnected and does not manufacture a trend',()=>{
    const f=academicFixture();f.db.marks=f.db.marks.filter(mark=>!mark.exam_id.startsWith('exam-2-'))
    const graph=buildReportGraph(reportFor(f,3))
    expect(graph.points.map(p=>p.order)).toEqual([0,2]);expect(graph.unavailable).toEqual(['Term 2 Avg']);expect(graph.trend).toBe('—')
    expect(renderToStaticMarkup(<ReportPerformanceGraph graph={graph}/>)).not.toContain('data-progress-segment=')
  })
  it('uses the latest consecutive plotted points when the selected term remains incomplete',()=>{
    const f=academicFixture();f.db.marks=f.db.marks.filter(mark=>!mark.exam_id.startsWith('exam-3-'))
    const report=reportFor(f,3),graph=buildReportGraph(report)
    expect(graph.points.map(p=>p.value)).toEqual([75,85]);expect(graph.trend).toBe('Improving +10.0 pp');expect(report.current.value).toBeNull();expect(report.cumulative.value).toBeNull()
  })
  it('does not treat unknown or missing historical eligibility as a late admission',()=>{
    const f=academicFixture();f.evidence=f.evidence.filter(e=>e.termId==='term-3')
    const graph=buildReportGraph(reportFor(f,3))
    expect(graph.mode).toBe('term');expect(graph.points.map(p=>p.label)).toEqual(['Term 3 Avg']);expect(graph.trend).toBe('—')
  })
  it('does not drop a missing enrolled Term 1 from a Term 2 timeline or replace it with an assessment fallback',()=>{
    const f=academicFixture();f.db.marks=f.db.marks.filter(mark=>!mark.exam_id.startsWith('exam-1-'))
    const graph=buildReportGraph(reportFor(f,2))
    expect(graph.mode).toBe('term');expect(graph.points.map(p=>p.value)).toEqual([85]);expect(graph.unavailable).toEqual(['Term 1 Avg'])
  })
  it('requires comparable full subject coverage for each assessment average',()=>{
    const f=missing(0),graph=buildReportGraph(reportFor(f,1))
    expect(graph.points.map(p=>p.label)).toEqual(['End Term']);expect(graph.unavailable).toEqual(['Midterm'])
  })
  it('does not count a verified subject not taken as zero',()=>{
    const f=academicFixture();f.evidence.forEach(e=>e.subjectIds=e.subjectIds.filter(id=>id!=='subject-1'))
    expect(buildReportGraph(reportFor(f,1)).points.map(p=>p.value)).toEqual([70,80])
  })
  it('reuses normalized component outputs for papers with unequal maxima',()=>{
    const f=academicFixture();f.db.exams[0].max_score=50;f.db.marks[0].score=35
    expect(buildReportGraph(reportFor(f,1)).points.map(p=>p.value)).toEqual([70,80])
  })
  it.each([[70,'Stationary 0.0 pp'],[60,'Dropped -10.0 pp'],[80,'Improving +10.0 pp']] as const)('matches plotted trend at End Term %s', (value,trend)=>{
    const f=academicFixture();f.db.marks.filter(m=>m.exam_id.startsWith('exam-1-')&&m.exam_id.endsWith('-1')).forEach(m=>m.score=value)
    expect(buildReportGraph(reportFor(f,1)).trend).toBe(trend)
  })
  it('treats numeric zero as valid without inventing missing marks',()=>{
    const f=academicFixture();f.db.marks.filter(m=>m.exam_id.startsWith('exam-1-')).forEach(m=>m.score=0)
    expect(buildReportGraph(reportFor(f,1)).points.map(p=>p.value)).toEqual([0,0])
  })
  it('excludes unfinalized marks and explicitly states when no verified point can be plotted',()=>{
    const f=academicFixture();f.db.exams.filter(e=>e.term_id==='term-1').forEach(e=>e.status='open')
    const graph=buildReportGraph(reportFor(f,1));expect(graph.points).toEqual([])
    const html=renderToStaticMarkup(<ReportPerformanceGraph graph={graph}/>);expect(html).toContain('No verified results available.');expect(html).not.toContain('<svg')
  })
  it('uses the selected report period and never future term results',()=>{
    const f=academicFixture();f.db.marks.filter(m=>m.exam_id.startsWith('exam-3-')).forEach(m=>m.score=0)
    expect(buildReportGraph(reportFor(f,1)).points.map(p=>p.value)).toEqual([70,80])
    expect(buildReportGraph(reportFor(f,2)).points.map(p=>p.value)).toEqual([75,85])
  })
})
it('aligns the displayed overall trend to the selected graph without changing engine trend or grades',()=>{
  const f=academicFixture(),report=reportFor(f,1),before=structuredClone(report)
  const record={attendance_present:0,attendance_total:0,class_teacher:'',academic:'',activities:'',conduct:'',principal:'',hse:'',next_term_begins:'',next_term_ends:''}
  const html=renderToStaticMarkup(<AcademicReportSheet school={f.db.schools[0]} student={f.student} report={report} population={[report]} bands={DEFAULT_BANDS} record={record}/>)
  expect(html).toContain('<span>Overall performance trend</span><strong>Improving +10.0 pp</strong>')
  expect(report.trend).toBe('—');expect(report).toEqual(before);expect(report.rows[0].band?.grade).toBe('B')
})
