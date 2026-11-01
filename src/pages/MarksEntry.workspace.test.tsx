import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { academicFixture } from '../test/academic-report-fixtures'
import type { Database } from '../data/types'
const state = vi.hoisted(() => ({ db: null as unknown as Database, locked: false, queue: [] as any[] }))
vi.mock('../data/db', () => ({ useDb: () => state.db, api: {}, findPaper: (db: Database, key: Record<string,string>) => db.exams.find(exam => exam.term_id === key.term_id && exam.class_id === key.class_id && exam.subject_id === key.subject_id && exam.exam_type === key.exam_type) }))
vi.mock('../lib/offline', () => ({ useQueueRecords: () => state.queue }))
vi.mock('../session', () => ({ useSession: () => ({ session: { role: 'teacher' }, teacher: null, subjectScope: null, mayEnterMarks: !state.locked, canEditPaper: () => ({ editable: !state.locked, reason: state.locked ? 'This paper is locked.' : null }) }) }))
import MarksEntry from './MarksEntry'
const render = (url='/') => renderToStaticMarkup(<MemoryRouter initialEntries={[url]}><Routes><Route path="/" element={<MarksEntry/>}/><Route path="/:examId" element={<MarksEntry/>}/></Routes></MemoryRouter>)
const register = (html: string) => html.split('aria-labelledby="marks-register-heading"')[1]?.split('</section>')[0] ?? ''
beforeEach(() => {
 state.db = academicFixture().db
 state.db.exams = state.db.exams.map(exam => ({ ...exam, exam_type: 'CAT 1', status: 'open' }))
 state.locked = false; state.queue = []
})
describe('Marks Entry workspace presentation using existing academic data', () => {
 it('shows actual assessment context and maximum', () => { const html=render(); expect(html).toContain('Mathematics'); expect(html).toContain('2025'); expect(html).toContain('Maximum marks'); expect(html).toContain('value="100"') })
 it('retains the persisted linked paper selection', () => { const html=render('/exam-3-1-0'); expect(html).toContain('English language and literature'); expect(html).toContain('Endterm') })
 it('keeps the compact combobox collapsed with selected subject and code', () => { const html=render(); expect(html).toContain('role="combobox"'); expect(html).toContain('aria-expanded="false"'); expect(html).toContain('Mathematics'); expect(html).not.toContain('role="option"') })
 it('renders only verified subject enrollments', () => { state.db.students.push({...state.db.students[0],_id:'other',full_name:'Unrelated Subject Fixture',subject_ids:['subject-1']}); const html=register(render()); expect(html).not.toContain('Unrelated Subject Fixture'); expect(html).toContain('Amina Fictional Mwangi') })
 it('excludes other classes and archived students', () => { for(const student of [{class_id:'other-class'},{archived:true}])state.db.students.push({...state.db.students[0],_id:JSON.stringify(student),full_name:'Excluded Fixture',...student}); expect(register(render())).not.toContain('Excluded Fixture') })
 it.each(['unknown','error'] as const)('distinguishes %s enrollment from no eligible students', certainty => {state.db.students[0].enrollment_certainty=certainty;const html=register(render());expect(html).toContain('Enrollment verification is unresolved');expect(html).not.toContain('No eligible students');expect(html).not.toContain('data-student-row')})
 it('does not claim verified eligibility for another term',()=>{state.db.students[0].enrollment_term_id='term-1';expect(register(render())).toContain('Enrollment verification is unresolved')})
 it('offers an accurate verified empty-subject state',()=>{state.db.students[0].subject_ids=['subject-2'];expect(register(render())).toContain('No eligible students')})
 it('shows no-subject guidance for an unresolved linked subject',()=>{state.db.exams[0].subject_id='unresolved-subject';expect(register(render('/exam-1-0-0'))).toContain('Select a subject')})
 it('shows existing permission reason and disables input',()=>{state.locked=true;const html=register(render());expect(html).toContain('Read-only');expect(html).toContain('This paper is locked.');expect(html).toMatch(/disabled=""[^>]*aria-label="Score for/)})
 it('uses only recorded outcomes for progress, excluding unrelated students',()=>{const html=register(render());expect(html).toContain('1 of 1 students entered');expect(html).toContain('value="1" max="1"')})
 it.each(['X','Y'] as const)('preserves %s display and existing entered-outcome counting',code=>{for(const mark of state.db.marks)mark.score=code;const html=register(render());expect(html).toContain(`value="${code}"`);expect(html).toContain('1 of 1 students entered');expect(html).not.toContain('NaN')})
 it('shows local pending synchronization without calling it accepted',()=>{state.queue=[{locked:false,state:'Pending',payload:{examId:'exam-3-0-0',studentId:'fictional-ada',score:89}}];expect(register(render())).toContain('saved locally')})
 it('retains sort controls, score labels and keyboard help',()=>{const html=register(render());for(const value of ['Sort register','data-sort="adm"','data-sort="name"','data-sort="gender"','Score for Amina Fictional Mwangi','Keyboard help','Grade scale:'])expect(html).toContain(value)})
 it('does not count a queued result as an accepted entered result',()=>{state.db.marks=[];state.queue=[{locked:false,state:'Pending',payload:{examId:'exam-3-0-0',studentId:'fictional-ada',score:89}}];const html=register(render());expect(html).toContain('0 of 1 students entered');expect(html).toContain('pending synchronization')})
 it('retains rejected reason and attention state',()=>{state.queue=[{locked:false,state:'Rejected',last_error:'Fictional server rejection',payload:{examId:'exam-3-0-0',studentId:'fictional-ada',score:89}}];const html=register(render());expect(html).toContain('Rejected');expect(html).toContain('Fictional server rejection');expect(html).toContain('1 result needs attention')})
 it('treats malformed verified scope as unresolved',()=>{state.db.students[0].subject_ids=['subject-0','subject-0'];const html=register(render());expect(html).toContain('Enrollment verification is unresolved');expect(html).not.toContain('data-student-row')})
 it('does not present uncertain server acceptance as a confirmed result',()=>{state.queue=[{locked:false,state:'Uncertain',payload:{examId:'exam-3-0-0',studentId:'fictional-ada',score:89}}];const html=register(render());expect(html).toContain('Acceptance unconfirmed');expect(html).toContain('acceptance unconfirmed - see synchronization panel')})
 it('preserves the original printed heading separator and sheet structure',()=>{
  const html=render()
  const printed=html.split('class="print-only sheet print-page text-[10.5px]"')[1].split('</table>')[0]
  const heading=printed.match(/<p class="mb-3 text-center[^>]*>(.*?)<\/p>/)?.[1]
  expect(heading).toContain('Year 9 Fixture \u00b7 ')
  expect(heading).not.toContain('Year 9 Fixture ?')
  expect(printed).toContain('Marks Entry Sheet')
  expect((printed.match(/<th /g)??[])).toHaveLength(7)
  expect(printed).toContain('Enrollment status')
  expect(printed).toContain('Amina Fictional Mwangi')
 })
 it('rendering does not mutate academic records',()=>{const before=structuredClone(state.db);render();expect(state.db).toEqual(before)})
})
