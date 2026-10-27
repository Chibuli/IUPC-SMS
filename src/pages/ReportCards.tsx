import { useEffect, useMemo, useState } from 'react'
import { Printer, Save } from 'lucide-react'
import { api, useDb } from '../data/db'
import { useSession } from '../session'
import { Badge, Field, PageHeader, SchoolLogo, SectionTitle } from '../components/ui'
import { bandFor, gradeFor, resolveScale } from '../lib/grading'
import { mean } from '../lib/analytics'
import { formatDate, round } from '../lib/format'
import { usePrintPage } from '../lib/print'
import type { GradeBand, ReportCard } from '../data/types'

const EMPTY: Omit<ReportCard, '_id' | 'student_id' | 'term_id' | 'updated_at'> = {
  attendance_present: 0,
  attendance_total: 0,
  class_teacher: '',
  academic: '',
  activities: '',
  conduct: '',
  principal: '',
  hse: '',
  next_term_begins: '',
  next_term_ends: '',
}

/* Remarks are handwritten: the printed card carries blank ruled space instead of
   stored text, so teachers write and sign in ink on the paper itself. */
function WriteIn({ label }: { label: string }) {
  return (
    <div className="flex items-end">
      <span className="w-[58px] shrink-0 pr-1 text-[8px] font-semibold uppercase tracking-[0.04em]">{label}</span>
      <span className="h-[11px] flex-1 border-b border-ink/35" />
    </div>
  )
}

/** 90–100, 80–89 … derived from the band floors, highest first. */
function bandRanges(bands: GradeBand[]) {
  const sorted = [...bands].sort((a, b) => b.min_score - a.min_score)
  return sorted.map((band, index) => ({
    band,
    range: `${band.min_score}–${index === 0 ? 100 : sorted[index - 1].min_score - 1}`,
  }))
}

export default function ReportCards() {
  const db = useDb()
  const { session } = useSession()
  const school = db.schools[0]
  const scale = resolveScale(db.gradingScales)
  const isAdmin = session?.role === 'admin'

  const activeTerm = db.terms.find((term) => term.is_active) ?? db.terms[0]
  usePrintPage('report')
  const [termId, setTermId] = useState(activeTerm?._id ?? '')
  const [classId, setClassId] = useState(db.classes[0]?._id ?? '')
  const [studentId, setStudentId] = useState(
    db.students.find((student) => student.class_id === (db.classes[0]?._id ?? ''))?._id ?? '',
  )

  const term = db.terms.find((t) => t._id === termId)
  const cls = db.classes.find((c) => c._id === classId)
  const roster = db.students.filter((student) => student.class_id === classId && student.status === 'Active')
  const student = db.students.find((s) => s._id === studentId) ?? roster[0]

  useEffect(() => {
    if (!roster.some((row) => row._id === studentId)) setStudentId(roster[0]?._id ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId])

  const exams = useMemo(
    () =>
      db.exams
        .filter((exam) => exam.term_id === termId && exam.class_id === classId)
        .sort((a, b) => a.exam_date.localeCompare(b.exam_date)),
    [db.exams, termId, classId],
  )

  const initialsFor = (subjectId: string) =>
    db.teachers.find((teacher) => teacher.assigned_subject_ids.includes(subjectId))?.initials ?? '—'

  const subjectRows = useMemo(() => {
    if (!student) return []
    return exams.map((exam) => {
      const subject = db.subjects.find((s) => s._id === exam.subject_id)
      const mark = db.marks.find((m) => m.exam_id === exam._id && m.student_id === student._id)
      const score = mark?.score ?? null
      const numeric = typeof score === 'number'
      const classScores = db.marks
        .filter((m) => m.exam_id === exam._id && typeof m.score === 'number')
        .map((m) => m.score as number)
        .sort((a, b) => b - a)
      const percentage = numeric ? (score / exam.max_score) * 100 : null
      return {
        exam,
        subject,
        score,
        percentage,
        // Bands are percentages: 41 on a paper out of 50 is an A, not an E.
        grade: percentage === null ? (score ?? '—') : gradeFor(percentage, scale.bands),
        points: percentage === null ? null : bandFor(percentage, scale.bands).points,
        rank: numeric ? classScores.filter((value) => value > score).length + 1 : null,
        classSize: classScores.length,
        initials: initialsFor(exam.subject_id),
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.marks, db.subjects, db.teachers, exams, scale, student])

  /* ── term aggregates ─────────────────────────────────────────────────── */
  const termTotalFor = (studentId: string, forTermId: string) => {
    const termExams = db.exams.filter((exam) => exam.term_id === forTermId && exam.class_id === classId)
    return termExams.reduce((sum, exam) => {
      const mark = db.marks.find((m) => m.exam_id === exam._id && m.student_id === studentId)
      return sum + (typeof mark?.score === 'number' ? mark.score : 0)
    }, 0)
  }

  const termAverageFor = (studentId: string, forTermId: string) => {
    const termExams = db.exams.filter((exam) => exam.term_id === forTermId && exam.class_id === classId)
    const percentages = termExams
      .map((exam) => {
        const mark = db.marks.find((m) => m.exam_id === exam._id && m.student_id === studentId)
        return typeof mark?.score === 'number' ? (mark.score / exam.max_score) * 100 : null
      })
      .filter((value): value is number => value !== null)
    return mean(percentages)
  }

  const classAverageFor = (forTermId: string) =>
    mean(roster.map((row) => termAverageFor(row._id, forTermId)).filter((value): value is number => value !== null))

  const numericRows = subjectRows.filter((row) => typeof row.score === 'number')
  const percentages = numericRows.map((row) => row.percentage as number)
  const average = mean(percentages)
  const totalScore = numericRows.reduce((sum, row) => sum + (row.score as number), 0)
  const totalOutOf = exams.reduce((sum, exam) => sum + exam.max_score, 0)
  const meanGrade = average === null ? '—' : gradeFor(average, scale.bands)
  const classAverage = classAverageFor(termId)

  const yearTerms = db.terms
    .filter((option) => option.academic_year === term?.academic_year)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
  const termRows = yearTerms.map((option) => {
    const avg = student ? termAverageFor(student._id, option._id) : null
    const total = student ? termTotalFor(student._id, option._id) : 0
    return { term: option, average: avg, total, classAverage: classAverageFor(option._id), current: option._id === termId }
  })
  const currentIndex = termRows.findIndex((row) => row.current)
  const previousAverage = currentIndex > 0 ? termRows[currentIndex - 1].average : null
  const improvement = average !== null && previousAverage !== null ? average - previousAverage : null

  const record = db.reportCards.find((r) => r.student_id === student?._id && r.term_id === termId)
  const [form, setForm] = useState(EMPTY)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setForm(record ? { ...record } : { ...EMPTY })
    setSaved(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student?._id, termId, record?._id])

  async function save() {
    if (!student) return
    await api.reportCards.upsert(student._id, termId, form)
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1600)
  }

  return (
    <>
      <PageHeader
        title="Report Cards"
        subtitle="The end-of-term academic report, one student at a time"
        meta={
          <>
            <span>{cls?.class_name} {cls?.stream_name}</span>
            <span>{term?.name} {term?.academic_year}</span>
            <span>{exams.length} subjects in scope</span>
          </>
        }
        actions={
          <>
            <button type="button" className="btn btn-sm" onClick={() => window.print()} disabled={!student}>
              <Printer size={13} /> Print card
            </button>
            {isAdmin ? (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void save()} disabled={!student}>
                <Save size={13} /> {saved ? 'Saved' : 'Save card'}
              </button>
            ) : null}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-2 no-print">
        <label>
          <span className="field-label">Term</span>
          <select className="select-field w-[190px]" value={termId} onChange={(event) => setTermId(event.target.value)}>
            {db.terms.map((option) => (
              <option key={option._id} value={option._id}>
                {option.name} · {option.academic_year}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">Class</span>
          <select className="select-field w-[160px]" value={classId} onChange={(event) => setClassId(event.target.value)}>
            {db.classes.map((option) => (
              <option key={option._id} value={option._id}>
                {option.class_name} {option.stream_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">Student</span>
          <select className="select-field w-[220px]" value={student?._id ?? ''} onChange={(event) => setStudentId(event.target.value)}>
            {roster.map((option) => (
              <option key={option._id} value={option._id}>
                {option.full_name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-5 xl:grid-cols-[320px_1fr]">
        {/* editing panel */}
        <aside className="no-print">
          <div className="card p-4">
            <SectionTitle>{isAdmin ? 'Editing panel' : 'Sign-off details'}</SectionTitle>
            {!isAdmin ? (
              <p className="mb-3 text-[11.5px] text-ink/50">Only administrators can edit attendance and the sign-off details.</p>
            ) : null}

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Field label="Days present">
                  <input
                    className="input-field figure"
                    type="number"
                    min={0}
                    value={form.attendance_present}
                    disabled={!isAdmin}
                    onChange={(event) => setForm({ ...form, attendance_present: Number(event.target.value) })}
                  />
                </Field>
                <Field label="Days in term">
                  <input
                    className="input-field figure"
                    type="number"
                    min={0}
                    value={form.attendance_total}
                    disabled={!isAdmin}
                    onChange={(event) => setForm({ ...form, attendance_total: Number(event.target.value) })}
                  />
                </Field>
              </div>

              <Field label="Class teacher">
                <input
                  className="input-field"
                  value={form.class_teacher}
                  disabled={!isAdmin}
                  onChange={(event) => setForm({ ...form, class_teacher: event.target.value })}
                  placeholder="Grace Wanjiru"
                />
              </Field>

              <p className="rounded border border-dashed border-rule px-2.5 py-2 text-[11px] leading-snug text-ink/55">
                Remarks are handwritten. The academic, activities, conduct, principal and HSE blocks print
                blank with ruled lines for the teachers to fill in by hand.
              </p>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Next term begins">
                  <input
                    className="input-field"
                    type="date"
                    value={form.next_term_begins}
                    disabled={!isAdmin}
                    onChange={(event) => setForm({ ...form, next_term_begins: event.target.value })}
                  />
                </Field>
                <Field label="Next term ends">
                  <input
                    className="input-field"
                    type="date"
                    value={form.next_term_ends}
                    disabled={!isAdmin}
                    onChange={(event) => setForm({ ...form, next_term_ends: event.target.value })}
                  />
                </Field>
              </div>

              {isAdmin ? (
                <button type="button" className="btn btn-primary btn-sm w-full" onClick={() => void save()} disabled={!student}>
                  <Save size={13} /> {saved ? 'Saved' : 'Save for this term'}
                </button>
              ) : (
                <Badge tone="neutral">Read-only</Badge>
              )}
            </div>
          </div>
        </aside>

        {/* the report sheet */}
        <div className="min-w-0">
          {!student ? (
            <p className="rounded border border-dashed border-rule px-4 py-10 text-center text-[12.5px] text-ink/45">
              No students in this stream.
            </p>
          ) : (
            <article className="sheet sheet-report card w-full px-6 py-5 text-[10px]">
              {/* masthead */}
              <header className="flex items-start gap-3 border-b-2 border-ink pb-2">
                <SchoolLogo school={school} size={42} />
                <div className="flex-1 text-center">
                  <p className="text-[17px] font-bold uppercase leading-tight tracking-[0.06em]">{school.name}</p>
                  <p className="text-[8.5px] leading-snug text-ink/65">
                    {school.address}
                  </p>
                  <p className="text-[8.5px] leading-snug text-ink/65">
                    {school.postal} · {school.city} · TEL {school.phone_number}
                  </p>
                  <p className="text-[8.5px] leading-snug text-ink/65">{school.contact_email}</p>
                  <p className="mt-1 border-t border-ink/20 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.1em]">
                    Academic report {term?.name} — {term?.name}, {term?.academic_year}
                  </p>
                </div>
                <div className="w-[74px] shrink-0 text-right text-[7.5px] leading-relaxed text-ink/55">
                  <p>Printed</p>
                  <p className="font-mono">{formatDate(new Date().toISOString())}</p>
                </div>
              </header>

              {/* student identity */}
              <section className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-ink/20 pb-1.5 text-[9px]">
                <p>
                  <span className="font-semibold uppercase tracking-[0.08em]">Name:</span>{' '}
                  <span className="text-[10.5px] font-semibold">{student.full_name}</span>
                </p>
                <p>
                  <span className="font-semibold uppercase tracking-[0.08em]">Adm. no.</span>{' '}
                  <span className="font-mono">{student.admission_number}</span>
                </p>
                <p>
                  <span className="font-semibold uppercase tracking-[0.08em]">Year:</span> {cls?.class_name}
                </p>
                <p>
                  <span className="font-semibold uppercase tracking-[0.08em]">House:</span> {cls?.stream_name}
                </p>
                <p className="ml-auto">
                  <span className="font-semibold uppercase tracking-[0.08em]">Attendance:</span>{' '}
                  {form.attendance_present}/{form.attendance_total}
                </p>
              </section>

              {/* subject table */}
              <table className="mt-2 w-full table-fixed border-collapse text-[9px]">
                <colgroup>
                  <col style={{ width: '37%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '7.5%' }} />
                  <col style={{ width: '6.5%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '18%' }} />
                  <col style={{ width: '11%' }} />
                </colgroup>
                <thead>
                  <tr>
                    {['Subjects', 'CAT (%)', 'Grd', 'Pts', 'Pos', 'Remarks', 'Initials/Sign'].map((heading) => (
                      <th
                        key={heading}
                        className={`border border-ink/30 bg-ink px-1 py-1 text-left text-[7.5px] font-semibold uppercase leading-tight tracking-[0.04em] text-white ${
                          heading === 'Initials/Sign' ? 'text-center' : ''
                        }`}
                      >
                        {heading === 'Initials/Sign' ? (
                          <span className="block">
                            Initials
                            <span className="block font-mono text-[6.5px] font-normal text-white/50">/sign</span>
                          </span>
                        ) : (
                          heading
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {subjectRows.map((row) => (
                    <tr key={row.exam._id}>
                      <td className="border border-ink/20 px-1 py-[3px]">
                        <span className="font-mono text-[8px] text-ink/70">{row.subject?.code}</span>{' '}
                        <span className="font-medium uppercase">{row.subject?.name}</span>
                      </td>
                      <td className="border border-ink/20 px-1 py-[3px] text-center font-mono">
                        {row.percentage === null ? '—' : round(row.percentage)}
                      </td>
                      <td className="border border-ink/20 px-1 py-[3px] text-center font-semibold">{row.grade}</td>
                      <td className="border border-ink/20 px-1 py-[3px] text-center font-mono">{row.points ?? '—'}</td>
                      <td className="border border-ink/20 px-1 py-[3px] text-center font-mono">
                        {row.rank ? `${row.rank}/${row.classSize}` : '—'}
                      </td>
                      <td className="border border-ink/20 px-1 py-[3px] text-[8px] uppercase tracking-[0.04em]">
                        &nbsp;
                      </td>
                      <td className="border border-ink/20 px-1 py-[3px] text-center font-mono text-[8px]">
                        {row.initials}
                      </td>
                    </tr>
                  ))}
                  {subjectRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="border border-ink/20 px-2 py-3 text-center text-ink/45">
                        No subjects recorded for this term.
                      </td>
                    </tr>
                  ) : null}

                  {/* legend + totals strip */}
                  <tr className="bg-ink/5 text-[8px]">
                    <td className="border border-ink/25 px-1 py-[3px] uppercase tracking-[0.03em]">
                      X-absent · Y-irregularity · Z-not graded
                    </td>
                    <td className="border border-ink/25 px-1 py-[3px] text-right font-semibold uppercase">Total</td>
                    <td className="border border-ink/25 px-1 py-[3px] text-center font-mono font-semibold">
                      {round(totalScore)}
                    </td>
                    <td className="border border-ink/25 px-1 py-[3px] text-right font-semibold uppercase" colSpan={2}>
                      Out of
                    </td>
                    <td className="border border-ink/25 px-1 py-[3px] font-mono font-semibold">{totalOutOf}</td>
                    <td className="border border-ink/25 px-1 py-[3px] text-center font-mono">
                      {subjectRows.length} subj
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* term performance */}
              <table className="mt-2 w-full table-fixed border-collapse text-[9px]">
                <thead>
                  <tr>
                    {['Term', 'Total score', 'Average', 'Impr (+/-)', 'Grd', 'Class average'].map((heading) => (
                      <th
                        key={heading}
                        className="border border-ink/25 bg-ink/5 px-1 py-0.5 text-left text-[7.5px] font-semibold uppercase tracking-[0.06em]"
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {termRows.map((row, index) => {
                    const previous = index > 0 ? termRows[index - 1].average : null
                    const delta = row.average !== null && previous !== null ? row.average - previous : null
                    return (
                      <tr key={row.term._id} className={row.current ? 'bg-crimson/5' : undefined}>
                        <td className="border border-ink/20 px-1 py-0.5 font-semibold uppercase">
                          {row.term.name}
                          {row.current ? <span className="ml-1 font-normal text-crimson">· current</span> : null}
                        </td>
                        <td className="border border-ink/20 px-1 py-0.5 font-mono">
                          {row.average === null ? '—' : round(row.total)}
                        </td>
                        <td className="border border-ink/20 px-1 py-0.5 font-mono">
                          {row.average === null ? '—' : round(row.average)}
                        </td>
                        <td className="border border-ink/20 px-1 py-0.5 font-mono">
                          {delta === null ? '—' : `${delta >= 0 ? '+' : ''}${round(delta)}`}
                        </td>
                        <td className="border border-ink/20 px-1 py-0.5 font-semibold">
                          {row.average === null ? '—' : gradeFor(row.average, scale.bands)}
                        </td>
                        <td className="border border-ink/20 px-1 py-0.5 font-mono">
                          {row.classAverage === null ? '—' : round(row.classAverage)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              <p className="mt-1.5 text-[8px] text-ink/60">
                Mean grade <strong>{meanGrade}</strong> · average {average === null ? '—' : round(average)}% · class
                average {classAverage === null ? '—' : round(classAverage)}% · improvement{' '}
                {improvement === null ? '—' : `${improvement >= 0 ? '+' : ''}${round(improvement)}`}
              </p>

              {/* remarks */}
              <section className="mt-2 border-t border-ink/25 pt-1.5 text-[8.5px]">
                <p className="text-[8px] font-semibold uppercase tracking-[0.1em]">Class teacher's remarks</p>
                <div className="mt-1.5 space-y-1.5">
                  <WriteIn label="Academic:" />
                  <WriteIn label="Activities:" />
                  <WriteIn label="Conduct:" />
                </div>
                <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-ink/15 pt-1 text-[8px] uppercase tracking-[0.04em] text-ink/70">
                  <span>Class teacher: {form.class_teacher || '—'}</span>
                  <span>Sign: ..........................</span>
                  <span>Date: ..........................</span>
                </div>
              </section>

              <section className="sheet-fill mt-2 grid gap-3 border-t border-ink/25 pt-1.5 text-[8.5px] sm:grid-cols-[1.35fr_1fr]">
                <div className="flex h-full flex-col rounded-sm border border-ink/20 px-2 py-1.5">
                  <p className="text-[8px] font-semibold uppercase tracking-[0.1em]">Principal's remarks</p>
                  <div className="write-area mt-2 min-h-[58px] flex-1" />
                  <div className="mt-auto flex justify-between gap-2 border-t border-ink/15 pt-1 text-[8px] uppercase tracking-[0.04em] text-ink/70">
                    <span>Principal</span>
                    <span>Sign: ...................</span>
                    <span>Date: ...............</span>
                  </div>
                </div>
                <div className="space-y-1 text-[8px] uppercase tracking-[0.04em] text-ink/70">
                  <p>
                    <span className="font-semibold text-ink">Next term begins from:</span>{' '}
                    {formatDate(form.next_term_begins)}
                  </p>
                  <p>
                    <span className="font-semibold text-ink">To:</span> {formatDate(form.next_term_ends)}
                  </p>
                  <p className="pt-2">Report seen by: ...................................</p>
                </div>
              </section>

              <section className="sheet-fill mt-2 grid gap-3 border-t border-ink/25 pt-1.5 text-[8.5px] sm:grid-cols-[1.35fr_1fr]">
                <div className="flex h-full flex-col rounded-sm border border-ink/20 px-2 py-1.5">
                  <p className="text-[8px] font-semibold uppercase tracking-[0.1em]">HSE master's remarks</p>
                  <div className="write-area mt-2 min-h-[58px] flex-1" />
                  <div className="mt-auto flex justify-between gap-2 border-t border-ink/15 pt-1 text-[8px] uppercase tracking-[0.04em] text-ink/70">
                    <span>HSE master</span>
                    <span>Sign: ...................</span>
                  </div>
                </div>
                <div>
                  <p className="text-[8px] font-semibold uppercase tracking-[0.1em]">Grading key</p>
                  <table className="mt-1 w-full border-collapse text-[7.5px]">
                    <thead>
                      <tr>
                        {['Range', 'Grade', 'Points'].map((heading) => (
                          <th key={heading} className="border border-ink/25 bg-ink/5 px-1 text-left font-semibold uppercase">
                            {heading}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {bandRanges(scale.bands).map(({ band, range }) => (
                        <tr key={band.grade}>
                          <td className="border border-ink/20 px-1 font-mono">{range}</td>
                          <td className="border border-ink/20 px-1 font-semibold">{band.grade}</td>
                          <td className="border border-ink/20 px-1 text-center font-mono">{band.points}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </article>
          )}
        </div>
      </div>
    </>
  )
}
