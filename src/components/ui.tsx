import type { ComponentType, ReactNode } from 'react'
import { X } from 'lucide-react'
import type { School } from '../data/types'
import { gradeTone } from '../lib/grading'
import { initialsOf } from '../lib/format'

/* ── page header: title, subtitle, status meta, action cluster ───────── */
export function PageHeader({
  title,
  subtitle,
  meta,
  actions,
}: {
  title: string
  subtitle?: string
  meta?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="mb-5 border-b border-rule pb-4 no-print">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">{title}</h1>
          {subtitle ? <p className="mt-0.5 text-[13px] text-ink/55">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{actions}</div> : null}
      </div>
      {meta ? <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink/60">{meta}</div> : null}
    </header>
  )
}

/* ── badges ──────────────────────────────────────────────────────────── */
export type Tone = 'neutral' | 'brass' | 'ok' | 'danger' | 'ink' | 'crimson' | 'warn'

const toneClass: Record<Tone, string> = {
  neutral: 'border-rule bg-sunken text-ink/70',
  brass: 'border-brass/40 bg-brass/12 text-brass-deep',
  ok: 'border-ok/25 bg-ok/8 text-ok',
  danger: 'border-danger/25 bg-danger/8 text-danger',
  warn: 'border-warn/30 bg-warn/10 text-warn',
  ink: 'border-ink/15 bg-ink/5 text-ink',
  crimson: 'border-crimson/25 bg-crimson/8 text-crimson',
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] ${toneClass[tone]}`}
    >
      {children}
    </span>
  )
}

/* ── grade pill ──────────────────────────────────────────────────────── */
const gradeClass: Record<string, string> = {
  gold: 'border-brass/50 bg-brass/15 text-brass-deep',
  ok: 'border-ok/30 bg-ok/10 text-ok',
  slate: 'border-ink/15 bg-ink/5 text-ink/70',
  warn: 'border-warn/35 bg-warn/12 text-warn',
  danger: 'border-danger/30 bg-danger/8 text-danger',
  neutral: 'border-rule bg-sunken text-ink/60',
}

export function GradePill({ grade, size = 'md' }: { grade: string; size?: 'sm' | 'md' }) {
  const tone = gradeTone(grade)
  return (
    <span
      title={`Grade ${grade}`}
      className={`inline-flex items-center justify-center rounded border font-mono font-semibold ${gradeClass[tone]} ${
        size === 'sm' ? 'min-w-[24px] px-1 py-0.5 text-[10px]' : 'min-w-[30px] px-1.5 py-1 text-[11px]'
      }`}
    >
      {grade}
    </span>
  )
}

/* ── identity ────────────────────────────────────────────────────────── */
export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full border border-rule bg-sunken font-semibold text-ink/70"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      aria-hidden="true"
    >
      {initialsOf(name)}
    </span>
  )
}

/**
 * The lockup (emblem + wordmark + tagline). `size` is its rendered height — the
 * width follows the asset, so the wordmark always reads at its natural ratio.
 * On dark surfaces pass `plate` so the black lettering stays legible.
 */
export function SchoolLogo({
  school,
  size = 34,
  plate = false,
}: {
  school: School
  size?: number
  plate?: boolean
}) {
  if (school.logo_url) {
    return (
      <img
        src={school.logo_url}
        alt={`${school.name} logo`}
        className={`shrink-0 object-contain ${plate ? 'rounded-sm bg-white px-1.5 py-1' : ''}`}
        style={{ height: size, width: 'auto', maxWidth: size * 4 }}
      />
    )
  }
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded border border-brass/50 bg-brass/15 font-semibold tracking-tight text-brass"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}
      aria-hidden="true"
    >
      IUPC
    </span>
  )
}

/** Square emblem for tight spaces (top bar, mobile bar, table headers). */
export function SchoolCrest({ school, size = 30 }: { school: School; size?: number }) {
  const source = school.crest_url ?? school.logo_url
  if (source) {
    return (
      <img
        src={source}
        alt={`${school.name} crest`}
        className="shrink-0 rounded-sm bg-white object-contain p-[3px]"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded border border-brass/50 bg-brass/15 font-semibold tracking-tight text-brass"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}
      aria-hidden="true"
    >
      IUPC
    </span>
  )
}

/* ── stat card ───────────────────────────────────────────────────────── */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'crimson',
}: {
  label: string
  value: ReactNode
  hint?: string
  icon?: ComponentType<{ size?: number; className?: string }>
  tone?: 'crimson' | 'brass' | 'ink' | 'ok'
}) {
  const strip: Record<string, string> = {
    crimson: 'bg-crimson',
    brass: 'bg-brass',
    ink: 'bg-ink',
    ok: 'bg-ok',
  }
  return (
    <div className="card card-hover relative overflow-hidden p-4">
      <span className={`absolute inset-x-0 top-0 h-[3px] ${strip[tone]}`} aria-hidden="true" />
      <div className="flex items-start justify-between gap-2">
        <p className="micro">{label}</p>
        {Icon ? <Icon size={15} className="text-ink/30" /> : null}
      </div>
      <p className="display-figure mt-2 text-[26px] font-semibold leading-none text-ink">{value}</p>
      {hint ? <p className="mt-1.5 text-[11.5px] text-ink/50">{hint}</p> : null}
    </div>
  )
}

/* ── empty state ─────────────────────────────────────────────────────── */
export function EmptyState({
  title,
  hint,
  action,
  compact = false,
}: {
  title: string
  hint?: string
  action?: ReactNode
  compact?: boolean
}) {
  return (
    <div className={`flex flex-col items-center justify-center rounded-md border border-dashed border-rule text-center ${compact ? 'px-4 py-6' : 'px-6 py-12'}`}>
      <p className="text-[13px] font-medium text-ink/70">{title}</p>
      {hint ? <p className="mt-1 max-w-sm text-[12px] text-ink/45">{hint}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  )
}

/* ── modal ───────────────────────────────────────────────────────────── */
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  width = 520,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 pt-[8vh] no-print">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full rounded-lg border border-rule bg-raised shadow-xl"
        style={{ maxWidth: width }}
      >
        <div className="flex items-center justify-between border-b border-rule px-4 py-3">
          <h2 className="text-[14px] font-semibold">{title}</h2>
          <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Close dialog">
            <X size={14} />
          </button>
        </div>
        <div className="px-4 py-4">{children}</div>
        {footer ? <div className="flex items-center justify-end gap-2 border-t border-rule px-4 py-3">{footer}</div> : null}
      </div>
    </div>
  )
}

/* ── misc ────────────────────────────────────────────────────────────── */
export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-2 border-b border-rule pb-2">
      <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink/55">{children}</h2>
      {right}
    </div>
  )
}

export function ProgressBar({ value, total, tone = 'brass' }: { value: number; total: number; tone?: 'brass' | 'ok' | 'crimson' }) {
  const pct = total ? Math.min(100, Math.round((value / total) * 100)) : 0
  const fill = tone === 'ok' ? 'bg-ok' : tone === 'crimson' ? 'bg-crimson' : 'bg-brass'
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunken" role="img" aria-label={`${value} of ${total} entered`}>
      <div className={`h-full ${fill}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-ink/45">{hint}</span> : null}
    </label>
  )
}
