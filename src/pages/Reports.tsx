import { useMemo, useState } from 'react'
import { Download, Printer } from 'lucide-react'
import { useDb } from '../data/db'
import { useSession } from '../session'
import { Badge, EmptyState, PageHeader, SchoolLogo } from '../components/ui'
import { buildBroadsheet, downloadCsv, stdDev, toCsv } from '../lib/analytics'
import { bandFor, gradeFor, resolveScale } from '../lib/grading'
import { formatDate, fileSlug, round } from '../lib/format'
import { usePrintPage } from '../lib/print'
import type { ScoreValue } from '../lib/analytics'

export default function Reports() {
  const db = useDb()
  const { session, subjectScope } = useSession()
  const scale = resolveScale(db.gradingScales)
  const school = db.schools[0]
  const activeTerm = db.terms.find((term) => term.is_active) ?? db.terms[0]
  usePrintPage('broadsheet')

  // Numeric, so the picker reads Year 7, 8 … 13 rather than alphabetically.
  const classNames = [...new Set(db.classes.map((c) => c.class_name))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const [className, setClassName] = useState(classNames[0] ?? '')
  const [streamFilter, setStreamFilter] = useState('all')
  const [demographic, setDemographic] = useState<'Both' | 'Boys' | 'Girls'>('Both')

  const streams = db.classes.filter((c) => c.class_name === className)
  const selectedClasses = streams.filter((c) => (streamFilter === 'all' ? true : c._id === streamFilter))
  const classIds = selectedClasses.map((c) => c._id)

  const students = db.students
    .filter((student) => classIds.includes(student.class_id) && student.status === 'Active')
    .filter((student) => (demographic === 'Boys' ? student.gender === 'Male' : demographic === 'Girls' ? student.gender === 'Female' : true))

  const exams = db.exams
    .filter((exam) => exam.term_id === activeTerm?._id && classIds.includes(exam.class_id))
    .filter((exam) => !subjectScope || subjectScope.includes(exam.subject_id))
    .sort((a, b) => a.exam_date.localeCompare(b.exam_date))

  const examIds = exams.map((exam) => exam._id)
  const marks = db.marks.filter((mark) => examIds.includes(mark.exam_id))

  const sheet = useMemo(
    () =>
      buildBroadsheet({
        students,
        exams,
        marks,
        bands: scale.bands,
        subjectCode: (subjectId) => db.subjects.find((s) => s._id === subjectId)?.code ?? '—',
        classCode: (id) => {
          const stream = db.classes.find((c) => c._id === id)
          if (!stream) return ''
          const form = stream.class_name.match(/\d+/)?.[0] ?? stream.class_name
          return `${form}${stream.stream_name}`
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [students, exams, marks, scale, db.subjects],
  )

  const scopeLabel = streamFilter === 'all' ? className : `${className} ${selectedClasses[0]?.stream_name ?? ''}`
  const heading =
    exams.length === 1
      ? `${exams[0].exam_name} Results — ${scopeLabel}`
      : `End-term results — ${scopeLabel} ${activeTerm?.name ?? ''}, ${activeTerm?.academic_year ?? ''}`

  const totalsAverage = sheet.summary.reduce((sum, row) => sum + (row.average ?? 0), 0)
  const passing = sheet.rows.filter((row) => row.mean !== null && row.mean >= scale.pass_mark).length
  const passRate = sheet.rows.length ? (passing / sheet.rows.length) * 100 : 0

  const exportCsv = () => {
    const filename = `broadsheet-${fileSlug(className)}-${fileSlug(activeTerm?.name ?? 'term')}.csv`
    downloadCsv(filename, toCsv(sheet))
  }

  const cell = (value: ScoreValue, maxScore: number) => {
    if (value === null || value === undefined) return <span className="text-ink/35">==</span>
    if (typeof value !== 'number') return <span className="font-semibold">{value}</span>
    const percentage = (value / maxScore) * 100
    return (
      <span className="font-mono">
        {round(percentage)}
        <span className="text-ink/45">-</span>
        <span className="font-semibold">{gradeFor(percentage, scale.bands)}</span>
      </span>
    )
  }

  return (
    <>
      <PageHeader
        title="Broadsheets"
        subtitle="The term's results sheet and subject analysis for a cohort"
        meta={
          <>
            <span>{scopeLabel}</span>
            <span>{activeTerm?.name} {activeTerm?.academic_year}</span>
            <span>{students.length} students · {exams.length} papers</span>
          </>
        }
        actions={
          <>
            <button type="button" className="btn btn-sm" onClick={exportCsv} disabled={!sheet.rows.length}>
              <Download size={13} /> Export to Excel
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()} disabled={!sheet.rows.length}>
              <Printer size={13} /> Print / PDF
            </button>
          </>
        }
      />

      <div className="card mb-4 flex flex-wrap items-end gap-2 p-3 no-print">
        <label>
          <span className="field-label">Class</span>
          <select className="select-field w-[150px]" value={className} onChange={(event) => setClassName(event.target.value)}>
            {classNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">Stream</span>
          <select className="select-field w-[170px]" value={streamFilter} onChange={(event) => setStreamFilter(event.target.value)}>
            <option value="all">Check all streams</option>
            {streams.map((stream) => (
              <option key={stream._id} value={stream._id}>
                {stream.class_name} {stream.stream_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">Demographic</span>
          <select
            className="select-field w-[150px]"
            value={demographic}
            onChange={(event) => setDemographic(event.target.value as typeof demographic)}
          >
            <option value="Both">Both</option>
            <option value="Boys">Boys only</option>
            <option value="Girls">Girls only</option>
          </select>
        </label>
        {session?.role === 'teacher' ? (
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <Badge tone="neutral">Teacher view · read-only</Badge>
            <span className="text-[11px] text-ink/45">
              {subjectScope
                ? `${subjectScope.length} subject${subjectScope.length === 1 ? '' : 's'} in view — marks are entered on the Exams page, never on a broadsheet.`
                : 'Every subject in view — marks are entered on the Exams page, never on a broadsheet.'}
            </span>
          </span>
        ) : null}
      </div>

      {sheet.rows.length === 0 ? (
        <EmptyState title="No results in scope" hint="Choose a class with exams and entered marks for this term." />
      ) : (
        <div className="overflow-x-auto print:overflow-visible">
          {/* ── page 1: the results sheet ─────────────────────────────── */}
          <article className="sheet sheet-broadsheet sheet-broadsheet--matrix print-page card px-5 py-4 text-[9px] page-break">
            <header className="flex items-start justify-between gap-4 border-b-2 border-ink pb-2">
              <div className="flex items-start gap-3">
                <SchoolLogo school={school} size={40} />
                <div>
                  <p className="text-[17px] font-bold uppercase leading-tight tracking-[0.05em]">{school.name}</p>
                  <p className="text-[8px] leading-snug text-ink/65">{school.address}</p>
                  <p className="text-[8px] leading-snug text-ink/65">
                    {school.postal} · {school.city}
                  </p>
                  <p className="text-[8px] leading-snug text-ink/65">TEL {school.phone_number}</p>
                  <p className="text-[8px] leading-snug text-ink/65">{school.contact_email}</p>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[11.5px] font-semibold uppercase leading-tight tracking-[0.02em]">{heading}</p>
                <p className="mt-0.5 text-[7.5px] text-ink/55">
                  {students.length} candidates · {exams.length} papers · printed {formatDate(new Date().toISOString())} · page 1 of 2
                </p>
              </div>
            </header>

            <table className="mt-2 w-full table-fixed border-collapse text-[8.5px]">
              <colgroup>
                <col style={{ width: '5%' }} />
                <col style={{ width: '25%' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '4%' }} />
                <col style={{ width: '5.5%' }} />
                <col style={{ width: '5%' }} />
                <col style={{ width: '4.5%' }} />
                <col style={{ width: '4.5%' }} />
                {sheet.columns.map((column) => (
                  <col key={column.examId} style={{ width: `${37.5 / Math.max(sheet.columns.length, 1)}%` }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {['Rank', 'Name of student', 'Adm', 'MC', 'Score', 'Avg', 'SD', 'Comp'].map((label) => (
                    <th
                      key={label}
                      className="whitespace-nowrap border border-ink/40 bg-ink px-1 py-1 text-left text-[7px] font-semibold uppercase tracking-[0.04em] text-white"
                    >
                      {label}
                    </th>
                  ))}
                  {sheet.columns.map((column) => (
                    <th
                      key={column.examId}
                      className="border border-ink/40 bg-ink px-0.5 py-1 text-center text-[7px] font-semibold uppercase leading-tight text-white"
                    >
                      {column.subjectCode}
                      <span className="block truncate font-mono text-[6.5px] font-normal text-white/55">
                        {column.classCode} {column.examName}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sheet.rows.map((row) => {
                  const values = Object.values(row.cells).filter((value): value is number => typeof value === 'number')
                  const sd = stdDev(values)
                  return (
                    <tr key={row.studentId}>
                      <td className="border border-ink/25 px-[3px] py-[2px] text-center font-mono">{row.rank ?? '—'}</td>
                      <td className="border border-ink/25 px-[4px] py-[2px] font-medium uppercase leading-tight">
                        {row.name}
                      </td>
                      <td className="border border-ink/25 px-[3px] py-[2px] font-mono text-[7.5px] text-ink/70">
                        {row.admission.replace('IUPC/', '')}
                      </td>
                      <td className="border border-ink/25 px-[2px] py-[2px] text-center font-semibold">{row.grade}</td>
                      <td className="border border-ink/25 px-[3px] py-[2px] text-right font-mono">{round(row.total)}</td>
                      <td className="border border-ink/25 px-[3px] py-[2px] text-right font-mono">
                        {row.mean === null ? '—' : round(row.mean)}
                      </td>
                      <td className="border border-ink/25 px-[3px] py-[2px] text-right font-mono text-ink/70">
                        {sd === null ? '—' : round(sd)}
                      </td>
                      <td className="border border-ink/25 px-[3px] py-[2px] text-center font-mono text-ink/70">
                        {row.completed}/{sheet.columns.length}
                      </td>
                      {sheet.columns.map((column) => (
                        <td key={column.examId} className="border border-ink/25 px-[2px] py-[2px] text-center">
                          {cell(row.cells[column.examId], column.maxScore)}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>

            <div className="mt-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-1 border-t border-ink/25 pt-1.5 text-[7.5px] uppercase tracking-[0.04em] text-ink/65">
              <p>
                <strong className="text-ink">Key</strong> · X absent · Y irregularity · Z not graded · == subject not
                taken
              </p>
              <p className="text-right">
                Mean score <strong className="text-ink">{round(sheet.overall.meanScore ?? 0)}</strong> · mean point{' '}
                <strong className="text-ink">{sheet.overall.meanPoints === null ? '—' : round(sheet.overall.meanPoints)}</strong>{' '}
                · mean grade <strong className="text-ink">{sheet.overall.meanGrade}</strong>
              </p>
            </div>
          </article>

          {/* ── page 2: subject analysis ──────────────────────────────── */}
          <article className="sheet sheet-broadsheet sheet-broadsheet--analysis print-page card px-5 py-4 text-[9px]">
            <header className="flex items-start justify-between gap-4 border-b-2 border-ink pb-2">
              <div className="flex items-start gap-3">
                <SchoolLogo school={school} size={40} />
                <div>
                  <p className="text-[17px] font-bold uppercase leading-tight tracking-[0.05em]">{school.name}</p>
                  <p className="text-[8px] leading-snug text-ink/65">{school.address}</p>
                  <p className="text-[8px] leading-snug text-ink/65">
                    {school.postal} · {school.city}
                  </p>
                  <p className="text-[8px] leading-snug text-ink/65">TEL {school.phone_number}</p>
                  <p className="text-[8px] leading-snug text-ink/65">{school.contact_email}</p>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[11.5px] font-semibold uppercase leading-tight tracking-[0.02em]">
                  Subject analysis — {scopeLabel} {activeTerm?.name}, {activeTerm?.academic_year}
                </p>
                <p className="mt-0.5 text-[7.5px] text-ink/55">
                  {exams.length} papers · printed {formatDate(new Date().toISOString())} · page 2 of 2
                </p>
              </div>
            </header>

            <table className="mt-2 w-full table-fixed border-collapse text-[8.5px]">
              <colgroup>
                <col style={{ width: '22%' }} />
                {sheet.columns.map((column) => (
                  <col key={column.examId} style={{ width: `${78 / Math.max(sheet.columns.length, 1)}%` }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th className="border border-ink/40 bg-ink px-1 py-1 text-left text-[7.5px] font-semibold uppercase tracking-[0.06em] text-white">
                    Subject
                  </th>
                  {sheet.columns.map((column) => (
                    <th
                      key={column.examId}
                      className="border border-ink/40 bg-ink px-1 py-1 text-center text-[7px] font-semibold uppercase leading-tight text-white"
                    >
                      {column.subjectCode}
                      <span className="block truncate font-mono text-[6.5px] font-normal text-white/55">
                        {column.classCode} {column.examName}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ['Grade', (index: number) => sheet.summary[index].grade],
                  ['Average', (index: number) => (sheet.summary[index].average === null ? '—' : round(sheet.summary[index].average as number))],
                  ['Entry', (index: number) => sheet.summary[index].entries],
                  ['Highest', (index: number) => (sheet.summary[index].highest === null ? '—' : round(sheet.summary[index].highest as number))],
                  ['Lowest', (index: number) => (sheet.summary[index].lowest === null ? '—' : round(sheet.summary[index].lowest as number))],
                ].map(([label, read]) => (
                  <tr key={label as string}>
                    <th
                      scope="row"
                      className="border border-ink/25 bg-ink/5 px-1 py-[3px] text-left text-[7.5px] font-semibold uppercase tracking-[0.06em]"
                    >
                      {label as string}
                    </th>
                    {sheet.columns.map((column, index) => (
                      <td key={column.examId} className="border border-ink/25 px-1 py-[3px] text-center font-mono">
                        {(read as (index: number) => string | number)(index)}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <th
                    scope="row"
                    className="border border-ink/25 bg-ink/5 px-1 py-[3px] text-left text-[7.5px] font-semibold uppercase tracking-[0.06em]"
                  >
                    Mean points
                  </th>
                  {sheet.columns.map((column, index) => {
                    const average = sheet.summary[index].average
                    return (
                      <td key={column.examId} className="border border-ink/25 px-1 py-[3px] text-center font-mono">
                        {average === null ? '—' : bandFor(average, scale.bands).points}
                      </td>
                    )
                  })}
                </tr>
              </tbody>
            </table>

            <div className="mt-2 grid grid-cols-2 gap-4 border-t border-ink/25 pt-1.5 text-[8px] uppercase tracking-[0.05em] text-ink/70">
              <div className="space-y-0.5">
                <p>
                  Mean score: <strong className="text-ink">{round(sheet.overall.meanScore ?? 0)}</strong>
                </p>
                <p>
                  Mean point: <strong className="text-ink">{sheet.overall.meanPoints === null ? '—' : round(sheet.overall.meanPoints)}</strong>
                </p>
                <p>
                  Mean grade: <strong className="text-ink">{sheet.overall.meanGrade}</strong>
                </p>
                <p>
                  Tot avg: <strong className="text-ink">{round(totalsAverage)}</strong>
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-[7px] font-semibold tracking-[0.1em]">Grade points</p>
                <p className="flex flex-wrap gap-x-2 gap-y-0.5 text-[7.5px] normal-case tracking-normal">
                  {[...scale.bands]
                    .sort((a, b) => b.min_score - a.min_score)
                    .map((band) => (
                      <span key={band.grade}>
                        <strong>{band.grade}</strong> — {band.points}
                      </span>
                    ))}
                  <span>
                    <strong>Z</strong> — not graded
                  </span>
                </p>
                <p className="text-[7.5px] normal-case tracking-normal text-ink/60">
                  Averages and totals are percentages of the paper maximum. Positions are computed on the mean; ties
                  share a rank.
                </p>
              </div>
            </div>

            <section className="mt-3 border-t border-ink/25 pt-2">
              <div className="flex items-baseline justify-between">
                <p className="text-[7px] font-semibold uppercase tracking-[0.1em]">Grade distribution</p>
                <p className="text-[7px] uppercase tracking-[0.06em] text-ink/60">
                  Pass mark {scale.pass_mark}% · {passing} of {sheet.rows.length} at or above · {round(passRate)}%
                </p>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-[8px]">
                {sheet.distribution.map((entry) => (
                  <span key={entry.grade} className="inline-flex items-baseline gap-1">
                    <span className="font-semibold">{entry.grade}</span>
                    <span className="font-mono text-ink/70">{entry.count}</span>
                    <span className="text-ink/35">·</span>
                    <span className="font-mono text-[7px] text-ink/45">
                      {sheet.rows.length ? round((entry.count / sheet.rows.length) * 100) : 0}%
                    </span>
                  </span>
                ))}
              </div>
            </section>

            <div className="signoff mt-8 flex justify-between gap-10 text-[7.5px] uppercase tracking-[0.06em] text-ink/65">
              <div className="w-[38%] border-t border-ink/40 pt-1">Class teacher · signature &amp; date</div>
              <div className="w-[38%] border-t border-ink/40 pt-1">Principal · signature &amp; date</div>
            </div>
          </article>
        </div>
      )}
    </>
  )
}
