import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ArrowDownRight,
  ArrowUpRight,
  BookOpen,
  ClipboardList,
  Download,
  FileText,
  Lightbulb,
  Minus,
  ShieldAlert,
  SlidersHorizontal,
  TrendingUp,
} from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import { useDb } from '../data/db'
import { useSession } from '../session'
import { Badge, EmptyState, GradePill, PageHeader, ProgressBar, SchoolLogo } from '../components/ui'
import type { Tone } from '../components/ui'
import { analysisCsv, buildAnalysis, classLabel, orderedTerms, termLabel } from '../lib/analysis'
import { downloadCsv } from '../lib/analytics'
import { gradeTone, resolveScale } from '../lib/grading'
import { fileSlug, formatDate, round } from '../lib/format'
import { usePrintPage } from '../lib/print'
import { buildDeck } from '../lib/deck'
import PerformanceDeck from '../components/PerformanceDeck'

const BAR_FILL: Record<string, string> = {
  gold: 'bg-brass',
  ok: 'bg-ok',
  slate: 'bg-ink/55',
  warn: 'bg-warn',
  danger: 'bg-danger',
  neutral: 'bg-ink/25',
}

const STRIP: Record<'crimson' | 'brass' | 'ink' | 'ok' | 'danger', string> = {
  crimson: 'bg-crimson',
  brass: 'bg-brass',
  ink: 'bg-ink',
  ok: 'bg-ok',
  danger: 'bg-danger',
}

const INSIGHT_TONE: Record<string, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
  brass: 'bg-brass',
}

function Metric({
  name,
  label,
  value,
  hint,
  badge,
  tone,
  icon: Icon,
  valueClassName = 'text-[26px]',
}: {
  name: string
  label: string
  value: ReactNode
  hint?: string
  badge?: ReactNode
  tone: 'crimson' | 'brass' | 'ink' | 'ok' | 'danger'
  icon?: ComponentType<{ size?: number; className?: string }>
  valueClassName?: string
}) {
  return (
    <div className="card relative overflow-hidden p-4" data-metric={name}>
      <span className={`absolute inset-x-0 top-0 h-[3px] ${STRIP[tone]}`} aria-hidden="true" />
      <div className="flex items-start justify-between gap-2">
        <p className="micro">{label}</p>
        {Icon ? <Icon size={15} className="text-ink/30" /> : null}
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-x-2 gap-y-1.5">
        <span className={`display-figure font-semibold leading-none text-ink ${valueClassName}`}>{value}</span>
        {badge}
      </div>
      {hint ? <p className="mt-1.5 text-[11.5px] leading-snug text-ink/50">{hint}</p> : null}
    </div>
  )
}

function DeltaBadge({ value, termName }: { value: number | null; termName: string }) {
  if (value === null) {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-rule bg-sunken px-1.5 py-0.5 text-[10.5px] font-semibold text-ink/45">
        <Minus size={11} /> No shared papers
      </span>
    )
  }
  const up = value >= 0
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10.5px] font-semibold ${
        up ? 'border-ok/25 bg-ok/8 text-ok' : 'border-danger/25 bg-danger/8 text-danger'
      }`}
    >
      <Icon size={11} />
      {up ? '+' : ''}
      {round(value)} pts vs {termName}
    </span>
  )
}

export default function AnalysisPage() {
  const db = useDb()
  const { session, teacher, subjectScope } = useSession()
  const scale = resolveScale(db.gradingScales)
  const school = db.schools[0] ?? { _id: 'school-unconfigured', name: 'IUPC Academy', code: '', address: '', postal: '', city: '', contact_email: '', phone_number: '', logo_url: null, crest_url: null, motto: '' }

  // The deck is a cross-term report, so `?deck=print` puts every slide on its own
  // page and the print run follows the deck instead of the analytics sheet.
  const [params, setParams] = useSearchParams()
  const deckStacked = params.get('deck') === 'print'
  usePrintPage(deckStacked ? 'deck' : 'analysis')
  const [printPending, setPrintPending] = useState(false)
  useEffect(() => {
    if (!printPending || !deckStacked) return
    setPrintPending(false)
    window.print()
  }, [printPending, deckStacked])

  const newestFirst = orderedTerms(db.terms).reverse()
  const activeTerm = db.terms.find((term) => term.is_active) ?? newestFirst[0]

  const [termId, setTermId] = useState(activeTerm?._id ?? '')
  const [classId, setClassId] = useState('all')
  const [subjectId, setSubjectId] = useState('all')

  // Null for the registrar, for guests and for staff granted the whole-school
  // read permission; otherwise the teacher's assigned subjects.
  const allowedSubjectIds = subjectScope

  const classes = useMemo(
    () =>
      [...db.classes].sort(
        (a, b) => a.class_name.localeCompare(b.class_name, undefined, { numeric: true }) || a.stream_name.localeCompare(b.stream_name),
      ),
    [db.classes],
  )

  // Only subjects that were actually examined this term, so a filter can never
  // silently empty the page for a subject the term never sat.
  const subjectOptions = useMemo(() => {
    const examined = new Set(
      db.exams
        .filter((exam) => exam.term_id === termId && (!allowedSubjectIds || allowedSubjectIds.includes(exam.subject_id)))
        .map((exam) => exam.subject_id),
    )
    return db.subjects
      .filter((subject) => examined.has(subject._id))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [db.exams, db.subjects, termId, allowedSubjectIds])

  const effectiveTermId = db.terms.some((term) => term._id === termId) ? termId : activeTerm?._id ?? ''
  const effectiveClassId = classId === 'all' || classes.some((cls) => cls._id === classId) ? classId : 'all'
  const effectiveSubjectId =
    subjectId === 'all' || subjectOptions.some((subject) => subject._id === subjectId) ? subjectId : 'all'

  const analysis = useMemo(
    () =>
      buildAnalysis({
        db,
        bands: scale.bands,
        passMark: scale.pass_mark,
        termId: effectiveTermId,
        classId: effectiveClassId,
        subjectId: effectiveSubjectId,
        allowedSubjectIds,
      }),
    [db, scale, effectiveTermId, effectiveClassId, effectiveSubjectId, allowedSubjectIds],
  )

  // The deck follows the class and subject filters — what is being reported on —
  // and not the term selector, because a deck is a term-on-term comparison.
  const deck = useMemo(
    () =>
      buildDeck({
        db,
        bands: scale.bands,
        passMark: scale.pass_mark,
        classId: effectiveClassId,
        subjectId: effectiveSubjectId,
        allowedSubjectIds,
      }),
    [db, scale, effectiveClassId, effectiveSubjectId, allowedSubjectIds],
  )

  const setDeckStacked = (next: boolean) =>
    setParams(
      (current) => {
        const updated = new URLSearchParams(current)
        if (next) updated.set('deck', 'print')
        else updated.delete('deck')
        return updated
      },
      { replace: true },
    )

  function printDeck() {
    // Switching to the stack re-renders first, so the print call has to wait for
    // the slide-per-page layout to be in the DOM.
    if (!deckStacked) {
      setPrintPending(true)
      setDeckStacked(true)
      return
    }
    window.print()
  }

  const filtered = effectiveClassId !== 'all' || effectiveSubjectId !== 'all'
  const scopeLine = `${termLabel(analysis.term)} · ${analysis.scope.className} · ${analysis.scope.subjectName}`
  const hasMarks = analysis.graded > 0
  const previousTermName = analysis.previousTerm?.name ?? 'prior term'

  const exportCsv = () => {
    const filename = `analytics-${fileSlug(termLabel(analysis.term))}-${fileSlug(analysis.scope.className)}-${fileSlug(
      analysis.scope.subjectName,
    )}.csv`
    downloadCsv(filename, analysisCsv(analysis, school.name))
  }

  const submissionTone = (entered: number, expected: number): { label: string; tone: Tone } => {
    if (expected === 0) return { label: 'No papers', tone: 'neutral' }
    if (entered >= expected) return { label: 'Complete', tone: 'ok' }
    if (entered === 0) return { label: 'Not started', tone: 'danger' }
    return { label: 'In progress', tone: 'brass' }
  }

  return (
    <>
      <PageHeader
        title="Academic Analytics"
        subtitle="Comprehensive performance metrics, grade distributions, and term insights."
        meta={
          <>
            <span>{scopeLine}</span>
            <span>
              {analysis.scope.examCount} {analysis.scope.examCount === 1 ? 'paper' : 'papers'} ·{' '}
              {analysis.scope.studentCount} students
            </span>
            <span>Pass mark {scale.pass_mark}%</span>
          </>
        }
        actions={
          <>
            <button type="button" className="btn btn-sm" onClick={exportCsv} data-action="export-csv">
              <Download size={13} /> Export CSV Analytics
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()} data-action="download-pdf">
              <FileText size={13} /> Download PDF Report
            </button>
          </>
        }
      />

      <div className="no-print">
        {/* ── filters: right-aligned on wide screens, stacked on phones ── */}
        <div className="card mb-4 p-3">
          <div className="flex flex-wrap items-end gap-2 md:justify-between">
            <p className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink/45">
              <SlidersHorizontal size={13} /> Filters
            </p>
            <div className="grid w-full grid-cols-2 items-end gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
              <label className="col-span-2 min-w-0 sm:col-span-1 sm:flex-none">
                <span className="field-label">Term</span>
                <select
                  className="select-field w-full sm:w-[210px]"
                  value={effectiveTermId}
                  onChange={(event) => {
                    setTermId(event.target.value)
                    // A subject examined last term may not have a paper this term.
                    setSubjectId('all')
                  }}
                  data-filter="term"
                >
                  {newestFirst.map((term) => (
                    <option key={term._id} value={term._id}>
                      {term.name} {term.academic_year}
                    </option>
                  ))}
                </select>
              </label>
              <label className="min-w-0 sm:flex-none">
                <span className="field-label">Class / stream</span>
                <select
                  className="select-field w-full sm:w-[190px]"
                  value={effectiveClassId}
                  onChange={(event) => setClassId(event.target.value)}
                  data-filter="class"
                >
                  <option value="all">All Classes</option>
                  {classes.map((cls) => (
                    <option key={cls._id} value={cls._id}>
                      {classLabel(cls)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="min-w-0 sm:flex-none">
                <span className="field-label">Subject</span>
                <select
                  className="select-field w-full sm:w-[200px]"
                  value={effectiveSubjectId}
                  onChange={(event) => setSubjectId(event.target.value)}
                  data-filter="subject"
                >
                  <option value="all">All Subjects</option>
                  {subjectOptions.map((subject) => (
                    <option key={subject._id} value={subject._id}>
                      {/* The code disambiguates the same title at two levels
                          (Mathematics 0580 and 9709). */}
                      {subject.name} · {subject.code}
                    </option>
                  ))}
                </select>
              </label>
              {filtered ? (
                <button
                  type="button"
                  className="btn btn-sm col-span-2 sm:col-span-1"
                  onClick={() => {
                    setClassId('all')
                    setSubjectId('all')
                  }}
                >
                  Reset
                </button>
              ) : null}
            </div>
          </div>
          {allowedSubjectIds ? (
            <p className="mt-2 text-[11.5px] text-ink/45">
              Scoped to your assigned subjects — {db.subjects.filter((subject) => allowedSubjectIds.includes(subject._id)).map((subject) => subject.name).join(', ') || 'none assigned'}.
              {analysis.term !== db.terms.find((term) => term.is_active) ? ' Historical term: results are read-only.' : ''}
            </p>
          ) : null}
        </div>

        {/* ── KPI row ─────────────────────────────────────────────────── */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            name="average"
            label="Campus average score"
            value={analysis.average === null ? '—' : `${round(analysis.average)}%`}
            icon={TrendingUp}
            tone="crimson"
            badge={<DeltaBadge value={analysis.delta} termName={previousTermName} />}
            hint={
              analysis.delta === null
                ? analysis.previousTerm
                  ? `No subject was examined in both ${analysis.term?.name ?? 'this term'} and ${previousTermName}.`
                  : 'First recorded term — no earlier results to compare.'
                : `${analysis.deltaSubjects} ${
                    analysis.deltaSubjects === 1 ? 'subject' : 'subjects'
                  } also examined in ${previousTermName}.`
            }
          />
          <Metric
            name="completion"
            label="Exam completion rate"
            value={`${Math.round(analysis.completion.rate)}%`}
            icon={ClipboardList}
            tone="ink"
            badge={
              <span className="inline-flex items-center gap-1 rounded border border-rule bg-sunken px-1.5 py-0.5 text-[10.5px] font-semibold text-ink/55">
                {analysis.completion.completePapers}/{analysis.completion.papers} papers
              </span>
            }
            hint={`${analysis.completion.entered} of ${analysis.completion.expected} marks entered${
              analysis.completion.expected > analysis.completion.entered
                ? ` · ${analysis.completion.expected - analysis.completion.entered} outstanding`
                : ''
            }`}
          />
          <Metric
            name="top-subject"
            label="Top performing subject"
            value={analysis.topSubject ? analysis.topSubject.name : '—'}
            valueClassName="text-[19px] leading-tight"
            icon={BookOpen}
            tone="brass"
            badge={
              analysis.topSubject ? (
                <span className="inline-flex items-center rounded border border-brass/40 bg-brass/12 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-brass-deep">
                  {round(analysis.topSubject.average ?? 0)}%
                </span>
              ) : null
            }
            hint={
              analysis.topSubject
                ? `${analysis.topSubject.papers} ${
                    analysis.topSubject.papers === 1 ? 'paper' : 'papers'
                  } · ${analysis.topSubject.entries} marks · ${analysis.topSubject.code}`
                : 'No marks in this scope yet.'
            }
          />
          <Metric
            name="at-risk"
            label="At-risk students"
            value={analysis.atRisk.count}
            icon={ShieldAlert}
            tone="danger"
            badge={
              <span
                className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10.5px] font-semibold ${
                  analysis.atRisk.count > 0
                    ? 'border-danger/25 bg-danger/8 text-danger'
                    : 'border-ok/25 bg-ok/8 text-ok'
                }`}
              >
                {analysis.atRisk.count > 0 ? 'Intervention' : 'On track'}
              </span>
            }
            hint={`${
              analysis.atRisk.count === 1 ? 'Student' : 'Students'
            } averaging below the ${scale.pass_mark}% pass mark${
              analysis.atRisk.count > 0
                ? // Full names: a school this size has more than one Amina, and
                  // two first names in a row would read like a double count.
                  ` · ${analysis.atRisk.students
                    .slice(0, 2)
                    .map((student) => student.name)
                    .join(', ')}${analysis.atRisk.count > 2 ? ` +${analysis.atRisk.count - 2}` : ''}`
                : ''
            }`}
          />
        </div>

        {/* ── modules A + B ───────────────────────────────────────────── */}
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <section className="card flex flex-col p-4" data-module="distribution">
            <div className="flex items-baseline justify-between gap-2 border-b border-rule pb-2">
              <h2 className="text-[13px] font-semibold">Grade distribution</h2>
              <span className="micro">{analysis.graded} graded</span>
            </div>
            <p className="mt-2 text-[11.5px] leading-snug text-ink/45">
              Student averages placed on the {scale.name} bands.
            </p>
            <div className="mt-3 flex-1 space-y-1.5">
              {analysis.distribution.map((slice) => (
                <div
                  key={slice.grade}
                  className="grid grid-cols-[30px_minmax(0,1fr)_78px] items-center gap-2"
                  data-grade={slice.grade}
                >
                  <GradePill grade={slice.grade} size="sm" />
                  <div
                    className="h-2 overflow-hidden rounded-full bg-sunken"
                    role="img"
                    aria-label={`Grade ${slice.grade}: ${slice.count} students`}
                  >
                    <div
                      className={`h-full ${BAR_FILL[gradeTone(slice.grade)] ?? 'bg-ink/25'}`}
                      style={{ width: `${slice.count ? Math.max(slice.share, 2) : 0}%` }}
                    />
                  </div>
                  <span className="figure text-right text-[11px] text-ink/55">
                    <strong className="font-semibold text-ink">{slice.count}</strong>
                    {slice.grade === 'Z' ? ' ungraded' : ` · ${Math.round(slice.share)}%`}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-3 border-t border-rule pt-2 text-[11px] text-ink/45">
              {analysis.graded === 0
                ? 'No student has a numeric mark in this scope yet.'
                : `${analysis.passing} of ${analysis.graded} graded students average ${scale.pass_mark}% or better (${Math.round(
                    (analysis.passing / analysis.graded) * 100,
                  )}%).`}
            </p>
          </section>

          <section className="card flex flex-col p-4" data-module="subjects">
            <div className="flex items-baseline justify-between gap-2 border-b border-rule pb-2">
              <h2 className="text-[13px] font-semibold">Subject performance</h2>
              <span className="micro">{analysis.subjects.length} subjects</span>
            </div>
            {analysis.subjects.length === 0 ? (
              <div className="mt-3 flex-1">
                <EmptyState compact title="No papers in scope" hint="Choose another term, class or subject." />
              </div>
            ) : (
              <div className="mt-3 flex-1 space-y-2.5">
                {analysis.subjects.map((subject) => (
                  <div key={subject.subjectId} data-subject={subject.subjectId}>
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="min-w-0 truncate text-[12px] font-medium" title={`${subject.name} · ${subject.code}`}>
                        {subject.name}
                        <span className="ml-1.5 font-mono text-[9.5px] font-semibold text-ink/40">{subject.code}</span>
                      </p>
                      <p className="flex shrink-0 items-baseline gap-1.5">
                        {subject.delta !== null ? (
                          <span
                            className={`figure text-[10px] ${
                              subject.delta >= 0 ? 'text-ok' : 'text-danger'
                            }`}
                            title={`${subject.delta >= 0 ? '+' : ''}${round(subject.delta)} points vs ${previousTermName}`}
                          >
                            {subject.delta >= 0 ? '+' : ''}
                            {round(subject.delta)}
                          </span>
                        ) : null}
                        <span className="figure text-[12px] font-semibold text-ink/80">
                          {subject.average === null ? '—' : `${round(subject.average)}%`}
                        </span>
                      </p>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <div
                        className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken"
                        role="img"
                        aria-label={`${subject.name}: ${subject.average === null ? 'no average' : `${round(subject.average)}%`}`}
                      >
                        <div
                          className={`h-full ${subject.average === null ? 'bg-ink/15' : 'bg-crimson'}`}
                          style={{ width: `${subject.average ?? 0}%` }}
                        />
                      </div>
                      <span className="w-[68px] shrink-0 text-right text-[10px] text-ink/40">
                        {subject.entries} marks
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* ── module C ────────────────────────────────────────────────── */}
        <section className="card mt-4 overflow-hidden" data-module="streams">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule px-4 pb-2 pt-4">
            <h2 className="text-[13px] font-semibold">Stream &amp; class comparison</h2>
            <span className="micro">
              All streams · {termLabel(analysis.term)} · {analysis.scope.subjectName}
              {effectiveClassId !== 'all' ? ' · filtered stream highlighted' : ''}
            </span>
          </div>
          {analysis.streams.length === 0 ? (
            <div className="p-4">
              <EmptyState compact title="No streams examined in scope" hint="Papers must be created for a stream before it can be compared." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table w-full sm:min-w-[660px]">
                <thead>
                  <tr>
                    <th scope="col">Stream</th>
                    <th scope="col" className="text-right">
                      Average
                    </th>
                    <th scope="col" className="hidden md:table-cell">
                      Top student
                    </th>
                    <th scope="col" className="w-[150px] sm:w-[190px]">
                      Submission
                    </th>
                    <th scope="col" className="hidden text-right sm:table-cell">
                      At risk
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.streams.map((stream) => {
                    const status = submissionTone(stream.entered, stream.expected)
                    return (
                      <tr
                        key={stream.classId}
                        className={effectiveClassId === stream.classId ? 'bg-brass/10' : undefined}
                        data-stream={stream.classId}
                      >
                        <td>
                          <p className="font-medium">{stream.label}</p>
                          <p className="text-[11px] text-ink/45">
                            {stream.students} {stream.students === 1 ? 'student' : 'students'}
                            {stream.atRisk > 0 ? ` · ${stream.atRisk} at risk` : ''}
                          </p>
                          {stream.topStudent ? (
                            <p className="mt-0.5 truncate text-[11px] text-ink/50 md:hidden">
                              Top: {stream.topStudent.name} · {round(stream.topStudent.average)}%
                            </p>
                          ) : null}
                        </td>
                        <td className="num">
                          <span className="text-[13px] font-semibold">{stream.average === null ? '—' : `${round(stream.average)}%`}</span>
                        </td>
                        <td className="hidden md:table-cell">
                          {stream.topStudent ? (
                            <>
                              <p className="max-w-[190px] truncate text-[12px]">{stream.topStudent.name}</p>
                              <p className="figure text-[10.5px] text-ink/45">{round(stream.topStudent.average)}%</p>
                            </>
                          ) : (
                            <span className="text-[12px] text-ink/35">No marks</span>
                          )}
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <ProgressBar
                              value={stream.entered}
                              total={stream.expected}
                              tone={status.tone === 'ok' ? 'ok' : status.tone === 'danger' ? 'crimson' : 'brass'}
                            />
                            <span className="whitespace-nowrap text-[11px] text-ink/55">
                              {stream.entered}/{stream.expected}
                            </span>
                          </div>
                          <div className="mt-1">
                            <Badge tone={status.tone}>{status.label}</Badge>
                          </div>
                        </td>
                        <td className="num hidden sm:table-cell">
                          {stream.atRisk === 0 ? (
                            <span className="text-ink/30">0</span>
                          ) : (
                            <span className="font-semibold text-danger">{stream.atRisk}</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── insights ────────────────────────────────────────────────── */}
        <section className="card mt-4 border-l-[3px] border-l-crimson p-4" data-module="insights">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-crimson/25 bg-crimson/8 text-crimson">
              <Lightbulb size={15} />
            </span>
            <div className="min-w-0">
              <h2 className="text-[13px] font-semibold">Automated insights</h2>
              <p className="mt-0.5 text-[11px] text-ink/45">Generated from the marks in this scope · updates with the filters</p>
              {analysis.insights.length === 0 ? (
                <p className="mt-3 text-[12.5px] text-ink/50">
                  {hasMarks
                    ? 'There is not enough spread in this scope to draw a comparison yet.'
                    : 'Enter numeric marks for this term to generate insights.'}
                </p>
              ) : (
                <ul className="mt-3 space-y-2.5">
                  {analysis.insights.map((insight) => (
                    <li key={insight.title} className="flex items-start gap-2" data-insight={insight.tone}>
                      <span
                        className={`mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full ${INSIGHT_TONE[insight.tone]}`}
                        aria-hidden="true"
                      />
                      <p className="text-[12.5px] leading-snug text-ink/65">
                        <span className="font-semibold text-ink">{insight.title}.</span> {insight.body}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* ── performance deck: the end-of-term report, as slides ────────── */}
      {deck.hasMarks ? (
        <PerformanceDeck
          model={deck}
          schoolName={school.name}
          stacked={deckStacked}
          onStackedChange={setDeckStacked}
          onPrint={printDeck}
        />
      ) : (
        <section className="screen-only card mt-8 p-4" data-deck="empty">
          <h2 className="text-[15px] font-semibold">Performance deck</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-ink/55">
            The end-of-term slide report is built from marked papers. Once this scope holds numeric marks it appears here,
            with the term-on-term trend, the streams that need attention and the recommended actions.
          </p>
        </section>
      )}

      {/* ── printed report: one A4 portrait sheet ─────────────────────── */}
      <article className="analysis-sheet print-only mx-auto bg-white px-4 py-3 text-[8.5px] text-ink" data-sheet="analysis">
        <header className="flex items-start justify-between gap-4 border-b-2 border-ink pb-1.5">
          <div className="flex items-start gap-3">
            <SchoolLogo school={school} size={34} />
            <div>
              <p className="text-[15px] font-bold uppercase leading-tight tracking-[0.05em]">{school.name}</p>
              <p className="text-[7.5px] leading-snug text-ink/65">{school.address}</p>
              <p className="text-[7.5px] leading-snug text-ink/65">
                {school.postal} · {school.city} · TEL {school.phone_number}
              </p>
              <p className="text-[7.5px] leading-snug text-ink/65">{school.contact_email}</p>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[11px] font-semibold uppercase tracking-[0.05em]">Academic analytics</p>
            <p className="mt-0.5 text-[7.5px] text-ink/60">{scopeLine}</p>
            <p className="text-[7.5px] text-ink/45">Generated {formatDate(new Date().toISOString())}</p>
          </div>
        </header>

        <div className="mt-2 grid grid-cols-4 gap-2">
          {[
            {
              label: 'Campus average',
              value: analysis.average === null ? '—' : `${round(analysis.average)}%`,
              note:
                analysis.delta === null
                  ? 'No shared papers'
                  : `${analysis.delta >= 0 ? '+' : ''}${round(analysis.delta)} pts vs ${previousTermName}`,
            },
            {
              label: 'Completion',
              value: `${Math.round(analysis.completion.rate)}%`,
              note: `${analysis.completion.entered}/${analysis.completion.expected} marks`,
            },
            {
              label: 'Top subject',
              value: analysis.topSubject ? analysis.topSubject.name : '—',
              note: analysis.topSubject ? `${round(analysis.topSubject.average ?? 0)}% average` : 'No marks',
            },
            {
              label: 'At risk',
              value: String(analysis.atRisk.count),
              note: `below ${scale.pass_mark}% pass mark`,
            },
          ].map((metric) => (
            <div key={metric.label} className="border border-ink/25 px-2 py-1.5">
              <p className="text-[6.5px] font-semibold uppercase tracking-[0.1em] text-ink/50">{metric.label}</p>
              <p className={`display-figure mt-0.5 font-semibold text-ink ${metric.label === 'Top subject' ? 'text-[10px] leading-tight' : 'text-[14px]'}`}>
                {metric.value}
              </p>
              <p className="mt-0.5 text-[7px] text-ink/55">{metric.note}</p>
            </div>
          ))}
        </div>

        <div className="mt-2 grid grid-cols-2 gap-4">
          <section>
            <p className="text-[7px] font-semibold uppercase tracking-[0.1em]">Grade distribution</p>
            <table className="mt-1 w-full border-collapse text-[7.5px]">
              <thead>
                <tr>
                  <th className="border border-ink/30 bg-ink/5 px-1 py-0.5 text-left font-semibold">Grade</th>
                  <th className="border border-ink/30 bg-ink/5 px-1 py-0.5 text-right font-semibold">Students</th>
                  <th className="border border-ink/30 bg-ink/5 px-1 py-0.5 text-right font-semibold">Share</th>
                  <th className="border border-ink/30 bg-ink/5 px-1 py-0.5 text-left font-semibold">Spread</th>
                </tr>
              </thead>
              <tbody>
                {analysis.distribution.map((slice) => (
                  <tr key={slice.grade}>
                    <td className="border border-ink/20 px-1 py-[2px] font-semibold">{slice.grade}</td>
                    <td className="border border-ink/20 px-1 py-[2px] text-right font-mono">{slice.count}</td>
                    <td className="border border-ink/20 px-1 py-[2px] text-right font-mono">
                      {slice.grade === 'Z' ? '—' : `${Math.round(slice.share)}%`}
                    </td>
                    <td className="border border-ink/20 px-1 py-[2px]">
                      <div className="h-[3px] w-full bg-ink/10">
                        <div className={`h-full ${BAR_FILL[gradeTone(slice.grade)] ?? 'bg-ink/25'}`} style={{ width: `${slice.share}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-[7px] text-ink/55">
              {analysis.passing} of {analysis.graded} graded students at or above the {scale.pass_mark}% pass mark.
            </p>
          </section>

          <section>
            <p className="text-[7px] font-semibold uppercase tracking-[0.1em]">Subject performance</p>
            <table className="mt-1 w-full border-collapse text-[7.5px]">
              <thead>
                <tr>
                  <th className="border border-ink/30 bg-ink/5 px-1 py-0.5 text-left font-semibold">Subject</th>
                  <th className="border border-ink/30 bg-ink/5 px-1 py-0.5 text-right font-semibold">Avg</th>
                  <th className="border border-ink/30 bg-ink/5 px-1 py-0.5 text-right font-semibold">Marks</th>
                  <th className="border border-ink/30 bg-ink/5 px-1 py-0.5 text-right font-semibold">Change</th>
                </tr>
              </thead>
              <tbody>
                {analysis.subjects.map((subject) => (
                  <tr key={subject.subjectId}>
                    <td className="border border-ink/20 px-1 py-[2px]">
                      {subject.name} <span className="font-mono text-[6.5px] text-ink/45">{subject.code}</span>
                    </td>
                    <td className="border border-ink/20 px-1 py-[2px] text-right font-mono">
                      {subject.average === null ? '—' : round(subject.average)}
                    </td>
                    <td className="border border-ink/20 px-1 py-[2px] text-right font-mono">{subject.entries}</td>
                    <td className="border border-ink/20 px-1 py-[2px] text-right font-mono">
                      {subject.delta === null ? '—' : `${subject.delta >= 0 ? '+' : ''}${round(subject.delta)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>

        <section className="mt-2">
          <p className="text-[7px] font-semibold uppercase tracking-[0.1em]">Stream &amp; class comparison</p>
          <table className="mt-1 w-full border-collapse text-[7.5px]">
            <thead>
              <tr>
                <th className="border border-ink/30 bg-ink/5 px-1 py-0.5 text-left font-semibold">Stream</th>
                <th className="border border-ink/30 bg-ink/5 px-1 py-0.5 text-right font-semibold">Students</th>
                <th className="border border-ink/30 bg-ink/5 px-1 py-0.5 text-right font-semibold">Average</th>
                <th className="border border-ink/30 bg-ink/5 px-1 py-0.5 text-left font-semibold">Top student</th>
                <th className="border border-ink/30 bg-ink/5 px-1 py-0.5 text-right font-semibold">Marks</th>
                <th className="border border-ink/30 bg-ink/5 px-1 py-0.5 text-right font-semibold">Completion</th>
                <th className="border border-ink/30 bg-ink/5 px-1 py-0.5 text-right font-semibold">At risk</th>
              </tr>
            </thead>
            <tbody>
              {analysis.streams.map((stream) => (
                <tr key={stream.classId}>
                  <td className="border border-ink/20 px-1 py-[2px] font-medium">{stream.label}</td>
                  <td className="border border-ink/20 px-1 py-[2px] text-right font-mono">{stream.students}</td>
                  <td className="border border-ink/20 px-1 py-[2px] text-right font-mono">
                    {stream.average === null ? '—' : round(stream.average)}
                  </td>
                  <td className="border border-ink/20 px-1 py-[2px]">
                    {stream.topStudent ? `${stream.topStudent.name} (${round(stream.topStudent.average)}%)` : '—'}
                  </td>
                  <td className="border border-ink/20 px-1 py-[2px] text-right font-mono">
                    {stream.entered}/{stream.expected}
                  </td>
                  <td className="border border-ink/20 px-1 py-[2px] text-right font-mono">{round(stream.completion)}%</td>
                  <td className="border border-ink/20 px-1 py-[2px] text-right font-mono">{stream.atRisk}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="mt-2 border-l-2 border-crimson pl-2">
          <p className="text-[7px] font-semibold uppercase tracking-[0.1em]">Insights</p>
          {analysis.insights.length === 0 ? (
            <p className="mt-0.5 text-[7.5px] text-ink/55">No insights for this scope.</p>
          ) : (
            <ul className="mt-0.5 space-y-0.5 text-[7.5px] leading-snug">
              {analysis.insights.map((insight) => (
                <li key={insight.title}>
                  <strong>{insight.title}.</strong> {insight.body}
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="mt-2 flex items-center justify-between gap-3 border-t border-ink/25 pt-1 text-[6.5px] uppercase tracking-[0.06em] text-ink/55">
          <span>
            Scale {scale.name} · pass mark {scale.pass_mark}% · {analysis.scope.examCount} papers · {analysis.graded} graded
          </span>
          <span>IUPC Academy · Academic analytics</span>
        </footer>
      </article>
    </>
  )
}
