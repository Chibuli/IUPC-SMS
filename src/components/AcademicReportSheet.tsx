import { useLayoutEffect, useRef, useState } from 'react'
import type { ClassRow, GradeBand, ReportCard, School, Student } from '../data/types'
import { SchoolLogo } from './ui'
import { type AcademicReport, reportPosition, reportValue } from '../lib/academic-report'
import { bandFor } from '../lib/grading'
import { formatDate } from '../lib/format'
import { buildReportGraph } from '../lib/report-performance-graph'
import { ReportPerformanceGraph } from './ReportPerformanceGraph'

type Props = { school: School; student: Student; cls?: ClassRow; report: AcademicReport; population: AcademicReport[]; bands: GradeBand[]; record: Omit<ReportCard, '_id'|'student_id'|'term_id'|'updated_at'>; classTeacherName?: string }

function SignatureLine({label}: {label: string}) {
  return <span className="report-signature-field"><span>{label}</span><span className="report-rule"/></span>
}
function RemarkLine({label,value}: {label: string; value: string}) {
  return <p className="report-remark-line"><span>{label}</span>{value?<span className="report-saved-remark">{value}</span>:<span className="report-rule"/>}</p>
}

export function AcademicReportSheet({school,student,cls,report,population,bands,record,classTeacherName}:Props) {
  const ref = useRef<HTMLElement>(null)
  const [overflow,setOverflow] = useState(false)
  const [omitGraph,setOmitGraph] = useState(false)
  const [compactGraph,setCompactGraph] = useState(false)
  const graph = buildReportGraph(report)
  const embeddedGraph = report.rows.length>10
  useLayoutEffect(()=>{
    setOmitGraph(false)
    setCompactGraph(false)
    const check=()=>{
      const el=ref.current
      if(!el)return
      const chart=el.querySelector<HTMLElement>('.report-progress')
      if(el.scrollHeight>1040 && chart){
        if(chart.dataset.graphSize!=='compact'){setCompactGraph(true);return}
        setOmitGraph(true);return
      }
      setOverflow(el.scrollHeight>1040)
    }
    let cancelled=false
    const safeCheck=()=>{if(!cancelled)check()}
    safeCheck();void document.fonts.ready.then(safeCheck)
    const observer=new ResizeObserver(safeCheck)
    if(ref.current)observer.observe(ref.current)
    return ()=>{cancelled=true;observer.disconnect()}
  },[report,student])
  const sorted = [...bands].sort((a,b)=>b.min_score-a.min_score)
  const grade = report.cumulative.value===null?'—':bandFor(report.cumulative.value,bands).grade
  const provisional = report.rows.some(row=>row.cumulative.status.startsWith('Provisional'))
  const mixedCoverage = provisional && report.rows.some(row=>row.cumulative.value!==null && row.cumulative.status==='Complete')
  // Rename headings and add markers without modifying engine-owned columns, values or statuses.
  const columns = report.columns.map((column,i)=>i===report.termNumber+1 && report.termNumber>1
    ? provisional ? mixedCoverage ? (report.termNumber===3?'Annual / available avg':'Cumul. / available avg') : 'Available Avg' : report.termNumber===3?'Annual Avg':'Cumulative Avg'
    : column==='Cumul. grade'||column==='Annual grade' ? 'Grade' : column==='Pts' ? 'Points' : column==='Pos' ? 'Position' : column)
  const metrics = [
    {label:'Current-term overall average',value:reportValue(report.current)+(report.current.value===null?'':'%'),numeric:report.current.value!==null},
    {label:'Cumulative overall average',value:reportValue(report.cumulative)+(report.cumulative.value===null?'':'%'),numeric:report.cumulative.value!==null},
    {label:'Current-term position',value:reportPosition(report,population),numeric:true},
    {label:'Cumulative position',value:reportPosition(report,population,true),numeric:true},
  ]
  const cells = (row: AcademicReport['rows'][number]) => {
    const values = report.termNumber===1 ? row.current.components.map(reportValue) : row.results.map(reportValue)
    return [...values, reportValue(row.cumulative),row.band?.grade??'—',row.band?.points??'—',...(report.termNumber===1?[subjectPosition(row)]:[]),row.trend,row.remark,row.initials]
  }
  function subjectPosition(row:AcademicReport['rows'][number]) {
    if(row.current.value===null || row.current.eligibility!=='enrolled')return '—'
    const scores=population.filter(p=>p.term._id===report.term._id && p.classId===report.classId && p.group===report.group).flatMap(p=>p.rows.filter(r=>r.subject._id===row.subject._id && r.current.eligibility==='enrolled' && r.current.value!==null).map(r=>r.current.value!))
    return `${1+scores.filter(v=>v>row.current.value!+1e-9).length}/${scores.length}`
  }
  const contacts = [school.phone_number?`Tel: ${school.phone_number}`:'',school.contact_email].filter(Boolean)
  const location = [school.address,school.postal,school.city && !school.address.includes(school.city)?school.city:''].filter(Boolean)
  return <>
    {overflow?<p role="alert" className="no-print">This report exceeds the readable one-page A4 limit. Review the subject load or long remarks before printing; required information has been retained.</p>:null}
    {omitGraph?<p role="status" className="no-print">Performance Trend could not fit at the minimum readable chart size. The chart is omitted; academic results are retained.</p>:null}
    <article ref={ref} className={`sheet sheet-report card intelligent-report ${report.rows.length>10?'report-dense':report.rows.length<6?'report-spacious':''}`} data-report-term={report.termNumber}>
      <div className="student-watermark" aria-hidden="true"><span>{student.full_name}</span></div>
      <header className="report-masthead">
        <div className="report-logo"><SchoolLogo school={school} size={42}/></div>
        <div className="report-school"><p className="report-school-name">{school.name}</p>{location.length?<p>{location.join(' · ')}</p>:null}{contacts.length?<p>{contacts.join(' · ')}</p>:null}</div>
        <div className="report-printed"><span>Printed</span><time>{formatDate(new Date().toISOString())}</time></div>
        <h1>Academic report — {report.term.name}, {report.term.academic_year}</h1>
      </header>
      <section className="report-identity"><div><span className="report-eyebrow">Student</span><p className="report-student-name">{student.full_name}</p></div><div className="report-student-details"><p><span>Admission no.</span><strong>{student.admission_number}</strong></p><p><span>Class</span><strong>{cls?.class_name} {cls?.stream_name}</strong></p><p><span>Attendance</span><strong>{record.attendance_total>0 && record.attendance_present>=0 && record.attendance_present<=record.attendance_total?`${record.attendance_present}/${record.attendance_total}`:'Not recorded'}</strong></p></div></section>
      <table className="report-subjects"><colgroup><col style={{width:'22%'}}/>{columns.slice(1,-2).map((_,i)=><col key={i} style={report.columns[i+1]==='Trend'?{width:'15%'}:undefined}/>)}<col style={{width:'17%'}}/><col style={{width:'7%'}}/></colgroup><thead><tr>{columns.map((c,i)=><th key={i} scope="col">{c}</th>)}</tr></thead><tbody>{report.rows.map(row=><tr key={row.subject._id}><td><strong>{row.subject.name}</strong><small>{row.subject.code}</small></td>{cells(row).map((cell,i)=>{
        const isAverage=i===(report.termNumber===1?2:report.termNumber), isGrade=i===(report.termNumber===1?3:report.termNumber+1)
        return <td key={i} className={isAverage?'report-result-average':isGrade?'report-result-grade':undefined} title={isAverage||isGrade?row.cumulative.status:undefined}>{cell}{(isAverage||isGrade)&&row.cumulative.status.startsWith('Provisional')?<sup className="report-provisional-marker">P</sup>:null}</td>
      })}</tr>)}</tbody></table>
      {provisional?<p className="report-provisional-key"><strong>P</strong> Available-term average and provisional grade. {mixedCoverage?'Unmarked numeric averages cover all required terms. ':''}See academic coverage below; no official cumulative position is awarded for provisional coverage.</p>:null}
      <p className="report-results-key">N/A: verified pre-enrollment · N/T: verified subject not taken · INC: required result incomplete · Pending: awaiting finalized mark · Unresolved: historical eligibility unknown. X remains missing; Y remains irregularity. Absence/exemption cannot be inferred.</p>
      <section className={`report-summary${embeddedGraph && !omitGraph?' report-summary-with-graph':''}`} aria-label="Academic results"><div className="report-summary-content"><h2>Academic results</h2><div className="report-summary-metrics">{metrics.map(metric=><div key={metric.label}><span>{metric.label}</span><strong className={metric.numeric?'':'report-summary-status'}>{metric.value}</strong></div>)}</div><div className="report-summary-context"><div><span>Cumulative grade</span><strong>{grade}{report.cumulative.status.startsWith('Provisional')?<sup className="report-provisional-marker">P</sup>:null}</strong></div><div><span>Academic coverage</span><strong>{report.cumulative.status}</strong></div><div><span>Overall performance trend</span><strong>{graph.trend}</strong></div></div></div>{embeddedGraph && !omitGraph?<ReportPerformanceGraph graph={graph} compact embedded/>:null}</section>
      {report.cumulative.status.startsWith('Provisional')?<p className="report-qualification">Cumulative position unavailable: Provisional — incomplete annual coverage.</p>:report.cumulative.status!=='Complete'?<p className="report-qualification">Cumulative position unavailable — {report.cumulative.status}. Required academic coverage has not been verified as complete.</p>:null}
      {report.current.status==='Unresolved'?<p className="report-qualification">Historical enrollment/class coverage requires administrative verification. Current membership does not establish earlier enrollment.</p>:report.current.value===null?<p className="report-qualification">Current-term position unavailable — {report.current.status}.</p>:null}
      {!embeddedGraph && !omitGraph?<ReportPerformanceGraph graph={graph} compact={compactGraph}/>:null}
      {omitGraph?<p className="report-qualification">Performance Trend: chart omitted because it exceeds the printable area at a readable size.</p>:null}
      <section className="report-signoffs" aria-label="Remarks and approvals">
        <div className="report-approval"><h2>Class teacher’s remarks</h2><RemarkLine label="Academic" value={record.academic}/><RemarkLine label="Activities" value={record.activities}/><RemarkLine label="Conduct" value={record.conduct}/><p className="report-staff">Class teacher: <strong>{classTeacherName || '—'}</strong></p><div className="report-signatures"><SignatureLine label="Signature"/><SignatureLine label="Date"/></div></div>
        <div className="report-approval"><h2>Principal’s remarks</h2>{record.principal?<p className="report-saved-remark report-comment-space">{record.principal}</p>:<div className="report-comment-space report-writing-lines" aria-hidden="true"><span/><span/><span/></div>}<p className="report-staff">Principal: <strong>{report.term.is_active ? school.principal_name || '—' : '—'}</strong></p><div className="report-signatures"><SignatureLine label="Signature"/><SignatureLine label="Date"/></div></div>
        <div className="report-approval"><h2>House master’s remarks</h2>{record.hse?<p className="report-saved-remark report-house-space">{record.hse}</p>:<div className="report-house-space report-writing-lines" aria-hidden="true"><span/><span/></div>}<div className="report-signatures"><SignatureLine label="Signature"/><SignatureLine label="Date"/></div></div>
        <div className="report-approval report-next-term"><h2>Next term</h2><p><span>Beginning date</span><strong>{formatDate(record.next_term_begins)}</strong></p><p><span>Ending date</span><strong>{formatDate(record.next_term_ends)}</strong></p><div className="report-signatures"><SignatureLine label="Report seen by"/></div></div>
      </section>
      <section className="report-grading"><h2>Grading key <span>Percentage · Grade · Points</span></h2><div>{sorted.map((b,i)=><span key={b.grade}><span className="report-band-range">{b.min_score}{i===0?'–100':`–<${sorted[i-1].min_score}`}</span><br/><strong>{b.grade}</strong> · {b.points}</span>)}</div></section>
      <footer className="report-motto">We make sure that everyone blossoms.</footer>
    </article>
  </>
}
