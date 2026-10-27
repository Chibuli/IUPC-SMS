import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, Check, Lock, Printer, X } from 'lucide-react'
import { api, findPaper, useDb } from '../data/db'
import { useSession } from '../session'
import { Badge, EmptyState, GradePill, PageHeader } from '../components/ui'
import { displayScore, gradeForMark, parseScoreInput, percentOf, resolveScale } from '../lib/grading'
import { formatDate, formatDateTime, todayIso } from '../lib/format'
import { usePrintPage } from '../lib/print'
import type { Database, ID, Student } from '../data/types'

/** The five papers this campus sets, in the order a term runs them. */
const EXAM_TYPES = ['CAT 1', 'CAT 2', 'Midterm', 'Endterm', 'Pre-Mock'] as const

type SortKey = 'adm' | 'name' | 'gender'
type Flash = 'saved' | 'error'

/** What the teacher picks on the bar: the four choices that name one paper. */
interface Selection {
  term_id: ID
  class_id: ID
  subject_id: ID
  exam_type: string
}

/**
 * The bar's starting position: the paper named in the URL when the page was
 * opened from a link, otherwise the active term and the first choices on offer.
 */
function initialSelection(db: Database, examId: string | undefined, fallback: Selection): Selection {
  const exam = examId ? db.exams.find((entry) => entry._id === examId) : undefined
  if (!exam) return fallback
  return {
    term_id: exam.term_id,
    class_id: exam.class_id,
    subject_id: exam.subject_id,
    exam_type: exam.exam_type,
  }
}

export default function MarksEntry() {
  const db = useDb()
  const { session, teacher, canEditPaper, subjectScope, mayEnterMarks, marksCloseAt } = useSession()
  const { examId } = useParams<{ examId?: string }>()
  const navigate = useNavigate()
  const scale = resolveScale(db.gradingScales)
  usePrintPage('report')

  const classes = useMemo(
    () =>
      [...db.classes].sort(
        (a, b) =>
          a.class_name.localeCompare(b.class_name, undefined, { numeric: true }) ||
          a.stream_name.localeCompare(b.stream_name),
      ),
    [db.classes],
  )
  const terms = useMemo(
    () => [...db.terms].sort((a, b) => a.start_date.localeCompare(b.start_date)),
    [db.terms],
  )
  const activeTerm = db.terms.find((term) => term.is_active) ?? terms[terms.length - 1]

  /**
   * The subjects the bar offers: a teacher picks from the subjects their staff
   * profile holds (that is what they may write), everyone else from what the
   * campus teaches.
   */
  const subjects = useMemo(() => {
    if (subjectScope) return db.subjects.filter((subject) => subjectScope.includes(subject._id))
    return db.subjects.filter((subject) => subject.offered)
  }, [db.subjects, subjectScope])

  const [picked, setPicked] = useState<Selection>(() =>
    initialSelection(db, examId, {
      term_id: activeTerm?._id ?? '',
      class_id: classes[0]?._id ?? '',
      subject_id: subjects[0]?._id ?? '',
      exam_type: EXAM_TYPES[0],
    }),
  )

  // Opening another paper from a link re-points the bar at it.
  useEffect(() => {
    if (!examId) return
    const exam = db.exams.find((entry) => entry._id === examId)
    if (!exam) return
    setPicked({
      term_id: exam.term_id,
      class_id: exam.class_id,
      subject_id: exam.subject_id,
      exam_type: exam.exam_type,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId])

  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('adm')
  const [outOf, setOutOf] = useState('100')

  /** The paper this selection names — undefined until a result is keyed in. */
  const paper = useMemo(() => findPaper(db, picked), [db, picked])
  const selectionKey = `${picked.term_id}|${picked.class_id}|${picked.subject_id}|${picked.exam_type}`

  useEffect(() => {
    setOutOf(String(paper?.max_score ?? 100))
  }, [paper?._id, paper?.max_score])

  const subject = db.subjects.find((entry) => entry._id === picked.subject_id)
  const cls = db.classes.find((entry) => entry._id === picked.class_id)
  const term = db.terms.find((entry) => entry._id === picked.term_id)
  const school = db.schools[0]

  // What the paper is out of: what the teacher typed, else the recorded total.
  const typedTotal = Number(outOf)
  const maxScore = typedTotal > 0 ? typedTotal : paper?.max_score ?? 100

  const permission = canEditPaper({
    subject_id: picked.subject_id,
    status: paper?.status,
    editing_deadline: paper?.editing_deadline,
  })
  const locked = !permission.editable

  const roster = useMemo(() => {
    const rows = db.students.filter((student) => student.class_id === picked.class_id && student.status === 'Active')
    const byAdmission = (a: Student, b: Student) => a.admission_number.localeCompare(b.admission_number)
    if (sortKey === 'name') {
      return [...rows].sort((a, b) => a.full_name.localeCompare(b.full_name) || byAdmission(a, b))
    }
    if (sortKey === 'gender') {
      return [...rows].sort((a, b) => a.gender.localeCompare(b.gender) || a.full_name.localeCompare(b.full_name))
    }
    return [...rows].sort(byAdmission)
  }, [db.students, picked.class_id, sortKey])

  const markFor = (studentId: string) =>
    paper ? db.marks.find((mark) => mark.exam_id === paper._id && mark.student_id === studentId) : undefined

  const initialDrafts = () =>
    Object.fromEntries(
      roster.map((student) => {
        const mark = markFor(student._id)
        if (!mark || mark.score === null) return [student._id, '']
        return [student._id, String(mark.score)]
      }),
    )

  const [drafts, setDrafts] = useState<Record<string, string>>(initialDrafts)
  const [flash, setFlash] = useState<Record<string, Flash>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const inputs = useRef<Record<string, HTMLInputElement | null>>({})

  // Changing the paper clears the register: drafts belong to one sheet.
  useEffect(() => {
    setDrafts(initialDrafts())
    setFlash({})
    setErrors({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey])

  const entered = roster.filter((student) => {
    const mark = markFor(student._id)
    return mark && mark.score !== null
  }).length

  /**
   * The paper the marks belong to. Nothing is created while the teacher is
   * still choosing — the row appears the first time a result is keyed in.
   */
  async function paperId(): Promise<string> {
    if (paper) return paper._id
    const created = await api.exams.ensure({
      term_id: picked.term_id,
      class_id: picked.class_id,
      subject_id: picked.subject_id,
      exam_name: picked.exam_type,
      exam_type: picked.exam_type,
      max_score: maxScore,
      exam_date: todayIso(),
    })
    return created._id
  }

  async function persist(studentId: string) {
    const raw = drafts[studentId] ?? ''
    const parsed = parseScoreInput(raw, maxScore)
    if (!parsed.ok) {
      setErrors((current) => ({ ...current, [studentId]: parsed.error }))
      setFlash((current) => ({ ...current, [studentId]: 'error' }))
      return false
    }
    setErrors((current) => {
      const next = { ...current }
      delete next[studentId]
      return next
    })
    // Tabbing through untouched rows is not an edit: a blank field on a learner
    // with no mark writes nothing (and must not flash "Saved").
    if (parsed.value === null && !markFor(studentId)) {
      setFlash((current) => {
        const next = { ...current }
        delete next[studentId]
        return next
      })
      return true
    }
    await api.marks.setScore(await paperId(), studentId, parsed.value)
    if (parsed.value === null) {
      // Cleared on purpose: the row goes back to Pending rather than "Saved".
      setFlash((current) => {
        const next = { ...current }
        delete next[studentId]
        return next
      })
      return true
    }
    setFlash((current) => ({ ...current, [studentId]: 'saved' }))
    window.setTimeout(() => {
      setFlash((current) => {
        if (current[studentId] !== 'saved') return current
        const next = { ...current }
        delete next[studentId]
        return next
      })
    }, 1400)
    return true
  }

  /** The paper total is part of the paper: changing it re-reads every percent. */
  async function commitTotal() {
    if (typedTotal > 0) {
      if (paper && paper.max_score !== typedTotal) await api.exams.setMaxScore(paper._id, typedTotal)
      return
    }
    setOutOf(String(paper?.max_score ?? 100))
  }

  function focusOffset(studentId: string, offset: number) {
    const index = roster.findIndex((student) => student._id === studentId)
    const next = roster[index + offset]
    if (next) inputs.current[next._id]?.focus()
  }

  const gradeForDraft = (studentId: string) => {
    const raw = (drafts[studentId] ?? '').trim().toUpperCase()
    if (raw === 'X' || raw === 'Y') return raw
    if (raw === '') return '—'
    // A draft that the field would reject must not read as a grade: 4141 is not
    // an A*, it is a typo.
    const parsed = parseScoreInput(raw, maxScore)
    if (!parsed.ok || typeof parsed.value !== 'number') return '—'
    return gradeForMark(parsed.value, maxScore, scale.bands)
  }

  /** A score as a percentage of the paper total — the figure the grade is read from. */
  const percentLabel = (studentId: string) => {
    const raw = (drafts[studentId] ?? '').trim()
    if (raw === '' || /^[xy]$/i.test(raw)) return '—'
    const parsed = parseScoreInput(raw, maxScore)
    if (!parsed.ok || typeof parsed.value !== 'number') return '—'
    return `${percentOf(parsed.value, maxScore).toFixed(1)}%`
  }

  /** Learners with no recorded outcome yet — the ones the warning names. */
  const missing = roster.filter((student) => {
    const mark = markFor(student._id)
    return !mark || mark.score === null
  })

  /**
   * The blanks still open on one paper, read from storage rather than from the
   * bar, so it stays right for a paper the teacher has already switched away
   * from: the settle handler belongs to the sheet it was armed on.
   */
  const blanksFor = (examId: string): string[] => {
    const row = db.exams.find((entry) => entry._id === examId)
    if (!row) return []
    return db.students
      .filter((student) => student.class_id === row.class_id && student.status === 'Active')
      .filter((student) => {
        const mark = db.marks.find((entry) => entry.exam_id === examId && entry.student_id === student._id)
        return !mark || mark.score === null
      })
      .map((student) => student._id)
  }

  // Leaving the sheet settles the register: anything still blank becomes X
  // (missing marks), which is what the printed codes already mean. A paper that
  // was never recorded is untouched — browsing the bar creates nothing. The ref
  // carries the current reader into the unload and unmount handlers.
  const blanksRef = useRef(blanksFor)
  blanksRef.current = blanksFor

  const settleOnLeave = Boolean(paper) && !locked

  useEffect(() => {
    if (!settleOnLeave || !paper) return
    const examId = paper._id
    let armed = false
    // StrictMode mounts, unmounts and mounts again in development; arming after
    // a tick keeps that first synthetic teardown from writing anything.
    const arm = window.setTimeout(() => {
      armed = true
    }, 250)
    const settle = () => {
      for (const studentId of blanksRef.current(examId)) void api.marks.setScore(examId, studentId, 'X')
    }
    const warn = (event: BeforeUnloadEvent) => {
      if (!blanksRef.current(examId).length) return
      event.preventDefault()
      event.returnValue = ''
    }
    const onHide = () => {
      if (armed) settle()
    }
    window.addEventListener('beforeunload', warn)
    window.addEventListener('pagehide', onHide)
    return () => {
      window.clearTimeout(arm)
      window.removeEventListener('beforeunload', warn)
      window.removeEventListener('pagehide', onHide)
      if (armed) settle()
    }
  }, [paper?._id, settleOnLeave, locked])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return subjects
    return subjects.filter((entry) =>
      `${entry.name} ${entry.code} ${entry.category} ${entry.level}`.toLowerCase().includes(needle),
    )
  }, [subjects, query])

  if (!subjects.length) {
    return (
      <>
        <PageHeader
          title="Marks Entry"
          subtitle="Choose the paper, then key the results straight into the register."
          meta={<span>No papers available for this account</span>}
        />
        <EmptyState
          title="No subjects are assigned to your profile"
          hint="The registrar assigns the subjects a teacher may work on from the staff register. Until then there is no paper to open."
        />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Marks Entry"
        subtitle="Choose the paper, then key the results straight into the register."
        meta={
          <>
            <span>
              {term?.name} {term?.academic_year}
            </span>
            <span>
              {cls?.class_name} {cls?.stream_name}
            </span>
            <span>{picked.exam_type}</span>
            <span>Out of {maxScore}</span>
            <span className={locked ? 'text-danger' : 'text-ok'}>{locked ? 'Read-only' : 'Editing open'}</span>
            <span className="figure">
              {entered}/{roster.length} entered
            </span>
            <span>{paper ? 'Recorded paper' : 'New paper — nothing saved yet'}</span>
          </>
        }
        actions={
          <>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => window.print()}
              data-action="print-preview"
            >
              <Printer size={13} /> Print preview
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => navigate('/dashboard')}
              data-action="close-page"
            >
              <X size={13} /> Close page
            </button>
          </>
        }
      />

      {/* ── the bar: type, subject, sort, term, class, paper total ─────── */}
      <section className="card mb-4 p-4 no-print" data-paper-bar>
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
          <label className="block">
            <span className="field-label">Exam type</span>
            <select
              className="select-field"
              value={picked.exam_type}
              data-field="exam-type"
              onChange={(event) => setPicked({ ...picked, exam_type: event.target.value })}
            >
              {EXAM_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="field-label">Term</span>
            <select
              className="select-field"
              value={picked.term_id}
              data-field="term"
              onChange={(event) => setPicked({ ...picked, term_id: event.target.value })}
            >
              {terms.map((entry) => (
                <option key={entry._id} value={entry._id}>
                  {entry.name} · {entry.academic_year}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="field-label">Class</span>
            <select
              className="select-field"
              value={picked.class_id}
              data-field="class"
              onChange={(event) => setPicked({ ...picked, class_id: event.target.value })}
            >
              {classes.map((entry) => (
                <option key={entry._id} value={entry._id}>
                  {entry.class_name} {entry.stream_name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="field-label">Paper is out of</span>
            <input
              className="input-field figure"
              type="number"
              min={1}
              inputMode="numeric"
              value={outOf}
              data-field="paper-out"
              disabled={locked}
              onChange={(event) => setOutOf(event.target.value)}
              onBlur={() => void commitTotal()}
            />
            <span className="mt-1 block text-[11px] text-ink/45" data-total-hint>
              {typedTotal > 0
                ? `1 mark = ${(100 / typedTotal).toFixed(1)}% · ${Math.round(typedTotal / 2)} = 50%`
                : `Enter the total this paper is marked out of (recorded: ${paper?.max_score ?? 100}).`}
            </span>
          </label>

          {/* ── subject: type a name or code, or scroll the list ───────── */}
          <div className="md:col-span-3 xl:col-span-2">
            <span className="field-label">Subject</span>
            <input
              className="input-field"
              type="search"
              value={query}
              placeholder="Type a subject name or Cambridge code…"
              aria-label="Search subjects"
              data-field="subject-search"
              onChange={(event) => setQuery(event.target.value)}
            />
            <div
              className="mt-1.5 max-h-[138px] overflow-y-auto rounded border border-rule bg-sunken p-1"
              role="listbox"
              aria-label="Subjects"
              data-subject-list
            >
              {filtered.map((entry) => {
                const selected = entry._id === picked.subject_id
                return (
                  <button
                    key={entry._id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    data-subject-option={entry._id}
                    className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-[12.5px] transition ${
                      selected ? 'bg-crimson font-medium text-white' : 'text-ink/75 hover:bg-raised'
                    }`}
                    onClick={() => setPicked({ ...picked, subject_id: entry._id })}
                  >
                    <span className="truncate">{entry.name}</span>
                    <span className="shrink-0 font-mono text-[10.5px] opacity-70">{entry.code}</span>
                  </button>
                )
              })}
              {filtered.length === 0 ? (
                <p className="px-2 py-3 text-center text-[11.5px] text-ink/45">No subject matches “{query}”.</p>
              ) : null}
            </div>
            <span className="mt-1 block text-[11px] text-ink/45" data-subject-picked>
              {subject ? `${subject.name} · ${subject.code}` : 'No subject selected'}
              {subject && !subjects.some((entry) => entry._id === subject._id)
                ? ' — not one of your assigned subjects'
                : ''}
            </span>
          </div>

          {/* ── sort the register ─────────────────────────────────────── */}
          <div className="md:col-span-3 xl:col-span-2 xl:self-end">
            <span className="field-label">Sort the register</span>
            <div className="mt-1 flex flex-wrap items-center gap-1.5" role="group" aria-label="Sort register">
              {(
                [
                  ['adm', 'Adm no.'],
                  ['name', 'Name'],
                  ['gender', 'Gender'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`btn btn-sm ${sortKey === key ? 'btn-primary' : ''}`}
                  aria-pressed={sortKey === key}
                  data-sort={key}
                  onClick={() => setSortKey(key)}
                >
                  {label}
                </button>
              ))}
              <span className="ml-1 font-mono text-[11px] text-ink/45" data-register-count>
                {roster.length} on register · {entered}/{roster.length} entered · out of {maxScore}
              </span>
            </div>
          </div>
        </div>
      </section>

      {locked ? (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded border border-danger/30 bg-danger/5 px-3 py-2.5 text-[12px] text-danger no-print"
        >
          <Lock size={14} className="mt-0.5 shrink-0" />
          <p>{permission.reason ?? 'This paper is read-only for your account.'}</p>
        </div>
      ) : null}

      {/* ── who is still missing a result, before the register ────────── */}
      {missing.length ? (
        <div
          role="alert"
          data-missing={missing.length}
          className={`mb-3 flex items-start gap-2 rounded border px-3 py-2.5 text-[12px] no-print ${
            locked ? 'border-brass/40 bg-brass/5 text-brass-deep' : 'border-warn/40 bg-warn/8 text-ink/75'
          }`}
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <p className="min-w-0">
            <span className="font-semibold">
              {missing.length} {missing.length === 1 ? 'result is' : 'results are'} not entered
            </span>
            {' — '}
            {missing.map((student) => student.full_name).join(', ')}.
            {locked
              ? ' This paper is read-only, so the blanks stay blank.'
              : paper
                ? ' If you leave this page they are recorded as X (missing marks).'
                : ' Nothing is saved until you key a result in, and once you do, leaving records the blanks as X.'}
          </p>
        </div>
      ) : null}

      <div className="card overflow-hidden no-print">
        <div className="overflow-x-auto">
          <table className="data-table min-w-[780px]">
            <thead>
              <tr>
                <th className="w-[46px]">#</th>
                <th>Admission no.</th>
                <th>Student</th>
                <th className="text-right">Score</th>
                <th className="w-[74px] text-right">%</th>
                <th className="w-[80px]">Grade</th>
                <th className="w-[100px]">Status</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((student, index) => {
                const state = flash[student._id]
                const error = errors[student._id]
                return (
                  <tr key={student._id}>
                    <td className="figure text-[11px] text-ink/40">{index + 1}</td>
                    <td className="figure text-[11.5px] text-ink/60">{student.admission_number}</td>
                    <td>
                      <p className="text-[13px] font-medium">{student.full_name}</p>
                      <p className="text-[10.5px] text-ink/40">{student.gender}</p>
                    </td>
                    <td className="text-right">
                      <input
                        ref={(node) => {
                          inputs.current[student._id] = node
                        }}
                        className={`input-field figure w-[86px] text-right ${
                          error ? 'border-danger focus:border-danger focus:ring-danger/15' : ''
                        }`}
                        value={drafts[student._id] ?? ''}
                        disabled={locked}
                        inputMode="text"
                        aria-label={`Score for ${student.full_name}`}
                        placeholder="—"
                        onChange={(event) =>
                          setDrafts((current) => ({ ...current, [student._id]: event.target.value }))
                        }
                        onBlur={() => void persist(student._id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            void persist(student._id).then((ok) => {
                              if (ok) focusOffset(student._id, 1)
                            })
                          } else if (event.key === 'ArrowDown') {
                            event.preventDefault()
                            focusOffset(student._id, 1)
                          } else if (event.key === 'ArrowUp') {
                            event.preventDefault()
                            focusOffset(student._id, -1)
                          }
                        }}
                      />
                      {error ? <p className="mt-1 text-[10px] text-danger">{error}</p> : null}
                    </td>
                    <td className="text-right">
                      <span className="figure text-[11.5px] text-ink/60" data-percent={student._id}>
                        {percentLabel(student._id)}
                      </span>
                    </td>
                    <td>
                      <GradePill grade={gradeForDraft(student._id)} size="sm" />
                    </td>
                    <td>
                      {state === 'saved' ? (
                        <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-ok">
                          <Check size={11} /> Saved
                        </span>
                      ) : state === 'error' ? (
                        <span className="text-[10.5px] font-medium text-danger">Rejected</span>
                      ) : markFor(student._id)?.score != null ? (
                        <span className="text-[10.5px] text-ink/45">Entered</span>
                      ) : (
                        <span className="text-[10.5px] text-ink/35">Pending</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-[11px] text-ink/45 no-print">
        <span>Enter commits and moves to the next student · ↑ ↓ navigate · blur saves</span>
        <span>
          Accepted: 0–{maxScore}, <strong>X</strong> missing marks, <strong>Y</strong> irregularity
        </span>
        {session?.role === 'teacher' ? (
          <span>
            {mayEnterMarks
              ? `Scoped to your assigned subjects${marksCloseAt ? ` · school closes ${formatDateTime(marksCloseAt)}` : ''}`
              : 'Your account is read-only — the registrar grants mark entry in Settings'}
          </span>
        ) : null}
      </div>

      {/* ── printed mark sheet ─────────────────────────────────────── */}
      <div className="print-only sheet print-page text-[10.5px]">
        <div className="mb-4 flex items-start justify-between border-b border-ink/25 pb-2">
          <div>
            <p className="text-[15px] font-semibold">{school.name}</p>
            <p className="text-[9px] text-ink/60">
              {school.address} · {school.postal} · {school.city} · {school.phone_number}
            </p>
          </div>
          <div className="text-right text-[9px] text-ink/60">
            <p>Marks Entry Sheet</p>
            <p>Printed {formatDate(new Date().toISOString())}</p>
          </div>
        </div>

        <h2 className="text-center text-[13px] font-semibold uppercase tracking-[0.16em]">Marks Entry Sheet</h2>
        <p className="mb-3 text-center text-[10px] text-ink/60">
          {subject?.name} ({subject?.code}) · {picked.exam_type} · {cls?.class_name} {cls?.stream_name} ·{' '}
          {term?.name} {term?.academic_year} · Out of {maxScore}
        </p>

        <table className="w-full border-collapse text-[10px]">
          <thead>
            <tr>
              {['#', 'Admission no.', 'Student name', 'Score', '%', 'Grade'].map((heading) => (
                <th
                  key={heading}
                  className="border border-ink/25 bg-ink/5 px-2 py-1 text-left font-semibold uppercase tracking-[0.08em]"
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roster.map((student, index) => {
              const score = markFor(student._id)?.score ?? null
              const grade =
                typeof score === 'number' ? gradeForMark(score, maxScore, scale.bands) : (score ?? '—')
              return (
                <tr key={student._id}>
                  <td className="border border-ink/15 px-2 py-1 tabular-nums">{index + 1}</td>
                  <td className="border border-ink/15 px-2 py-1 font-mono">{student.admission_number}</td>
                  <td className="border border-ink/15 px-2 py-1">{student.full_name}</td>
                  <td className="border border-ink/15 px-2 py-1 text-right font-mono">{displayScore(score)}</td>
                  <td className="border border-ink/15 px-2 py-1 text-right font-mono">
                    {typeof score === 'number' ? `${percentOf(score, maxScore).toFixed(1)}%` : '—'}
                  </td>
                  <td className="border border-ink/15 px-2 py-1">{grade}</td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <p className="mt-3 text-[8.5px] text-ink/60">
          <strong>X</strong> — missing marks (absent or incomplete assessment). <strong>Y</strong> — examination
          irregularity. Codes do not contribute to totals, means or positions.
        </p>

        <div className="mt-12 flex justify-between text-[9px] text-ink/70">
          <div className="w-[46%] border-t border-ink/40 pt-1">Subject teacher</div>
          <div className="w-[46%] border-t border-ink/40 pt-1">Head teacher</div>
        </div>
      </div>

      {teacher ? (
        <p className="mt-4 text-[11.5px] text-ink/45 no-print">
          Signed in as {teacher.full_name} · grade scale in use: {scale.name}
        </p>
      ) : (
        <p className="mt-4 text-[11.5px] text-ink/45 no-print">
          Grade scale in use: {scale.name} · {session?.role === 'admin' ? 'Registrar view — every subject' : ''}
        </p>
      )}

      {paper && paper.status !== 'open' ? (
        <p className="mt-2 text-[11.5px] text-ink/45 no-print">
          <Badge tone={paper.status === 'published' ? 'neutral' : 'danger'}>{paper.status}</Badge>{' '}
          <span className="ml-1">This paper was closed by the registrar.</span>
        </p>
      ) : null}
    </>
  )
}
