import type { Database, GradeBand, Student } from '../data/types'
import { bandFor, percentOf } from './grading'
import { mean } from './analytics'
import { subjectRemark } from './subject-remarks'
import { reportTeacherInitials, resolveReportSubjectTeacher } from './report-teacher'

/** Report-only policy; broadsheet calculations remain unchanged. */
export const REPORT_POLICY = { termWeights: [1, 1, 1], tolerance: 1e-9, components: ['Midterm', 'Endterm'] } as const
export type Eligibility = 'enrolled' | 'pre-enrollment' | 'not-taken' | 'unknown'
/** Read-only, authoritative historical evidence supplied by an adapter, never teacher-entered. */
export interface ReportEvidence { studentId: string; termId: string; classId: string; subjectIds: string[]; eligibility: 'enrolled' | 'pre-enrollment' }
export interface Result { value: number | null; status: string }
export const reportValue = (r: Result) => r.value === null ? r.status : r.value.toFixed(1)
export function comparePerformance(current: number | null, previous: number | null) {
  if (current === null || previous === null) return '—'
  const delta = current - previous
  return `${Math.abs(delta) < REPORT_POLICY.tolerance ? 'Stationary' : delta > 0 ? 'Improving' : 'Dropped'} ${Math.abs(delta) < REPORT_POLICY.tolerance ? '0.0' : (delta > 0 ? '+' : '') + delta.toFixed(1)} pp`
}
export function cumulativeResult(terms: Result[]): Result {
  if (terms.some(t => t.value === null && t.status !== 'N/A')) return { value: null, status: terms.some(t => t.status === 'Unresolved') ? 'Unresolved' : 'INC' }
  const completed = terms.flatMap((t, i) => t.value === null ? [] : [{ value: t.value, weight: REPORT_POLICY.termWeights[i] }])
  const value = completed.length ? completed.reduce((s,t) => s+t.value*t.weight,0)/completed.reduce((s,t)=>s+t.weight,0) : null
  return { value, status: value === null ? 'N/A' : completed.length === terms.length ? 'Complete' : `Provisional — ${completed.length} of ${terms.length} terms` }
}
export function eligibilityFor(student: Student, termId: string, classId: string, subjectId: string, evidence: ReportEvidence[]): Eligibility {
  const rows = evidence.filter(e=>e.studentId===student._id && e.termId===termId)
  if (rows.length === 1) {
    const row = rows[0]
    if (row.eligibility === 'pre-enrollment') return 'pre-enrollment'
    if (row.classId !== classId) return 'unknown'
    return row.subjectIds.includes(subjectId) ? 'enrolled' : 'not-taken'
  }
  if (!rows.length && student.class_id===classId && student.enrollment_term_id===termId && student.enrollment_certainty==='verified_enrolled' && student.subject_ids?.length) return student.subject_ids.includes(subjectId) ? 'enrolled' : 'not-taken'
  return 'unknown'
}
export function termSubject(db: Database, student: Student, termId: string, classId: string, subjectId: string, evidence: ReportEvidence[]) {
  const eligibility = eligibilityFor(student,termId,classId,subjectId,evidence)
  const components: Result[] = REPORT_POLICY.components.map(type=>{
    const papers = db.exams.filter(e=>e.term_id===termId && e.class_id===classId && e.subject_id===subjectId && e.exam_type===type)
    if (eligibility==='pre-enrollment' || eligibility==='not-taken') return {value:null,status:eligibility==='pre-enrollment'?'N/A':'N/T'}
    if (papers.length!==1) return {value:null,status:papers.length ? 'INC' : 'Pending'}
    const exam = papers[0]
    const marks = db.marks.filter(m=>m.exam_id===exam._id && m.student_id===student._id)
    if (marks.length>1) return {value:null,status:'INC'}
    const score = marks[0]?.score
    // db.marks contains accepted server records, never the offline submission queue.
    if (exam.status!=='published' && exam.status!=='locked') return {value:null,status:'Pending'}
    if (typeof score==='number' && Number.isFinite(score) && exam.max_score>0 && score>=0 && score<=exam.max_score) return {value:percentOf(score,exam.max_score),status:'Complete'}
    // X means missing, Y irregularity in the canonical marks workflow; neither proves absence.
    return {value:null,status:score==='X'?'INC':score==='Y'?'Irregularity':'Pending'}
  })
  const complete = components.every(c=>c.value!==null)
  const status = eligibility==='pre-enrollment'?'N/A':eligibility==='not-taken'?'N/T':complete?'Complete':eligibility==='unknown'?'Unresolved':'INC'
  return { components, eligibility, value: complete ? mean(components.map(c=>c.value!)) : null, status }
}
export function reportColumns(termNumber: number) {
  return termNumber===1 ? ['Subject','Midterm','End Term','Term 1 avg','Grade','Pts','Pos','Trend','Remark','Teacher'] : ['Subject',...Array.from({length:termNumber},(_,i)=>`Term ${i+1}`),termNumber===3?'Annual avg':'Cumul. avg',termNumber===3?'Annual grade':'Cumul. grade','Pts','Trend','Remark','Teacher']
}
export function buildAcademicReport(db: Database, student: Student, termId: string, classId: string, bands: GradeBand[], evidence: ReportEvidence[] = []) {
  const term = db.terms.find(t=>t._id===termId)
  if (!term || student.school_id!==term.school_id || !db.classes.some(c=>c._id===classId && c.school_id===term.school_id)) throw Error('Selected academic period is unavailable.')
  const year = db.terms.filter(t=>t.school_id===term.school_id && t.academic_year===term.academic_year).sort((a,b)=>a.start_date.localeCompare(b.start_date))
  if (year.length!==3 || new Set(year.map(t=>t.start_date)).size!==3) throw Error('Reporting requires three distinct, chronologically configured terms in the selected academic year.')
  const index = year.findIndex(t=>t._id===termId), terms = year.slice(0,index+1)
  const subjects = db.subjects.filter(s=>db.exams.some(e=>e.class_id===classId && terms.some(t=>t._id===e.term_id) && e.subject_id===s._id) || evidence.some(e=>e.studentId===student._id && e.classId===classId && terms.some(t=>t._id===e.termId) && e.subjectIds.includes(s._id)) || (student.enrollment_term_id===termId && student.subject_ids?.includes(s._id)))
  const rows = subjects.map(subject=>{
    const results = terms.map(t=>termSubject(db,student,t._id,classId,subject._id,evidence))
    const current = results[index]
    const cumulative = current.status==='N/T' ? {value:null,status:'N/T'} : cumulativeResult(results)
    const band = cumulative.value===null ? null : bandFor(cumulative.value,bands)
    const teacher = resolveReportSubjectTeacher(db,{schoolId:term.school_id,termId,classId,subjectId:subject._id})
    const overrides = new Set(db.marks.filter(m=>m.student_id===student._id && db.exams.some(e=>e._id===m.exam_id && e.term_id===termId && e.class_id===classId && e.subject_id===subject._id && (e.status==='locked'||e.status==='published'))).map(m=>m.remarks.trim()).filter(Boolean))
    const trend=comparePerformance(current.value,index>0?results[index-1].value:null)
    const remark=subjectRemark({band,bands,resultStatus:cumulative.status,eligibilityKnown:results.every(result=>result.eligibility!=='unknown'),termNumber:index+1,trend,componentStatuses:current.components.map(component=>component.status),override:overrides.size>0?[...overrides].join(' / '):undefined})
    return { subject, results, current, cumulative, band, trend, initials:reportTeacherInitials(teacher?.full_name), remark }
  })
  const overall = terms.map((_,i):Result=>{
    const relevant = rows.filter(r=>r.results[i].status!=='N/T')
    if (!relevant.length) return {value:null,status:'Unresolved'}
    if (relevant.every(r=>r.results[i].status==='N/A')) return {value:null,status:'N/A'}
    if (relevant.some(r=>r.results[i].eligibility==='unknown')) return {value:null,status:'Unresolved'}
    if (relevant.some(r=>r.results[i].value===null)) return {value:null,status:'INC'}
    return {value:mean(relevant.map(r=>r.results[i].value!)),status:'Complete'}
  })
  const sameSubjects = terms.every((_,i)=> rows.filter(r=>r.results[i].status!=='N/T').map(r=>r.subject._id).join('|')===rows.filter(r=>r.current.status!=='N/T').map(r=>r.subject._id).join('|'))
  const cumulative = sameSubjects ? cumulativeResult(overall) : {value:null,status:'Unresolved — subject coverage changed'}
  return { term, terms, classId, termNumber:index+1, columns:reportColumns(index+1), rows, overall, current:overall[index], cumulative, trend:sameSubjects?comparePerformance(overall[index].value,index>0?overall[index-1].value:null):'—', group: rows.filter(r=>r.current.status!=='N/T').map(r=>r.subject._id).sort().join('|') }
}
export type AcademicReport = ReturnType<typeof buildAcademicReport>
/** Competition ranking (1,1,3), same tolerance as existing broadsheets; comparable subject sets only. */
export function reportPosition(report: AcademicReport, population: AcademicReport[], cumulative=false) {
  const result = cumulative?report.cumulative:report.current
  if (result.value===null || result.status!=='Complete') return '—'
  const eligible = population.filter(p=>p.term._id===report.term._id && p.classId===report.classId && p.group===report.group && (cumulative?p.cumulative:p.current).status==='Complete' && (cumulative?p.cumulative:p.current).value!==null)
  return `${1+eligible.filter(p=>(cumulative?p.cumulative:p.current).value! > result.value! + REPORT_POLICY.tolerance).length}/${eligible.length}`
}
