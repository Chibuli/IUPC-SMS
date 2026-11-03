import { useMemo, useState } from 'react'
import { Lock, Plus, Save, Undo2 } from 'lucide-react'
import { api, useDb } from '../data/db'
import { useSession } from '../session'
import { Badge, EmptyState, Field, Modal, PageHeader, ProgressBar } from '../components/ui'
import type { Exam, ExamStatus } from '../data/types'
import { formatDate, formatDateTime, isoToLocalInput, todayIso } from '../lib/format'
import {
  EXAM_STATUSES,
  EXAM_TYPES,
  STATUS_LABEL,
  eligibleRoster,
  paperDetailIssue,
  paperProgress,
  publicationIssue,
  publicationWarning,
  statusTone,
  transitionIssue,
  transitionsFrom,
  type StatusTransition,
} from '../lib/exam-lifecycle'

const UNCONFIGURED_SCHOOL = {
  _id: 'school-unconfigured',
  name: 'IUPC Academy',
  code: '',
  address: '',
  postal: '',
  city: '',
  contact_email: '',
  phone_number: '',
  logo_url: null,
  crest_url: null,
  motto: '',
}

/**
 * The registrar's Examinations page: every paper in the term, how far its
 * register has been completed, its deadline, and the lifecycle moves that turn
 * a draft into published results.
 *
 * Marks themselves are never written here. Editing a paper's total or status is
 * an administrator action against `exams` (RLS `exams admin write`), and the
 * database freezes scores once a paper leaves `open`.
 */
export default function Exams() {
  const db = useDb()
  const { session } = useSession()
  const isAdmin = session?.role === 'admin'
  const school = db.schools[0] ?? UNCONFIGURED_SCHOOL

  const terms = useMemo(() => [...db.terms].sort((a, b) => b.start_date.localeCompare(a.start_date)), [db.terms])
  const activeTerm = db.terms.find((term) => term.is_active) ?? terms[0]

  const [termId, setTermId] = useState(activeTerm?._id ?? '')
  const effectiveTermId = db.terms.some((term) => term._id === termId) ? termId : activeTerm?._id ?? ''
  const [classFilter, setClassFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<'all' | ExamStatus>('all')

  const subjectOf = (id: string) => db.subjects.find((subject) => subject._id === id)
  const classOf = (id: string) => db.classes.find((cls) => cls._id === id)
  const classLabel = (id: string) => {
    const cls = classOf(id)
    return cls ? `${cls.class_name} ${cls.stream_name}` : 'Unknown stream'
  }
  const paperTitle = (exam: Exam) => {
    const subject = subjectOf(exam.subject_id)
    return subject ? `${subject.name} · ${exam.exam_type}` : exam.exam_type
  }

  const progressFor = (exam: Exam) =>
    paperProgress(
      eligibleRoster(db, exam),
      db.marks.filter((mark) => mark.exam_id === exam._id),
    )

  const termPapers = db.exams.filter((exam) => exam.term_id === effectiveTermId)
  const papers = useMemo(
    () =>
      termPapers
        .filter((exam) => classFilter === 'all' || exam.class_id === classFilter)
        .filter((exam) => statusFilter === 'all' || exam.status === statusFilter)
        .sort(
          (a, b) =>
            a.exam_date.localeCompare(b.exam_date) ||
            classLabel(a.class_id).localeCompare(classLabel(b.class_id)) ||
            paperTitle(a).localeCompare(paperTitle(b)),
        ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db.exams, db.classes, db.subjects, effectiveTermId, classFilter, statusFilter],
  )

  const openCount = termPapers.filter((exam) => exam.status === 'open').length
  const publishedCount = termPapers.filter((exam) => exam.status === 'published').length
  const filtered = classFilter !== 'all' || statusFilter !== 'all'
  const selectedTerm = db.terms.find((term) => term._id === effectiveTermId)
  const markWindow = db.markWindows[0] ?? null

  /* ── creating a paper ─────────────────────────────────────────────────── */

  const offeredSubjects = useMemo(() => db.subjects.filter((subject) => subject.offered), [db.subjects])
  const [createOpen, setCreateOpen] = useState(false)
  const [createClass, setCreateClass] = useState(db.classes[0]?._id ?? '')
  const [createSubject, setCreateSubject] = useState(offeredSubjects[0]?._id ?? '')
  const [createType, setCreateType] = useState<string>(EXAM_TYPES[0])
  const [createDate, setCreateDate] = useState(todayIso().slice(0, 10))
  const [createScore, setCreateScore] = useState('100')
  const [createError, setCreateError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function openCreate() {
    setCreateClass(db.classes[0]?._id ?? '')
    setCreateSubject(offeredSubjects[0]?._id ?? '')
    setCreateType(EXAM_TYPES[0])
    setCreateDate(todayIso().slice(0, 10))
    setCreateScore('100')
    setCreateError(null)
    setCreateOpen(true)
  }

  async function createPaper() {
    const maxScore = Number(createScore)
    if (!effectiveTermId) return setCreateError('Choose a term first.')
    if (!createClass) return setCreateError('Choose the class that sits this paper.')
    if (!createSubject) return setCreateError('Choose the subject. Only subjects the campus offers can be examined.')
    const detailIssue = paperDetailIssue({ max_score: maxScore, exam_date: createDate, editing_deadline: null })
    if (detailIssue) return setCreateError(detailIssue)
    const duplicate = db.exams.find(
      (exam) =>
        exam.term_id === effectiveTermId &&
        exam.class_id === createClass &&
        exam.subject_id === createSubject &&
        exam.exam_type === createType,
    )
    if (duplicate) {
      setCreateError('That stream already has this paper for the selected term. Open it from the table instead.')
      return
    }
    setBusy(true)
    setCreateError(null)
    try {
      await api.exams.create({
        term_id: effectiveTermId,
        class_id: createClass,
        subject_id: createSubject,
        exam_name: createType,
        exam_type: createType,
        max_score: maxScore,
        exam_date: createDate,
        status: 'draft',
      })
      setCreateOpen(false)
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'The paper could not be created.')
    } finally {
      setBusy(false)
    }
  }

  /* ── managing one paper ───────────────────────────────────────────────── */

  const [manageId, setManageId] = useState<string | null>(null)
  const manageExam = manageId ? db.exams.find((exam) => exam._id === manageId) : undefined
  const [editScore, setEditScore] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editDeadline, setEditDeadline] = useState('')
  const [manageError, setManageError] = useState<string | null>(null)
  const [manageNotice, setManageNotice] = useState<string | null>(null)

  function openManage(exam: Exam) {
    setManageId(exam._id)
    setEditScore(String(exam.max_score))
    setEditDate(exam.exam_date)
    setEditDeadline(isoToLocalInput(exam.editing_deadline))
    setManageError(null)
    setManageNotice(null)
  }

  async function saveDetails() {
    if (!manageExam) return
    const maxScore = Number(editScore)
    const recordedScores = db.marks
      .filter((mark) => mark.exam_id === manageExam._id && typeof mark.score === 'number')
      .map((mark) => mark.score as number)
    const detailIssue = paperDetailIssue(
      { max_score: maxScore, exam_date: editDate, editing_deadline: editDeadline || null },
      recordedScores,
    )
    if (detailIssue) return setManageError(detailIssue)
    setBusy(true)
    setManageError(null)
    try {
      await api.exams.update(manageExam._id, {
        max_score: maxScore,
        exam_date: editDate,
        editing_deadline: editDeadline ? new Date(editDeadline).toISOString() : null,
      })
      setManageNotice('Paper details saved.')
    } catch (error) {
      setManageError(error instanceof Error ? error.message : 'The paper could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  async function applyTransition(exam: Exam, transition: StatusTransition) {
    // The database enforces this graph too; checking here turns a refused write
    // into a sentence before anything is sent.
    const invalid = transitionIssue(exam.status, transition.to)
    if (invalid) return setManageError(invalid)
    const progress = progressFor(exam)
    if (transition.to === 'published') {
      const issue = publicationIssue(progress, exam.status)
      if (issue) return setManageError(issue)
      const warning = publicationWarning(progress)
      if (warning && !window.confirm(`${warning}\n\nPublish ${paperTitle(exam)} anyway?`)) return
    }
    if (
      transition.to === 'open' &&
      exam.status === 'locked' &&
      !window.confirm('Reopen this paper for corrections? Teachers with marks entry can change scores again until it is locked.')
    ) {
      return
    }
    if (
      transition.to === 'locked' &&
      exam.status === 'published' &&
      !window.confirm('Withdraw this paper from publication? Results stay on broadsheets and report cards, but are no longer final.')
    ) {
      return
    }
    setBusy(true)
    setManageError(null)
    setManageNotice(null)
    try {
      await api.exams.update(exam._id, { status: transition.to })
      setManageNotice(`Paper is now ${STATUS_LABEL[transition.to].toLowerCase()}.`)
    } catch (error) {
      setManageError(error instanceof Error ? error.message : 'The paper status could not be changed.')
    } finally {
      setBusy(false)
    }
  }

  const manageProgress = manageExam ? progressFor(manageExam) : null
  const manageDeadline = manageExam ? manageExam.editing_deadline ?? markWindow?.closes_at ?? null : null

  return (
    <>
      <PageHeader
        title="Examinations"
        subtitle="Every paper for the term, its register and its lifecycle — draft, open, locked, published"
        meta={
          <>
            <span>{selectedTerm ? `${selectedTerm.name} · ${selectedTerm.academic_year}` : 'No term configured'}</span>
            <span>
              {termPapers.length} paper{termPapers.length === 1 ? '' : 's'} · {openCount} open · {publishedCount} published
            </span>
            <span>{school.name}</span>
          </>
        }
        actions={
          isAdmin ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={openCreate}
              disabled={!db.classes.length || !offeredSubjects.length}
              data-action="create-paper"
            >
              <Plus size={14} /> New paper
            </button>
          ) : null
        }
      />

      <div className="card mb-4 flex flex-wrap items-end gap-2 p-3">
        <label>
          <span className="field-label">Term</span>
          <select
            className="select-field w-[210px]"
            value={effectiveTermId}
            data-filter="exam-term"
            onChange={(event) => setTermId(event.target.value)}
          >
            {terms.map((term) => (
              <option key={term._id} value={term._id}>
                {term.name} · {term.academic_year}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">Class / stream</span>
          <select
            className="select-field w-[190px]"
            value={classFilter}
            data-filter="exam-class"
            onChange={(event) => setClassFilter(event.target.value)}
          >
            <option value="all">Every stream</option>
            {db.classes.map((cls) => (
              <option key={cls._id} value={cls._id}>
                {cls.class_name} {cls.stream_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">Status</span>
          <select
            className="select-field w-[170px]"
            value={statusFilter}
            data-filter="exam-status"
            onChange={(event) => setStatusFilter(event.target.value as 'all' | ExamStatus)}
          >
            <option value="all">Every status</option>
            {EXAM_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABEL[status]}
              </option>
            ))}
          </select>
        </label>
        {filtered ? (
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setClassFilter('all')
              setStatusFilter('all')
            }}
          >
            Reset
          </button>
        ) : null}
        <span className="ml-auto text-[11px] text-ink/45">
          Mark-entry window: {markWindow?.closes_at ? formatDateTime(markWindow.closes_at) : 'no school-wide deadline'}
        </span>
      </div>

      {!terms.length ? (
        <EmptyState
          title="No academic terms configured"
          hint="Create a term first: every paper belongs to a term, and the term decides which register is used."
        />
      ) : papers.length === 0 ? (
        <EmptyState
          title={termPapers.length ? 'No paper matches these filters' : 'No papers for this term yet'}
          hint={
            isAdmin
              ? 'Create a paper, or record a result in Marks Entry and the paper appears here automatically.'
              : 'The registrar creates papers. Marks Entry shows the ones assigned to you.'
          }
          action={
            isAdmin && !termPapers.length ? (
              <button type="button" className="btn btn-sm" onClick={openCreate}>
                <Plus size={13} /> New paper
              </button>
            ) : null
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="data-table min-w-[900px]">
              <thead>
                <tr>
                  <th>Paper</th>
                  <th>Class</th>
                  <th>Date</th>
                  <th className="text-right">Max</th>
                  <th className="w-[160px]">Register</th>
                  <th>Deadline</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {papers.map((exam) => {
                  const subject = subjectOf(exam.subject_id)
                  const progress = progressFor(exam)
                  return (
                    <tr key={exam._id} data-exam={exam._id}>
                      <td>
                        <p className="font-medium">{subject?.name ?? 'Unknown subject'}</p>
                        <p className="text-[11px] text-ink/45">
                          <span className="font-mono">{subject?.code ?? '—'}</span> · {exam.exam_type}
                        </p>
                      </td>
                      <td className="whitespace-nowrap text-[12px]">{classLabel(exam.class_id)}</td>
                      <td className="whitespace-nowrap text-[12px] text-ink/60">{formatDate(exam.exam_date)}</td>
                      <td className="num">{exam.max_score}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <ProgressBar
                            value={progress.recorded}
                            total={progress.roster}
                            tone={progress.complete ? 'ok' : progress.recorded ? 'brass' : 'crimson'}
                          />
                          <span className="whitespace-nowrap font-mono text-[11px] text-ink/55">
                            {progress.roster ? `${progress.recorded}/${progress.roster}` : '—'}
                          </span>
                        </div>
                        <span className="mt-1 inline-block text-[10.5px] text-ink/45">
                          {progress.roster === 0
                            ? 'No verified enrollment'
                            : progress.complete
                              ? 'Complete'
                              : `${progress.missing} outstanding`}
                        </span>
                      </td>
                      <td className="whitespace-nowrap text-[11.5px] text-ink/60">
                        {exam.editing_deadline ? formatDateTime(exam.editing_deadline) : 'School window'}
                      </td>
                      <td>
                        <Badge tone={statusTone(exam.status)}>{STATUS_LABEL[exam.status]}</Badge>
                      </td>
                      <td className="text-right">
                        {isAdmin ? (
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => openManage(exam)}
                            data-action="manage-paper"
                          >
                            Manage
                          </button>
                        ) : (
                          <span className="text-[11px] text-ink/35">Read-only</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="mt-4 flex items-start gap-2 text-[11.5px] leading-relaxed text-ink/50">
        <Lock size={13} className="mt-0.5 shrink-0 text-ink/35" />
        <span>
          A paper is writable only while it is <strong>open</strong>; locking or publishing freezes every score in the
          database, not just in this browser. Status and total changes are administrator-only, and each paper can hold
          one result per student. Mark <strong>X</strong> means a missing paper, <strong>Y</strong> an irregularity —
          both count as recorded outcomes.
        </span>
      </p>

      {/* create */}
      <Modal
        open={createOpen}
        title="New examination paper"
        onClose={() => setCreateOpen(false)}
        width={560}
        footer={
          <>
            <button type="button" className="btn btn-sm" onClick={() => setCreateOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => void createPaper()}
              disabled={busy}
              data-action="save-paper"
            >
              {busy ? 'Saving…' : 'Create paper'}
            </button>
          </>
        }
      >
        <p className="text-[11.5px] leading-snug text-ink/55">
          A paper belongs to one stream and one subject. It starts as a draft, invisible to marks entry, until you open
          it here.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Term">
            <input className="input-field" value={selectedTerm ? `${selectedTerm.name} · ${selectedTerm.academic_year}` : 'No term'} disabled />
          </Field>
          <Field label="Class / stream">
            <select className="select-field" value={createClass} onChange={(event) => setCreateClass(event.target.value)}>
              {db.classes.map((cls) => (
                <option key={cls._id} value={cls._id}>
                  {cls.class_name} {cls.stream_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Subject" hint="Only what the campus offers can be examined.">
            <select className="select-field" value={createSubject} onChange={(event) => setCreateSubject(event.target.value)}>
              {offeredSubjects.map((subject) => (
                <option key={subject._id} value={subject._id}>
                  {subject.name} · {subject.code}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Assessment">
            <select className="select-field" value={createType} onChange={(event) => setCreateType(event.target.value)}>
              {EXAM_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date sat">
            <input className="input-field" type="date" value={createDate} onChange={(event) => setCreateDate(event.target.value)} />
          </Field>
          <Field label="Maximum marks">
            <input
              className="input-field figure"
              type="number"
              min={1}
              value={createScore}
              onChange={(event) => setCreateScore(event.target.value)}
            />
          </Field>
        </div>
        {createError ? (
          <p role="alert" className="mt-3 rounded border border-danger/30 bg-danger/5 px-3 py-2 text-[12px] text-danger">
            {createError}
          </p>
        ) : null}
      </Modal>

      {/* manage */}
      <Modal
        open={Boolean(manageExam)}
        title={manageExam ? paperTitle(manageExam) : 'Paper'}
        onClose={() => setManageId(null)}
        width={620}
        footer={
          <>
            <button type="button" className="btn btn-sm" onClick={() => setManageId(null)}>
              Close
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void saveDetails()} disabled={busy}>
              <Save size={13} /> Save details
            </button>
          </>
        }
      >
        {manageExam && manageProgress ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <Badge tone={statusTone(manageExam.status)}>{STATUS_LABEL[manageExam.status]}</Badge>
              <span className="text-ink/60">{classLabel(manageExam.class_id)}</span>
              <span className="text-ink/60">
                {manageProgress.roster ? `${manageProgress.recorded} of ${manageProgress.roster} results recorded` : 'No verified enrollment'}
              </span>
              {manageProgress.missing > 0 ? <span className="text-warn">{manageProgress.missing} outstanding</span> : null}
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Maximum marks">
                <input
                  className="input-field figure"
                  type="number"
                  min={1}
                  value={editScore}
                  onChange={(event) => setEditScore(event.target.value)}
                />
              </Field>
              <Field label="Date sat">
                <input className="input-field" type="date" value={editDate} onChange={(event) => setEditDate(event.target.value)} />
              </Field>
              <Field
                label="This paper closes after"
                hint={
                  manageDeadline
                    ? experienceDeadlineHint(Boolean(manageExam.editing_deadline), manageDeadline)
                    : 'Leave empty: no deadline, so the paper stays open while its status is open.'
                }
              >
                <input
                  className="input-field"
                  type="datetime-local"
                  value={editDeadline}
                  onChange={(event) => setEditDeadline(event.target.value)}
                />
              </Field>
              <div className="flex items-end">
                {editDeadline ? (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setEditDeadline('')}
                    title="Fall back to the school-wide window"
                  >
                    <Undo2 size={12} /> Use school window
                  </button>
                ) : null}
              </div>
            </div>

            <div className="mt-4 border-t border-rule pt-3">
              <p className="micro mb-2">Lifecycle</p>
              <div className="space-y-2">
                {transitionsFrom(manageExam.status).map((transition) => (
                  <div key={transition.to} className="flex flex-wrap items-start gap-2 rounded border border-rule p-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] font-medium">{transition.label}</p>
                      <p className="mt-0.5 text-[11px] leading-snug text-ink/50">{transition.hint}</p>
                    </div>
                    <button
                      type="button"
                      className={`btn btn-sm ${transition.to === 'published' ? 'btn-primary' : ''}`}
                      disabled={busy}
                      data-transition={transition.to}
                      onClick={() => void applyTransition(manageExam, transition)}
                    >
                      {transition.label}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {manageError ? (
              <p role="alert" className="mt-3 rounded border border-danger/30 bg-danger/5 px-3 py-2 text-[12px] text-danger">
                {manageError}
              </p>
            ) : null}
            {manageNotice ? (
              <p role="status" className="mt-3 rounded border border-ok/30 bg-ok/8 px-3 py-2 text-[12px] text-ok">
                {manageNotice}
              </p>
            ) : null}
          </>
        ) : null}
      </Modal>
    </>
  )
}

/** One sentence saying where a deadline comes from. */
function experienceDeadlineHint(ownDeadline: boolean, effective: string): string {
  return ownDeadline
    ? `This paper closes on ${formatDateTime(effective)}, overriding the school-wide window.`
    : `No deadline on this paper, so it uses the school-wide window (${formatDateTime(effective)}).`
}
