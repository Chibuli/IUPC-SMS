import { useSyncExternalStore } from 'react'

/**
 * Offline capture.
 *
 * Marks are entered in classrooms, exam halls and staffrooms where the network
 * comes and goes, so no write may depend on the connection being up. Every
 * field write lands in the device database first and is appended to a durable
 * outbox in the same breath; the outbox then drains to the server, in the order
 * the records were keyed.
 *
 * The outbox lives in its own storage key rather than in the database, so a
 * database rebuild (a new seed, a data reset) can never discard records that
 * were keyed offline and have not left the device yet.
 *
 * Transport: this build ships without a server, so the default transport
 * acknowledges an entry immediately — the device database *is* the database.
 * Point `VITE_SYNC_URL` at a real endpoint and every queued write is POSTed
 * there instead, in order, with retries; nothing else in the app changes.
 */

const OUTBOX_KEY = 'iupc.outbox.v1'
const META_KEY = 'iupc.sync.v1'
/** While online with a queue left over, keep trying on this beat. */
const FLUSH_INTERVAL = 20_000

const SYNC_URL = (import.meta.env.VITE_SYNC_URL as string | undefined)?.trim() || null

export interface OutboxEntry {
  id: string
  /** The api method that produced the write, e.g. `marks.setScore`. */
  kind: string
  /** One line the person who keyed it would recognise in the queue. */
  summary: string
  payload: Record<string, unknown>
  created_at: string
  attempts: number
  last_error?: string
}

export interface SyncState {
  online: boolean
  /** Entries still to leave the device. */
  pending: number
  /** Entries the transport has rejected at least once. */
  failed: number
  sending: boolean
  last_synced_at: string | null
  /** Everything this device has pushed since it was set up. */
  delivered: number
  last_error: string | null
}

interface Meta {
  last_synced_at: string | null
  delivered: number
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const value = JSON.parse(raw) as T
    return value ?? fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* Storage unavailable or full: the rows are already in the database, so the
       queue is the only casualty. Keep working in memory. */
  }
}

function newId() {
  return `out-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

let queue: OutboxEntry[] = readJson<OutboxEntry[]>(OUTBOX_KEY, [])
let meta: Meta = readJson<Meta>(META_KEY, { last_synced_at: null, delivered: 0 })

let online = typeof navigator === 'undefined' ? true : navigator.onLine
let sending = false
let lastError: string | null = null

const listeners = new Set<() => void>()
let state: SyncState = snapshot()

function snapshot(): SyncState {
  return {
    online,
    pending: queue.length,
    failed: queue.filter((entry) => entry.attempts > 0).length,
    sending,
    last_synced_at: meta.last_synced_at,
    delivered: meta.delivered,
    last_error: lastError,
  }
}

function publish() {
  state = snapshot()
  listeners.forEach((listener) => listener())
}

function persistQueue() {
  writeJson(OUTBOX_KEY, queue)
}

function persistMeta() {
  writeJson(META_KEY, meta)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(subscribe, () => state, () => state)
}

/** The queue itself, newest last — the order it drains in. */
export function useOutbox(): OutboxEntry[] {
  useSyncExternalStore(subscribe, () => queue, () => queue)
  return queue
}

/**
 * Hand one entry to the server. Resolves when it is safely there; throws with a
 * message worth showing when it is not. Without a configured endpoint the
 * device database is the destination, so the entry is acknowledged at once.
 */
async function push(entry: OutboxEntry): Promise<void> {
  if (!SYNC_URL) return
  const response = await fetch(`${SYNC_URL.replace(/\/$/, '')}/writes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: entry.id,
      kind: entry.kind,
      payload: entry.payload,
      created_at: entry.created_at,
    }),
  })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim())
}

/**
 * Drain the queue in order. A record that fails stays at the head of the queue
 * with its attempt count raised — nothing behind it is sent ahead of it, so the
 * server sees the records in the order they were keyed.
 */
export async function syncNow(): Promise<void> {
  if (sending) return
  // Nothing leaves a device with no connection, whatever it would be sent to.
  if (!online) {
    publish()
    return
  }
  if (queue.length === 0) {
    publish()
    return
  }
  sending = true
  lastError = null
  publish()
  let delivered = 0
  try {
    while (queue.length > 0) {
      const entry = queue[0]
      try {
        await push(entry)
      } catch (error) {
        entry.attempts += 1
        entry.last_error = error instanceof Error ? error.message : String(error)
        lastError = entry.last_error
        persistQueue()
        break
      }
      queue = queue.slice(1)
      delivered += 1
      persistQueue()
    }
  } finally {
    sending = false
    if (delivered > 0) {
      meta = { last_synced_at: new Date().toISOString(), delivered: meta.delivered + delivered }
      persistMeta()
    }
    publish()
  }
}

/**
 * Record a write for the server. Called by the api seam the moment a row is
 * saved locally, so the two can never disagree about what the device holds.
 */
export function enqueueWrite(kind: string, summary: string, payload: Record<string, unknown>): OutboxEntry {
  const entry: OutboxEntry = {
    id: newId(),
    kind,
    summary,
    payload,
    created_at: new Date().toISOString(),
    attempts: 0,
  }
  queue = [...queue, entry]
  persistQueue()
  publish()
  // Offline the entry simply waits; online it leaves straight away.
  if (online) void syncNow()
  return entry
}

export function setOnline(next: boolean) {
  if (online === next) return
  online = next
  publish()
  if (next) void syncNow()
}

/** Wire the browser's own connectivity signal. Called once from main.tsx. */
export function watchConnection() {
  const up = () => setOnline(true)
  const down = () => setOnline(false)
  window.addEventListener('online', up)
  window.addEventListener('offline', down)
  window.addEventListener('focus', () => {
    setOnline(navigator.onLine)
  })
  window.setInterval(() => {
    if (queue.length > 0) void syncNow()
  }, FLUSH_INTERVAL)
  void syncNow()
}

/** True when this build has somewhere to send records to. */
export const hasServer = Boolean(SYNC_URL)
