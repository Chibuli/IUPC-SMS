import {describe,it,expect} from 'vitest'
import {academicFixture,lateFixture} from '../test/academic-report-fixtures'
import {buildAcademicReport,reportPosition} from './academic-report'
import {buildReportGraph} from './report-performance-graph'
import {DEFAULT_BANDS} from './grading'
const build=(f:ReturnType<typeof academicFixture>,t=3)=>buildAcademicReport(f.db,f.student,`term-${t}`,f.student.class_id,DEFAULT_BANDS,f.evidence)
describe('subject remark and initials integration',()=>{
  it('keeps Term 1 baseline wording separate from the Midterm/End Term graph',()=>{
    const f=academicFixture(),r=build(f,1)
    expect(r.rows[0].cumulative.value).toBe(75);expect(r.rows[0].band?.grade).toBe('B');expect(r.rows[0].remark).toBe('Good work; aim higher');expect(r.rows[0].trend).toBe('—');expect(buildReportGraph(r).trend).toBe('Improving +10.0 pp')
  })
  it('uses the Term 2 cumulative band rather than the current-term band',()=>{
    const f=academicFixture();f.db.marks.filter(m=>m.exam_id.startsWith('exam-2-')).forEach(m=>m.score=m.exam_id.endsWith('-0')?90:100)
    const r=build(f,2),row=r.rows[0]
    expect(row.current.value).toBe(95);expect(row.cumulative.value).toBe(85);expect(row.band?.grade).toBe('A');expect(row.remark).toBe('Very good progress')
  })
  it('uses the Term 3 annual band with the existing Term 2-to-Term 3 subject trend',()=>{
    const r=build(academicFixture()),row=r.rows[0]
    expect(row.current.value).toBe(95);expect(row.cumulative.value).toBe(85);expect(row.band?.grade).toBe('A');expect(row.trend).toBe('Improving +10.0 pp');expect(row.remark).toBe('Very good progress')
  })
  it('does not describe a high-achieving declining student as weak',()=>{
    const f=academicFixture();f.db.marks.forEach(m=>m.score=m.exam_id.startsWith('exam-3-')?90:100)
    const r=build(f);expect(r.rows[0].band?.grade).toBe('A*');expect(r.rows[0].trend).toBe('Dropped -10.0 pp');expect(r.rows[0].remark).toBe('Strong; regain consistency')
  })
  it.each([[2,2,'Very good performance'],[2,3,'Excellent progress'],[3,3,'Outstanding achievement']])('supports admission Term %s on report Term %s', (join,t,expected)=>{
    const r=build(lateFixture(join as number),t as number)
    expect(r.rows[0].remark).toBe(expected);expect(r.cumulative.status).toMatch(/^Provisional/);expect(reportPosition(r,[r],true)).toBe('—');expect(reportPosition(r,[r])).toBe('1/1')
  })
  it.each([0,1])('keeps component %s missing rather than assigning praise or a zero',component=>{
    const f=academicFixture();f.db.marks=f.db.marks.filter(m=>m.exam_id!==`exam-1-0-${component}`)
    const r=build(f,1);expect(r.rows[0].remark).toBe('INC');expect(r.rows[0].band).toBeNull();expect(r.current.value).toBeNull();expect(reportPosition(r,[r])).toBe('—')
  })
  it('distinguishes unentered/pending marks and a recorded irregularity',()=>{
    const f=academicFixture();f.db.marks=[];expect(build(f,1).rows[0].remark).toBe('Pending')
    const irregular=academicFixture();irregular.db.marks[0].score='Y';expect(build(irregular,1).rows[0].remark).toBe('Irregularity')
    const pending=academicFixture();pending.db.exams.filter(e=>e.term_id==='term-1').forEach(e=>e.status='draft');expect(build(pending,1).rows[0].remark).toBe('Pending')
  })
  it('keeps verified subject exclusions and unknown history explicit',()=>{
    const f=academicFixture();f.evidence.forEach(e=>e.subjectIds=e.subjectIds.filter(id=>id!=='subject-1'));expect(build(f).rows[1].remark).toBe('N/T')
    const unknown=academicFixture();unknown.evidence=[];expect(build(unknown,1).rows[0].remark).toBe('Unresolved')
  })
  it('does not average around an incomplete required historical term for a positive remark',()=>{
    const f=academicFixture();f.db.marks=f.db.marks.filter(m=>!m.exam_id.startsWith('exam-2-'))
    const r=build(f);expect(r.rows[0].current.value).toBe(95);expect(r.rows[0].cumulative.value).toBeNull();expect(r.rows[0].remark).toBe('INC')
  })
  it('uses recorded names instead of cached initials or mark submitters without changing records',()=>{
    const f=academicFixture();f.db.teachers[0].full_name=' Mr.  Collins Sammy ';f.db.teachers[0].initials='ZZ';f.db.marks.forEach(m=>m.entered_by='admin')
    const before=structuredClone(f.db);expect(build(f).rows[0].initials).toBe('C.S.');expect(f.db).toEqual(before)
  })
  it('retains missing/ambiguous assignment behavior on the real report view model',()=>{
    const f=academicFixture();f.db.timetableSlots=f.db.timetableSlots.filter(s=>s.term_id!=='term-1');expect(build(f,1).rows[0].initials).toBe('—')
    f.db.teachers.push({...f.db.teachers[0],_id:'other'});f.db.timetableSlots.push({...f.db.timetableSlots[0],_id:'shared',teacher_id:'other'});expect(build(f,2).rows[0].initials).toBe('—')
  })
})
