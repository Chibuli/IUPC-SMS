import { describe, expect, it } from 'vitest'
import type { Exam, Mark, Student } from '../data/types'
import { DEFAULT_BANDS } from './grading'
import { buildBroadsheet, mean, toCsv } from './analytics'
import { decodeEnrollmentVerification } from './enrollment-certainty'

const subjects = Array.from({ length: 9 }, (_, index) => `subject-${index + 1}`)
const student = (id: string, subjectIds: string[] | undefined, admission = id): Student => ({
  _id: id,
  school_id: 'school-1',
  admission_number: admission,
  full_name: `Student ${id}`,
  gender: 'Female',
  date_of_birth: '2010-01-01',
  class_id: 'class-1',
  subject_ids: subjectIds,
  enrollment_certainty: subjectIds?.length ? 'verified_enrolled' : 'unknown',
  enrollment_term_id: 'term-1',
  guardian_name: '',
  guardian_phone: '',
  status: 'Active',
  archived: false,
  archived_at: null,
})
const examsFor = (subjectIds: string[], prefix = 'exam'): Exam[] => subjectIds.map((subjectId, index) => ({
  _id: `${prefix}-${index + 1}`,
  term_id: 'term-1',
  subject_id: subjectId,
  class_id: 'class-1',
  exam_name: 'Term paper',
  exam_type: 'End term',
  max_score: 100,
  exam_date: '2026-10-01',
  editing_deadline: null,
  status: 'published',
}))
const marksFor = (studentId: string, exams: Exam[], scores: (number | 'X' | 'Y' | null)[]): Mark[] =>
  exams.flatMap((exam, index) => scores[index] === undefined ? [] : [{
    _id: `mark-${studentId}-${exam._id}`,
    exam_id: exam._id,
    student_id: studentId,
    score: scores[index],
    remarks: '',
    updated_at: '2026-10-01T00:00:00.000Z',
  }])
const build = (students: Student[], exams: Exam[], marks: Mark[], options: { completionScopeComplete?: boolean; assessmentTermId?: string | null } = {}) =>
  buildBroadsheet({ students, exams, marks, bands: DEFAULT_BANDS, assessmentTermId: 'term-1', ...options })

describe('buildBroadsheet enrollment-aware completion and ranking', () => {
  it('keeps combined and separate assessment calculations tied to their existing papers', () => {
    const midterm = examsFor(subjects.slice(0, 2), 'midterm').map(exam => ({ ...exam, exam_type: 'Midterm' }))
    const endterm = examsFor(subjects.slice(0, 2), 'endterm').map(exam => ({ ...exam, exam_type: 'Endterm' }))
    const learner = student('periods', subjects.slice(0, 2))
    const marks = [...marksFor(learner._id, midterm, [60, 80]), ...marksFor(learner._id, endterm, [90, 70])]
    expect(build([learner], [...midterm, ...endterm], marks).completedRows[0]).toMatchObject({ required: 4, completed: 4, total: 300, mean: 75 })
    expect(build([learner], midterm, marks).completedRows[0]).toMatchObject({ required: 2, completed: 2, total: 140, mean: 70 })
    expect(build([learner], endterm, marks).completedRows[0]).toMatchObject({ required: 2, completed: 2, total: 160, mean: 80 })
  })

  it('exports full assessment headings with CSV escaping and unchanged student values', () => {
    const exams = examsFor(subjects.slice(0, 2)), learner = student('csv-labels', subjects.slice(0, 2))
    const sheet = build([learner], exams, marksFor(learner._id, exams, [88, 95]))
    const csv = toCsv(sheet, column => `Mathematics, "advanced" · Midterm · ${column.examName}`)
    expect(csv).toContain('"Mathematics, ""advanced"" · Midterm · Term paper"')
    expect(csv.trim().split('\r\n')).toHaveLength(2)
    expect(csv).toContain(',88,95')
    expect(sheet.completedRows[0]).toMatchObject({ total: 183, mean: 91.5 })
  })
  it('keeps a high one-of-eight mark incomplete and below the final ranked cohort', () => {
    const exams = examsFor(subjects.slice(0, 8))
    const leader = student('partial-leader', subjects.slice(0, 8), '001')
    const complete = student('complete', subjects.slice(0, 8), '002')
    const sheet = build([leader, complete], exams, [
      ...marksFor(leader._id, exams, [88]),
      ...marksFor(complete._id, exams, [80, 80, 80, 80, 80, 80, 80, 80]),
    ])

    expect(sheet.completedRows.map((row) => row.studentId)).toEqual(['complete'])
    expect(sheet.incompleteRows.map((row) => row.studentId)).toEqual(['partial-leader'])
    expect(sheet.rows.map((row) => row.studentId)).toEqual(['complete', 'partial-leader'])
    expect(sheet.incompleteRows[0].rank).toBeNull()
    expect(sheet.incompleteRows[0].outstandingPapers).toHaveLength(7)
    expect(sheet.incompleteRows[0].mean).toBe(88)
  })

  it('qualifies a student with all eight required papers for final ranking', () => {
    const exams = examsFor(subjects.slice(0, 8))
    const learner = student('eight', subjects.slice(0, 8))
    const sheet = build([learner], exams, marksFor(learner._id, exams, Array(8).fill(72)))
    expect(sheet.completedRows[0]).toMatchObject({ required: 8, completed: 8, rank: 1, assessmentComplete: true })
    expect(sheet.incompleteRows).toHaveLength(0)
  })

  it('uses the student’s six actual enrollments, not a universal eight-subject count', () => {
    const exams = examsFor(subjects.slice(0, 8))
    const learner = student('six', subjects.slice(0, 6))
    const sheet = build([learner], exams, marksFor(learner._id, exams, [60, 60, 60, 60, 60, 60]))
    expect(sheet.completedRows[0]).toMatchObject({ required: 6, completed: 6, rank: 1 })
    expect(sheet.completedRows[0].cells[exams[6]._id]).toBeNull()
  })

  it('leaves seven of eight required outcomes incomplete without zero-imputing missing papers', () => {
    const exams = examsFor(subjects.slice(0, 8))
    const learner = student('seven', subjects.slice(0, 8))
    const sheet = build([learner], exams, marksFor(learner._id, exams, [75, 75, 75, 75, 75, 75, 75]))
    expect(sheet.incompleteRows[0]).toMatchObject({ completed: 7, required: 8, total: 525, mean: 75, rank: null })
    expect(sheet.incompleteRows[0].outstandingPapers).toHaveLength(1)
    expect(sheet.completedRows).toHaveLength(0)
  })

  it('does not divide by zero or show a fabricated average when no mark exists', () => {
    const exams = examsFor(subjects.slice(0, 2))
    const learner = student('none', subjects.slice(0, 2))
    const row = build([learner], exams, []).incompleteRows[0]
    expect(row).toMatchObject({ completed: 0, required: 2, total: 0, mean: null, points: null, rank: null })
  })

  it('treats a numeric zero as a recorded mark', () => {
    const exams = examsFor(subjects.slice(0, 1))
    const learner = student('zero', subjects.slice(0, 1))
    const row = build([learner], exams, marksFor(learner._id, exams, [0])).completedRows[0]
    expect(row).toMatchObject({ completed: 1, required: 1, mean: 0, rank: 1 })
  })

  it('places each student in exactly one section', () => {
    const exams = examsFor(subjects.slice(0, 2))
    const learners = [student('full', subjects.slice(0, 2)), student('partial', subjects.slice(0, 2))]
    const sheet = build(learners, exams, [
      ...marksFor('full', exams, [90, 90]),
      ...marksFor('partial', exams, [95]),
    ])
    const ids = [...sheet.completedRows, ...sheet.incompleteRows].map((row) => row.studentId)
    expect(new Set(ids).size).toBe(learners.length)
    expect(ids).toHaveLength(learners.length)
  })

  it('ranks only complete students by the existing mean-percentage method and shares ties', () => {
    const exams = examsFor(subjects.slice(0, 2))
    const learners = [student('tie-b', subjects.slice(0, 2), '002'), student('lower', subjects.slice(0, 2), '003'), student('tie-a', subjects.slice(0, 2), '001')]
    const sheet = build(learners, exams, [
      ...marksFor('tie-a', exams, [80, 80]),
      ...marksFor('tie-b', exams, [80, 80]),
      ...marksFor('lower', exams, [70, 70]),
    ])
    expect(sheet.completedRows.map((row) => [row.studentId, row.rank, row.mean])).toEqual([
      ['tie-a', 1, 80], ['tie-b', 1, 80], ['lower', 3, 70],
    ])
  })

  it('does not require unassigned or unenrolled subjects', () => {
    const exams = examsFor(subjects.slice(0, 3))
    const learner = student('two', subjects.slice(0, 2))
    const sheet = build([learner], exams, marksFor(learner._id, exams, [55, 65]))
    expect(sheet.completedRows[0]).toMatchObject({ required: 2, completed: 2, mean: 60 })
    expect(sheet.completedRows[0].requiredExamIds).not.toContain(exams[2]._id)
    expect(sheet.completedRows[0].cells[exams[2]._id]).toBeNull()
  })

  it('requires each paper row, including multiple papers for one enrolled subject', () => {
    const exams = [...examsFor([subjects[0]]), ...examsFor([subjects[0]], 'second-paper')]
    const learner = student('multi-paper', [subjects[0]])
    const sheet = build([learner], exams, marksFor(learner._id, exams, [90]))
    expect(sheet.incompleteRows[0]).toMatchObject({ required: 2, completed: 1 })
    expect(sheet.incompleteRows[0].outstandingPapers).toHaveLength(1)
  })

  it('does not treat explicit outcome codes as numeric zero, and keeps them recorded', () => {
    const exams = examsFor(subjects.slice(0, 2))
    const learner = student('codes', subjects.slice(0, 2))
    const row = build([learner], exams, marksFor(learner._id, exams, ['X', 'Y'])).incompleteRows[0]
    expect(row).toMatchObject({ completed: 0, required: 2, total: 0, mean: null, points: null, rank: null, assessmentComplete: false })
    expect(row.cells).toEqual({ [exams[0]._id]: 'X', [exams[1]._id]: 'Y' })
    expect(row.outstandingPapers.join(' ')).toContain('(X recorded, awaiting valid score)')
  })

  it('treats an empty enrollment array as unavailable, not proof of zero enrolled subjects', () => {
    const exams = examsFor(subjects.slice(0, 2))
    const learner = student('empty-enrollment', [])
    const row = build([learner], exams, marksFor(learner._id, exams, [88])).incompleteRows[0]

    expect(row).toMatchObject({
      enrollmentKnown: false,
      completionKnown: false,
      assessmentComplete: false,
      required: 0,
      completed: 0,
      mean: null,
      total: 0,
      grade: '—',
      rank: null,
    })
    const csv = toCsv(build([learner], exams, marksFor(learner._id, exams, [88])))
    expect(csv).toContain('Unavailable / unverified')
    expect(csv).not.toContain('88.00')
  })

  it('ranks a fully assessed student only when the adapter marks enrollment as authoritatively verified', () => {
    const exams = examsFor(subjects.slice(0, 2))
    const learner = { ...student('verified', subjects.slice(0, 2)), enrollment_certainty: 'verified_enrolled' as const }
    const lower = { ...student('verified-lower', subjects.slice(0, 2)), enrollment_certainty: 'verified_enrolled' as const }
    const sheet = build([learner, lower], exams, [
      ...marksFor(learner._id, exams, [95, 95]),
      ...marksFor(lower._id, exams, [85, 85]),
    ])
    expect(sheet.completedRows.map(({ studentId, rank, mean }) => [studentId, rank, mean])).toEqual([
      ['verified', 1, 95],
      ['verified-lower', 2, 85],
    ])
  })

  it.each([
    ['missing subject_ids', undefined],
    ['null subject_ids', null],
    ['empty subject_ids', []],
    ['duplicate subject_ids', [subjects[0], subjects[0]]],
    ['invalid subject_ids', [subjects[0], '  ']],
    ['non-string subject_ids', [subjects[0], null]],
  ])('withholds rank and final average for verified_enrolled with %s even when all class papers have marks', (_label, rawSubjectIds) => {
    const exams = examsFor(subjects.slice(0, 2))
    const learner = {
      ...student('malformed-scope', subjects.slice(0, 2)),
      subject_ids: rawSubjectIds as unknown as string[] | undefined,
      enrollment_certainty: 'verified_enrolled' as const,
      enrollment_term_id: 'term-1',
    }
    const sheet = build([learner], exams, marksFor(learner._id, exams, [100, 100]))

    expect(sheet.completedRows).toHaveLength(0)
    expect(sheet.incompleteRows[0]).toMatchObject({
      enrollmentCertainty: 'unknown',
      enrollmentKnown: false,
      completionKnown: false,
      assessmentComplete: false,
      mean: null,
      points: null,
      rank: null,
    })
  })

  it('excludes an authoritatively verified zero-enrollment student without a false zero average', () => {
    const exams = examsFor(subjects.slice(0, 2))
    const learner = { ...student('no-enrollments', []), enrollment_certainty: 'verified_no_enrollments' as const }
    const sheet = build([learner], exams, marksFor(learner._id, exams, [95]))
    expect(sheet.completedRows).toHaveLength(0)
    expect(sheet.incompleteRows[0]).toMatchObject({
      enrollmentCertainty: 'verified_no_enrollments', enrollmentKnown: true, completionKnown: false,
      assessmentComplete: false, mean: null, points: null, rank: null,
    })
    expect(toCsv(sheet)).toContain('Verified · no enrollments')
  })

  it('withholds ranking and averages when enrollment rows are hidden by the caller’s authorization scope', () => {
    const exams = examsFor(subjects.slice(0, 2))
    const learner = { ...student('hidden-enrollment', []), enrollment_certainty: 'unknown' as const }
    const sheet = build([learner], exams, marksFor(learner._id, exams, [95, 95]))
    expect(sheet.completedRows).toHaveLength(0)
    expect(sheet.incompleteRows[0]).toMatchObject({
      enrollmentCertainty: 'unknown', completionKnown: false, assessmentComplete: false, mean: null, rank: null,
    })
  })

  it('withholds ranking and averages when enrollment verification fails', () => {
    const exams = examsFor(subjects.slice(0, 2))
    const learner = { ...student('verification-error', []), enrollment_certainty: 'error' as const }
    const sheet = build([learner], exams, marksFor(learner._id, exams, [95, 95]))
    expect(sheet.completedRows).toHaveLength(0)
    expect(sheet.incompleteRows[0]).toMatchObject({
      enrollmentCertainty: 'error', completionKnown: false, assessmentComplete: false, mean: null, points: null, rank: null,
    })
    expect(toCsv(sheet)).toContain('Enrollment verification error')
  })

  it('never ranks a student when a malformed verification response decodes to unknown', () => {
    const exams = examsFor(subjects.slice(0, 1))
    const malformedRows = [
      [{ student_id: 'student-1', certainty: 'verified_no_enrollments' }],
      [{ student_id: 'student-1', certainty: 'verified_no_enrollments', subject_ids: null }],
      [{ student_id: 'student-1', certainty: 'verified_enrolled', subject_ids: [] }],
      [{ student_id: 'student-2', certainty: 'verified_enrolled', subject_ids: [subjects[0]] }],
      { student_id: 'student-1', certainty: 'verified_enrolled', subject_ids: [subjects[0]] },
    ]

    for (const rows of malformedRows) {
      const scope = decodeEnrollmentVerification(['student-1'], rows)['student-1']
      const learner = {
        ...student('student-1', scope.subjectIds),
        enrollment_certainty: scope.certainty,
        enrollment_term_id: 'term-1',
      }
      const sheet = build([learner], exams, marksFor(learner._id, exams, [99]))
      expect(sheet.completedRows).toHaveLength(0)
      expect(sheet.incompleteRows[0].rank).toBeNull()
    }
  })

  it('withholds ranks and averages when verification belongs to a different term', () => {
    const exams = examsFor(subjects.slice(0, 2))
    const learner = student('different-term', subjects.slice(0, 2))
    learner.enrollment_term_id = 'term-2'
    const sheet = build([learner], exams, marksFor(learner._id, exams, [95, 95]))

    expect(sheet.completedRows).toHaveLength(0)
    expect(sheet.incompleteRows[0]).toMatchObject({
      assessmentTermVerified: false,
      enrollmentKnown: false,
      completionKnown: false,
      mean: null,
      rank: null,
    })
    expect(toCsv(sheet)).toContain('Assessment term unavailable or enrollment scope belongs to another term')
  })

  it('withholds ranks and averages when there is no uniquely established assessment term', () => {
    const exams = examsFor(subjects.slice(0, 2))
    const learner = student('no-term', subjects.slice(0, 2))
    const sheet = build([learner], exams, marksFor(learner._id, exams, [95, 95]), { assessmentTermId: null })

    expect(sheet.completedRows).toHaveLength(0)
    expect(sheet.incompleteRows[0]).toMatchObject({ assessmentTermVerified: false, mean: null, rank: null })
  })

  it('does not rank a student when an enrolled subject has no paper configured for the term', () => {
    const learner = student('unassessed-subject', subjects.slice(0, 2))
    const exams = examsFor(subjects.slice(0, 1))
    const sheet = build([learner], exams, marksFor(learner._id, exams, [95]))

    expect(sheet.completedRows).toHaveLength(0)
    expect(sheet.incompleteRows[0]).toMatchObject({ assessmentComplete: false, rank: null, unassessedSubjects: [subjects[1]] })
    expect(toCsv(sheet)).toContain(`${subjects[1]} · no assessment paper configured`)
  })

  it('does not claim overall completion or positions when the assessment paper scope is incomplete', () => {
    const exams = examsFor(subjects.slice(0, 2))
    const learner = { ...student('teacher-view', subjects.slice(0, 2)), enrollment_certainty: 'verified_enrolled' as const }
    const sheet = build([learner], exams, marksFor(learner._id, exams, [95, 95]), { completionScopeComplete: false })
    expect(sheet.completedRows).toHaveLength(0)
    expect(sheet.incompleteRows[0]).toMatchObject({ completionKnown: false, enrollmentKnown: true, assessmentComplete: false, rank: null })
  })

  it('preserves IUPC grade-band boundaries and computes grade points from the configured mean band', () => {
    expect(DEFAULT_BANDS.map(({ grade, min_score, points }) => [grade, min_score, points])).toEqual([
      ['A*', 90, 9], ['A', 80, 8], ['B', 70, 7], ['C', 60, 6], ['D', 50, 5],
      ['E', 40, 4], ['F', 30, 3], ['G', 20, 2], ['U', 0, 1],
    ])
    const exams = examsFor(subjects.slice(0, 2))
    const learner = student('grades', subjects.slice(0, 2))
    const row = build([learner], exams, marksFor(learner._id, exams, [90, 90])).completedRows[0]
    expect(row).toMatchObject({ mean: 90, grade: 'A*', points: 9 })
  })

  it('uses the same mean-of-recorded-paper-percentages as the report-card formula', () => {
    const exams = examsFor(subjects.slice(0, 3))
    exams[0].max_score = 50
    exams[1].max_score = 100
    exams[2].max_score = 25
    const learner = student('consistent', subjects.slice(0, 3))
    const scores = [40, 80, 20]
    const row = build([learner], exams, marksFor(learner._id, exams, scores)).completedRows[0]
    const reportCardTermAverage = mean(scores.map((score, index) => score / exams[index].max_score * 100))
    expect(row.mean).toBe(reportCardTermAverage)
    expect(row.total).toBe(240)
  })

  it('exports incomplete status and missing paper details instead of a rank', () => {
    const exams = examsFor(subjects.slice(0, 2))
    const learner = student('csv', subjects.slice(0, 2))
    const csv = toCsv(build([learner], exams, marksFor(learner._id, exams, [88])))
    expect(csv).toContain('Average % (Provisional when incomplete; blank when enrollment unavailable)')
    expect(csv).toContain('Incomplete / provisional')
    expect(csv).toContain('1/2')
    expect(csv).toContain('Term paper')
  })
})
