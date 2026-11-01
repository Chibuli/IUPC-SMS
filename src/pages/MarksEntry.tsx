import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Check, Loader2, Lock, Printer, X } from 'lucide-react'
import { api, findPaper, useDb } from '../data/db'
import { useQueueRecords, type SubmitOutcome } from '../lib/offline'
import { useSession } from '../session'
import { Badge, EmptyState, GradePill, PageHeader } from '../components/ui'
import { displayScore, gradeForMark, parseScoreInput, percentOf, resolveScale } from '../lib/grading'
import { formatDate, formatDateTime, todayIso } from '../lib/format'
import { usePrintPage } from '../lib/print'
import type { Database, ID, Student } from '../data/types'
import { isOperationalStudent } from '../data/student-lifecycle'
import { SubjectCombobox } from '../components/SubjectCombobox'
import './MarksEntry.css'

/** The five papers this campus sets, in the order a term runs them. */
const EXAM_TYPES = ['CAT 1', 'CAT 2', 'Midterm', 'Endterm', 'Pre-Mock'] as const

type SortKey = 'adm' | 'name' | 'gender'
type Flash = 'saved' | 'queued' | 'review' | 'error'

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
function verifiedEnrolledIn(student: Student, termId: string, subjectId: string): boolean {
  const subjectIds = student.subject_ids
  if (
    student.enrollment_certainty !== 'verified_enrolled' ||
    student.enrollment_term_id !== termId ||
    !Array.isArray(subjectIds) ||
    subjectIds.length === 0 ||
    subjectIds.some((id) => typeof id !== 'string' || id.trim().length === 0) ||
    new Set(subjectIds).size !== subjectIds.length
  ) return false
  return subjectIds.includes(subjectId)
}

function enrollmentLabel(student: Student, termId: string, subjectId: string): string {
  if (student.enrollment_term_id !== termId) return 'Enrollment scope not verified for this term'
  if (student.enrollment_certainty === 'error') return 'Enrollment verification failed'
  if (student.enrollment_certainty === 'unknown') return 'Enrollment scope unavailable'
  if (student.enrollment_certainty === 'verified_no_enrollments') return 'No enrolled subjects'
  if (student.enrollment_certainty === 'verified_enrolled') {
    return verifiedEnrolledIn(student, termId, subjectId) ? 'Enrolled · editable' : 'Not enrolled in this subject'
  }
  return 'Enrollment scope unavailable'
}

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
  const school = db.schools[0] ?? { _id: 'school-unconfigured', name: 'IUPC Academy', code: '', address: '', postal: '', city: '', contact_email: '', phone_number: '', logo_url: null, crest_url: null, motto: '' }

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
    const rows = db.students.filter(
      (student) => student.class_id === picked.class_id && isOperationalStudent(student),
    )
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
  const [activeStudent, setActiveStudent] = useState<string | null>(null)
  const saving = useRef(new Map<string, Promise<boolean>>())
  const advancing = useRef(new Set<string>())
  const workspace = useRef<HTMLDivElement>(null)
  const inputs = useRef<Record<string, HTMLInputElement | null>>({})
  const queued = useQueueRecords().filter(entry => !entry.locked && entry.payload.examId === paper?._id)
  const queueKey = JSON.stringify(queued.map(entry => [entry.id, entry.state, entry.payload, entry.last_error]))
  const previousSelection = useRef<string | null>(null)

  // Changing the paper clears the register: drafts belong to one sheet.
  useEffect(() => {
    const restored = initialDrafts()
    const statuses: Record<string, Flash> = {}
    const reasons: Record<string, string> = {}
    for (const entry of queued) {
      const studentId = entry.payload.studentId
      if (!roster.some(student => student._id === studentId)) continue
      restored[studentId] = entry.payload.score === null ? '' : String(entry.payload.score)
      statuses[studentId] = entry.state === 'Accepted' ? 'saved' : entry.state === 'Rejected' ? 'error' : entry.state === 'Blocked' ? 'review' : 'queued'
      if (entry.last_error && (entry.state === 'Rejected' || entry.state === 'Blocked')) reasons[studentId] = entry.last_error
    }
    const changedPaper = previousSelection.current !== selectionKey
    previousSelection.current = selectionKey
    // Queue transitions must not discard another learner's unfinished input.
    const queuedDrafts = Object.fromEntries(queued.map(entry => [entry.payload.studentId, entry.payload.score === null ? '' : String(entry.payload.score)]))
    setDrafts(current => changedPaper ? restored : { ...current, ...queuedDrafts })
    setFlash(statuses)
    setErrors(reasons)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, queueKey])

  const eligibleRoster = subject ? roster.filter((student) => verifiedEnrolledIn(student, picked.term_id, picked.subject_id)) : []
  // Measure the existing school navigation rather than assuming a header height.
  // The inner table header also clears the context when the outer page scrolls.
  useEffect(() => {
    const root = workspace.current
    const header = document.querySelector('.workspace-header')
    const context = root?.querySelector('.marks-context')
    if (!root || !header || !context) return
    let frame = 0
    const measure = () => {
      root.style.setProperty('--marks-nav-height', `${header.getBoundingClientRect().height}px`)
      const scroller = root.querySelector('.marks-table-scroll')
      const offset = window.innerWidth >= 1024 && scroller
        ? Math.max(0, context.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top) : 0
      root.style.setProperty('--marks-head-offset', `${offset}px`)
    }
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure) }
    const observer = new ResizeObserver(schedule)
    observer.observe(header); observer.observe(context)
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    measure()
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule)
    }
  }, [selectionKey, eligibleRoster.length, subjects.length])
  const unresolvedRoster = roster.filter(student => student.enrollment_term_id !== picked.term_id || !['verified_enrolled', 'verified_no_enrollments'].includes(student.enrollment_certainty ?? '') || (student.enrollment_certainty === 'verified_enrolled' && (!student.subject_ids?.length || new Set(student.subject_ids).size !== student.subject_ids.length || student.subject_ids.some(id => typeof id !== 'string' || !id.trim()))))
  const entered = eligibleRoster.filter((student) => {
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

  // Coalesce Enter/blur while the same row is saving; never submit twice in flight.
  function persist(studentId: string): Promise<boolean> {
    const saveKey = `${selectionKey}|${studentId}|${drafts[studentId] ?? ''}`
    const pending = saving.current.get(saveKey)
    if (pending) return pending
    const task = persistResult(studentId).catch(() => {
      setErrors(current => ({ ...current, [studentId]: 'Could not save. Check the connection and retry.' }))
      setFlash(current => ({ ...current, [studentId]: 'error' }))
      return false
    }).finally(() => saving.current.delete(saveKey))
    saving.current.set(saveKey, task)
    return task
  }

  async function persistResult(studentId: string) {
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
    if (session?.role === 'admin' && typeof navigator !== 'undefined' && !navigator.onLine) {
      // Administrator mark capture is online only, so it is refused rather than queued.
      setErrors((current) => ({ ...current, [studentId]: 'Administrators can only record marks while connected.' }))
      setFlash((current) => ({ ...current, [studentId]: 'error' }))
      return false
    }
    const outcome = await api.marks.setScore(await paperId(), studentId, parsed.value, teacher?._id ?? null)
    if (!reportOutcome(studentId, outcome)) return false
    if (outcome.state !== 'Accepted') return true
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
    const index = eligibleRoster.findIndex((student) => student._id === studentId)
    const next = eligibleRoster[index + offset]
    if (next) {
      inputs.current[next._id]?.focus({ preventScroll: true })
      inputs.current[next._id]?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
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
  const missing = eligibleRoster.filter((student) => {
    const mark = markFor(student._id)
    return !mark || mark.score === null
  })

  const [settling, setSettling] = useState(false)

  /**
   * What the queue actually did, in the one place the row's status is decided.
   * Only an accepted write may read as saved; a mark sitting on this device says
   * so; a refusal carries its reason.
   */
  function reportOutcome(studentId: string, outcome: SubmitOutcome): boolean {
    if (!outcome.persisted) {
      setErrors((current) => ({ ...current, [studentId]: outcome.detail }))
      setFlash((current) => ({ ...current, [studentId]: 'error' }))
      return false
    }
    if (outcome.state === 'Accepted') {
      setFlash((current) => ({ ...current, [studentId]: 'saved' }))
      return true
    }
    if (outcome.state === 'Rejected') {
      setErrors((current) => ({ ...current, [studentId]: outcome.detail }))
      setFlash((current) => ({ ...current, [studentId]: 'error' }))
      return false
    }
    if (outcome.state === 'Blocked') {
      setErrors((current) => ({ ...current, [studentId]: outcome.detail }))
      setFlash((current) => ({ ...current, [studentId]: 'review' }))
      return false
    }
    // Pending, Synchronizing, Retryable or Uncertain: on this device only.
    setFlash((current) => ({ ...current, [studentId]: 'queued' }))
    return true
  }

  /**
   * Recording the missing learners as X is now something the teacher asks for.
   * It used to happen silently on unload, where the writes were fire-and-forget
   * and nobody could tell whether they had reached the server.
   */
  async function settleMissing() {
    if (!paper || locked || settling || !missing.length) return
    if (session?.role === 'admin' && typeof navigator !== 'undefined' && !navigator.onLine) {
      setErrors((current) => ({ ...current, [missing[0]._id]: 'Administrators can only record marks while connected.' }))
      return
    }
    setSettling(true)
    try {
      for (const learner of missing) {
        const outcome = await api.marks.setScore(paper._id, learner._id, 'X', teacher?._id ?? null)
        reportOutcome(learner._id, outcome)
      }
    } finally {
      setSettling(false)
    }
  }

  function hasUnsavedInput(studentId: string) {
    const local = queued.find(entry => entry.payload.studentId === studentId)
    const recorded = local ? local.payload.score : markFor(studentId)?.score ?? null
    const parsed = parseScoreInput(drafts[studentId] ?? '', maxScore)
    return !parsed.ok || parsed.value !== recorded
  }
  // A queued result is recoverable; a draft that has not reached persist is not.
  function changeSelection(next: Selection) {
    if (eligibleRoster.some(student => hasUnsavedInput(student._id)) && !window.confirm('Leave this assessment? Unsaved input will be cleared. Results already saved or queued remain available.')) return
    setPicked(next)
  }
  const queuedCount = queued.filter(entry => !['Accepted', 'Rejected', 'Blocked', 'Uncertain'].includes(entry.state)).length
  const unconfirmedCount = queued.filter(entry => entry.state === 'Uncertain').length
  const attentionCount = new Set([...Object.keys(errors), ...Object.keys(flash).filter(id => flash[id] === 'review' || flash[id] === 'error'), ...queued.filter(entry => entry.state === 'Rejected' || entry.state === 'Blocked').map(entry => entry.payload.studentId)]).size
  const unsavedCount = eligibleRoster.filter(student => hasUnsavedInput(student._id)).length
  const saveSummary = [
    attentionCount ? `${attentionCount} ${attentionCount === 1 ? 'result needs' : 'results need'} attention` : '',
    unsavedCount ? `${unsavedCount} unsaved input${unsavedCount === 1 ? '' : 's'}` : '',
    queuedCount ? `${queuedCount} saved locally - pending synchronization` : '',
    unconfirmedCount ? `${unconfirmedCount} acceptance unconfirmed - see synchronization panel` : '',
  ].filter(Boolean).join(' | ') || (paper ? 'Recorded results loaded' : 'New paper - no saved results')

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
    <div className="marks-workspace" ref={workspace}>
      <PageHeader
        title="Marks Entry"
        subtitle="Select an assessment and enter student results."
        actions={
          <>
            {!locked && paper && missing.length > 0 ? (
              <button
                type="button"
                className="btn btn-sm"
                disabled={settling}
                onClick={() => void settleMissing()}
                data-action="settle-missing"
              >
                {settling ? <Loader2 size={13} className="animate-spin" /> : null} Record {missing.length} as X
              </button>
            ) : null}
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


      <section className="card marks-configuration no-print" aria-label="Assessment configuration" data-paper-bar>
        <label><span className="field-label">Exam type</span>
          <select className="select-field" value={picked.exam_type} data-field="exam-type" onChange={event => changeSelection({ ...picked, exam_type: event.target.value })}>
            {EXAM_TYPES.map(type => <option key={type}>{type}</option>)}
          </select>
        </label>
        <label><span className="field-label">Academic term</span>
          <select className="select-field" value={picked.term_id} data-field="term" onChange={event => changeSelection({ ...picked, term_id: event.target.value })}>
            {terms.map(entry => <option key={entry._id} value={entry._id}>{entry.name} · {entry.academic_year}</option>)}
          </select>
        </label>
        <label><span className="field-label">Class</span>
          <select className="select-field" value={picked.class_id} data-field="class" onChange={event => changeSelection({ ...picked, class_id: event.target.value })}>
            {classes.map(entry => <option key={entry._id} value={entry._id}>{entry.class_name} {entry.stream_name}</option>)}
          </select>
        </label>
        <label><span className="field-label">Maximum marks</span>
          <input className="input-field figure" type="number" min={1} inputMode="numeric" value={outOf} data-field="paper-out" disabled={locked}
            onChange={event => setOutOf(event.target.value)} onBlur={() => void commitTotal()} />
        </label>
        <SubjectCombobox subjects={subjects} selected={subject} onSelect={subject_id => changeSelection({ ...picked, subject_id })} />
      </section>
      <section className="card marks-register no-print" aria-labelledby="marks-register-heading">
        <div className="marks-context">
          <div><span className="marks-eyebrow">Current assessment</span>
            <p data-assessment-context>{cls?.class_name} {cls?.stream_name} · {subject?.name ?? 'Select a subject'} · {picked.exam_type} · {term?.name} ({term?.academic_year})</p>
          </div>
          <span className="marks-maximum">Maximum marks <strong>{maxScore}</strong></span>
        </div>
        <div className="marks-register-toolbar">
          <div><h2 id="marks-register-heading">Student marks register</h2><span data-register-count>{eligibleRoster.length} enrolled student{eligibleRoster.length === 1 ? '' : 's'}</span></div>
          <div className="marks-sort" role="group" aria-label="Sort register"><span>Sort</span>
            {([['adm', 'Adm no.'], ['name', 'Name'], ['gender', 'Gender']] as const).map(([key, label]) =>
              <button key={key} type="button" className="btn btn-sm" aria-pressed={sortKey === key} data-sort={key} onClick={() => setSortKey(key)}>{label}</button>)}
          </div>
        </div>
        <div className="marks-status-strip">
          <span className={locked ? 'text-danger' : 'text-ok'}>{locked ? <Lock size={13} /> : <Check size={13} />}{locked ? 'Read-only' : 'Editing open'}</span>
          <div className="marks-progress"><span>{eligibleRoster.length ? `${entered} of ${eligibleRoster.length} students entered` : 'No eligible register'}</span>
            {eligibleRoster.length > 0 && <progress aria-label="Recorded results" value={entered} max={eligibleRoster.length} />}
          </div>
          <span role="status" data-save-status>{saveSummary}</span>
        </div>
        {locked && <p className="marks-notice" role="note">{permission.reason ?? 'This paper is read-only for your account.'}</p>}
        {!subject ? <EmptyState title="Select a subject" hint="Choose a subject above to load the enrolled student register." /> : unresolvedRoster.length ?
          <p className="marks-notice" role="alert">Enrollment verification is unresolved for {unresolvedRoster.length} student{unresolvedRoster.length === 1 ? '' : 's'} in this class and period. Only verified subject enrollments are shown. Ask the registrar to check enrollment; reconnect to reload if verification failed. <button type="button" className="btn btn-sm" onClick={() => window.location.reload()}>Reload register</button></p> : null}
        {subject && !eligibleRoster.length && !unresolvedRoster.length && <EmptyState title="No eligible students" hint="No students in this class have verified enrollment in the selected subject for this term." />}
        {eligibleRoster.length > 0 && <div className="marks-table-scroll" tabIndex={0} role="region" aria-label="Student score entry; scroll for more students and columns">
          <table className="data-table marks-table">
            <thead><tr><th scope="col">#</th><th scope="col">Admission no.</th><th scope="col">Student</th><th scope="col" className="text-right">Score</th><th scope="col" className="text-right">%</th><th scope="col">Grade</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {eligibleRoster.map((student, index) => {
                const local = queued.find(entry => entry.payload.studentId === student._id)
                const state = flash[student._id] ?? (local?.state === 'Rejected' ? 'error' : local?.state === 'Blocked' ? 'review' : local && local.state !== 'Accepted' ? 'queued' : undefined)
                const error = errors[student._id] ?? (local && ['Rejected', 'Blocked'].includes(local.state) ? local.last_error : undefined)
                const enrolledForPaper = verifiedEnrolledIn(student, picked.term_id, picked.subject_id)
                const enrollmentStatus = enrollmentLabel(student, picked.term_id, picked.subject_id)
                return (
                  <tr key={student._id} data-student-row={student._id} data-active={activeStudent === student._id}>
                    <td className="figure text-[11px] text-ink/40">{index + 1}</td>
                    <td className="figure text-[11.5px] text-ink/60">{student.admission_number}</td>
                    <td>
                      <p className="text-[13px] font-medium">{student.full_name}</p>
                      <p className="text-[10.5px] text-ink/40">{student.gender} · {enrollmentStatus}</p>
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
                        disabled={locked || !enrolledForPaper}
                        inputMode="text"
                        aria-label={`Score for ${student.full_name}`}
                        aria-invalid={Boolean(error)}
                        aria-describedby={error ? `score-error-${student._id}` : undefined}
                        onFocus={() => setActiveStudent(student._id)}
                        placeholder="—"
                        onChange={(event) => {
                          setDrafts((current) => ({ ...current, [student._id]: event.target.value }))
                          setFlash(current => { const next = { ...current }; delete next[student._id]; return next })
                          setErrors(current => { const next = { ...current }; delete next[student._id]; return next })
                        }}
                        onBlur={() => { setActiveStudent(null); if (!advancing.current.has(student._id)) void persist(student._id) }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            if (event.repeat || advancing.current.has(student._id)) return
                            advancing.current.add(student._id)
                            void persist(student._id).then(ok => {
                              if (ok) focusOffset(student._id, 1)
                            }).finally(() => advancing.current.delete(student._id))
                          } else if (event.key === 'ArrowDown') {
                            event.preventDefault()
                            focusOffset(student._id, 1)
                          } else if (event.key === 'ArrowUp') {
                            event.preventDefault()
                            focusOffset(student._id, -1)
                          }
                        }}
                      />
                      {error ? <p id={`score-error-${student._id}`} role="alert" className="mt-1 text-[11px] text-danger">{error}</p> : null}
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
                      {/^[xy]$/i.test((drafts[student._id] ?? '').trim()) && <p className="text-[11px] font-medium">{(drafts[student._id] ?? '').trim().toUpperCase() === 'X' ? 'Missing mark' : 'Irregularity'}</p>}
                      {state === 'saved' ? (
                        <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-ok">
                          <Check size={11} /> Accepted
                        </span>
                      ) : state === 'queued' ? (
                        <span className="text-[10.5px] font-medium text-warn">{local?.state === 'Uncertain' ? 'Acceptance unconfirmed' : local?.state === 'Retryable' ? 'Sync retry needed' : local?.state === 'Synchronizing' ? 'Synchronizing' : 'Pending sync'}</span>
                      ) : state === 'review' ? (
                        <span className="text-[10.5px] font-medium text-danger">Needs review</span>
                      ) : state === 'error' ? (
                        <span className="text-[10.5px] font-medium text-danger">{queued.some(entry => entry.payload.studentId === student._id && entry.state === 'Rejected') ? 'Rejected' : 'Check result'}</span>
                      ) : !enrolledForPaper ? (
                        <span className="text-[10.5px] font-medium text-warn">{enrollmentStatus}</span>
                      ) : markFor(student._id)?.score != null ? (
                        <span className="text-[11px] text-ink/60">{hasUnsavedInput(student._id) ? 'Unsaved input' : 'Accepted'}</span>
                      ) : (
                        <span className="text-[11px] text-ink/55">{(drafts[student._id] ?? '').trim() ? 'Unsaved input' : 'Unentered'}</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>}
        <details className="marks-help"><summary>Keyboard help &amp; result key</summary>
          <p>Enter commits and moves to the next student. Up / Down move between score fields. Leaving a score field saves it. Valid entries: 0-{maxScore}; X = missing marks; Y = irregularity. X and Y are recorded outcomes, not numeric results. Percentages use the paper maximum.</p>
          <p>Pending sync means saved on this device only. Accepted means confirmed by the school database. Rejected or review-needed results require attention; see the row message and synchronization panel.</p>
          <p>Grade scale: {scale.name}. {scale.bands.map(band => `${band.grade}: >=${band.min_score}%`).join(' · ')}</p>
          {session?.role === 'teacher' && <p>{mayEnterMarks ? `Your assigned subjects${marksCloseAt ? ` · school closes ${formatDateTime(marksCloseAt)}` : ''}` : 'Your account is read-only; the registrar grants mark entry.'}</p>}
          {subject && !subjects.some(entry => entry._id === subject._id) && <p>This linked subject is outside your assigned subjects.</p>}
        </details>
        {missing.length > 0 && <details className="marks-help" data-missing={missing.length}><summary>{missing.length} results not entered</summary><p>{missing.map(student => student.full_name).join(', ')}. Blanks remain blank unless explicitly recorded as X.</p></details>}
      </section>

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
              {['#', 'Admission no.', 'Student name', 'Enrollment status', 'Score', '%', 'Grade'].map((heading) => (
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
                  <td className="border border-ink/15 px-2 py-1">{enrollmentLabel(student, picked.term_id, picked.subject_id)}</td>
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
    </div>
  )
}
