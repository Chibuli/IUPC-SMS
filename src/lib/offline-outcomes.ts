/**
 * Offline mark submissions — the pure part.
 *
 * Everything here is a decision about *what is true*, kept free of IndexedDB,
 * the network and React so the rules can be reasoned about and tested on their
 * own. The queue in `offline-store.ts` stores records; `offline.ts` moves them.
 *
 * The one idea that governs the whole file: a record may only be called
 * accepted when the server said so, and may only be called rejected when the
 * server definitively refused it. Anything in between is `Uncertain` and waits
 * for a person or a receipt lookup — never for an automatic replay.
 */

/** The seven persisted states. Nothing else is written to a record. */
export type OperationState =
  | 'Pending'
  | 'Synchronizing'
  | 'Accepted'
  | 'Rejected'
  | 'Retryable'
  | 'Uncertain'
  | 'Blocked'

export const OPERATION_STATES: readonly OperationState[] = [
  'Pending',
  'Synchronizing',
  'Accepted',
  'Rejected',
  'Retryable',
  'Uncertain',
  'Blocked',
]

/**
 * Machine-readable reasons. The database is being taught to raise these as
 * tokens; until it does, `tokenFromMessage` reads the current server messages
 * so the classification is still deterministic rather than guessed.
 */
export type ReasonToken =
  | 'NOT_SENT'
  | 'NETWORK_UNREACHABLE'
  | 'AUTH_EXPIRED'
  | 'RPC_EXECUTE_DENIED'
  | 'FUNCTION_MISSING'
  | 'SCHEMA_CACHE'
  | 'NOT_MEMBER'
  | 'EXAM_CLOSED'
  | 'DEADLINE_PASSED'
  | 'NOT_ASSIGNED'
  | 'PERMISSION_DENIED'
  | 'SCORE_INVALID'
  | 'ARCHIVED_STUDENT'
  | 'ENROLLMENT_MISSING'
  | 'RESOURCE_NOT_FOUND'
  | 'ENVELOPE_INVALID'
  | 'IDEMPOTENCY_CONFLICT'
  | 'LEGACY_UNBOUND_RECEIPT'
  | 'UNIQUE_CONFLICT'
  | 'SERIALIZATION'
  | 'DEADLOCK'
  | 'STATEMENT_TIMEOUT'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'STORAGE_UNAVAILABLE'
  | 'UNKNOWN'

/** A score as the register stores it: a number, a printed code, or cleared. */
export type ScoreValue = number | 'X' | 'Y' | null

export interface ScorePayload {
  examId: string
  studentId: string
  score: ScoreValue
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value.trim())
}

/**
 * One text form per request, so a retry can be compared with the receipt.
 *
 * PostgreSQL's jsonb already treats 1 and 1.0 as equal and ignores key order,
 * so this is not about number formatting. It is about the things jsonb does
 * *not* normalise: a string "1" against a number 1, the case of a UUID, extra
 * keys a client slipped in, and the choice between a score and a code.
 * Returns null when the payload is not one this queue may carry.
 */
export function canonicalScorePayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const candidate = payload as Record<string, unknown>
  const keys = Object.keys(candidate)
  if (keys.length !== 3) return null
  if (!keys.every((key) => key === 'examId' || key === 'studentId' || key === 'score')) return null
  const examId = candidate.examId
  const studentId = candidate.studentId
  if (!isUuid(examId) || !isUuid(studentId)) return null
  const score = candidate.score
  let encoded: string
  if (score === null) encoded = 'cleared'
  else if (score === 'X' || score === 'Y') encoded = `code:${score}`
  else if (typeof score === 'number' && Number.isFinite(score) && score >= 0) {
    // `String(Number(...))` collapses 1 and 1.0 to the same text.
    encoded = `score:${String(Number(score))}`
  } else return null
  return JSON.stringify({
    examId: examId.trim().toLowerCase(),
    studentId: studentId.trim().toLowerCase(),
    score: encoded,
  })
}

/**
 * Read a stored receipt's payload in the same shape, tolerating the snake_case
 * the database may use. Returns null when the receipt carries no payload at
 * all — a legacy receipt, which must never be read as an acceptance.
 */
export function canonicalStoredPayload(stored: unknown): string | null {
  if (!stored || typeof stored !== 'object') return null
  const row = stored as Record<string, unknown>
  return canonicalScorePayload({
    examId: row.examId ?? row.exam_id,
    studentId: row.studentId ?? row.student_id,
    score: row.score,
  })
}

/** Twelve calendar months later, in UTC, clamping the day to the short month. */
export function addCalendarMonthsUtc(iso: string, months: number): string {
  const from = new Date(iso)
  if (Number.isNaN(from.getTime())) throw new Error('Invalid timestamp')
  const day = from.getUTCDate()
  const firstOfTarget = new Date(
    Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth() + months,
      1,
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
      from.getUTCMilliseconds(),
    ),
  )
  const daysInTarget = new Date(
    Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth() + 1, 0),
  ).getUTCDate()
  firstOfTarget.setUTCDate(Math.min(day, daysInTarget))
  return firstOfTarget.toISOString()
}

/** Only rejected records expire. Pending and uncertain work never inherits it. */
export function rejectedExpiry(rejectedAt: string): string {
  return addCalendarMonthsUtc(rejectedAt, 12)
}

export interface Fence {
  dispatchStartedAt: string | null
  dispatchClosedAt: string | null
}

/**
 * A fence is open when dispatch began and no verified outcome closed it. An
 * open fence means the request may have reached the server, whatever the lease
 * or the clock says.
 */
export function fenceIsOpen(record: Fence): boolean {
  return Boolean(record.dispatchStartedAt) && !record.dispatchClosedAt
}

/**
 * What an expired lease proves. A closed fence proves the outcome for that
 * generation was settled, so the record may queue again; an open fence proves
 * nothing and the record must be reconciled before anything else is sent.
 */
export function stateAfterLeaseExpiry(record: Fence & { state: OperationState }): OperationState {
  if (record.state !== 'Synchronizing') return record.state
  return fenceIsOpen(record) ? 'Uncertain' : 'Pending'
}

/** Only these states may be sent automatically. */
export function isDispatchable(state: OperationState): boolean {
  return state === 'Pending' || state === 'Retryable'
}

/** States that a person must look at. They are never replayed automatically. */
export function needsReview(state: OperationState): boolean {
  return state === 'Rejected' || state === 'Uncertain' || state === 'Blocked'
}

export interface Ownership {
  userId: string
  schoolId: string
}

export type OwnershipProblem = 'OWNER_MISMATCH' | 'SCHOOL_MISMATCH' | 'LOCKED'

/**
 * A queued record belongs to the account and school that created it. If either
 * moved, the record is parked — it is never sent under whoever is signed in now.
 */
export function ownershipProblem(
  record: Ownership & { locked?: boolean },
  current: Ownership,
): OwnershipProblem | null {
  if (record.locked) return 'LOCKED'
  if (record.userId !== current.userId) return 'OWNER_MISMATCH'
  if (record.schoolId !== current.schoolId) return 'SCHOOL_MISMATCH'
  return null
}

export interface DispatchFailureInput {
  /** True once the request was handed to the transport. */
  dispatched: boolean
  online: boolean
  /** HTTP status reported by the client; 0 means the request never got an answer. */
  status?: number
  /** PostgREST code or SQLSTATE. */
  code?: string
  message?: string
}

export interface Classification {
  state: OperationState
  token: ReasonToken
  /** The receipt must be consulted before the state is believed. */
  reconcile: boolean
  automaticRetry: boolean
  detail: string
}

/**
 * Current server messages, mapped to stable tokens. Transitional: once
 * `apply_offline_write` raises tokens of its own, this table stops mattering —
 * the token is read straight from the message.
 */
const MESSAGE_TOKENS: ReadonlyArray<readonly [RegExp, ReasonToken]> = [
  [/idempotency key reused with different request/i, 'IDEMPOTENCY_CONFLICT'],
  [/invalid offline operation/i, 'ENVELOPE_INVALID'],
  [/invalid record/i, 'RESOURCE_NOT_FOUND'],
  [/mark entry is closed/i, 'EXAM_CLOSED'],
  [/deadline passed/i, 'DEADLINE_PASSED'],
  [/invalid score/i, 'SCORE_INVALID'],
  [/archived/i, 'ARCHIVED_STUDENT'],
  [/enrol/i, 'ENROLLMENT_MISSING'],
  [/record not found/i, 'RESOURCE_NOT_FOUND'],
  [/record scope is immutable/i, 'ENVELOPE_INVALID'],
  [/mark identity is immutable/i, 'ENVELOPE_INVALID'],
  [/not authorized/i, 'PERMISSION_DENIED'],
  [/not a member|not_member/i, 'NOT_MEMBER'],
  [/not assigned/i, 'NOT_ASSIGNED'],
]

const KNOWN_TOKENS = new Set<string>([
  'NOT_MEMBER',
  'EXAM_CLOSED',
  'DEADLINE_PASSED',
  'NOT_ASSIGNED',
  'PERMISSION_DENIED',
  'SCORE_INVALID',
  'ARCHIVED_STUDENT',
  'ENROLLMENT_MISSING',
  'RESOURCE_NOT_FOUND',
  'ENVELOPE_INVALID',
  'IDEMPOTENCY_CONFLICT',
  'LEGACY_UNBOUND_RECEIPT',
])

/** A token the server raised itself wins over any message guess. */
export function tokenFromMessage(message: string | undefined): ReasonToken | null {
  if (!message) return null
  for (const token of KNOWN_TOKENS) {
    if (new RegExp(`\\b${token}\\b`).test(message)) return token as ReasonToken
  }
  for (const [pattern, token] of MESSAGE_TOKENS) {
    if (pattern.test(message)) return token
  }
  return null
}

export function classifyDispatchFailure(input: DispatchFailureInput): Classification {
  const { dispatched, online, status, code = '', message = '' } = input

  // Never left the device: it is still just waiting.
  if (!dispatched) {
    return {
      state: 'Pending',
      token: 'NOT_SENT',
      reconcile: false,
      automaticRetry: false,
      detail: online
        ? 'Saved on this device. It has not been sent yet.'
        : 'Saved on this device while offline. It will be sent when the connection returns.',
    }
  }

  // No answer at all. The request may still have been executed.
  if (!status || status === 0) {
    return {
      state: 'Uncertain',
      token: online ? 'NETWORK_UNREACHABLE' : 'NETWORK_UNREACHABLE',
      reconcile: true,
      automaticRetry: false,
      detail: online
        ? 'The connection dropped before the server answered. The mark is being checked.'
        : 'The connection dropped. The mark is held and checked rather than sent again blindly.',
    }
  }

  if (status === 401) {
    return {
      state: 'Pending',
      token: 'AUTH_EXPIRED',
      reconcile: false,
      automaticRetry: false,
      detail: 'The session expired before the mark was sent. Sign in again to send it.',
    }
  }

  if (status === 403) {
    const token = tokenFromMessage(message)
    if (token && token !== 'ENROLLMENT_MISSING') {
      return { state: 'Rejected', token, reconcile: false, automaticRetry: false, detail: rejectionCopy(token) }
    }
    if (/permission denied for (function|schema|table)/i.test(message)) {
      return {
        state: 'Blocked',
        token: 'RPC_EXECUTE_DENIED',
        reconcile: false,
        automaticRetry: false,
        detail: 'This device is not allowed to submit marks. An administrator must fix the database permissions.',
      }
    }
    return {
      state: 'Blocked',
      token: token ?? 'RPC_EXECUTE_DENIED',
      reconcile: false,
      automaticRetry: false,
      detail: 'The server refused the submission without an explanation this app understands. It is held for review.',
    }
  }

  if (status === 404) {
    if (code === 'PGRST202' || /could not find the function/i.test(message)) {
      return {
        state: 'Blocked',
        token: 'FUNCTION_MISSING',
        reconcile: false,
        automaticRetry: false,
        detail: 'The mark submission function is missing on the server. A deployment is incomplete.',
      }
    }
    if (code === 'PGRST205') {
      return {
        state: 'Blocked',
        token: 'SCHEMA_CACHE',
        reconcile: false,
        automaticRetry: false,
        detail: 'The server has not loaded its schema yet. Nothing was written.',
      }
    }
    const token = tokenFromMessage(message)
    if (token === 'RESOURCE_NOT_FOUND') {
      return { state: 'Rejected', token, reconcile: false, automaticRetry: false, detail: rejectionCopy(token) }
    }
    return {
      state: 'Blocked',
      token: 'RESOURCE_NOT_FOUND',
      reconcile: false,
      automaticRetry: false,
      detail: 'The paper or learner could not be found on the server. It is held for review.',
    }
  }

  if (status === 429) {
    // A gateway can rate-limit a request it has already forwarded, so the
    // status alone proves nothing about execution.
    return {
      state: 'Uncertain',
      token: 'RATE_LIMITED',
      reconcile: true,
      automaticRetry: false,
      detail: 'The server asked this device to slow down. The mark is being checked before anything is resent.',
    }
  }

  // SQLSTATE first: it is more specific than the status the gateway chose.
  if (code === '40001') {
    return {
      state: 'Retryable',
      token: 'SERIALIZATION',
      reconcile: false,
      automaticRetry: true,
      detail: 'Another save collided with this one. It will be retried with the same request.',
    }
  }
  if (code === '40P01') {
    return {
      state: 'Retryable',
      token: 'DEADLOCK',
      reconcile: false,
      automaticRetry: true,
      detail: 'Two saves crossed. It will be retried with the same request.',
    }
  }
  if (code === '57014') {
    return {
      state: 'Uncertain',
      token: 'STATEMENT_TIMEOUT',
      reconcile: true,
      automaticRetry: false,
      detail: 'The server cancelled the request. Whether it committed is being checked.',
    }
  }
  if (code === '23505') {
    return {
      state: 'Uncertain',
      token: 'UNIQUE_CONFLICT',
      reconcile: true,
      automaticRetry: false,
      detail: 'This request may already have been accepted. The receipt decides.',
    }
  }
  if (code === '23514') {
    return {
      state: 'Rejected',
      token: 'SCORE_INVALID',
      reconcile: false,
      automaticRetry: false,
      detail: rejectionCopy('SCORE_INVALID'),
    }
  }
  if (code === '42501') {
    const token = tokenFromMessage(message)
    if (token) {
      return { state: 'Rejected', token, reconcile: false, automaticRetry: false, detail: rejectionCopy(token) }
    }
    return {
      state: 'Blocked',
      token: 'RPC_EXECUTE_DENIED',
      reconcile: false,
      automaticRetry: false,
      detail: 'The database refused the write at the permission level. An administrator must review it.',
    }
  }

  if (status === 409) {
    const token = tokenFromMessage(message)
    if (token === 'IDEMPOTENCY_CONFLICT' || token === 'LEGACY_UNBOUND_RECEIPT') {
      return { state: 'Blocked', token, reconcile: true, automaticRetry: false, detail: rejectionCopy(token) }
    }
    return {
      state: 'Uncertain',
      token: 'UNIQUE_CONFLICT',
      reconcile: true,
      automaticRetry: false,
      detail: 'The server reported a conflict this app cannot interpret. The mark is held and checked.',
    }
  }

  if (status >= 500) {
    return {
      state: 'Uncertain',
      token: 'SERVER_ERROR',
      reconcile: true,
      automaticRetry: false,
      detail: 'The server failed while handling the mark. It is being checked rather than resent.',
    }
  }

  if (status === 400) {
    const token = tokenFromMessage(message)
    // The server's own request-id conflict arrives as a 400: the id was used
    // before with different marks, so this record must not be resent.
    if (token === 'IDEMPOTENCY_CONFLICT' || token === 'LEGACY_UNBOUND_RECEIPT') {
      return { state: 'Blocked', token, reconcile: true, automaticRetry: false, detail: rejectionCopy(token) }
    }
    if (token) {
      return { state: 'Rejected', token, reconcile: false, automaticRetry: false, detail: rejectionCopy(token) }
    }
  }

  return {
    state: 'Uncertain',
    token: 'UNKNOWN',
    reconcile: true,
    automaticRetry: false,
    detail: 'The outcome of this mark could not be determined. It is held and checked.',
  }
}

/** Plain words for a person reading the queue, not a code. */
export function reasonText(token: ReasonToken | null): string {
  if (!token) return 'Waiting to be sent.'
  const copy: Record<ReasonToken, string> = {
    NOT_SENT: 'Saved on this device, not sent yet.',
    NETWORK_UNREACHABLE: 'The connection failed during the save.',
    AUTH_EXPIRED: 'The session expired. Sign in again to send it.',
    RPC_EXECUTE_DENIED: 'This account is not permitted to submit marks here.',
    FUNCTION_MISSING: 'The server is missing the submission function.',
    SCHEMA_CACHE: 'The server has not loaded its schema yet.',
    NOT_MEMBER: 'This account no longer belongs to the school.',
    EXAM_CLOSED: 'The exam was closed before this mark was recorded.',
    DEADLINE_PASSED: 'The mark-entry deadline had passed.',
    NOT_ASSIGNED: 'This paper is not assigned to your staff profile.',
    PERMISSION_DENIED: 'The school does not grant you mark entry for this paper.',
    SCORE_INVALID: 'The score is not valid for this paper.',
    ARCHIVED_STUDENT: 'The learner has been archived.',
    ENROLLMENT_MISSING: 'The learner is not enrolled in this exact subject.',
    RESOURCE_NOT_FOUND: 'The paper or learner no longer exists on the server.',
    ENVELOPE_INVALID: 'The request did not match what the server accepts.',
    IDEMPOTENCY_CONFLICT: 'This request id was already used for different marks. Record the change again.',
    LEGACY_UNBOUND_RECEIPT: 'An older receipt cannot be matched to this request. Review it before recording again.',
    UNIQUE_CONFLICT: 'Another save claimed this record first.',
    SERIALIZATION: 'A concurrent save collided with this one.',
    DEADLOCK: 'Two saves crossed each other.',
    STATEMENT_TIMEOUT: 'The server timed out while saving.',
    RATE_LIMITED: 'The server asked this device to slow down.',
    SERVER_ERROR: 'The server failed while saving.',
    STORAGE_UNAVAILABLE: 'This device could not store the mark, so nothing was sent.',
    UNKNOWN: 'The outcome could not be determined.',
  }
  return copy[token]
}

function rejectionCopy(token: ReasonToken): string {
  return reasonText(token)
}
