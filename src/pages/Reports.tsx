import { useMemo, useState } from 'react'
import { Download, Printer } from 'lucide-react'
import { useDb } from '../data/db'
import { isOperationalStudent } from '../data/student-lifecycle'
import { useSession } from '../session'
import { Badge, EmptyState, PageHeader } from '../components/ui'
import { BroadsheetHeader } from '../components/BroadsheetHeader'
import { downloadCsv, stdDev } from '../lib/analytics'
import { buildCompactBroadsheet, toCompactCsv, type BroadsheetAssessment } from '../lib/compact-broadsheet'
import { bandFor, gradeFor, resolveScale } from '../lib/grading'
import { formatDate, fileSlug } from '../lib/format'
import { formatBroadsheetNumber as round, RESULTS_KEY } from '../lib/broadsheet-presentation'
import { usePrintPage } from '../lib/print'
import type { BroadsheetRow } from '../lib/analytics'

export default function Reports() {
  const db = useDb()
  const { session, subjectScope } = useSession()
  const scale = resolveScale(db.gradingScales)
  const school = db.schools[0] ?? { _id: 'school-unconfigured', name: 'IUPC Academy', code: '', address: '', postal: '', city: '', contact_email: '', phone_number: '', logo_url: null, crest_url: null, motto: '' }
  const activeTerms = db.terms.filter((term) => term.is_active)
  const activeTerm = activeTerms.length === 1 ? activeTerms[0] : undefined

  // Numeric, so the picker reads Year 7, 8 … 13 rather than alphabetically.
  const classNames = [...new Set(db.classes.map((c) => c.class_name))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const [className, setClassName] = useState(classNames[0] ?? '')
  const [streamFilter, setStreamFilter] = useState('all')
  const [demographic, setDemographic] = useState<'Both' | 'Boys' | 'Girls'>('Both')
  const [assessment, setAssessment] = useState<BroadsheetAssessment>('all')

  const streams = db.classes.filter((c) => c.class_name === className)
  const selectedClasses = streams.filter((c) => (streamFilter === 'all' ? true : c._id === streamFilter))
  const classIds = selectedClasses.map((c) => c._id)

  const students = db.students
    .filter((student) => classIds.includes(student.class_id) && isOperationalStudent(student))
    .filter((student) => (demographic === 'Boys' ? student.gender === 'Male' : demographic === 'Girls' ? student.gender === 'Female' : true))

  const availableExams = db.exams
    .filter((exam) => exam.term_id === activeTerm?._id && classIds.includes(exam.class_id))
    .filter((exam) => !subjectScope || subjectScope.includes(exam.subject_id))
    .sort((a, b) => a.exam_date.localeCompare(b.exam_date))
  const selectedAssessment = assessment
  const assessmentLabel = selectedAssessment === 'all' ? 'Combined' : selectedAssessment === 'Endterm' ? 'End Term' : selectedAssessment
  const exams = availableExams.filter(exam => selectedAssessment === 'all' || exam.exam_type === selectedAssessment)

  const examIds = exams.map((exam) => exam._id)
  const activeStudentIds = new Set(students.map((student) => student._id))
  const marks = db.marks.filter((mark) => examIds.includes(mark.exam_id) && activeStudentIds.has(mark.student_id))

  const sheet = useMemo(
    () =>
      buildCompactBroadsheet({
        students,
        exams: availableExams,
        marks,
        assessment: selectedAssessment,
        subjectScope,
        bands: scale.bands,
        // Enrollment scopes are tied to the same unique active term displayed by this sheet.
        completionScopeComplete: true,
        assessmentTermId: activeTerm?._id ?? null,
        subjectCode: (subjectId) => db.subjects.find((s) => s._id === subjectId)?.code ?? '—',
        classCode: (id) => {
          const stream = db.classes.find((c) => c._id === id)
          if (!stream) return ''
          const form = stream.class_name.match(/\d+/)?.[0] ?? stream.class_name
          return `${form}${stream.stream_name}`
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [students, availableExams, marks, selectedAssessment, scale, db.subjects, session?.role, subjectScope, activeTerm?._id],
  )

  const nameWidth = Math.max(230, ...students.map(student => student.full_name.length * 7.5 + 12))
  const admissionWidth = Math.max(100, ...students.map(student => student.admission_number.length * 7 + 12))
  const columnWidths = [30, nameWidth, admissionWidth, 32, 56, 52, 42, 48]
  const tableWidth = columnWidths.reduce((sum, width) => sum + width, 0) + sheet.columns.length * 54
  const documentWidth = tableWidth + 40
  const wide = documentWidth > 1062
  usePrintPage(wide ? 'broadsheet-wide' : 'broadsheet')

  const scopeLabel = streamFilter === 'all' ? className : `${className} ${selectedClasses[0]?.stream_name ?? ''}`
  const heading =
    `${assessmentLabel} results — ${scopeLabel} ${activeTerm?.name ?? ''}, ${activeTerm?.academic_year ?? ''}`

  const totalsAverage = sheet.summary.reduce((sum, row) => sum + (row.average ?? 0), 0)
  const passing = sheet.completedRows.filter((row) => row.mean !== null && row.mean >= scale.pass_mark).length
  const passRate = sheet.completedRows.length ? (passing / sheet.completedRows.length) * 100 : 0
  const subjectLegend = sheet.columns.map(column => ({ code: column.subjectCode,
    name: db.subjects.find(subject => `subject:${subject._id}` === column.examId)?.name ?? 'Name unavailable',
  }))

  const exportCsv = () => {
    const filename = `broadsheet-${fileSlug(scopeLabel)}-${fileSlug(activeTerm?.name ?? 'term')}-${fileSlug(assessmentLabel)}.csv`
    downloadCsv(filename, toCompactCsv(sheet))
  }

  const cell = (row: BroadsheetRow, columnId: string) => {
    const { state, detail } = sheet.cellDetails[row.studentId][columnId]
    const percentage = row.cells[columnId]
    if (state !== 'valid' || typeof percentage !== 'number') return <span title={detail} className="font-semibold">{state === 'not-taken' ? '==' : state === 'incomplete' ? 'INC' : state}</span>
    return (
      <span className="font-mono" title={detail}>
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
            <span>{activeTerm ? `${activeTerm.name} ${activeTerm.academic_year}` : 'Assessment term unavailable · final results withheld'}</span>
            <span>{students.length} students · {sheet.columns.length} subjects</span>
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
        <label>
          <span className="field-label">Assessment</span>
          <select aria-label="Assessment" className="select-field w-[200px]" value={selectedAssessment} onChange={event => setAssessment(event.target.value as BroadsheetAssessment)}>
            <option value="Midterm">Midterm</option>
            <option value="Endterm">End Term</option>
            <option value="all">Combined</option>
          </select>
        </label>
        {session?.role === 'teacher' ? (
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <Badge tone="neutral">Teacher view · read-only</Badge>
            <span className="text-[11px] text-ink/45">
              {subjectScope
                ? `${subjectScope.length} assigned subject${subjectScope.length === 1 ? '' : 's'} in view. Final positions appear only where the server verifies full authorized enrollment and paper scope. Marks are entered on the Exams page.`
                : 'Full ranking is shown only where the server verifies authorized enrollment and paper scope. Marks are entered on the Exams page.'}
            </span>
          </span>
        ) : null}
      </div>

      {sheet.rows.length === 0 ? (
        <EmptyState title={activeTerm ? 'No results in scope' : 'Assessment term unavailable'} hint={activeTerm ? 'Choose a class with exams and entered marks for this term.' : 'No unique active term is configured, so enrollment verification and final positions cannot be established.'} />
      ) : (
        <div className={`academic-scroll ${wide ? 'broadsheet-wide' : ''}`} role="region" aria-label="Broadsheet and subject analysis; scroll horizontally to view all papers" tabIndex={0}>
          {/* ── page 1: the results sheet ─────────────────────────────── */}
          <article className="sheet sheet-broadsheet sheet-broadsheet--matrix print-page card px-5 py-4 text-[9px] page-break" style={{width:documentWidth}}>
            <BroadsheetHeader school={school} title={heading} detail={`${students.length} candidates · ${sheet.columns.length} subjects · printed ${formatDate(new Date().toISOString())}`} />

            <table className="broadsheet-table mt-2 w-full table-fixed border-collapse text-[10.5px]" style={{ minWidth: tableWidth }}>
              <colgroup>
                {columnWidths.map((width, index) => <col key={index} style={{width}} />)}
                {sheet.columns.map((column) => (
                  <col key={column.examId} style={{ width: 54 }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {['Rank', 'Name of student', 'ADM NO.', 'MG', 'Total', 'Avg', 'SD', 'Comp'].map((label) => (
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
                      data-exam-id={column.examId}
                      className="border border-ink/40 bg-ink px-0.5 py-1 text-center text-[7px] font-semibold uppercase leading-tight text-white"
                    >
                      {column.subjectCode}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th colSpan={8 + sheet.columns.length} className="border border-ink/30 bg-ink/10 px-2 py-1 text-left text-[7px] font-bold uppercase tracking-[0.08em]">
                    Section A — Completed assessments · final positions
                  </th>
                </tr>
                {sheet.completedRows.map((row) => {
                  const values = row.requiredExamIds.map((examId) => row.cells[examId]).filter((value): value is number => typeof value === 'number')
                  const sd = stdDev(values)
                  return (
                    <tr key={row.studentId} data-student-id={row.studentId}>
                      <td className="border border-ink/25 px-[3px] py-[2px] text-center font-mono">{row.rank ?? '—'}</td>
                      <td className="border border-ink/25 px-[4px] py-[2px] font-medium uppercase leading-tight">{row.name}</td>
                      <td className="border border-ink/25 px-[3px] py-[2px] font-mono text-[7.5px] text-ink/70">{row.admission}</td>
                      <td className="border border-ink/25 px-[2px] py-[2px] text-center font-semibold">{row.grade}</td>
                      <td className="border border-ink/25 px-[3px] py-[2px] text-right font-mono">{round(row.total)}</td>
                      <td className="border border-ink/25 px-[3px] py-[2px] text-right font-mono">{row.mean === null ? '—' : round(row.mean)}</td>
                      <td className="border border-ink/25 px-[3px] py-[2px] text-right font-mono text-ink/70">{sd === null ? '—' : round(sd)}</td>
                      <td className="border border-ink/25 px-[3px] py-[2px] text-center font-mono text-ink/70">{row.enrollmentCertainty === 'verified_no_enrollments' ? 'No enrollment' : row.enrollmentKnown ? `${row.completed}/${row.required}` : '—'}</td>
                      {sheet.columns.map((column) => <td key={column.examId} className="border border-ink/25 px-[2px] py-[2px] text-center">{cell(row, column.examId)}</td>)}
                    </tr>
                  )
                })}
                <tr>
                  <th colSpan={8 + sheet.columns.length} className="border border-ink/30 bg-amber-50 px-2 py-1 text-left text-[7px] font-bold uppercase tracking-[0.08em]">
                    Section B — Incomplete or unverified assessments · not ranked
                  </th>
                </tr>
                {sheet.incompleteRows.map((row) => {
                  const values = row.requiredExamIds.map((examId) => row.cells[examId]).filter((value): value is number => typeof value === 'number')
                  const sd = row.completionKnown ? stdDev(values) : null
                  return (
                    <tr key={row.studentId} data-student-id={row.studentId}>
                      <td className="border border-ink/25 px-[3px] py-[2px] text-center font-mono">—</td>
                      <td className="border border-ink/25 px-[4px] py-[2px] font-medium uppercase leading-tight">
                        {row.name}
                      </td>
                      <td className="border border-ink/25 px-[3px] py-[2px] font-mono text-[7.5px] text-ink/70">{row.admission}</td>
                      <td className="border border-ink/25 px-[2px] py-[2px] text-center font-semibold">{!row.completionKnown ? '—' : row.mean === null ? 'Z' : `${row.grade}*`}</td>
                      <td className="border border-ink/25 px-[3px] py-[2px] text-right font-mono">{row.completionKnown ? round(row.total) : '—'}</td>
                      <td className="border border-ink/25 px-[3px] py-[2px] text-right font-mono">{!row.completionKnown || row.mean === null ? '—' : `P ${round(row.mean)}`}</td>
                      <td className="border border-ink/25 px-[3px] py-[2px] text-right font-mono text-ink/70">{sd === null ? '—' : round(sd)}</td>
                      <td className="border border-ink/25 px-[3px] py-[2px] text-center font-mono text-ink/70">{row.enrollmentCertainty === 'verified_no_enrollments' ? 'No enrollment' : row.completionKnown ? `${row.completed}/${row.required}` : '—'}</td>
                      {sheet.columns.map((column) => <td key={column.examId} className="border border-ink/25 px-[2px] py-[2px] text-center">{cell(row, column.examId)}</td>)}
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {sheet.incompleteRows.length > 0 ? <section className="mt-2 text-[9px] leading-relaxed" aria-label="Incomplete assessment details">
              <p className="font-semibold">Incomplete / unverified — final positions withheld</p>
              <ul>{sheet.incompleteRows.map(row => <li key={row.studentId}>
                <strong>{row.admission} · {row.name}</strong>: {!row.completionKnown ? 'Full enrollment and assessment scope could not be verified; aggregate withheld.' : row.required === 0 ? 'No enrolled subjects available for ranking.' : row.outstandingPapers.join('; ')}
              </li>)}</ul>
            </section> : null}

            <section className="broadsheet-results-key" aria-label="Results key">
              <h2>Results key</h2>
              <dl>{RESULTS_KEY.map(([code, meaning]) => <div key={code}><dt>{code}</dt><dd>{meaning}</dd></div>)}</dl>
            </section>
            <section className="broadsheet-subject-legend" aria-label="Subject code legend">
              <h2>Subject codes</h2>
              <dl>{subjectLegend.map(({code, name}, index) => <div key={sheet.columns[index].examId}><dt>{code}</dt><dd>{name}</dd></div>)}</dl>
            </section>
            <p className="broadsheet-cohort-strip">Completed cohort · Mean score <strong>{sheet.overall.meanScore === null ? '—' : `${round(sheet.overall.meanScore)}%`}</strong> · Mean point <strong>{round(sheet.overall.meanPoints)}</strong> · Mean grade <strong>{sheet.overall.meanGrade}</strong>. Class performance details follow on Subject Analysis.</p>
          </article>

          {/* ── page 2: subject analysis ──────────────────────────────── */}
          <article className="sheet sheet-broadsheet sheet-broadsheet--analysis print-page card px-5 py-4 text-[9px]" style={{width:documentWidth}}>
            <BroadsheetHeader school={school} title={`Subject analysis — ${scopeLabel} ${activeTerm?.name ?? ''}, ${activeTerm?.academic_year ?? ''}`} detail={`${assessmentLabel} · ${sheet.columns.length} subjects · printed ${formatDate(new Date().toISOString())}`} />

            <table className="broadsheet-table mt-2 w-full table-fixed border-collapse text-[10.5px]" style={{ minWidth: tableWidth }}>
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

            <section className="broadsheet-performance" aria-label="Class performance">
              <h2>Class performance</h2>
              <dl>
                <div><dt>Mean score</dt><dd data-stat="mean-score">{sheet.overall.meanScore === null ? '—' : `${round(sheet.overall.meanScore)}%`}</dd></div>
                <div><dt>Mean point</dt><dd data-stat="mean-point">{round(sheet.overall.meanPoints)}</dd></div>
                <div><dt>Mean grade</dt><dd data-stat="mean-grade">{sheet.overall.meanGrade}</dd></div>
                <div><dt>Sum of subject averages</dt><dd data-stat="sum-subject-averages">{round(totalsAverage)}</dd></div>
              </dl>
              <p>The first three values use completed, eligible students only. Mean grade is the configured grade of the mean score; mean point averages their individual mean-grade points. The sum uses each subject’s valid entries and is not a percentage.</p>
            </section>
            <section className="broadsheet-grade-points" aria-label="Grade points">
              <h2>Grade points <span>{scale.name}</span></h2>
              <table className="broadsheet-reference-table"><thead><tr><th scope="row">Grade</th>{[...scale.bands].sort((a,b)=>b.min_score-a.min_score).map(band=><th key={band.grade} scope="col">{band.grade}</th>)}</tr></thead>
                <tbody><tr><th scope="row">Points</th>{[...scale.bands].sort((a,b)=>b.min_score-a.min_score).map(band=><td key={band.grade}>{band.points}</td>)}</tr></tbody>
              </table>
              <p>Z is a non-numeric result indicator, not a configured grade-point band. Subject “Mean points” means points for that subject’s average grade, rather than an average of students’ points.</p>
              <p>{selectedAssessment === 'all' ? 'Combined subject % = (Midterm % + End Term %) / 2; both components must be valid. ' : 'Subject results are percentages of their original paper maximum. '}Totals count subjects once. Grades and positions use full-precision results; ties share a rank. Incomplete students have provisional values and no final rank.</p>
            </section>
            <section className="broadsheet-distribution" aria-label="Grade distribution">
              <h2>Grade distribution <span>Completed, eligible students only</span></h2>
              <table className="broadsheet-reference-table" data-grade-distribution>
                <thead><tr><th scope="col">Grade</th>{sheet.distribution.map(entry=><th key={entry.grade} scope="col">{entry.grade}</th>)}<th scope="col">Total</th></tr></thead>
                <tbody>
                  <tr><th scope="row">Students</th>{sheet.distribution.map(entry=><td key={entry.grade}>{entry.count}</td>)}<td>{sheet.completedRows.length}</td></tr>
                  <tr><th scope="row">Percentage</th>{sheet.distribution.map(entry=><td key={entry.grade}>{sheet.completedRows.length ? round(entry.count / sheet.completedRows.length * 100) : 0}%</td>)}<td>{sheet.completedRows.length ? '100%' : '0%'}</td></tr>
                </tbody>
              </table>
              <p>{sheet.incompleteRows.length} incomplete or unverified student(s) excluded. Displayed percentages may differ slightly from 100% when rounded.</p>
              <p className="broadsheet-pass-rate" data-pass-mark={scale.pass_mark} data-passing={passing} data-eligible={sheet.completedRows.length}><strong>Pass threshold: {round(scale.pass_mark)}%</strong><span>{passing} of {sheet.completedRows.length} completed students meet or exceed the threshold <strong>({round(passRate)}%)</strong>.</span></p>
            </section>
            <div className="broadsheet-signatures">
              <div>Class teacher — signature &amp; date</div><div>Principal — signature &amp; date</div>
            </div>
          </article>
        </div>
      )}
    </>
  )
}
