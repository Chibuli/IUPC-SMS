import { useState } from 'react'
import { CloudAlert, CloudCheck, CloudOff, CloudUpload, Loader2, RefreshCw, ShieldCheck } from 'lucide-react'
import {
  hasServer,
  reconcileOperation,
  retryOperation,
  syncNow,
  useQueueRecords,
  useSyncState,
} from '../lib/offline'
import { reasonText, type OperationState } from '../lib/offline-outcomes'
import { Modal } from './ui'
import { formatDateTime, timeAgo } from '../lib/format'

/**
 * What has happened to the marks keyed on this device.
 *
 * The wording is deliberately literal. A queued mark is "on this device", not
 * "saved": the school only has it once the server has accepted it. A mark whose
 * answer was lost says so, and is checked against its receipt rather than being
 * described as failed.
 */

type Look = 'idle' | 'offline' | 'pending' | 'failed'

const skins: Record<'dark' | 'light', Record<Look, string>> = {
  dark: {
    idle: 'border-white/20 bg-white/10 text-white/75 hover:bg-white/20 hover:text-white',
    offline: 'border-brass/60 bg-brass/20 text-white hover:bg-brass/30',
    pending: 'border-brass/60 bg-brass/20 text-white hover:bg-brass/30',
    failed: 'border-danger/70 bg-danger/30 text-white hover:bg-danger/40',
  },
  light: {
    idle: 'border-rule bg-sunken text-ink/60 hover:border-ink/25 hover:text-ink',
    offline: 'border-warn/40 bg-warn/12 text-warn hover:bg-warn/20',
    pending: 'border-brass/50 bg-brass/15 text-brass-deep hover:bg-brass/25',
    failed: 'border-danger/40 bg-danger/10 text-danger hover:bg-danger/20',
  },
}

const stateChip: Record<OperationState, string> = {
  Pending: 'border-brass/50 bg-brass/15 text-brass-deep',
  Synchronizing: 'border-brass/50 bg-brass/15 text-brass-deep',
  Retryable: 'border-warn/40 bg-warn/12 text-warn',
  Accepted: 'border-ok/40 bg-ok/10 text-ok',
  Rejected: 'border-danger/40 bg-danger/10 text-danger',
  Uncertain: 'border-warn/40 bg-warn/12 text-warn',
  Blocked: 'border-danger/40 bg-danger/10 text-danger',
}

const stateWords: Record<OperationState, string> = {
  Pending: 'On this device',
  Synchronizing: 'Sending',
  Retryable: 'Will retry',
  Accepted: 'Accepted by school',
  Rejected: 'Not accepted',
  Uncertain: 'Outcome unknown',
  Blocked: 'Needs review',
}

export function SyncPill({ surface = 'light', compact = false }: { surface?: 'dark' | 'light'; compact?: boolean }) {
  const sync = useSyncState()
  const [open, setOpen] = useState(false)

  const attention = sync.failed + sync.uncertain
  const look: Look = !sync.online
    ? 'offline'
    : attention > 0
      ? 'failed'
      : sync.pending > 0 || !sync.serverConfigured
        ? 'pending'
        : 'idle'

  const label = (() => {
    if (look === 'offline') return sync.pending > 0 ? `Offline · ${sync.pending} local` : 'Offline · server unavailable'
    if (look === 'failed') return attention === 1 ? '1 mark needs review' : `${attention} marks need review`
    if (look === 'pending')
      return !sync.serverConfigured
        ? `${sync.pending} local · no server`
        : sync.sending
          ? `Sending ${sync.pending}…`
          : `${sync.pending} waiting`
    return 'Synced'
  })()

  const Icon = look === 'offline' ? CloudOff : look === 'failed' ? CloudAlert : look === 'pending' ? CloudUpload : CloudCheck

  const title = (() => {
    if (!sync.storageAvailable) return 'This browser is not storing marks locally. Nothing can be queued on this device.'
    if (look === 'offline')
      return sync.pending > 0
        ? `${sync.pending} mark${sync.pending === 1 ? '' : 's'} saved on this device; the school has not accepted them yet`
        : 'No connection. Marks cannot be confirmed by the school right now.'
    if (look === 'failed')
      return `${attention} mark${attention === 1 ? '' : 's'} need a person: ${sync.uncertain} unclear, ${sync.rejected} not accepted, ${sync.blocked} blocked`
    if (look === 'pending')
      return !sync.serverConfigured
        ? 'Saved on this device only. No school database is configured.'
        : `Sending ${sync.pending} mark(s)…`
    return sync.last_synced_at ? `Everything accepted by the school · last ${timeAgo(sync.last_synced_at)}` : 'Everything accepted by the school'
  })()

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={title}
        aria-label={`Sync status: ${label}`}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded border px-2 py-1 text-[11.5px] font-medium transition ${skins[surface][look]}`}
      >
        {sync.sending ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />}
        {compact ? (
          sync.pending > 0 || attention > 0 ? (
            <span className="figure">{sync.pending + attention}</span>
          ) : (
            <span className="sr-only">{label}</span>
          )
        ) : (
          <span className="whitespace-nowrap">{label}</span>
        )}
      </button>
      <SyncPanel open={open} onClose={() => setOpen(false)} />
    </>
  )
}

export function SyncPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const sync = useSyncState()
  const records = useQueueRecords()
  const [busy, setBusy] = useState<string | null>(null)

  const visible = records.filter((entry) => !entry.locked)
  const hidden = records.length - visible.length

  async function act(id: string, action: 'retry' | 'check') {
    setBusy(id)
    try {
      if (action === 'retry') await retryOperation(id)
      else await reconcileOperation(id)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal
      open={open}
      title="Marks on this device"
      onClose={onClose}
      width={600}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!sync.online || sync.pending === 0 || sync.sending}
            onClick={() => void syncNow()}
          >
            {sync.sending ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Sync now
          </button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
        <span className="inline-flex items-center gap-1.5">
          {sync.online ? <ShieldCheck size={14} className="text-ok" /> : <CloudOff size={14} className="text-warn" />}
          <span className={sync.online ? 'text-ink/70' : 'font-medium text-warn'}>
            {sync.online ? 'Connected' : 'No connection'}
          </span>
        </span>
        <span className="text-ink/55">
          <span className="figure font-semibold text-ink/75">{sync.pending}</span> waiting
        </span>
        <span className="text-ink/55">
          <span className="figure font-semibold text-ink/75">{sync.uncertain + sync.failed}</span> need review
        </span>
        <span className="text-ink/55">
          Last accepted{' '}
          <span className="figure text-ink/75">{sync.last_synced_at ? formatDateTime(sync.last_synced_at) : 'never'}</span>
        </span>
        <span className="text-ink/55">
          <span className="figure font-semibold text-ink/75">{sync.delivered}</span> accepted from this device
        </span>
      </div>

      <p className="mt-3 rounded border-l-2 border-brass bg-sunken/70 px-3 py-2 text-[11.5px] leading-relaxed text-ink/65">
        {!sync.storageAvailable ? (
          <>
            This browser is not storing marks locally, so a mark keyed while offline would be lost. Nothing is queued
            here and nothing is claimed to be saved until the school accepts it.
          </>
        ) : hasServer ? (
          <>
            A mark is written to this device first, then sent to the school database. It stays in this list until the
            server accepts it. Marks that were refused, blocked, or whose outcome is unclear are kept here for you to
            review — they are never resent automatically.
          </>
        ) : (
          <>
            No school database is configured, so marks cannot leave this device. Nothing here has been accepted by the
            school.
          </>
        )}
      </p>

      {sync.last_error && (
        <p className="mt-2 rounded border border-danger/30 bg-danger/8 px-3 py-2 text-[11.5px] text-danger">
          {sync.last_error}
        </p>
      )}

      {hidden > 0 && (
        <p className="mt-3 rounded border border-dashed border-rule px-3 py-2 text-[11.5px] text-ink/55">
          {hidden} mark{hidden === 1 ? '' : 's'} on this device belong to another account and are hidden. They stay
          stored, and they are only ever visible and sendable to the account that keyed them.
        </p>
      )}

      {visible.length === 0 ? (
        <p className="mt-3 rounded-md border border-dashed border-rule px-3 py-6 text-center text-[12.5px] text-ink/50">
          {hasServer ? 'Nothing is waiting on this device.' : 'No marks are queued on this device.'}
        </p>
      ) : (
        <ul className="mt-3 max-h-[46vh] divide-y divide-rule overflow-y-auto rounded-md border border-rule">
          {visible.map((entry) => (
            <li key={entry.id} className="px-3 py-2">
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-ink/80">{entry.summary}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10.5px] font-medium ${stateChip[entry.state]}`}
                    >
                      {stateWords[entry.state]}
                    </span>
                    <span className="figure text-[10.5px] text-ink/45">
                      {timeAgo(entry.created_at)}
                      {entry.attempts > 0 ? ` · ${entry.attempts} attempt${entry.attempts === 1 ? '' : 's'}` : ''}
                    </span>
                    {entry.state === 'Rejected' && entry.expires_at && (
                      <span className="text-[10.5px] text-ink/40">
                        kept until {formatDateTime(entry.expires_at)}
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block text-[11px] leading-relaxed text-ink/55">
                    {entry.last_error ?? reasonText(entry.token)}
                  </span>
                </span>
                {entry.state === 'Uncertain' && (
                  <span className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={busy === entry.id}
                      onClick={() => void act(entry.id, 'check')}
                    >
                      {busy === entry.id ? <Loader2 size={12} className="animate-spin" /> : null} Check
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={busy === entry.id || !sync.online}
                      onClick={() => void act(entry.id, 'retry')}
                    >
                      Send again
                    </button>
                  </span>
                )}
                {entry.state === 'Retryable' && (
                  <button
                    type="button"
                    className="btn btn-sm shrink-0"
                    disabled={busy === entry.id || !sync.online}
                    onClick={() => void act(entry.id, 'retry')}
                  >
                    {busy === entry.id ? <Loader2 size={12} className="animate-spin" /> : null} Retry
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
