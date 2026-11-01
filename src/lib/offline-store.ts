/**
 * The durable side of the offline outbox.
 *
 * IndexedDB, not localStorage: a queued mark is a record with its own identity,
 * and every change to it has to be a read-modify-write inside one transaction so
 * two tabs can never both claim the same request. Writing a whole array back on
 * each change is exactly how a queued mark gets lost.
 *
 * Nothing here decides anything — it stores and it compares. The rules live in
 * `offline-outcomes.ts` and the sequencing in `offline.ts`.
 */

import type { OperationState, ReasonToken, ScorePayload } from './offline-outcomes'

const DB_NAME = 'iupc.offline.queue'
const DB_VERSION = 1
const STORE = 'operations'

/** One dispatch attempt that has finished. Kept for diagnosis, never replayed. */
export interface FenceEntry {
  generation: number
  startedAt: string
  closedAt: string | null
  outcome: OperationState | null
  token: ReasonToken | null
}

export interface OperationRecord {
  /** The request UUID. Minted once, before anything is sent, and never replaced. */
  id: string
  kind: 'marks.setScore'
  payload: ScorePayload
  /** Canonical text of the payload, so a retry is compared, not re-derived. */
  payloadDigest: string
  userId: string
  schoolId: string
  teacherId: string | null
  createdAt: string
  updatedAt: string
  state: OperationState
  attempts: number
  lastError: string | null
  lastToken: ReasonToken | null
  /** Lease: who is allowed to be sending this record right now. */
  leaseOwner: string | null
  leaseUntil: number | null
  leaseGeneration: number
  /** Which generation owns the current dispatch fence. */
  dispatchGeneration: number | null
  dispatchStartedAt: string | null
  dispatchClosedAt: string | null
  acceptedResult: unknown
  /** Only rejected records carry this. Twelve calendar months, UTC. */
  expiresAt: string | null
  /** Set when a different account signs in; cleared when the owner returns. */
  locked: boolean
  history: FenceEntry[]
}

export class OfflineStorageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OfflineStorageError'
  }
}

export function storageAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null
  } catch {
    return false
  }
}

let opening: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (!storageAvailable()) return Promise.reject(new OfflineStorageError('This browser has no local database.'))
  if (opening) return opening
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (error) {
      reject(new OfflineStorageError(String(error)))
      return
    }
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE)) {
        const store = database.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('state', 'state', { unique: false })
        store.createIndex('owner', ['userId', 'state'], { unique: false })
        store.createIndex('school', ['schoolId', 'state'], { unique: false })
        store.createIndex('expires', 'expiresAt', { unique: false })
      }
    }
    request.onsuccess = () => {
      const database = request.result
      // Another tab upgrading the schema must not leave this one writing into a
      // closed connection.
      database.onversionchange = () => {
        database.close()
        opening = null
      }
      resolve(database)
    }
    request.onerror = () => reject(new OfflineStorageError(request.error?.message ?? 'Local database unavailable.'))
    request.onblocked = () => reject(new OfflineStorageError('Another tab is holding an older local database open.'))
  }).catch((error) => {
    opening = null
    throw error
  })
  return opening
}

function once<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new OfflineStorageError(request.error?.message ?? 'Local database request failed.'))
  })
}

function committed(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(new OfflineStorageError(tx.error?.message ?? 'Local database transaction failed.'))
    tx.onabort = () => reject(new OfflineStorageError(tx.error?.message ?? 'Local database transaction was aborted.'))
  })
}

export async function readAll(): Promise<OperationRecord[]> {
  const database = await open()
  const tx = database.transaction(STORE, 'readonly')
  const rows = await once(tx.objectStore(STORE).getAll() as IDBRequest<OperationRecord[]>)
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function readOne(id: string): Promise<OperationRecord | undefined> {
  const database = await open()
  const tx = database.transaction(STORE, 'readonly')
  return once(tx.objectStore(STORE).get(id) as IDBRequest<OperationRecord | undefined>)
}

export async function write(record: OperationRecord): Promise<void> {
  const database = await open()
  const tx = database.transaction(STORE, 'readwrite')
  tx.objectStore(STORE).put(record)
  await committed(tx)
}

export async function remove(id: string): Promise<void> {
  const database = await open()
  const tx = database.transaction(STORE, 'readwrite')
  tx.objectStore(STORE).delete(id)
  await committed(tx)
}

/**
 * The atomic primitive: read the record and write it back inside one
 * transaction. Returning null means "nothing changed", which is how a claim
 * reports that another tab got there first.
 */
export async function updateRecord(
  id: string,
  change: (record: OperationRecord) => OperationRecord | null,
): Promise<OperationRecord | null> {
  const database = await open()
  const tx = database.transaction(STORE, 'readwrite')
  const store = tx.objectStore(STORE)
  const current = await once(store.get(id) as IDBRequest<OperationRecord | undefined>)
  if (!current) {
    tx.abort()
    return null
  }
  const next = change(current)
  if (!next) {
    tx.abort()
    return null
  }
  store.put(next)
  await committed(tx)
  return next
}

/**
 * Best-effort retention: only rejected records carry an expiry, so only they are
 * ever removed here. Returns how many were dropped.
 */
export async function pruneExpired(now: string = new Date().toISOString()): Promise<number> {
  const database = await open()
  const tx = database.transaction(STORE, 'readwrite')
  const store = tx.objectStore(STORE)
  const rows = await once(store.getAll() as IDBRequest<OperationRecord[]>)
  let dropped = 0
  for (const row of rows) {
    if (row.state === 'Rejected' && row.expiresAt && row.expiresAt <= now) {
      store.delete(row.id)
      dropped += 1
    }
  }
  await committed(tx)
  return dropped
}

/** Used by tests and by the sign-out path to know what is parked, not to delete it. */
export async function countByState(): Promise<Record<string, number>> {
  const rows = await readAll()
  const counts: Record<string, number> = {}
  for (const row of rows) counts[row.state] = (counts[row.state] ?? 0) + 1
  return counts
}
