import { describe, expect, it } from 'vitest'
import {
  canonicalScorePayload,
  canonicalStoredPayload,
  classifyDispatchFailure,
  fenceIsOpen,
  isDispatchable,
  needsReview,
  ownershipProblem,
  reasonText,
  rejectedExpiry,
  stateAfterLeaseExpiry,
  tokenFromMessage,
} from './offline-outcomes'

const EXAM = '90000000-0000-4000-8000-000000000001'
const STUDENT = '80000000-0000-4000-8000-000000000001'

describe('canonical payload', () => {
  it('accepts exactly the three approved fields', () => {
    expect(canonicalScorePayload({ examId: EXAM, studentId: STUDENT, score: 42 })).toContain('score:42')
  })

  it('rejects a slipped-in extra field', () => {
    expect(canonicalScorePayload({ examId: EXAM, studentId: STUDENT, score: 42, schoolId: EXAM })).toBeNull()
  })

  it('rejects a missing field', () => {
    expect(canonicalScorePayload({ examId: EXAM, studentId: STUDENT })).toBeNull()
  })

  it('treats 1 and 1.0 as the same request', () => {
    expect(canonicalScorePayload({ examId: EXAM, studentId: STUDENT, score: 1 })).toBe(
      canonicalScorePayload({ examId: EXAM, studentId: STUDENT, score: 1.0 }),
    )
  })

  it('does not read a string score as a number score', () => {
    expect(canonicalScorePayload({ examId: EXAM, studentId: STUDENT, score: '1' })).toBeNull()
  })

  it('separates a cleared mark from the X code', () => {
    expect(canonicalScorePayload({ examId: EXAM, studentId: STUDENT, score: null })).not.toBe(
      canonicalScorePayload({ examId: EXAM, studentId: STUDENT, score: 'X' }),
    )
  })

  it('normalises UUID case so a retry matches its receipt', () => {
    expect(canonicalScorePayload({ examId: EXAM.toUpperCase(), studentId: STUDENT, score: 5 })).toBe(
      canonicalScorePayload({ examId: EXAM, studentId: STUDENT, score: 5 }),
    )
  })

  it('refuses negative and non-finite scores', () => {
    expect(canonicalScorePayload({ examId: EXAM, studentId: STUDENT, score: -1 })).toBeNull()
    expect(canonicalScorePayload({ examId: EXAM, studentId: STUDENT, score: Number.POSITIVE_INFINITY })).toBeNull()
  })

  it('reads a stored snake_case receipt payload', () => {
    expect(canonicalStoredPayload({ exam_id: EXAM, student_id: STUDENT, score: 7 })).toBe(
      canonicalScorePayload({ examId: EXAM, studentId: STUDENT, score: 7 }),
    )
  })

  it('reads a legacy receipt with no payload as unbound, never as a match', () => {
    expect(canonicalStoredPayload(null)).toBeNull()
    expect(canonicalStoredPayload({})).toBeNull()
  })

  it('detects a genuinely different operation', () => {
    expect(canonicalScorePayload({ examId: EXAM, studentId: STUDENT, score: 7 })).not.toBe(
      canonicalScorePayload({ examId: EXAM, studentId: STUDENT, score: 8 }),
    )
  })
})

describe('dispatch classification', () => {
  it('leaves an undispatched record waiting rather than failed', () => {
    const result = classifyDispatchFailure({ dispatched: false, online: false })
    expect(result.state).toBe('Pending')
    expect(result.automaticRetry).toBe(false)
    expect(result.reconcile).toBe(false)
  })

  it('treats no answer at all as uncertain, not as a rejection', () => {
    const result = classifyDispatchFailure({ dispatched: true, online: true, status: 0 })
    expect(result.state).toBe('Uncertain')
    expect(result.reconcile).toBe(true)
    expect(result.automaticRetry).toBe(false)
  })

  it('treats an expired session as not sent', () => {
    expect(classifyDispatchFailure({ dispatched: true, online: true, status: 401 }).state).toBe('Pending')
  })

  it('reads a business refusal as rejected', () => {
    const result = classifyDispatchFailure({
      dispatched: true,
      online: true,
      status: 403,
      code: '42501',
      message: 'mark entry is closed',
    })
    expect(result.state).toBe('Rejected')
    expect(result.token).toBe('EXAM_CLOSED')
  })

  it('does not confuse a missing execute privilege with a business refusal', () => {
    const result = classifyDispatchFailure({
      dispatched: true,
      online: true,
      status: 403,
      code: '42501',
      message: 'permission denied for function apply_offline_write',
    })
    expect(result.state).toBe('Blocked')
    expect(result.token).toBe('RPC_EXECUTE_DENIED')
  })

  it('distinguishes a missing function from a missing row', () => {
    expect(
      classifyDispatchFailure({ dispatched: true, online: true, status: 404, code: 'PGRST202', message: 'could not find the function' })
        .token,
    ).toBe('FUNCTION_MISSING')
    expect(
      classifyDispatchFailure({ dispatched: true, online: true, status: 404, code: '42501', message: 'record not found' }).state,
    ).toBe('Rejected')
  })

  it('never treats a 429 as proof the request did not run', () => {
    const result = classifyDispatchFailure({ dispatched: true, online: true, status: 429 })
    expect(result.state).toBe('Uncertain')
    expect(result.reconcile).toBe(true)
    expect(result.automaticRetry).toBe(false)
  })

  it('retries serialization and deadlock with the same request', () => {
    expect(classifyDispatchFailure({ dispatched: true, online: true, status: 409, code: '40001' })).toMatchObject({
      state: 'Retryable',
      automaticRetry: true,
      reconcile: false,
    })
    expect(classifyDispatchFailure({ dispatched: true, online: true, status: 409, code: '40P01' })).toMatchObject({
      state: 'Retryable',
      automaticRetry: true,
    })
  })

  it('does not assume a statement timeout rolled back', () => {
    expect(classifyDispatchFailure({ dispatched: true, online: true, status: 500, code: '57014' })).toMatchObject({
      state: 'Uncertain',
      reconcile: true,
    })
  })

  it('lets the receipt decide a uniqueness conflict', () => {
    expect(classifyDispatchFailure({ dispatched: true, online: true, status: 409, code: '23505' })).toMatchObject({
      state: 'Uncertain',
      reconcile: true,
    })
  })

  it('blocks a request id reused with different marks', () => {
    const result = classifyDispatchFailure({
      dispatched: true,
      online: true,
      status: 409,
      code: '22023',
      message: 'idempotency key reused with different request',
    })
    expect(result.state).toBe('Blocked')
    expect(result.token).toBe('IDEMPOTENCY_CONFLICT')
  })

  it('holds an uninterpretable conflict for review instead of guessing', () => {
    expect(classifyDispatchFailure({ dispatched: true, online: true, status: 409, message: 'conflict' }).state).toBe('Uncertain')
  })

  it('treats a server failure and an unknown status as uncertain', () => {
    expect(classifyDispatchFailure({ dispatched: true, online: true, status: 502 }).state).toBe('Uncertain')
    expect(classifyDispatchFailure({ dispatched: true, online: true, status: 418 }).state).toBe('Uncertain')
  })

  it('tells a permission-level refusal apart from a business one', () => {
    expect(classifyDispatchFailure({ dispatched: true, online: true, status: 403, code: '42501', message: 'not authorized' }).state).toBe(
      'Rejected',
    )
    expect(classifyDispatchFailure({ dispatched: true, online: true, status: 403, code: '42501', message: '?' }).state).toBe('Blocked')
  })
})

describe('reason tokens', () => {
  it('reads a server token out of the message', () => {
    expect(tokenFromMessage('ENROLLMENT_MISSING')).toBe('ENROLLMENT_MISSING')
    expect(tokenFromMessage('nothing recognisable')).toBeNull()
  })

  it('always has plain words for a person', () => {
    expect(reasonText(null)).toContain('Waiting')
    expect(reasonText('EXAM_CLOSED')).toContain('closed')
  })
})

describe('lease fence', () => {
  it('is open when dispatch began and nothing closed it', () => {
    expect(fenceIsOpen({ dispatchStartedAt: '2026-10-31T00:00:00.000Z', dispatchClosedAt: null })).toBe(true)
    expect(fenceIsOpen({ dispatchStartedAt: null, dispatchClosedAt: null })).toBe(false)
    expect(
      fenceIsOpen({ dispatchStartedAt: '2026-10-31T00:00:00.000Z', dispatchClosedAt: '2026-10-31T00:00:01.000Z' }),
    ).toBe(false)
  })

  it('reconciles an interrupted dispatch instead of queueing it again', () => {
    expect(
      stateAfterLeaseExpiry({
        state: 'Synchronizing',
        dispatchStartedAt: '2026-10-31T00:00:00.000Z',
        dispatchClosedAt: null,
      }),
    ).toBe('Uncertain')
  })

  it('queues a record that was claimed but never dispatched', () => {
    expect(stateAfterLeaseExpiry({ state: 'Synchronizing', dispatchStartedAt: null, dispatchClosedAt: null })).toBe('Pending')
  })

  it('leaves a settled record alone', () => {
    expect(stateAfterLeaseExpiry({ state: 'Accepted', dispatchStartedAt: null, dispatchClosedAt: null })).toBe('Accepted')
  })
})

describe('what may be sent without a person', () => {
  it('only queues pending and retryable work', () => {
    expect(isDispatchable('Pending')).toBe(true)
    expect(isDispatchable('Retryable')).toBe(true)
    expect(isDispatchable('Uncertain')).toBe(false)
    expect(isDispatchable('Rejected')).toBe(false)
    expect(isDispatchable('Blocked')).toBe(false)
    expect(isDispatchable('Accepted')).toBe(false)
    expect(isDispatchable('Synchronizing')).toBe(false)
  })

  it('keeps rejected, uncertain and blocked work in front of a person', () => {
    expect(needsReview('Rejected')).toBe(true)
    expect(needsReview('Uncertain')).toBe(true)
    expect(needsReview('Blocked')).toBe(true)
    expect(needsReview('Pending')).toBe(false)
  })
})

describe('ownership', () => {
  const owner = { userId: 'u1', schoolId: 's1' }

  it('refuses to send another account or school queue', () => {
    expect(ownershipProblem({ ...owner }, { userId: 'u2', schoolId: 's1' })).toBe('OWNER_MISMATCH')
    expect(ownershipProblem({ ...owner }, { userId: 'u1', schoolId: 's2' })).toBe('SCHOOL_MISMATCH')
    expect(ownershipProblem({ ...owner }, owner)).toBeNull()
  })

  it('honours a locked record', () => {
    expect(ownershipProblem({ ...owner, locked: true }, owner)).toBe('LOCKED')
  })
})

describe('rejected-record retention', () => {
  it('expires twelve calendar months later in UTC', () => {
    expect(rejectedExpiry('2026-10-31T09:30:00.000Z')).toBe('2027-10-31T09:30:00.000Z')
  })

  it('clamps the day when the target month is shorter', () => {
    expect(rejectedExpiry('2026-01-31T00:00:00.000Z')).toBe('2027-01-31T00:00:00.000Z')
    expect(rejectedExpiry('2028-02-29T00:00:00.000Z')).toBe('2029-02-28T00:00:00.000Z')
  })
})
