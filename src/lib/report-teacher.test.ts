import {describe,it,expect} from 'vitest'
import {reportTeacherInitials,resolveReportSubjectTeacher} from './report-teacher'
import {academicFixture} from '../test/academic-report-fixtures'

describe('report teacher name formatting',()=>{
  it.each([
    ['Collins Sammy','C.S.'],['Faith Mbithe Kavita','F.M.K.'],['Paul Mugendi','P.M.'],['Mary Wanjiku Otieno','M.W.O.'],
    ['Mr. Collins Sammy','C.S.'],['Dr. Mary Wanjiku','M.W.'],['Mrs Faith Kavita','F.K.'],['Ms. Faith Kavita','F.K.'],['Prof. Mary Otieno','M.O.'],
    [' Mr. Dr.  Collins   Sammy ','C.S.'],['Dr.Mary Wanjiku','M.W.'],['  fAItH  mBiTHe   kAvItA  ','F.M.K.'],
    ["Anne-Marie O'Neill",'A.M.O.'],['Mary‑Jane D’Souza','M.J.D.'],['Achieng','A.'],['Élodie Ochieng','É.O.'],
    ['Mrinal Sammy','M.S.'],['','—'],['   ','—'],['Dr.','—'],['...','—'],[null,'—'],[undefined,'—'],
    ['Mary Anne Wanjiku Otieno Njeri Achieng','M.A.W.O.N.A.'],
  ])('formats %s as %s',(name,expected)=>expect(reportTeacherInitials(name)).toBe(expected))
})
describe('subject teacher assignment resolution',()=>{
  const setup=()=>{const f=academicFixture();return {db:f.db,scope:{schoolId:f.student.school_id,termId:'term-1',classId:f.student.class_id,subjectId:'subject-0'}}}
  it('resolves repeated periods for the same assigned teacher once',()=>{
    const {db,scope}=setup();db.timetableSlots.push({...db.timetableSlots[0],_id:'repeated',day:2})
    expect(resolveReportSubjectTeacher(db,scope)?.full_name).toBe('Collins Fictional Sammy')
  })
  it('respects different subject teachers across academic terms',()=>{
    const {db,scope}=setup();db.teachers.push({...db.teachers[0],_id:'teacher-2',full_name:'Dr. Mary Wanjiku'})
    db.timetableSlots.filter(s=>s.term_id==='term-2').forEach(s=>s.teacher_id='teacher-2')
    expect(reportTeacherInitials(resolveReportSubjectTeacher(db,scope)?.full_name)).toBe('C.F.S.')
    expect(reportTeacherInitials(resolveReportSubjectTeacher(db,{...scope,termId:'term-2'})?.full_name)).toBe('M.W.')
  })
  it('does not use the mark submitter or subject-wide teacher permissions as the assignment',()=>{
    const {db,scope}=setup();db.marks.forEach(m=>m.entered_by='administrator');db.teachers[0].assigned_subject_ids=[]
    expect(resolveReportSubjectTeacher(db,scope)?._id).toBe('teacher')
  })
  it('returns unresolved for multiple teachers without an established primary rule',()=>{
    const {db,scope}=setup();db.teachers.push({...db.teachers[0],_id:'teacher-2'});db.timetableSlots.push({...db.timetableSlots[0],_id:'shared',teacher_id:'teacher-2'})
    expect(resolveReportSubjectTeacher(db,scope)).toBeUndefined()
    db.teachers.reverse();db.timetableSlots.reverse();expect(resolveReportSubjectTeacher(db,scope)).toBeUndefined()
  })
  it('never substitutes current assignment for a missing historical period',()=>{
    const {db,scope}=setup();db.timetableSlots=db.timetableSlots.filter(s=>s.term_id!=='term-1');expect(resolveReportSubjectTeacher(db,scope)).toBeUndefined()
  })
  it.each(['schoolId','termId','classId','subjectId'] as const)('isolates %s',field=>{
    const {db,scope}=setup();expect(resolveReportSubjectTeacher(db,{...scope,[field]:'other'})).toBeUndefined()
  })
  it('does not resolve a missing or cross-school teacher record',()=>{
    const {db,scope}=setup();db.teachers[0].school_id='other';expect(resolveReportSubjectTeacher(db,scope)).toBeUndefined()
  })
})
