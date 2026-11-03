import { describe, expect, it } from 'vitest'
import {
  EXAM_STATUSES,
  MAX_PAPER_SCORE,
  STATUS_LABEL,
  eligibleRoster,
  examWriteMessage,
  paperDetailIssue,
  paperProgress,
  publicationIssue,
  publicationWarning,
  statusTone,
  transitionIssue,
  transitionsFrom,
} from './exam-lifecycle'
import type { Student } from '../data/types'

const base = {
  school_id: 'school',
  admission_number: 'A1',
  full_name: 'Fictional Learner',
  gender: 'Female' as const,
  date_of_birth: '2012-01-01',
  class_id: 'class-a',
  guardian_name: '',
  guardian_phone: '',
  status: 'Active' as const,
  archived: false,
  archived_at: null,
  subject_ids: ['subject-maths'],
  enrollment_certainty: 'verified_enrolled' as const,
  enrollment_term_id: 'term-1',
}

const student = (overrides: Partial<Student> = {}): Student => ({ ...base, _id: 'student-1', ...overrides })

const exam = { class_id: 'class-a', subject_id: 'subject-maths', term_id: 'term-1' }

describe('exam status transitions', () => {
  it('offers only forward moves from draft and open', () => {
    expect(transitionsFrom('draft').map((entry) => entry.to)).toEqual(['open'])
    expect(transitionsFrom('open').map((entry) => entry.to)).toEqual(['locked'])
  })

  it('allows publication from locked and a correction window back to open', () => {
    expect(transitionsFrom('locked').map((entry) => entry.to)).toEqual(['published', 'open'])
  })

  it('lets a published paper be withdrawn but never reopened directly', () => {
    expect(transitionsFrom('published').map((entry) => entry.to)).toEqual(['locked'])
  })

  it('names and tones every status', () => {
    for (const status of EXAM_STATUSES) {
      expect(STATUS_LABEL[status].length).toBeGreaterThan(0)
      expect(statusTone(status).length).toBeGreaterThan(0)
    }
  })
})

describe('the register a paper is marked against', () => {
  it('keeps only students verified in this subject for this term', () => {
    const db = {
      students: [
        student(),
        student({ _id: 'not-enrolled', subject_ids: ['subject-english'] }),
        student({ _id: 'other-term', enrollment_term_id: 'term-2' }),
        student({ _id: 'unverified', enrollment_certainty: 'unknown' }),
        student({ _id: 'other-class', class_id: 'class-b' }),
        student({ _id: 'archived', archived: true }),
        student({ _id: 'alumni', status: 'Alumni' }),
      ],
    }
    expect(eligibleRoster(db, exam).map((row) => row._id)).toEqual(['student-1'])
  })

  it('treats X and Y as recorded outcomes but not a null score', () => {
    const roster = [student(), student({ _id: 'student-2' }), student({ _id: 'student-3' })]
    const progress = paperProgress(roster, [
      { student_id: 'student-1', score: 78 },
      { student_id: 'student-2', score: 'X' },
      { student_id: 'student-3', score: null },
      { student_id: 'outsider', score: 90 },
    ])
    expect(progress).toEqual({ roster: 3, recorded: 2, missing: 1, complete: false, percent: 67 })
  })

  it('reports a complete paper without inventing a roster', () => {
    expect(paperProgress([student()], [{ student_id: 'student-1', score: 'Y' }])).toMatchObject({
      roster: 1,
      recorded: 1,
      missing: 0,
      complete: true,
      percent: 100,
    })
    expect(paperProgress([], [])).toMatchObject({ roster: 0, recorded: 0, missing: 0, complete: false, percent: 0 })
  })
})

describe('publication guards', () => {
  const complete = { roster: 2, recorded: 2, missing: 0, complete: true, percent: 100 }

  it('refuses to publish a paper that is not locked', () => {
    expect(publicationIssue(complete, 'open')).toBe('Only a locked paper can be published.')
  })

  it('refuses an empty roster and an empty paper', () => {
    expect(publicationIssue({ ...complete, roster: 0, recorded: 0, complete: false }, 'locked')).toContain(
      'No verified subject enrollment',
    )
    expect(publicationIssue({ ...complete, recorded: 0, missing: 2, complete: false }, 'locked')).toContain(
      'No result has been recorded',
    )
  })

  it('publishes a complete paper and warns, without blocking, a partial one', () => {
    expect(publicationIssue(complete, 'locked')).toBeNull()
    expect(publicationWarning(complete)).toBeNull()

    const partial = { roster: 3, recorded: 2, missing: 1, complete: false, percent: 67 }
    expect(publicationIssue(partial, 'locked')).toBeNull()
    expect(publicationWarning(partial)).toContain('1 of 3 enrolled students')
    expect(publicationWarning(partial)).toContain('INC')
  })
})

describe('paper details the database would refuse', () => {
  const valid = { max_score: 100, exam_date: '2026-11-05', editing_deadline: null }

  it('accepts a valid paper and a deadline on the same day', () => {
    expect(paperDetailIssue(valid)).toBeNull()
    expect(paperDetailIssue({ ...valid, editing_deadline: '2026-11-05T16:00' })).toBeNull()
  })

  it('requires a positive total inside the hard ceiling', () => {
    expect(paperDetailIssue({ ...valid, max_score: 0 })).toContain('greater than zero')
    expect(paperDetailIssue({ ...valid, max_score: MAX_PAPER_SCORE + 1 })).toContain('cannot exceed')
  })

  it('requires a real calendar date inside the supported range', () => {
    expect(paperDetailIssue({ ...valid, exam_date: '' })).toContain('Choose the date')
    expect(paperDetailIssue({ ...valid, exam_date: '05/11/2026' })).toContain('Choose the date')
    expect(paperDetailIssue({ ...valid, exam_date: '1999-12-31' })).toContain('outside the range')
  })

  it('refuses a total below an already recorded score, and says how many', () => {
    expect(paperDetailIssue({ ...valid, max_score: 70 }, [78])).toContain('1 recorded score exceeds')
    expect(paperDetailIssue({ ...valid, max_score: 70 }, [60, 78, 81])).toContain('2 recorded scores exceed')
    expect(paperDetailIssue({ ...valid, max_score: 70 }, [60])).toBeNull()
  })

  it('refuses a deadline before the paper is sat, and an unreadable one', () => {
    expect(paperDetailIssue({ ...valid, editing_deadline: '2026-11-04T18:00' })).toContain(
      'cannot fall before the date',
    )
    expect(paperDetailIssue({ ...valid, editing_deadline: 'not-a-date' })).toContain('Enter a valid deadline')
  })
})

describe('server-side lifecycle enforcement', () => {
  it('allows only the moves the graph offers', () => {
    expect(transitionIssue('draft', 'open')).toBeNull()
    expect(transitionIssue('open', 'locked')).toBeNull()
    expect(transitionIssue('locked', 'published')).toBeNull()
    expect(transitionIssue('locked', 'open')).toBeNull()
    expect(transitionIssue('published', 'locked')).toBeNull()
    expect(transitionIssue('locked', 'locked')).toBeNull()
    expect(transitionIssue('open', 'published')).toContain('cannot be moved')
    expect(transitionIssue('published', 'open')).toContain('cannot be moved')
    expect(transitionIssue('draft', 'locked')).toContain('cannot be moved')
  })

  it('translates a refused database write into an actionable sentence', () => {
    expect(examWriteMessage('invalid examination status transition')).toContain('skips a step')
    expect(examWriteMessage('the maximum cannot fall below a recorded score')).toContain('below a score')
    expect(examWriteMessage('a paper with no recorded result cannot be published')).toContain('no recorded result')
    expect(examWriteMessage('not authorized')).toContain('administrator')
    expect(examWriteMessage('some unexpected failure')).toBe(
      'The paper could not be saved. Check the details and try again.',
    )
  })
})
