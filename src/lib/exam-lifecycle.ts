import type { Exam, ExamStatus, Mark, Student } from '../data/types'
import { isOperationalStudent } from '../data/student-lifecycle'

/**
 * Examination lifecycle rules.
 *
 * Pure and deterministic so the Examinations page and its tests share one
 * definition. The database remains the authority: only a school administrator
 * may write an `exams` row (RLS `exams admin write`), and the mark-write trigger
 * refuses every score change unless the paper is `open`. These helpers decide
 * what the registrar is offered, not what the server permits.
 */

/** The five papers this campus sets, in the order a term runs them. */
export const EXAM_TYPES = ['CAT 1', 'CAT 2', 'Midterm', 'Endterm', 'Pre-Mock'] as const

export const EXAM_STATUSES: ExamStatus[] = ['draft', 'open', 'locked', 'published']

export const STATUS_LABEL: Record<ExamStatus, string> = {
  draft: 'Draft',
  open: 'Open for entry',
  locked: 'Locked',
  published: 'Published',
}

export type StatusTone = 'neutral' | 'brass' | 'ok' | 'ink' | 'danger'

export function statusTone(status: ExamStatus): StatusTone {
  switch (status) {
    case 'draft':
      return 'neutral'
    case 'open':
      return 'ok'
    case 'locked':
      return 'ink'
    case 'published':
      return 'brass'
  }
}

export interface StatusTransition {
  to: ExamStatus
  label: string
  /** What the change means, in the registrar's words. */
  hint: string
}

/**
 * The moves a registrar may make from a status. Nothing rewrites a paper back
 * to draft: a paper that has been opened has marks attached to it, and hiding
 * that history would be worse than leaving it visible.
 */
export function transitionsFrom(status: ExamStatus): StatusTransition[] {
  switch (status) {
    case 'draft':
      return [
        {
          to: 'open',
          label: 'Open for marks entry',
          hint: 'Teachers with “Enter and edit marks” may record results for this paper until it is locked or a deadline passes.',
        },
      ]
    case 'open':
      return [
        {
          to: 'locked',
          label: 'Lock the paper',
          hint: 'Freezes every score and puts the paper’s results on broadsheets and report cards. Nobody can edit a mark afterwards.',
        },
      ]
    case 'locked':
      return [
        {
          to: 'published',
          label: 'Publish results',
          hint: 'Declares the results final. A published paper stays read-only for everyone.',
        },
        {
          to: 'open',
          label: 'Reopen for corrections',
          hint: 'Returns the paper to open entry so a score can be corrected before publication.',
        },
      ]
    case 'published':
      return [
        {
          to: 'locked',
          label: 'Withdraw from publication',
          hint: 'Results stay on broadsheets and report cards but are no longer final until published again.',
        },
      ]
  }
}

export interface PaperProgress {
  /** Students with a verified enrollment in this paper's subject and term. */
  roster: number
  /** Of those, the ones with an accepted outcome (a score, X or Y). */
  recorded: number
  missing: number
  complete: boolean
  percent: number
}

/**
 * The register a paper is marked against. It mirrors Marks Entry exactly: a
 * student counts only when the server verified their enrollment in this subject
 * for this term, so a learner who does not take the subject never blocks a
 * paper from being completed or published.
 */
export function eligibleRoster(
  db: Pick<{ students: Student[] }, 'students'>,
  exam: Pick<Exam, 'class_id' | 'subject_id' | 'term_id'>,
): Student[] {
  return db.students.filter(
    (student) =>
      student.class_id === exam.class_id &&
      isOperationalStudent(student) &&
      student.enrollment_term_id === exam.term_id &&
      student.enrollment_certainty === 'verified_enrolled' &&
      Array.isArray(student.subject_ids) &&
      student.subject_ids.includes(exam.subject_id),
  )
}

export function paperProgress(
  roster: readonly Pick<Student, '_id'>[],
  marks: readonly Pick<Mark, 'student_id' | 'score'>[],
): PaperProgress {
  const expected = new Set(roster.map((student) => student._id))
  const recorded = new Set<string>()
  for (const mark of marks) {
    if (!expected.has(mark.student_id)) continue
    // `null` is an unentered result; X and Y are recorded outcomes.
    if (mark.score === null || mark.score === undefined) continue
    recorded.add(mark.student_id)
  }
  const total = expected.size
  return {
    roster: total,
    recorded: recorded.size,
    missing: Math.max(0, total - recorded.size),
    complete: total > 0 && recorded.size === total,
    percent: total ? Math.round((recorded.size / total) * 100) : 0,
  }
}

/**
 * Why publication must be refused, or null when it may go ahead. A paper with
 * no verified roster is not publishable: there would be nothing to publish and
 * the usual cause is a missing enrollment record, which is the registrar's to
 * fix first.
 */
export function publicationIssue(progress: PaperProgress, status: ExamStatus): string | null {
  if (status !== 'locked') return 'Only a locked paper can be published.'
  if (progress.roster === 0) {
    return 'No verified subject enrollment is on record for this paper, so there is nothing to publish. Check the class register and subject enrollments first.'
  }
  if (progress.recorded === 0) {
    return 'No result has been recorded for this paper yet. Record the marks before publishing.'
  }
  return null
}

/** A confirmation sentence when some students have no outcome; null when complete. */
export function publicationWarning(progress: PaperProgress): string | null {
  if (progress.missing === 0) return null
  return `${progress.missing} of ${progress.roster} enrolled students have no recorded outcome (a score, X or Y). Their report rows will read “INC” until a result is entered.`
}

/**
 * The limits the database enforces too (`enforce_exam_write`, see the
 * 20261103000200 migration). One definition means the form refuses exactly what
 * the server would refuse instead of drifting from it.
 */
export const MAX_PAPER_SCORE = 1000
export const EARLIEST_PAPER_DATE = '2000-01-01'
export const LATEST_PAPER_DATE = '2100-12-31'

export interface PaperDetails {
  max_score: number
  exam_date: string
  editing_deadline?: string | null
}

/**
 * Why these paper details would be refused, or null when they are valid. A
 * total may only be lowered to a value every recorded score still fits inside.
 */
export function paperDetailIssue(details: PaperDetails, recordedScores: readonly number[] = []): string | null {
  const { max_score: maxScore, exam_date: examDate } = details
  if (!Number.isFinite(maxScore) || maxScore <= 0) return 'Maximum marks must be greater than zero.'
  if (maxScore > MAX_PAPER_SCORE) return `Maximum marks cannot exceed ${MAX_PAPER_SCORE}.`
  if (!/^\d{4}-\d{2}-\d{2}$/.test(examDate)) return 'Choose the date the paper is sat.'
  if (examDate < EARLIEST_PAPER_DATE || examDate > LATEST_PAPER_DATE) {
    return 'That date is outside the range a school paper can be sat.'
  }
  const over = recordedScores.filter((score) => score > maxScore)
  if (over.length) {
    return `${over.length} recorded score${over.length === 1 ? '' : 's'} exceed${over.length === 1 ? 's' : ''} that total. Correct or clear ${over.length === 1 ? 'it' : 'them'} before lowering the maximum.`
  }
  if (details.editing_deadline) {
    const deadline = Date.parse(details.editing_deadline)
    if (Number.isNaN(deadline)) return 'Enter a valid deadline, or leave it empty to use the school window.'
    if (deadline < Date.parse(`${examDate}T00:00:00`)) return 'The deadline cannot fall before the date the paper is sat.'
  }
  return null
}

/** Restates the transition graph for a caller that did not go through the UI. */
export function transitionIssue(from: ExamStatus, to: ExamStatus): string | null {
  if (from === to) return null
  if (transitionsFrom(from).some((entry) => entry.to === to)) return null
  return `A ${STATUS_LABEL[from].toLowerCase()} paper cannot be moved to ${STATUS_LABEL[to].toLowerCase()}.`
}

/**
 * The database refuses these writes with short codes and sentences. This turns
 * them into something a registrar can act on, without inventing a new rule.
 */
const SERVER_ISSUES: [RegExp, string][] = [
  [
    /invalid examination status transition/i,
    'That change skips a step in the paper’s lifecycle. Reload the paper and use one of the moves offered.',
  ],
  [
    /a paper must start as a draft or open/i,
    'A new paper starts as a draft or open for entry. It cannot be created already published.',
  ],
  [/maximum marks must be greater than zero/i, 'Maximum marks must be greater than zero and at most 1000.'],
  [
    /maximum cannot fall below a recorded score/i,
    'That total is below a score already recorded. Correct or clear the score first.',
  ],
  [
    /deadline cannot fall before the date/i,
    'The deadline cannot fall before the date the paper is sat.',
  ],
  [
    /no recorded result cannot be published/i,
    'A paper with no recorded result cannot be published.',
  ],
  [
    /recorded results cannot change its term, class, subject/i,
    'This paper already has results, so its term, class, subject and assessment type are fixed.',
  ],
  [/paper date is outside the range/i, 'That date is outside the range a school paper can be sat.'],
  [/not authorized/i, 'Only a school administrator can change a paper.'],
]

export function examWriteMessage(raw: string): string {
  for (const [pattern, message] of SERVER_ISSUES) if (pattern.test(raw)) return message
  return 'The paper could not be saved. Check the details and try again.'
}
