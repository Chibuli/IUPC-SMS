import { describe, expect, it } from 'vitest'
import type { Exam, Mark, Student } from '../data/types'
import { buildCompactBroadsheet, toCompactCsv, type BroadsheetAssessment } from './compact-broadsheet'
import { buildBroadsheet } from './analytics'
import { DEFAULT_BANDS } from './grading'

const learner = (id = 'a', subjects = ['math'], classId = 'class-7'): Student => ({
  _id: id, school_id: 'school', class_id: classId, full_name: `Full Student Name ${id}`, admission_number: `TEST-${id}`,
  gender: 'Female', date_of_birth: '', guardian_name: '', guardian_phone: '', status: 'Active', archived: false, archived_at: null,
  subject_ids: subjects, enrollment_certainty: subjects.length ? 'verified_enrolled' : 'verified_no_enrollments', enrollment_term_id: 'term',
})
const papers = (subjects = ['math'], classId = 'class-7'): Exam[] => subjects.flatMap(subject => ['Midterm', 'Endterm'].map(type => ({
  _id: `${classId}-${subject}-${type}`, class_id: classId, subject_id: subject, term_id: 'term', exam_type: type, exam_name: type,
  exam_date: '2026-10-01', max_score: 100, editing_deadline: null, status: 'published' as const,
})))
const marks = (exams: Exam[], studentId = 'a', scores: Mark['score'][] = [72, 84]): Mark[] => exams.flatMap((e, i) => scores[i] === undefined ? [] : [{
  _id: `mark-${studentId}-${e._id}`, exam_id: e._id, student_id: studentId, score: scores[i], remarks: '', updated_at: '',
}])
const build = (students = [learner()], exams = papers(), scores = marks(exams), assessment: BroadsheetAssessment = 'all') => buildCompactBroadsheet({
  students, exams, marks: scores, assessment, assessmentTermId: 'term', bands: DEFAULT_BANDS, subjectCode: id => id === 'math' ? '0862' : id,
})

describe('compact subject broadsheets — independent expected results', () => {
  it('calculates 72 and 84 as one 78 result without changing original marks or the legacy paper engine', () => {
    const exams = papers(), source = marks(exams), before = structuredClone({ exams, source })
    const sheet = build([learner()], exams, source)
    expect(sheet.columns.map(c => c.subjectCode)).toEqual(['0862'])
    expect(sheet.rows[0]).toMatchObject({ cells: { 'subject:math': 78 }, total: 78, mean: 78, grade: 'B', required: 1, completed: 1, rank: 1 })
    expect({ exams, source }).toEqual(before)
    const legacy = buildBroadsheet({ students: [learner()], exams, marks: source, bands: DEFAULT_BANDS, assessmentTermId: 'term' })
    expect(legacy.rows[0]).toMatchObject({ total: 156, required: 2, completed: 2, mean: 78 })
  })
  it('normalizes 36/50 and 168/200 before averaging to 78, never averages the raw 36 and 168', () => {
    const exams = papers().map((e, i) => ({ ...e, max_score: i ? 200 : 50 }))
    expect(build([learner()], exams, marks(exams, 'a', [36, 168])).rows[0].mean).toBe(78)
  })
  it('retains precision until presentation and grades the unrounded result', () => {
    const exams = papers().map((e, i) => ({ ...e, max_score: i ? 7 : 3 }))
    const sheet = build([learner()], exams, marks(exams, 'a', [1, 2]))
    expect(sheet.rows[0].mean).toBeCloseTo(30.952380952380953, 12)
    expect(sheet.rows[0].cells['subject:math']).not.toBe(31)
    const threshold = build([learner()], papers(), marks(papers(), 'a', [79.94, 79.98]))
    expect(threshold.rows[0].mean).toBeCloseTo(79.96, 12)
    expect(threshold.rows[0].grade).toBe('B')
  })
  it.each([['Midterm', 72], ['Endterm', 84]] as const)('keeps %s percentages independent', (type, expected) => {
    expect(build([learner()], papers(), marks(papers()), type).rows[0]).toMatchObject({ total: expected, mean: expected, required: 1, completed: 1 })
  })
  it('uses configured grading bands without substituting an academic policy', () => {
    const sheet = buildCompactBroadsheet({ students: [learner()], exams: papers(), marks: marks(papers()), assessment: 'all', assessmentTermId: 'term', bands: [{ grade: 'H', min_score: 75, points: 5, remark: '' }, { grade: 'L', min_score: 0, points: 1, remark: '' }] })
    expect(sheet.rows[0]).toMatchObject({ mean: 78, grade: 'H', points: 5 })
    expect(sheet.summary[0].grade).toBe('H')
  })
  it.each([null, 'X', 'Y'] as const)('withholds completion and ranking for a missing/irregular component %s', value => {
    const sheet = build([learner()], papers(), marks(papers(), 'a', [72, value]))
    expect(sheet.rows[0]).toMatchObject({ total: 0, mean: null, completed: 0, required: 1, rank: null, assessmentComplete: false })
    expect(sheet.summary[0]).toMatchObject({ entries: 0, average: null })
    expect(toCompactCsv(sheet)).toContain(value ?? 'INC')
  })
  it('does not substitute a sole configured Midterm, and does not fall back when End Term is selected', () => {
    const exams = papers().slice(0, 1)
    for (const type of ['all', 'Endterm'] as const) expect(build([learner()], exams, marks(exams), type).rows[0]).toMatchObject({ completed: 0, required: 1, rank: null, mean: null })
  })
  it('retains an enrolled subject with no configured papers as incomplete', () => {
    const sheet = build([learner('a', ['math', 'science'])])
    expect(sheet.columns).toHaveLength(2)
    expect(sheet.rows[0]).toMatchObject({ total: 78, mean: 78, completed: 1, required: 2, rank: null })
    expect(sheet.rows[0].outstandingPapers.join(';')).toContain('paper not configured')
  })
  it.each([-1, 101, NaN, Infinity])('excludes invalid numeric mark %s from combined statistics', invalid => {
    const sheet = build([learner()], papers(), marks(papers(), 'a', [72, invalid]))
    expect(sheet.rows[0]).toMatchObject({ completed: 0, rank: null, mean: null })
    expect(sheet.cellDetails.a['subject:math'].state).toBe('Z')
    expect(sheet.summary[0].entries).toBe(0)
  })
  it.each([0, -1, NaN, Infinity])('rejects an invalid maximum %s', maximum => {
    const exams = papers().map((e, i) => ({ ...e, max_score: i ? maximum : 100 }))
    expect(build([learner()], exams, marks(exams)).rows[0]).toMatchObject({ rank: null, completed: 0, mean: null })
  })
  it('treats zero as valid, including when both components are zero', () => {
    expect(build([learner()], papers(), marks(papers(), 'a', [0, 0])).rows[0]).toMatchObject({ mean: 0, completed: 1, rank: 1 })
  })
  it('preserves both irregular component details without assigning a rank', () => {
    const sheet = build([learner()], papers(), marks(papers(), 'a', ['X', 'Y']))
    expect(sheet.cellDetails.a['subject:math']).toEqual({ state: 'Y', detail: 'Midterm: X; End Term: Y' })
    expect(sheet.rows[0].rank).toBeNull()
  })
  it('shows not-taken separately from incomplete, excluding extraneous marks from summary', () => {
    const exams = papers(['math', 'science'])
    const sheet = build([learner()], exams, marks(exams, 'a', [72, 84, 99, 99]))
    expect(sheet.cellDetails.a['subject:science'].state).toBe('not-taken')
    expect(sheet.rows[0]).toMatchObject({ required: 1, mean: 78, rank: 1 })
    expect(sheet.summary[1].entries).toBe(0)
    expect(toCompactCsv(sheet)).toContain('==')
  })
  it('does not invent weights for duplicate component papers or accept duplicate mark records', () => {
    const exams = [...papers(), { ...papers()[0], _id: 'duplicate-paper' }]
    expect(build([learner()], exams, marks(exams, 'a', [72, 84, 100])).rows[0].rank).toBeNull()
    const scores = [...marks(papers()), { ...marks(papers())[0], _id: 'duplicate-mark' }]
    expect(build([learner()], papers(), scores).rows[0].rank).toBeNull()
  })
  it('computes per-subject statistics from valid combined results', () => {
    const exams = papers(), students = [learner('a'), learner('b'), learner('c')]
    const sheet = build(students, exams, [...marks(exams, 'a', [72, 84]), ...marks(exams, 'b', [64, 76]), ...marks(exams, 'c', [99, 'X'])])
    expect(sheet.summary[0]).toMatchObject({ average: 74, highest: 78, lowest: 70, entries: 2, sd: 4, grade: 'B' })
  })
  it('preserves competition ranks 1,1,3 with admission ordering inside a tie', () => {
    const exams = papers(), students = [learner('b'), learner('c'), learner('a')]
    const sheet = build(students, exams, [...marks(exams, 'a', [72, 88]), ...marks(exams, 'b', [80, 80]), ...marks(exams, 'c', [70, 80])])
    expect(sheet.rows.map(r => [r.studentId, r.mean, r.rank])).toEqual([['a', 80, 1], ['b', 80, 1], ['c', 75, 3]])
  })
  it('keeps students in different streams separate while sharing one subject column', () => {
    const exams = [...papers(), ...papers(['math'], 'class-8')]
    const sheet = build([learner(), learner('b', ['math'], 'class-8')], exams, [...marks(exams.slice(0, 2)), ...marks(exams.slice(2), 'b', [60, 80])])
    expect(sheet.columns).toHaveLength(1)
    expect(sheet.rows.map(r => r.mean)).toEqual([78, 70])
    expect(sheet.summary[0].average).toBe(74)
  })
  it.each(['unknown', 'error', 'verified_no_enrollments'] as const)('does not award final ranks for %s enrollment', certainty => {
    const s = { ...learner(), enrollment_certainty: certainty, subject_ids: certainty === 'verified_no_enrollments' ? [] : ['math'] }
    expect(build([s]).rows[0].rank).toBeNull()
  })
  it('does not use enrollment from another term or assessments from another term', () => {
    expect(build([{ ...learner(), enrollment_term_id: 'old-term' }]).rows[0].rank).toBeNull()
    expect(build([learner()], papers().map(e => ({ ...e, term_id: 'old-term' }))).rows[0]).toMatchObject({ rank: null, completed: 0 })
  })
  it.each([{ ids: ['math', 'math'] }, { ids: [null] }, { ids: 'math' }])('fails closed for malformed verified enrollment $ids', ({ ids }) => {
    const s = { ...learner(), subject_ids: ids } as unknown as Student
    expect(build([s]).rows[0]).toMatchObject({ rank: null, completionKnown: false, mean: null })
  })
  it('restricts teacher subjects in columns, statistics and CSV and withholds partial-scope final ranks', () => {
    const exams = papers(['math', 'hidden']), scores = marks(exams, 'a', [72, 84, 99, 99])
    const sheet = buildCompactBroadsheet({ students: [learner('a', ['math', 'hidden'])], exams, marks: scores, assessment: 'all', assessmentTermId: 'term', bands: DEFAULT_BANDS, subjectScope: ['math'], subjectCode: id => id })
    expect(sheet.columns.map(c => c.subjectCode)).toEqual(['math'])
    expect(JSON.stringify(sheet)).not.toContain('hidden')
    expect(toCompactCsv(sheet)).not.toContain('hidden')
    expect(sheet.rows[0]).toMatchObject({ rank: null, mean: null })
    const noSubjects = buildCompactBroadsheet({ students: [learner()], exams, marks: scores, assessment: 'all', assessmentTermId: 'term', bands: DEFAULT_BANDS, subjectScope: [] })
    expect(noSubjects.columns).toEqual([])
    expect(noSubjects.rows[0].rank).toBeNull()
  })
  it('exports one subject column and exact full names/admissions with correct CSV escaping', () => {
    const s = { ...learner(), full_name: 'Full Name, "with quotation"', admission_number: 'TEST-VERY-LONG-001' }
    const csv = toCompactCsv(build([s]))
    expect(csv).toContain('0862 · Combined (%)')
    expect(csv).toContain('"Full Name, ""with quotation"""')
    expect(csv).toContain('TEST-VERY-LONG-001')
    expect(csv.split('\r\n')[1]).toMatch(/,78$/)
  })
  it.each([7, 8, 9, 10, 11, 12, 13])('covers all three views for Year %s with each subject counted once', year => {
    const ids = Array.from({ length: year >= 12 ? 7 : 8 }, (_, i) => `S${i}`), exams = papers(ids, `class-${year}`), s = learner('a', ids, `class-${year}`)
    const source = marks(exams, 'a', exams.map((_, i) => i % 2 ? 84 : 72))
    for (const [type, expected] of [['all', 78], ['Midterm', 72], ['Endterm', 84]] as const) {
      const sheet = build([s], exams, source, type)
      expect(sheet.columns).toHaveLength(ids.length)
      expect(sheet.rows[0]).toMatchObject({ mean: expected, total: expected * ids.length, completed: ids.length, required: ids.length, rank: 1 })
    }
  })
})
