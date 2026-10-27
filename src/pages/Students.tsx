import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { MessageSquare, Paperclip, Plus, Search, Trash2 } from 'lucide-react'
import { api, useDb } from '../data/db'
import { useSession } from '../session'
import { Avatar, Badge, EmptyState, Field, GradePill, Modal, PageHeader, SectionTitle } from '../components/ui'
import { displayScore, gradeFor, gradeForMark, resolveScale } from '../lib/grading'
import { formatDate, formatDateTime, ordinal, round } from '../lib/format'
import { offeredSubjects } from '../lib/subjects'

type SortKey = 'name' | 'admission' | 'class'

interface AdmissionForm {
  full_name: string
  admission_number: string
  gender: 'Male' | 'Female'
  date_of_birth: string
  class_id: string
  subject_ids: string[] | null
  guardian_name: string
  guardian_phone: string
}

const BLANK_ADMISSION: AdmissionForm = {
  full_name: '',
  admission_number: '',
  gender: 'Female',
  date_of_birth: '',
  class_id: '',
  subject_ids: null,
  guardian_name: '',
  guardian_phone: '',
}

/** Next free number in the school's `IUPC/<year>/<nnn>` admission sequence. */
function nextAdmissionNumber(existing: string[]): string {
  const year = new Date().getFullYear()
  const prefix = `IUPC/${year}/`
  const used = existing
    .filter((value) => value.startsWith(prefix))
    .map((value) => Number(value.slice(prefix.length)))
    .filter((value) => Number.isFinite(value))
  return `${prefix}${String((used.length ? Math.max(...used) : 0) + 1).padStart(3, '0')}`
}

export default function Students() {
  const db = useDb()
  const { session } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const { studentId } = useParams()
  /** Set by the "Student" button on a class card: open the register on that stream. */
  const admitInto = (location.state as { admitInto?: string } | null)?.admitInto ?? null

  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'All' | 'Active' | 'Alumni'>('All')
  const [classId, setClassId] = useState(admitInto ?? 'all')
  const [sort, setSort] = useState<SortKey>('name')
  const [noteText, setNoteText] = useState('')
  const [adding, setAdding] = useState(Boolean(admitInto))
  const [form, setForm] = useState<AdmissionForm>(() =>
    admitInto
      ? {
          ...BLANK_ADMISSION,
          admission_number: nextAdmissionNumber(db.students.map((s) => s.admission_number)),
          class_id: admitInto,
        }
      : BLANK_ADMISSION,
  )
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')

  // Drop the one-shot router state so a reload doesn't reopen the dialog.
  useEffect(() => {
    if (admitInto) navigate(location.pathname, { replace: true, state: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const scale = resolveScale(db.gradingScales)
  const offered = useMemo(() => offeredSubjects(db.subjects), [db.subjects])
  const classSubjects = useMemo(() => {
    const classPapers = db.exams.filter((exam) => exam.class_id === form.class_id)
    const paperSubjectIds = new Set(classPapers.map((exam) => exam.subject_id))
    const offeredInClass = offered.filter((subject) => paperSubjectIds.has(subject._id))
    if (offeredInClass.length) return offeredInClass

    const classRow = db.classes.find((entry) => entry._id === form.class_id)
    const year = Number(classRow?.class_name.match(/\d+/)?.[0])
    const level = year >= 7 && year <= 9 ? 'Lower Secondary' : year >= 10 && year <= 11 ? 'IGCSE' : year >= 12 ? 'AS & A Level' : null
    return level ? offered.filter((subject) => subject.level === level) : offered
  }, [db.classes, db.exams, form.class_id, offered])

  const classLabel = (id: string) => {
    const cls = db.classes.find((c) => c._id === id)
    return cls ? `${cls.class_name} ${cls.stream_name}` : '—'
  }

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    const rows = db.students.filter((student) => {
      if (status !== 'All' && student.status !== status) return false
      if (classId !== 'all' && student.class_id !== classId) return false
      if (!term) return true
      return (
        student.full_name.toLowerCase().includes(term) ||
        student.admission_number.toLowerCase().includes(term) ||
        student.guardian_phone.toLowerCase().includes(term)
      )
    })
    return rows.sort((a, b) => {
      if (sort === 'admission') return a.admission_number.localeCompare(b.admission_number)
      if (sort === 'class') return classLabel(a.class_id).localeCompare(classLabel(b.class_id)) || a.full_name.localeCompare(b.full_name)
      return a.full_name.localeCompare(b.full_name)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.students, query, status, classId, sort, db.classes])

  const selected = studentId ? db.students.find((student) => student._id === studentId) : null

  const performance = selected
    ? db.marks
        .filter((mark) => mark.student_id === selected._id)
        .map((mark) => {
          const exam = db.exams.find((e) => e._id === mark.exam_id)
          const subject = db.subjects.find((s) => s._id === exam?.subject_id)
          return { mark, exam, subject }
        })
        .filter((row) => row.exam && row.subject)
        .sort((a, b) => (b.exam!.exam_date ?? '').localeCompare(a.exam!.exam_date ?? ''))
    : []

  const numericScores = performance
    .map((row) => row.mark.score)
    .filter((score): score is number => typeof score === 'number')
  const average = numericScores.length ? numericScores.reduce((a, b) => a + b, 0) / numericScores.length : null

  const notes = selected ? db.notes.filter((note) => note.student_id === selected._id) : []

  const canWrite = session?.role === 'admin' || session?.role === 'teacher'
  const isAdmin = session?.role === 'admin'

  function startAdmission(presetClass?: string) {
    setForm({
      ...BLANK_ADMISSION,
      admission_number: nextAdmissionNumber(db.students.map((s) => s.admission_number)),
      // Start in whichever class the roster is currently filtered to.
      class_id: presetClass ?? (classId !== 'all' ? classId : db.classes[0]?._id ?? ''),
      subject_ids: null,
    })
    setFormError('')
    setAdding(true)
  }

  async function admit(again: boolean) {
    const fullName = form.full_name.trim().replace(/\s+/g, ' ')
    const admissionNumber = form.admission_number.trim()
    if (fullName.length < 2) return setFormError("Enter the student's full name.")
    if (!admissionNumber) return setFormError('An admission number is required.')
    if (db.students.some((student) => student.admission_number.toLowerCase() === admissionNumber.toLowerCase())) {
      return setFormError(`${admissionNumber} is already on roll — check the register first.`)
    }
    if (!form.class_id) return setFormError('Choose the class the student joins.')
    await api.students.create({
      full_name: fullName,
      admission_number: admissionNumber,
      gender: form.gender,
      date_of_birth: form.date_of_birth,
      class_id: form.class_id,
      subject_ids: form.subject_ids ?? classSubjects.map((subject) => subject._id),
      guardian_name: form.guardian_name.trim(),
      guardian_phone: form.guardian_phone.trim(),
      status: 'Active',
    })
    setNotice(`${fullName} admitted to ${classLabel(form.class_id)} · ${admissionNumber}`)
    if (again) {
      setForm({
        ...BLANK_ADMISSION,
        admission_number: nextAdmissionNumber([...db.students.map((s) => s.admission_number), admissionNumber]),
        class_id: form.class_id,
        subject_ids: null,
      })
      setFormError('')
    } else {
      setAdding(false)
    }
  }

  async function addNote() {
    if (!selected || !noteText.trim()) return
    await api.notes.create(selected._id, noteText.trim(), session?.name ?? 'Staff')
    setNoteText('')
  }

  return (
    <>
      <PageHeader
        title="Students"
        subtitle={`${filtered.length} of ${db.students.length} on roll`}
        meta={
          <>
            <span>{db.students.filter((s) => s.status === 'Active').length} active</span>
            <span>{db.classes.length} streams</span>
          </>
        }
        actions={
          isAdmin ? (
            <button
              type="button"
              className="btn btn-primary w-full justify-center sm:w-auto"
              onClick={() => startAdmission()}
            >
              <Plus size={15} /> Add student
            </button>
          ) : (
            <p className="text-[12px] text-ink/50">
              {session?.role === 'teacher'
                ? 'Read-only roster — the registrar admits new students.'
                : 'Sign in as registrar to admit students.'}
            </p>
          )
        }
      />

      {notice ? (
        <p
          role="status"
          className="mb-4 flex items-center justify-between gap-3 rounded border border-ok/30 bg-ok/8 px-3 py-2 text-[12px] text-ok"
        >
          <span>{notice}</span>
          <button type="button" className="text-[11px] font-medium text-ok/70 hover:text-ok" onClick={() => setNotice('')}>
            Dismiss
          </button>
        </p>
      ) : null}

      <div className="card mb-4 flex flex-wrap items-end gap-2 p-3">
        <label className="relative min-w-[220px] flex-1">
          <span className="sr-only">Search students</span>
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
          <input
            className="input-field pl-8"
            placeholder="Search name, admission number or guardian phone"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          <span className="field-label">Status</span>
          <select className="select-field w-[130px]" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
            <option value="All">All</option>
            <option value="Active">Active</option>
            <option value="Alumni">Alumni</option>
          </select>
        </label>
        <label>
          <span className="field-label">Class</span>
          <select className="select-field w-[150px]" value={classId} onChange={(event) => setClassId(event.target.value)}>
            <option value="all">All classes</option>
            {db.classes.map((cls) => (
              <option key={cls._id} value={cls._id}>
                {cls.class_name} {cls.stream_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">Sort by</span>
          <select className="select-field w-[150px]" value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
            <option value="name">Name</option>
            <option value="admission">Admission no.</option>
            <option value="class">Class</option>
          </select>
        </label>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={db.students.length ? 'No students match those filters' : 'No students on roll'}
          hint={
            db.students.length
              ? 'Adjust the search or clear the filters to see the full roster.'
              : 'Admit the first student to start the register.'
          }
          action={
            !db.students.length && isAdmin ? (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => startAdmission()}>
                <Plus size={13} /> Add student
              </button>
            ) : db.students.length ? (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  setQuery('')
                  setStatus('All')
                  setClassId('all')
                }}
              >
                Clear filters
              </button>
            ) : null
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="data-table min-w-[760px]">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Admission no.</th>
                  <th>Class</th>
                  <th>Gender</th>
                  <th>Guardian</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((student) => (
                  <tr key={student._id}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={student.full_name} size={28} />
                        <button
                          type="button"
                          className="text-left font-medium hover:text-crimson"
                          onClick={() => navigate(`/dashboard/students/${student._id}`)}
                        >
                          {student.full_name}
                        </button>
                      </div>
                    </td>
                    <td className="figure text-[12px] text-ink/65">{student.admission_number}</td>
                    <td className="whitespace-nowrap text-[12px]">{classLabel(student.class_id)}</td>
                    <td className="text-[12px] text-ink/60">{student.gender}</td>
                    <td>
                      <p className="text-[12px]">{student.guardian_name}</p>
                      <p className="font-mono text-[11px] text-ink/45">{student.guardian_phone}</p>
                    </td>
                    <td>
                      <Badge tone={student.status === 'Active' ? 'ok' : 'neutral'}>{student.status}</Badge>
                    </td>
                    <td className="text-right">
                      <button type="button" className="btn btn-sm" onClick={() => navigate(`/dashboard/students/${student._id}`)}>
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        open={Boolean(selected)}
        title={selected ? selected.full_name : 'Student'}
        onClose={() => navigate('/dashboard/students')}
        width={620}
      >
        {selected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar name={selected.full_name} size={46} />
              <div>
                <p className="text-[14px] font-semibold">{selected.full_name}</p>
                <p className="text-[11.5px] text-ink/50">
                  {selected.admission_number} · {classLabel(selected.class_id)} · {selected.gender}
                </p>
              </div>
              <Badge tone={selected.status === 'Active' ? 'ok' : 'neutral'}>{selected.status}</Badge>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded border border-rule bg-sunken/50 px-3 py-2.5 text-[12px]">
              {[
                ['Date of birth', formatDate(selected.date_of_birth)],
                ['Guardian', selected.guardian_name],
                ['Guardian phone', selected.guardian_phone],
                ['Term average', average === null ? '—' : `${round(average)} · ${gradeFor(average, scale.bands)}`],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="micro">{label}</dt>
                  <dd className="mt-0.5 text-ink/80">{value}</dd>
                </div>
              ))}
            </dl>

            <div>
              <SectionTitle right={<span className="text-[11px] text-ink/45">{performance.length} records</span>}>
                Performance
              </SectionTitle>
              {performance.length === 0 ? (
                <p className="text-[12px] text-ink/45">No marks recorded for this student.</p>
              ) : (
                <ul className="divide-y divide-rule rounded border border-rule">
                  {performance.map(({ mark, exam, subject }) => {
                    const grade =
                      typeof mark.score === 'number'
                        ? gradeForMark(mark.score, exam?.max_score ?? 100, scale.bands)
                        : (mark.score ?? '—')
                    return (
                      <li key={mark._id} className="flex items-center justify-between gap-3 px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-[12.5px] font-medium">{subject?.name}</p>
                          <p className="text-[11px] text-ink/45">
                            {exam?.exam_name} · {formatDate(exam?.exam_date)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="figure text-[12.5px] text-ink/70">{displayScore(mark.score)}</span>
                          <GradePill grade={String(grade)} size="sm" />
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            <div>
              <SectionTitle right={<span className="text-[11px] text-ink/45">{notes.length} notes</span>}>Notes &amp; attachments</SectionTitle>
              <ul className="space-y-2">
                {notes.map((note) => (
                  <li key={note._id} className="rounded border border-rule px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[12.5px] text-ink/80">{note.body}</p>
                      {canWrite ? (
                        <button
                          type="button"
                          className="text-ink/30 hover:text-danger"
                          aria-label="Delete note"
                          onClick={() => api.notes.remove(note._id)}
                        >
                          <Trash2 size={13} />
                        </button>
                      ) : null}
                    </div>
                    <p className="mt-1 flex items-center gap-1.5 text-[10.5px] text-ink/40">
                      <MessageSquare size={10} /> {note.author_name} · {formatDateTime(note.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
              {canWrite ? (
                <div className="mt-2 flex items-end gap-2">
                  <label className="flex-1">
                    <span className="field-label">Add a note</span>
                    <input
                      className="input-field"
                      value={noteText}
                      onChange={(event) => setNoteText(event.target.value)}
                      placeholder="Record a guardian conversation, a concern, an achievement…"
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void addNote()
                      }}
                    />
                  </label>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => void addNote()} disabled={!noteText.trim()}>
                    <Plus size={13} /> Add
                  </button>
                </div>
              ) : null}
              <p className="mt-2 flex items-center gap-1.5 text-[10.5px] text-ink/35">
                <Paperclip size={10} /> File attachments are recorded in the data model but upload is not enabled in this build.
              </p>
            </div>

            <p className="text-[10.5px] text-ink/35">
              Marks, notes and the timetable are live. Editing an existing student's details and uploading attachments are not
              enabled in this build.
            </p>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={adding}
        title="Add student"
        onClose={() => setAdding(false)}
        width={620}
        footer={
          <>
            <button type="button" className="btn btn-sm" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-sm" onClick={() => void admit(true)}>
              Save &amp; add another
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void admit(false)}>
              Save student
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Full name">
            <input
              className="input-field"
              autoFocus
              value={form.full_name}
              onChange={(event) => setForm({ ...form, full_name: event.target.value })}
              placeholder="Amina Abdalla"
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Admission number" hint="Pre-filled from the register's number sequence.">
              <input
                className="input-field figure"
                value={form.admission_number}
                onChange={(event) => setForm({ ...form, admission_number: event.target.value })}
              />
            </Field>
            <Field label="Class">
              <select
                className="select-field"
                value={form.class_id}
                onChange={(event) => setForm({ ...form, class_id: event.target.value, subject_ids: null })}
              >
                <option value="">Choose a class</option>
                {db.classes.map((cls) => (
                  <option key={cls._id} value={cls._id}>
                    {cls.class_name} {cls.stream_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Gender">
              <select
                className="select-field"
                value={form.gender}
                onChange={(event) => setForm({ ...form, gender: event.target.value as 'Male' | 'Female' })}
              >
                <option value="Female">Female</option>
                <option value="Male">Male</option>
              </select>
            </Field>
            <Field label="Date of birth">
              <input
                type="date"
                className="input-field"
                value={form.date_of_birth}
                onChange={(event) => setForm({ ...form, date_of_birth: event.target.value })}
              />
            </Field>
            <Field label="Guardian name">
              <input
                className="input-field"
                value={form.guardian_name}
                onChange={(event) => setForm({ ...form, guardian_name: event.target.value })}
                placeholder="Hassan Abdalla"
              />
            </Field>
            <Field label="Guardian phone">
              <input
                className="input-field figure"
                value={form.guardian_phone}
                onChange={(event) => setForm({ ...form, guardian_phone: event.target.value })}
                placeholder="+254 700 000 000"
              />
            </Field>
          </div>
          <fieldset className="rounded border border-rule p-3">
            <legend className="px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/55">Subjects enrolled</legend>
            <p className="mb-2 text-[11px] text-ink/45">Select the subjects this student will study. The class curriculum is selected by default; you may change it or clear every subject.</p>
            {classSubjects.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {classSubjects.map((subject) => {
                  const checked = form.subject_ids === null || form.subject_ids.includes(subject._id)
                  return (
                    <label key={subject._id} className="flex min-h-9 cursor-pointer items-center gap-2 rounded border border-rule px-2.5 py-1.5 text-[12px] hover:bg-sunken">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setForm((current) => ({
                          ...current,
                          subject_ids: checked
                            ? (current.subject_ids ?? classSubjects.map((entry) => entry._id)).filter((id) => id !== subject._id)
                            : [...(current.subject_ids ?? classSubjects.map((entry) => entry._id)), subject._id],
                        }))}
                      />
                      <span className="min-w-0 flex-1 truncate">{subject.name}</span>
                      <span className="font-mono text-[10px] text-ink/45">{subject.code}</span>
                    </label>
                  )
                })}
              </div>
            ) : (
              <p className="text-[11px] text-ink/45">Choose a class with offered subjects to configure enrolment.</p>
            )}
          </fieldset>
          {formError ? (
            <p role="alert" className="rounded border border-danger/30 bg-danger/8 px-3 py-2 text-[12px] text-danger">
              {formError}
            </p>
          ) : null}
          {db.classes.length === 0 ? (
            <p className="text-[11.5px] text-ink/50">
              No streams exist yet — add a class on the Classes page before admitting students.
            </p>
          ) : null}
        </div>
      </Modal>

      {!isAdmin ? (
        <p className="mt-4 flex items-center gap-1.5 text-[11.5px] text-ink/45">
          <Badge tone="neutral">Read-only</Badge> Only administrators can admit new students.
        </p>
      ) : null}
    </>
  )
}
