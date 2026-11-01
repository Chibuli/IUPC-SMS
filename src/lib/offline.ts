/**
 * Offline marks: the queue that owns the truth about a mark until the server does.
 *
 * A teacher keys a mark in a classroom where the network comes and goes, so the
 * record is written to IndexedDB *before* anything is sent. From that moment the
 * record has an identity (its request UUID) and an immutable payload. Retrying
 * sends that same request; correcting a score is a new request with a new UUID.
 *
 * The rules that matter, and where they come from:
 *
 *  - `Pending` and `Retryable` are the only states that may be sent without a
 *    person asking. Rejected, Uncertain and Blocked wait.
 *  - A lost answer is never a rejection. The request may have committed, so the
 *    record becomes `Uncertain` and the receipt is consulted.
 *  - A record belongs to the account and school that created it. Signing in as
 *    someone else hides those records; it never sends them under the new account.
 *  - If the device cannot store the mark, nothing is sent and nothing claims the
 *    mark was saved.
 *
 * IndexedDB is not durable in the way a server is: the browser may evict it, the
 * person may clear site data, the disk may fail. That is accepted and stated in
 * the interface — it is not papered over.
 */

import { useSyncExternalStore } from 'react'
import { supabase, supabaseConfigured } from '../data/supabase'
import { getActiveSchoolId, getAccountScope } from '../data/backend'
import { refreshDatabase } from '../data/db'
import {
  canonicalScorePayload,
  canonicalStoredPayload,
  classifyDispatchFailure,
  isDispatchable,
  ownershipProblem,
  reasonText,
  rejectedExpiry,
  stateAfterLeaseExpiry,
  type OperationState,
  type ReasonToken,
  type ScorePayload,
} from './offline-outcomes'
import {
  OfflineStorageError,
  pruneExpired as pruneStoredExpired,
  readAll,
  readOne,
  remove as removeRecord,
  storageAvailable,
  updateRecord,
  write as writeRecord,
  type OperationRecord,
} from './offline-store'

const DRAIN_LOCK = 'iupc.offline.drain'
/** How long one tab may hold a record before another may consider taking it. */
const LEASE_MS = 30_000
/** While connected with work left over, try again on this beat. */
const FLUSH_INTERVAL = 20_000
const META_KEY = 'iupc.sync.meta.v2'

const TAB = (() => {
  try {
    return crypto.randomUUID()
  } catch {
    return `tab-${Math.random().toString(36).slice(2)}`
  }
})()

export interface QueueActor {
  userId: string
  schoolId: string
}

export interface SyncState {
  online: boolean
  serverConfigured: boolean
  sending: boolean
  /** Persisted and still to be sent. */
  pending: number
  /** Refused or parked: needs a person. */
  failed: number
  uncertain: number
  rejected: number
  blocked: number
  storageAvailable: boolean
  last_synced_at: string | null
  delivered: number
  last_error: string | null
}

export interface QueueEntry {
  id: string
  kind: string
  summary: string
  state: OperationState
  attempts: number
  created_at: string
  last_error: string | null
  token: ReasonToken | null
  expires_at: string | null
  locked: boolean
  payload: ScorePayload
}

export type SubmitOutcome =
  | { persisted: false; requestId: null; state: null; token: ReasonToken; detail: string }
  | { persisted: true; requestId: string; state: OperationState; token: ReasonToken | null; detail: string }

interface Meta {
  last_synced_at: string | null
  delivered: number
}

let records: OperationRecord[] = []
let summaries = new Map<string, string>()
/**
 * The account the queue is currently being read under. Signing out or switching
 * account hides every record that does not belong to this account; nothing is
 * deleted, and nothing is ever sent under the wrong one.
 */
let queueOwner: QueueActor | null = null
let loaded = false
let loading: Promise<void> | null = null
let online = typeof navigator === 'undefined' ? true : navigator.onLine
let sending = false
let lastError: string | null = null
let meta: Meta = readMeta()
let storeWorks = storageAvailable()

function readMeta(): Meta {
  try {
    const raw = localStorage.getItem(META_KEY)
    if (!raw) return { last_synced_at: null, delivered: 0 }
    const parsed = JSON.parse(raw) as Partial<Meta>
    return { last_synced_at: parsed.last_synced_at ?? null, delivered: Number(parsed.delivered) || 0 }
  } catch {
    return { last_synced_at: null, delivered: 0 }
  }
}

function writeMeta() {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta))
  } catch {
    /* Metadata only: losing it must never lose a queued mark. */
  }
}

const listeners = new Set<() => void>()
let state: SyncState = snapshot()

function count(states: OperationState[]): number {
  return records.filter((record) => queueOwner && record.userId === queueOwner.userId && record.schoolId === queueOwner.schoolId && !record.locked && states.includes(record.state)).length
}

function snapshot(): SyncState {
  return {
    online,
    serverConfigured: supabaseConfigured,
    sending,
    pending: count(['Pending', 'Synchronizing', 'Retryable']),
    failed: count(['Rejected', 'Blocked']),
    uncertain: count(['Uncertain']),
    rejected: count(['Rejected']),
    blocked: count(['Blocked']),
    storageAvailable: storeWorks,
    last_synced_at: meta.last_synced_at,
    delivered: meta.delivered,
    last_error: lastError,
  }
}

function publish() {
  state = snapshot()
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(subscribe, () => state, () => state)
}

export function useQueueRecords(): QueueEntry[] {
  useSyncExternalStore(subscribe, () => records, () => records)
  return records.filter(record => queueOwner && record.userId === queueOwner.userId && record.schoolId === queueOwner.schoolId && !record.locked).map(toEntry)
}

function toEntry(record: OperationRecord): QueueEntry {
  return {
    id: record.id,
    payload: record.payload,
    kind: record.kind,
    summary: summaries.get(record.id) ?? 'Mark score',
    state: record.state,
    attempts: record.attempts,
    created_at: record.createdAt,
    last_error: record.lastError,
    token: record.lastToken,
    expires_at: record.expiresAt,
    locked:
      record.locked ||
      !queueOwner ||
      record.userId !== queueOwner.userId ||
      record.schoolId !== queueOwner.schoolId,
  }
}

/** Set by the session: the account whose marks may be read on this screen. */
export function setQueueOwner(next: QueueActor | null): void {
  queueOwner = next
  publish()
}

async function reload(): Promise<void> {
  try {
    records = await readAll()
    storeWorks = true
  } catch (error) {
    storeWorks = false
    records = []
    if (error instanceof OfflineStorageError) lastError = error.message
  }
  loaded = true
  publish()
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return
  if (!loading) loading = reload().finally(() => { loading = null })
  await loading
}

export async function refreshQueue(): Promise<void> {
  await ensureLoaded()
  try {
    const dropped = await pruneStoredExpired()
    if (dropped > 0) await reload()
  } catch {
    /* Cleanup is best effort; never let it hide the queue. */
  }
}

/** The account and school a submission belongs to, read from the live session. */
export async function currentActor(): Promise<QueueActor | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  const userId = data.session?.user.id
  const schoolId = getActiveSchoolId()
  const scope = getAccountScope()
  if (!userId || !schoolId || !scope?.verified || scope.userId !== userId || scope.schoolId !== schoolId || !data.session?.expires_at || data.session.expires_at * 1000 <= Date.now()) return null
  return { userId, schoolId }
}

function nowIso() {
  return new Date().toISOString()
}

export interface SubmitMeta {
  actor: QueueActor
  teacherId?: string | null
  summary: string
}

/**
 * Persist the mark, then try to send it. The order is the point: the record is
 * on disk before the first byte leaves, and the return value says what actually
 * happened rather than what we hope happened.
 */
export async function submitMarkScore(payload: ScorePayload, meta: SubmitMeta): Promise<SubmitOutcome> {
  const digest = canonicalScorePayload(payload)
  if (!digest) {
    return {
      persisted: false,
      requestId: null,
      state: null,
      token: 'ENVELOPE_INVALID',
      detail: 'This mark could not be read as a score request, so nothing was sent.',
    }
  }
  await ensureLoaded()
  const createdAt = nowIso()
  const record: OperationRecord = {
    id: crypto.randomUUID(),
    kind: 'marks.setScore',
    payload,
    payloadDigest: digest,
    userId: meta.actor.userId,
    schoolId: meta.actor.schoolId,
    teacherId: meta.teacherId ?? null,
    createdAt,
    updatedAt: createdAt,
    state: 'Pending',
    attempts: 0,
    lastError: null,
    lastToken: null,
    leaseOwner: null,
    leaseUntil: null,
    leaseGeneration: 0,
    dispatchGeneration: null,
    dispatchStartedAt: null,
    dispatchClosedAt: null,
    acceptedResult: null,
    expiresAt: null,
    locked: false,
    history: [],
  }
  try {
    await writeRecord(record)
  } catch (error) {
    storeWorks = false
    lastError = error instanceof Error ? error.message : String(error)
    publish()
    return {
      persisted: false,
      requestId: null,
      state: null,
      token: 'STORAGE_UNAVAILABLE',
      detail: 'This device could not store the mark, so nothing was sent. Keep this page open and try again.',
    }
  }
  summaries.set(record.id, meta.summary)
  records = [...records, record].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  publish()

  if (!online || !getAccountScope()?.verified || (typeof navigator !== 'undefined' && !navigator.onLine)) {
    return {
      persisted: true,
      requestId: record.id,
      state: 'Pending',
      token: 'NOT_SENT',
      detail: 'Saved on this device. It will be sent when the connection returns.',
    }
  }

  const finalState = await dispatch(record, meta.actor)
  const settled = records.find((entry) => entry.id === record.id) ?? (await readOne(record.id))
  return {
    persisted: true,
    requestId: record.id,
    state: finalState,
    token: settled?.lastToken ?? null,
    detail: settled?.lastError ?? reasonText(settled?.lastToken ?? null),
  }
}

/** Claim, fence, send, settle — one record, one generation. */
async function dispatch(record: OperationRecord, actor: QueueActor): Promise<OperationState> {
  if (!supabase) return record.state
  const verifiedActor = await currentActor()
  if (!verifiedActor || verifiedActor.userId !== actor.userId || verifiedActor.schoolId !== actor.schoolId) return record.state
  if (ownershipProblem(record, actor)) return record.state

  const claimed = await updateRecord(record.id, (current) => {
    if (!isDispatchable(current.state)) return null
    if (ownershipProblem(current, actor)) return null
    const generation = current.leaseGeneration + 1
    return {
      ...current,
      state: 'Synchronizing',
      leaseOwner: TAB,
      leaseUntil: Date.now() + LEASE_MS,
      leaseGeneration: generation,
      dispatchGeneration: generation,
      dispatchStartedAt: null,
      dispatchClosedAt: null,
      attempts: current.attempts + 1,
      updatedAt: nowIso(),
    }
  })
  if (!claimed) return (await readOne(record.id))?.state ?? record.state

  const generation = claimed.leaseGeneration
  const fenced = await updateRecord(record.id, (current) => {
    if (current.leaseOwner !== TAB || current.leaseGeneration !== generation) return null
    return { ...current, dispatchStartedAt: nowIso(), updatedAt: nowIso() }
  })
  // Another tab closed the record out from under this generation: keep whatever
  // that tab recorded.
  if (!fenced) return (await readOne(record.id))?.state ?? 'Synchronizing'

  const sendingActor = await currentActor()
  if (!sendingActor || sendingActor.userId !== actor.userId || sendingActor.schoolId !== actor.schoolId) {
    return settle(claimed.id, generation, { state: 'Pending', lastToken: 'NOT_SENT', lastError: 'Reconnect and verify this account before sending its marks.' })
  }

  let response: { data: unknown; error: { code?: string; message?: string } | null; status?: number }
  try {
    response = await supabase.rpc('apply_offline_write', {
      request_id: claimed.id,
      operation: claimed.kind,
      payload: claimed.payload as unknown as Record<string, unknown>,
    })
  } catch (error) {
    response = {
      data: null,
      error: { message: error instanceof Error ? error.message : String(error) },
      status: 0,
    }
  }

  const acknowledged =
    !response.error &&
    Boolean((response.data as { accepted?: boolean } | null)?.accepted)

  if (acknowledged) {
    const result = response.data as { result?: unknown } | null
    return settle(claimed.id, generation, {
      state: 'Accepted',
      lastError: null,
      lastToken: null,
      acceptedResult: result?.result ?? null,
    })
  }

  const classification = classifyDispatchFailure({
    dispatched: true,
    online,
    status: response.status ?? 0,
    code: response.error?.code,
    message: response.error?.message,
  })

  if (classification.reconcile) {
    const verdict = await reconcileWithReceipt(claimed)
    if (verdict === 'Accepted') {
      return settle(claimed.id, generation, { state: 'Accepted', lastError: null, lastToken: null })
    }
    if (verdict === 'Legacy') {
      return settle(claimed.id, generation, {
        state: 'Blocked',
        lastError: reasonText('LEGACY_UNBOUND_RECEIPT'),
        lastToken: 'LEGACY_UNBOUND_RECEIPT',
      })
    }
    if (verdict === 'Conflict') {
      return settle(claimed.id, generation, {
        state: 'Blocked',
        lastError: reasonText('IDEMPOTENCY_CONFLICT'),
        lastToken: 'IDEMPOTENCY_CONFLICT',
      })
    }
  }

  return settle(claimed.id, generation, {
    state: classification.state,
    lastError: classification.detail,
    lastToken: classification.token,
  })
}

/**
 * The receipt is the only proof of acceptance. Looked up by the request UUID
 * under the caller's own row — a missing receipt proves nothing, so it can only
 * ever confirm, never reject.
 */
async function reconcileWithReceipt(record: OperationRecord): Promise<'Accepted' | 'Legacy' | 'Conflict' | 'Unknown'> {
  if (!supabase) return 'Unknown'
  try {
    const { data, error } = await supabase
      .from('write_receipts')
      .select('request_id,operation,payload')
      .eq('request_id', record.id)
      .maybeSingle()
    if (error) return 'Unknown'
    if (!data) return 'Unknown'
    const row = data as { operation?: string; payload?: unknown }
    if (row.operation && row.operation !== record.kind) return 'Conflict'
    const stored = canonicalStoredPayload(row.payload)
    if (!stored) return 'Legacy'
    return stored === record.payloadDigest ? 'Accepted' : 'Conflict'
  } catch {
    return 'Unknown'
  }
}

async function settle(
  id: string,
  generation: number,
  patch: Pick<OperationRecord, 'state'> & Partial<OperationRecord>,
): Promise<OperationState> {
  const at = nowIso()
  const closed = patch.state !== 'Uncertain'
  const next = await updateRecord(id, (current) => {
    // A late answer from an older generation must not overwrite a newer state.
    if (current.leaseGeneration !== generation) return null
    const entry = {
      generation,
      startedAt: current.dispatchStartedAt ?? at,
      closedAt: closed ? at : null,
      outcome: patch.state,
      token: patch.lastToken ?? null,
    }
    const rejected = patch.state === 'Rejected'
    return {
      ...current,
      ...patch,
      leaseOwner: null,
      leaseUntil: null,
      updatedAt: at,
      dispatchClosedAt: closed ? at : current.dispatchClosedAt,
      expiresAt: rejected ? rejectedExpiry(at) : patch.expiresAt === null ? null : current.expiresAt,
      history: [...current.history.slice(-4), entry],
    }
  })
  if (!next) return (await readOne(id))?.state ?? 'Uncertain'

  if (next.state === 'Accepted') {
    meta = { last_synced_at: at, delivered: meta.delivered + 1 }
    writeMeta()
    try {
      await refreshDatabase(next.schoolId)
      await removeRecord(id)
      summaries.delete(id)
    } catch {
      /* The mark is accepted; only the local copy is still here. */
    }
  }
  await reload()
  return next.state
}

/**
 * Recover records a crashed tab left behind. A closed fence means that attempt
 * was settled and the record may queue again; an open one means the request may
 * have been executed, so it must be reconciled instead of resent.
 */
async function recoverStaleLeases(): Promise<void> {
  const now = Date.now()
  for (const record of records) {
    if (record.state !== 'Synchronizing') continue
    if (record.leaseUntil && record.leaseUntil > now) continue
    const recovered = stateAfterLeaseExpiry(record)
    await updateRecord(record.id, (current) => {
      if (current.state !== 'Synchronizing') return null
      if (current.leaseUntil && current.leaseUntil > now) return null
      return {
        ...current,
        state: recovered,
        leaseOwner: null,
        leaseUntil: null,
        lastError:
          recovered === 'Uncertain'
            ? 'This save was interrupted after it was sent. Its outcome is being checked.'
            : 'The save was interrupted before it was sent. It is queued again.',
        lastToken: recovered === 'Uncertain' ? 'UNKNOWN' : 'NOT_SENT',
        updatedAt: nowIso(),
      }
    })
  }
  if (records.some((record) => record.state === 'Synchronizing')) await reload()
}

/** Drain what may be drained. Never touches Rejected, Uncertain or Blocked. */
export async function syncNow(actor?: QueueActor | null): Promise<void> {
  await ensureLoaded()
  if (sending) return
  if (!supabaseConfigured || !supabase) {
    lastError = 'No authenticated school database is configured; records stay on this device.'
    publish()
    return
  }
  const who = actor ?? (await currentActor())
  if (!who) {
    lastError = 'Sign in to send the marks saved on this device.'
    publish()
    return
  }
  if (!online) {
    lastError = 'No connection; records stay on this device.'
    publish()
    return
  }

  const run = async () => {
    sending = true
    lastError = null
    publish()
    try {
      await recoverStaleLeases()
      const queue = records
        .filter((record) => record.userId === who.userId && record.schoolId === who.schoolId)
        .filter((record) => isDispatchable(record.state))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      for (const record of queue) {
        if (!online) break
        const state = await dispatch(record, who)
        // A transport problem or an expired session stops the run; parked
        // records never hold up the ones behind them.
        if (state === 'Synchronizing' || !online) break
        if (state === 'Pending' && records.some((entry) => entry.id === record.id && entry.lastToken === 'AUTH_EXPIRED')) break
      }
    } finally {
      sending = false
      publish()
    }
  }

  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (locks && typeof locks.request === 'function') await locks.request(DRAIN_LOCK, run)
  else await run()
}

/** A person asking for one record to go again — same UUID, same payload. */
export async function retryOperation(id: string): Promise<OperationState> {
  await ensureLoaded()
  const record = await readOne(id)
  if (!record) return 'Blocked'
  if (record.state !== 'Uncertain' && record.state !== 'Retryable') return record.state
  const who = await currentActor()
  if (!who || ownershipProblem(record, who)) return record.state
  // Reopen for one attempt without minting a new identity.
  const reopened = await updateRecord(id, (current) => {
    if (current.state !== 'Uncertain' && current.state !== 'Retryable') return null
    return {
      ...current,
      state: 'Pending',
      leaseOwner: null,
      leaseUntil: null,
      dispatchStartedAt: null,
      dispatchClosedAt: null,
      updatedAt: nowIso(),
    }
  })
  if (!reopened) return record.state
  await reload()
  return dispatch(reopened, who)
}

/** Check an uncertain record against its receipt without sending anything. */
export async function reconcileOperation(id: string): Promise<OperationState> {
  await ensureLoaded()
  const record = await readOne(id)
  if (!record) return 'Blocked'
  const who = await currentActor()
  if (!who || ownershipProblem(record, who)) return record.state
  if (record.state !== 'Uncertain') return record.state
  const verdict = await reconcileWithReceipt(record)
  if (verdict === 'Accepted') {
    await updateRecord(id, (current) =>
      current.state === 'Uncertain'
        ? { ...current, state: 'Accepted', lastError: null, lastToken: null, updatedAt: nowIso() }
        : null,
    )
    try {
      await refreshDatabase(record.schoolId)
      await removeRecord(id)
    } catch {
      /* keep the accepted copy locally */
    }
    await reload()
    return 'Accepted'
  }
  if (verdict === 'Legacy' || verdict === 'Conflict') {
    await updateRecord(id, (current) =>
      current.state === 'Uncertain'
        ? {
            ...current,
            state: 'Blocked',
            lastToken: verdict === 'Legacy' ? 'LEGACY_UNBOUND_RECEIPT' : 'IDEMPOTENCY_CONFLICT',
            lastError:
              verdict === 'Legacy'
                ? reasonText('LEGACY_UNBOUND_RECEIPT')
                : reasonText('IDEMPOTENCY_CONFLICT'),
            updatedAt: nowIso(),
          }
        : null,
    )
    await reload()
    return 'Blocked'
  }
  await updateRecord(id, (current) =>
    current.state === 'Uncertain'
      ? {
          ...current,
          lastError: 'No receipt yet. It is still unclear whether this mark reached the server.',
          updatedAt: nowIso(),
        }
      : null,
  )
  await reload()
  return 'Uncertain'
}

/** Sign-out: keep another account's records out of reach without deleting them. */
export async function lockOwnerRecords(userId: string | null): Promise<void> {
  if (!userId) return
  await ensureLoaded()
  for (const record of records) {
    if (record.userId !== userId || record.locked) continue
    await updateRecord(record.id, (current) =>
      current.userId === userId && !current.locked ? { ...current, locked: true, updatedAt: nowIso() } : null,
    )
  }
  await reload()
}

/** The owner is back: their records become visible and sendable again. */
export async function unlockOwnerRecords(userId: string | null): Promise<void> {
  if (!userId) return
  await ensureLoaded()
  for (const record of records) {
    if (record.userId !== userId || !record.locked) continue
    await updateRecord(record.id, (current) =>
      current.userId === userId && current.locked ? { ...current, locked: false, updatedAt: nowIso() } : null,
    )
  }
  await reload()
}

/**
 * Kept for callers that still reach the sample-data branches. Only mark scores
 * can be queued for real; anything else must not pretend to be safe offline.
 */
export function enqueueWrite(_kind: string, _summary: string, _payload: Record<string, unknown>): never {
  throw new Error('Only mark scores can be queued for the school database.')
}

export function setOnline(next: boolean) {
  if (online === next) return
  online = next
  publish()
  if (next) void syncNow()
}

/** Wire the browser's own connectivity signal. Called once from main.tsx. */
export function watchConnection() {
  void refreshQueue()
  const up = () => setOnline(true)
  const down = () => setOnline(false)
  if (typeof window !== 'undefined') {
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    window.addEventListener('focus', () => setOnline(navigator.onLine))
    window.setInterval(() => {
      if (records.some((record) => isDispatchable(record.state))) void syncNow()
    }, FLUSH_INTERVAL)
  }
  void syncNow()
}

/** True when this build has somewhere to send records to. */
export const hasServer = supabaseConfigured
