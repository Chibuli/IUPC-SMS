import { describe, expect, it } from 'vitest'
import { decodeEnrollmentVerification, uniqueActiveTermId } from './enrollment-certainty'

const enrolled = { student_id: 'student-1', certainty: 'verified_enrolled', subject_ids: ['subject-1', 'subject-2'] }
const verifiedEmpty = { student_id: 'student-1', certainty: 'verified_no_enrollments', subject_ids: [] }

const decodeOne = (row: unknown) => decodeEnrollmentVerification(['student-1'], [row])['student-1']

describe('authoritative enrollment certainty', () => {
  it('accepts a verified non-empty enrollment scope', () => {
    expect(decodeOne(enrolled)).toEqual({
      certainty: 'verified_enrolled',
      subjectIds: ['subject-1', 'subject-2'],
    })
  })

  it('accepts verified-empty only when subject_ids is explicitly an empty array', () => {
    expect(decodeOne(verifiedEmpty)).toEqual({ certainty: 'verified_no_enrollments', subjectIds: [] })
  })

  it.each([
    ['missing subject_ids', { student_id: 'student-1', certainty: 'verified_no_enrollments' }],
    ['null subject_ids', { ...verifiedEmpty, subject_ids: null }],
    ['non-array subject_ids', { ...verifiedEmpty, subject_ids: '[]' }],
    ['invalid array entry', { ...verifiedEmpty, subject_ids: [null] }],
    ['nonempty array', { ...verifiedEmpty, subject_ids: ['subject-1'] }],
  ])('rejects verified-empty with %s', (_label, row) => {
    expect(decodeOne(row).certainty).toBe('unknown')
  })

  it.each([
    ['missing subject_ids', { student_id: 'student-1', certainty: 'verified_enrolled' }],
    ['null subject_ids', { ...enrolled, subject_ids: null }],
    ['non-array subject_ids', { ...enrolled, subject_ids: { id: 'subject-1' } }],
    ['empty array', { ...enrolled, subject_ids: [] }],
    ['invalid subject ID', { ...enrolled, subject_ids: ['  '] }],
    ['duplicate subject IDs', { ...enrolled, subject_ids: ['subject-1', 'subject-1'] }],
  ])('rejects verified-enrolled with %s', (_label, row) => {
    expect(decodeOne(row).certainty).toBe('unknown')
  })

  it('preserves explicit unknown certainty without exposing subjects', () => {
    expect(decodeOne({ student_id: 'student-1', certainty: 'unknown', subject_ids: null })).toEqual({
      certainty: 'unknown',
      subjectIds: [],
    })
  })

  it('rejects unknown status values', () => {
    expect(decodeOne({ ...verifiedEmpty, certainty: 'verified' }).certainty).toBe('unknown')
  })

  it('ignores unexpected student IDs rather than assigning their scope to a requested student', () => {
    expect(decodeEnrollmentVerification(['student-1'], [
      { ...enrolled, student_id: 'student-2' },
    ])['student-1']).toEqual({ certainty: 'unknown', subjectIds: [] })
  })

  it('keeps duplicate response rows unknown rather than choosing one scope claim', () => {
    expect(decodeEnrollmentVerification(['student-1'], [enrolled, verifiedEmpty])['student-1']).toEqual({
      certainty: 'unknown',
      subjectIds: [],
    })
  })

  it('treats missing, null, or malformed response data as unknown', () => {
    for (const rows of [null, undefined, {}, 'not rows']) {
      expect(decodeEnrollmentVerification(['student-1'], rows)['student-1']).toEqual({
        certainty: 'unknown',
        subjectIds: [],
      })
    }
  })

  it('treats a missing response row as unknown, not as no enrollments', () => {
    expect(decodeEnrollmentVerification(['student-1'], [])['student-1']).toEqual({
      certainty: 'unknown',
      subjectIds: [],
    })
  })

  it('marks a failed verification operation as error', () => {
    expect(decodeEnrollmentVerification(['student-1'], null, true)['student-1']).toEqual({
      certainty: 'error',
      subjectIds: [],
    })
  })

  it('establishes a term only when exactly one term is explicitly active', () => {
    expect(uniqueActiveTermId([{ id: 'term-1', is_active: true }, { id: 'term-2', is_active: false }])).toBe('term-1')
    expect(uniqueActiveTermId([{ id: 'term-1', is_active: false }])).toBeNull()
    expect(uniqueActiveTermId([
      { id: 'term-1', is_active: true },
      { id: 'term-2', is_active: true },
    ])).toBeNull()
    expect(uniqueActiveTermId([])).toBeNull()
  })
})
