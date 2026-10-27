import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Layers, Printer } from 'lucide-react'
import type { DeckModel, DeckStream, DeckTone } from '../lib/deck'
import { round } from '../lib/format'

/**
 * The end-of-term performance deck: the department report as a slide show.
 *
 * The palette, the chrome (kicker, rule, footer with a slide number) and the
 * clustered column charts follow the printed report this school circulates —
 * deep teal ground, teal/sand/sun series, coral for anything that needs
 * intervention. Every number comes from `buildDeck`, which reads marks and
 * nothing else.
 */

const TONE_COLOR: Record<DeckTone, string> = {
  teal: 'var(--color-deck-teal)',
  sand: 'var(--color-deck-sand)',
  sun: 'var(--color-deck-sun)',
  coral: 'var(--color-deck-coral)',
  ink: 'var(--color-deck-ink)',
  slate: 'var(--color-deck-mute)',
}

/**
 * One colour per term, so a series always means the same term on every slide.
 * The order is the printed report's: teal first term, gold second, coral third.
 */
const TERM_COLORS = [
  'var(--color-deck-teal)',
  'var(--color-deck-sand)',
  'var(--color-deck-coral)',
  'var(--color-deck-sun)',
]

/** Streams are peers, so they take the neutral-positive half of the palette. */
const STREAM_COLORS = [
  'var(--color-deck-teal)',
  'var(--color-deck-sand)',
  'var(--color-deck-ink)',
  'var(--color-deck-sun)',
]

const pct = (value: number) => `${Math.max(0, Math.min(100, value))}%`
const figure = (value: number | null, digits = 1) => (value === null ? '—' : round(value, digits))

interface Series {
  key: string
  label: string
  color: string
  values: (number | null)[]
}

/** Clustered columns: one column per category, one bar per series inside it. */
function ClusterChart({
  categories,
  series,
  label,
  tickStep = 25,
}: {
  categories: string[]
  series: Series[]
  label: string
  tickStep?: number
}) {
  const ticks = Array.from({ length: 100 / tickStep }, (_, i) => (i + 1) * tickStep)
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex w-7 shrink-0 flex-col justify-between pb-5 text-right font-mono text-[8.5px] text-deck-ink/40">
          {[...ticks].reverse().map((tick) => (
            <span key={tick}>{tick}</span>
          ))}
          <span>0</span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="deck-plot" role="img" aria-label={label}>
            {ticks.map((tick) => (
              <span key={tick} className="deck-gridline" style={{ bottom: pct(tick) }} aria-hidden="true" />
            ))}
            <div className="absolute inset-x-0 bottom-0 top-0 flex items-end gap-1.5 sm:gap-3">
              {categories.map((category, index) => (
                <div key={category} className="flex h-full flex-1 flex-col justify-end">
                  <div className="flex h-full items-end justify-center gap-[3px] sm:gap-1">
                    {series.map((entry) => {
                      const value = entry.values[index]
                      if (value === null) {
                        return (
                          <div key={entry.key} className="flex w-full max-w-[30px] items-end justify-center pb-1">
                            <span className="font-mono text-[8.5px] text-deck-ink/30">—</span>
                          </div>
                        )
                      }
                      // The value sits absolutely above its bar, so a near-full
                      // column cannot push itself out of the plot.
                      return (
                        <div key={entry.key} className="relative flex h-full w-full max-w-[30px] items-end justify-center">
                          <span
                            className="absolute left-1/2 -translate-x-1/2 font-mono text-[8.5px] font-semibold leading-none text-deck-ink/70"
                            style={{ bottom: `calc(${pct(value)} + 2px)` }}
                          >
                            {Math.round(value)}
                          </span>
                          <div
                            className="deck-bar w-full"
                            style={{ height: pct(value), background: entry.color, minHeight: 2 }}
                            title={`${category} · ${entry.label}: ${figure(value)}%`}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-1.5 border-t border-deck-ink/25 pt-1 sm:gap-3">
            {categories.map((category) => (
              <span
                key={category}
                className="flex-1 truncate text-center text-[9px] font-semibold uppercase tracking-[0.06em] text-deck-ink/70"
              >
                {category}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        {series.map((entry) => (
          <span key={entry.key} className="inline-flex items-center gap-1.5 text-[9.5px] text-deck-ink/70">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: entry.color }} />
            {entry.label}
          </span>
        ))}
      </div>
    </div>
  )
}

function Verdict({ tone, label }: { tone: DeckTone; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-white"
      style={{ background: TONE_COLOR[tone] }}
    >
      {label}
    </span>
  )
}

function Slide({
  n,
  total,
  kicker,
  title,
  subtitle,
  children,
  foot,
  cover = false,
  active = true,
}: {
  n: number
  total: number
  kicker?: string
  title: string
  subtitle?: string
  children: ReactNode
  foot: string
  cover?: boolean
  active?: boolean
}) {
  return (
    <article
      className={`deck-slide ${cover ? 'deck-slide--cover' : ''} relative shadow-[0_1px_3px_rgb(17_24_39_/_0.12)]`}
      data-slide={n}
      data-active={active}
      aria-hidden={!active}
    >
      {cover ? (
        <div className="flex flex-1 flex-col justify-between p-6 sm:p-10">
          <p className="deck-kicker">{kicker}</p>
          <div>
            <h3 className="deck-title text-[26px] sm:text-[38px]">{title}</h3>
            <div className="mt-2 h-[3px] w-16" style={{ background: 'var(--color-deck-teal)' }} />
            {subtitle ? <p className="mt-3 text-[13px] font-semibold text-white/80 sm:text-[15px]">{subtitle}</p> : null}
            <p className="mt-1 text-[11px] text-white/55 sm:text-[12px]">{children}</p>
          </div>
          <p className="deck-foot border-deck-teal/30 pt-2 text-white/45">{foot}</p>
        </div>
      ) : (
        <>
          <header className="px-4 pt-4 sm:px-7 sm:pt-5">
            {kicker ? <p className="deck-kicker">{kicker}</p> : null}
            <h3 className="deck-title mt-1 text-[17px] sm:text-[22px]">{title}</h3>
            <div className="mt-1.5 h-[3px] w-10" style={{ background: 'var(--color-deck-teal)' }} />
            {subtitle ? <p className="mt-1.5 text-[10.5px] text-deck-ink/60 sm:text-[11.5px]">{subtitle}</p> : null}
          </header>
          <div className="flex min-h-0 flex-1 flex-col px-4 py-3 sm:px-7 sm:py-4">{children}</div>
          <footer className="deck-foot flex items-center justify-between gap-3 px-4 pb-2.5 pt-1.5 text-deck-ink/50 sm:px-7">
            <span className="truncate">{foot}</span>
            <span className="shrink-0 font-mono font-semibold text-deck-ink/70">
              {String(n).padStart(2, '0')}
              <span className="text-deck-ink/35">/{total}</span>
            </span>
          </footer>
        </>
      )}
      {cover ? (
        <span className="absolute bottom-6 right-6 font-mono text-[11px] font-semibold text-white/60 sm:bottom-10 sm:right-10">
          {String(n).padStart(2, '0')}
        </span>
      ) : null}
    </article>
  )
}

export default function PerformanceDeck({
  model,
  schoolName,
  stacked,
  onStackedChange,
  onPrint,
}: {
  model: DeckModel
  schoolName: string
  /** Print layout: every slide stacked, one per page. Mirrored in the URL. */
  stacked: boolean
  onStackedChange: (stacked: boolean) => void
  onPrint: () => void
}) {
  const [index, setIndex] = useState(0)

  const foot = `${model.scopeTitle} · performance analysis · ${model.streamLine} · ${model.timeline}`

  const contents = useMemo(() => {
    const rows = [
      { title: 'Executive summary', blurb: 'Key findings and headline measures' },
      { title: 'Overall performance', blurb: `All ${model.streams.length} streams across ${model.terms.length} terms` },
    ]
    for (const group of model.yearGroups) {
      rows.push({
        title: `${group.name} performance`,
        blurb: `${group.streams.map((stream) => stream.short).join(' & ')} term by term`,
      })
    }
    for (const group of model.yearGroups) {
      rows.push({ title: `Detailed analysis — ${group.name}`, blurb: 'Challenges and recommended actions' })
    }
    rows.push(
      { title: 'Recommendations', blurb: `${model.recommendations.length} priority strategies` },
      { title: 'Conclusion', blurb: 'Summary and way forward' },
    )
    return rows
  }, [model])

  const total = contents.length + 2 // cover + contents + the sections listed

  const go = useCallback(
    (delta: number) => setIndex((current) => Math.max(0, Math.min(total - 1, current + delta))),
    [total],
  )

  useEffect(() => {
    setIndex((current) => Math.min(current, total - 1))
  }, [total])

  const streamSeries = (stream: DeckStream, colorIndex: number): Series => ({
    key: stream.classId,
    label: `${stream.short} (${stream.label})`,
    color: STREAM_COLORS[colorIndex % STREAM_COLORS.length],
    values: stream.points.map((point) => point.mean),
  })

  /** Slides in the same order `contents` describes. */
  const slides: { key: string; node: ReactNode }[] = []
  // In the stacked (print) layout every slide is displayed; otherwise only the
  // one being paged to. `n` is a 1-based slide number; `index` is 0-based.
  const active = (n: number) => stacked || index === n - 1

  slides.push({
    key: 'cover',
    node: (
      <Slide
        key="cover"
        n={1}
        total={total}
        cover
        kicker={schoolName}
        title={model.scopeTitle}
        subtitle="Performance Analysis Report"
        foot={foot}
        active={active(1)}
      >
        {`${model.streamLine} · ${model.timeline} · Comprehensive review of learner performance across every stream in scope`}
      </Slide>
    ),
  })

  slides.push({
    key: 'contents',
    node: (
      <Slide key="contents" n={2} total={total} kicker="Contents" title="What this report covers" foot={foot} active={active(2)}>
        <div className="grid flex-1 grid-cols-2 content-start gap-x-6 gap-y-2">
          {contents.map((entry, position) => (
            <div key={entry.title} className="flex items-start gap-2.5 border-b border-deck-ink/10 pb-1.5" data-deck-contents={position + 1}>
              <span className="w-5 shrink-0 font-mono text-[12px] font-bold text-deck-teal">
                {String(position + 1).padStart(2, '0')}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-semibold leading-tight">{entry.title}</span>
                <span className="block truncate text-[10px] text-deck-ink/55">{entry.blurb}</span>
              </span>
            </div>
          ))}
        </div>
      </Slide>
    ),
  })

  slides.push({
    key: 'summary',
    node: (
      <Slide
        key="summary"
        n={3}
        total={total}
        kicker="Executive summary"
        title="Where the cohort stands"
        subtitle={`Measured from ${model.terms.length} ${model.terms.length === 1 ? 'term' : 'terms'} of marks in ${model.scopeLine}.`}
        foot={foot}
        active={active(3)}
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {model.tiles.map((tile) => (
            <div key={tile.label} className="deck-tile p-2" style={{ borderTopColor: TONE_COLOR[tile.tone] }} data-deck-tile={tile.label}>
              <p className="text-[8.5px] font-bold uppercase tracking-[0.12em] text-deck-ink/45">{tile.label}</p>
              <p className="mt-0.5 font-mono text-[17px] font-bold leading-none sm:text-[20px]">{tile.value}</p>
              {tile.grade ? <p className="mt-0.5 text-[9.5px] font-semibold text-deck-ink/60">{tile.grade}</p> : null}
              <p className="mt-1 text-[9px] leading-snug text-deck-ink/55">{tile.note}</p>
            </div>
          ))}
        </div>
        <ul className="mt-3 min-h-0 flex-1 space-y-1.5 overflow-hidden">
          {model.summary.map((line) => (
            <li key={line} className="flex items-start gap-2 text-[10.5px] leading-snug text-deck-ink/75 sm:text-[11.5px]">
              <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: 'var(--color-deck-teal)' }} />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </Slide>
    ),
  })

  // Overall performance: classes along the axis, one series per term.
  slides.push({
    key: 'overall',
    node: (
      <Slide
        key="overall"
        n={4}
        total={total}
        kicker="Overall performance"
        title="Every stream, term by term"
        subtitle="Mean percentage per stream in each measured term. Higher is better."
        foot={foot}
        active={active(4)}
      >
        <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[1.7fr_1fr]">
          <ClusterChart
            categories={model.streams.map((stream) => stream.short)}
            series={model.terms.map((term, termIndex) => ({
              key: term.id,
              label: term.label,
              color: TERM_COLORS[termIndex % TERM_COLORS.length],
              values: model.streams.map((stream) => stream.points[termIndex]?.mean ?? null),
            }))}
            label={`Mean score per stream for ${model.terms.map((term) => term.label).join(', ')}`}
          />
          <div className="min-h-0 overflow-hidden">
            <p className="text-[8.5px] font-bold uppercase tracking-[0.12em] text-deck-ink/45">Key insights</p>
            <div className="mt-1.5 space-y-1">
              {model.streams.map((stream) => (
                <div key={stream.classId} className="flex items-baseline justify-between gap-2 border-b border-deck-ink/10 pb-1" data-deck-insight={stream.classId}>
                  <span className="min-w-0 truncate text-[10.5px]">
                    <span className="font-mono font-bold" style={{ color: STREAM_COLORS[model.streams.indexOf(stream) % STREAM_COLORS.length] }}>
                      {stream.short}
                    </span>{' '}
                    <span className="text-deck-ink/70">{stream.verdict.label}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[10px] font-semibold">
                    {figure(stream.closing)}
                    {stream.change === null ? null : (
                      <span className={stream.change >= 0 ? 'text-deck-teal' : 'text-deck-coral'}>
                        {' '}
                        {stream.change >= 0 ? '+' : ''}
                        {round(stream.change)}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Slide>
    ),
  })

  // One slide per year group, then one detailed slide per year group.
  let n = 5
  for (const group of model.yearGroups) {
    const streamIndex = new Map(model.streams.map((stream, position) => [stream.classId, position]))
    slides.push({
      key: `year-${group.name}`,
      node: (
        <Slide
          key={`year-${group.name}`}
          n={n}
          total={total}
          kicker="Year group"
          title={`${group.name} performance trend`}
          subtitle={`Term-by-term mean for each stream, with the verdict each one closed on.`}
          foot={foot}
          active={active(n)}
        >
          <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[1.2fr_1fr]">
            <ClusterChart
              categories={model.terms.map((term) => term.short)}
              series={group.streams.map((stream) => streamSeries(stream, streamIndex.get(stream.classId) ?? 0))}
              label={`${group.name} term-by-term means`}
            />
            {/* A column, not a stretched grid: a stream card hugs its own content
                instead of standing half empty beside a taller sibling. */}
            <div className="flex min-h-0 flex-col gap-2">
              {group.streams.map((stream) => (
                <div key={stream.classId} className="border border-deck-ink/15 bg-white p-2" data-deck-stream={stream.classId}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[13px] font-bold">{stream.short}</span>
                    <Verdict tone={stream.verdict.tone} label={stream.verdict.label} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-2.5">
                    {stream.points.map((point, position) => (
                      <span key={point.termId} className="text-center">
                        <span className="block text-[8px] uppercase tracking-[0.08em] text-deck-ink/45">
                          {model.terms[position]?.short ?? ''}
                        </span>
                        <span className="block font-mono text-[13px] font-bold leading-none">
                          {point.mean === null ? '—' : Math.round(point.mean)}
                        </span>
                        <span className="block text-[8.5px] font-semibold text-deck-ink/55">{point.grade}</span>
                      </span>
                    ))}
                  </div>
                  <p className="mt-1.5 line-clamp-3 text-[9.5px] leading-snug text-deck-ink/60">{stream.narrative}</p>
                </div>
              ))}
            </div>
          </div>
        </Slide>
      ),
    })
    n += 1
  }

  for (const group of model.yearGroups) {
    slides.push({
      key: `detail-${group.name}`,
      node: (
        <Slide
          key={`detail-${group.name}`}
          n={n}
          total={total}
          kicker="Detailed analysis"
          title={`${group.name} — challenges and actions`}
          subtitle="Each challenge is a measured fact about this stream's marks; each action follows from one."
          foot={foot}
          active={active(n)}
        >
          <div className={`grid min-h-0 flex-1 content-start gap-2.5 ${group.streams.length > 1 ? 'sm:grid-cols-2' : ''}`}>
            {group.streams.map((stream) => (
              <div key={stream.classId} className="flex h-fit flex-col border border-deck-ink/15 bg-white p-2.5" data-deck-detail={stream.classId}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[13px] font-bold">{stream.short}</span>
                  <Verdict tone={stream.verdict.tone} label={stream.verdict.label} />
                </div>
                <p className="mt-1.5 text-[10px] leading-snug text-deck-ink/70">{stream.narrative}</p>
                {stream.strongest && stream.weakest ? (
                  <p className="mt-1 text-[9.5px] leading-snug text-deck-ink/60">
                    <span className="font-semibold text-deck-ink/80">Across {stream.subjectCount} subjects:</span> strongest{' '}
                    {stream.strongest.name} at {figure(stream.strongest.mean)}%, weakest {stream.weakest.name} at{' '}
                    {figure(stream.weakest.mean)}%.
                  </p>
                ) : null}
                <p className="mt-2 text-[8.5px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--color-deck-coral)' }}>
                  Challenges
                </p>
                <ul className="mt-1 space-y-0.5">
                  {stream.challenges.map((line) => (
                    <li key={line} className="text-[9.5px] leading-snug text-deck-ink/70">
                      · {line}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[8.5px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--color-deck-teal)' }}>
                  Recommended actions
                </p>
                <ul className="mt-1 space-y-0.5">
                  {stream.actions.map((action) => (
                    <li key={action.key} className="text-[9.5px] leading-snug text-deck-ink/70">
                      · {action.title} — {action.because}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Slide>
      ),
    })
    n += 1
  }

  slides.push({
    key: 'recommendations',
    node: (
      <Slide
        key="recommendations"
        n={n}
        total={total}
        kicker="Departmental recommendations"
        title="Priority strategies for the coming term"
        subtitle={`${model.recommendations.length} ${
          model.recommendations.length === 1 ? 'strategy' : 'strategies'
        } — ${model.recommendations.filter((action) => action.triggered).length} asked for by the marks, the rest standing practice.`}
        foot={foot}
        active={active(n)}
      >
        <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-x-4 gap-y-2.5 overflow-hidden">
          {model.recommendations.map((action, position) => (
            <div key={action.key} className="flex items-start gap-2.5" data-deck-recommendation={action.key}>
              <span className="w-5 shrink-0 font-mono text-[13px] font-bold text-deck-teal">
                {String(position + 1).padStart(2, '0')}
              </span>
              <span className="min-w-0">
                <span className="block text-[11.5px] font-semibold leading-tight">
                  {action.title}
                  {action.triggered ? null : (
                    <span className="ml-1.5 align-middle text-[8px] font-bold uppercase tracking-[0.1em] text-deck-ink/40">
                      standing
                    </span>
                  )}
                </span>
                <span className="block text-[9.5px] leading-snug text-deck-ink/70">{action.body}</span>
                <span className="block text-[9px] italic leading-snug text-deck-ink/50">{action.because}</span>
              </span>
            </div>
          ))}
        </div>
      </Slide>
    ),
  })
  n += 1

  slides.push({
    key: 'conclusion',
    node: (
      <Slide
        key="conclusion"
        n={n}
        total={total}
        kicker="Conclusion"
        title="Summary and way forward"
        subtitle={`${model.scopeTitle} · ${model.timeline}`}
        foot={`${foot} · confidential`}
        active={active(n)}
      >
        <ul className="min-h-0 flex-1 space-y-2">
          {model.conclusion.map((line) => (
            <li key={line} className="flex items-start gap-2.5 border-b border-deck-ink/10 pb-1.5 text-[11px] leading-snug text-deck-ink/75">
              <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: 'var(--color-deck-teal)' }} />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </Slide>
    ),
  })

  return (
    <section className="deck-section screen-only mt-8" data-deck="performance">
      <div className="deck-nav mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold">Performance deck</h2>
          <p className="mt-0.5 text-[11.5px] text-ink/50">
            The end-of-term report as a slide show — {total} slides built from the marks in scope. Arrow keys page through
            it; printing the stack gives one slide per page.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className="btn btn-sm"
            data-action="deck-prev"
            disabled={stacked || index === 0}
            onClick={() => go(-1)}
            aria-label="Previous slide"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="figure min-w-[64px] text-center text-[12px] text-ink/60" data-deck-counter>
            {stacked ? `All ${total}` : `${index + 1} / ${total}`}
          </span>
          <button
            type="button"
            className="btn btn-sm"
            data-action="deck-next"
            disabled={stacked || index >= total - 1}
            onClick={() => go(1)}
            aria-label="Next slide"
          >
            <ChevronRight size={14} />
          </button>
          <button
            type="button"
            className="btn btn-sm"
            data-action="deck-stack"
            aria-pressed={stacked}
            onClick={() => onStackedChange(!stacked)}
          >
            <Layers size={13} /> {stacked ? 'Single slide' : 'All slides'}
          </button>
          <button type="button" className="btn btn-primary btn-sm" data-action="deck-print" onClick={onPrint}>
            <Printer size={13} /> Print slides
          </button>
        </div>
      </div>

      <div
        className="deck-root rounded-md border border-rule bg-sunken/60 p-2 sm:p-3"
        role="region"
        aria-label="Performance deck"
        tabIndex={0}
        onKeyDown={(event) => {
          if (stacked) return
          if (event.key === 'ArrowRight' || event.key === 'PageDown') {
            event.preventDefault()
            go(1)
          }
          if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
            event.preventDefault()
            go(-1)
          }
          if (event.key === 'Home') {
            event.preventDefault()
            setIndex(0)
          }
          if (event.key === 'End') {
            event.preventDefault()
            setIndex(total - 1)
          }
        }}
      >
        <div className={stacked ? 'deck-stack' : ''}>{slides.map((slide) => slide.node)}</div>
      </div>
    </section>
  )
}
