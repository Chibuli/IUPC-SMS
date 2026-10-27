import { useState } from 'react'
import { CloudAlert, CloudCheck, CloudOff, CloudUpload, Loader2, RefreshCw, ShieldCheck } from 'lucide-react'
import { hasServer, syncNow, useOutbox, useSyncState } from '../lib/offline'
import { Modal } from './ui'
import { formatDateTime, timeAgo } from '../lib/format'

/**
 * Whether the records keyed on this device have reached the server.
 *
 * It is deliberately always on screen: a teacher who keys a mark while the
 * network is down needs to see that the record is safe here and only waiting to
 * travel, not wonder whether it was lost.
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

export function SyncPill({ surface = 'light', compact = false }: { surface?: 'dark' | 'light'; compact?: boolean }) {
  const sync = useSyncState()
  const [open, setOpen] = useState(false)

  const look: Look = !sync.online ? 'offline' : sync.failed > 0 ? 'failed' : sync.pending > 0 ? 'pending' : 'idle'

  const label = (() => {
    if (look === 'offline') return sync.pending > 0 ? `Offline · ${sync.pending} waiting` : 'Offline · all saved'
    if (look === 'failed') return `${sync.pending} waiting · not sent`
    if (look === 'pending') return sync.sending ? `Sending ${sync.pending}…` : `${sync.pending} waiting`
    return 'Synced'
  })()

  const Icon = look === 'offline' ? CloudOff : look === 'failed' ? CloudAlert : look === 'pending' ? CloudUpload : CloudCheck

  const title = (() => {
    if (look === 'offline')
      return sync.pending > 0
        ? `${sync.pending} record${sync.pending === 1 ? '' : 's'} kept on this device, waiting for a connection`
        : 'No connection. Records keyed now are saved on this device.'
    if (look === 'failed') return `${sync.pending} record(s) waiting — the last attempt failed: ${sync.last_error ?? 'unknown'}`
    if (look === 'pending') return `Sending ${sync.pending} record(s)…`
    return sync.last_synced_at ? `All records sent · last ${timeAgo(sync.last_synced_at)}` : 'All records sent'
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
          sync.pending > 0 ? (
            <span className="figure">{sync.pending}</span>
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
  const outbox = useOutbox()

  return (
    <Modal
      open={open}
      title="Records on this device"
      onClose={onClose}
      width={560}
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
          {sync.online ? (
            <ShieldCheck size={14} className="text-ok" />
          ) : (
            <CloudOff size={14} className="text-warn" />
          )}
          <span className={sync.online ? 'text-ink/70' : 'font-medium text-warn'}>
            {sync.online ? 'Connected' : 'No connection'}
          </span>
        </span>
        <span className="text-ink/55">
          <span className="figure font-semibold text-ink/75">{sync.pending}</span> waiting
        </span>
        <span className="text-ink/55">
          Last sent{' '}
          <span className="figure text-ink/75">{sync.last_synced_at ? formatDateTime(sync.last_synced_at) : 'never'}</span>
        </span>
        <span className="text-ink/55">
          <span className="figure font-semibold text-ink/75">{sync.delivered}</span> sent from this device
        </span>
      </div>

      <p className="mt-3 rounded border-l-2 border-brass bg-sunken/70 px-3 py-2 text-[11.5px] leading-relaxed text-ink/65">
        {hasServer ? (
          <>
            Marks are written to this device first and posted to the server in the order they were keyed. A record only
            leaves the queue once the server has accepted it.
          </>
        ) : (
          <>
            Every mark is written to this device immediately, so nothing is lost when the network drops — and the app
            itself is installed on the device, so it opens with no connection at all. This build has no server wired
            up yet, so queued records are acknowledged against the device database; point{' '}
            <code className="figure text-[11px]">VITE_SYNC_URL</code> at an endpoint and they post there instead.
          </>
        )}
      </p>

      {outbox.length === 0 ? (
        <p className="mt-3 rounded-md border border-dashed border-rule px-3 py-6 text-center text-[12.5px] text-ink/50">
          Nothing is waiting. Every record keyed on this device has been sent.
        </p>
      ) : (
        <ul className="mt-3 max-h-[46vh] divide-y divide-rule overflow-y-auto rounded-md border border-rule">
          {outbox.map((entry) => (
            <li key={entry.id} className="flex items-start gap-3 px-3 py-2">
              <span
                className={`mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                  entry.attempts > 0 ? 'bg-danger' : 'bg-brass'
                }`}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] text-ink/80">{entry.summary}</span>
                <span className="figure mt-0.5 block text-[10.5px] text-ink/45">
                  {entry.kind} · {timeAgo(entry.created_at)}
                  {entry.attempts > 0 ? ` · ${entry.attempts} attempt${entry.attempts === 1 ? '' : 's'}` : ''}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
