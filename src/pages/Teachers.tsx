import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { KeyRound, PenLine, Search, ShieldCheck, Trash2, UserPlus } from 'lucide-react'
import { api, useDb } from '../data/db'
import { useSession } from '../session'
import { Avatar, Badge, EmptyState, Field, Modal, PageHeader, SectionTitle } from '../components/ui'
import { AccessBadge, PermissionSummary, PermissionToggles } from '../components/permissions'
import { grantedPermissions, hasPermission, normalisePermissions } from '../lib/permissions'
import { offeredSubjects } from '../lib/subjects'
import type { Teacher, TeacherPermissionKey } from '../data/types'

type AccessFilter = 'all' | 'entry' | 'readonly'

interface TeacherForm {
  full_name: string
  email: string
  employee_id: string
  subjectIds: string[]
  permissions: TeacherPermissionKey[]
}

/** Next free staff number, so the registrar never has to invent one. */
function nextEmployeeId(teachers: Teacher[]): string {
  const numbers = teachers.map((teacher) => Number(teacher.employee_id.match(/(\d+)\s*$/)?.[1] ?? 0))
  return `EMP-${String(Math.max(0, ...numbers) + 1).padStart(3, '0')}`
}

const blankForm = (teachers: Teacher[]): TeacherForm => ({
  full_name: '',
  email: '',
  employee_id: nextEmployeeId(teachers),
  subjectIds: [],
  permissions: [],
})

export default function Teachers() {
  const db = useDb()
  const { session } = useSession()
  const isAdmin = session?.role === 'admin'
  const [params, setParams] = useSearchParams()

  const [query, setQuery] = useState('')
  const [subjectQuery, setSubjectQuery] = useState('')
  const [access, setAccess] = useState<AccessFilter>('all')
  const [editor, setEditor] = useState<{ mode: 'new' } | { mode: 'edit'; id: string } | null>(null)
  const [form, setForm] = useState<TeacherForm>(() => blankForm(db.teachers))
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null)
  const [removeFor, setRemoveFor] = useState<string | null>(null)

  function openRegister() {
    setForm(blankForm(db.teachers))
    setError('')
    setEditor({ mode: 'new' })
  }

  // The top-bar button links here with ?register=1, so registering is one click
  // from any page. The flag is consumed immediately to keep the URL clean.
  useEffect(() => {
    if (params.get('register') === '1' && isAdmin) {
      openRegister()
      setParams({}, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, isAdmin])

  function openEdit(teacher: Teacher) {
    setForm({
      full_name: teacher.full_name,
      email: teacher.email,
      employee_id: teacher.employee_id,
      subjectIds: [...teacher.assigned_subject_ids],
      permissions: grantedPermissions(teacher),
    })
    setError('')
    setEditor({ mode: 'edit', id: teacher._id })
  }

  const entering = db.teachers.filter((teacher) => hasPermission(teacher, 'marks.enter')).length

  const offered = useMemo(() => offeredSubjects(db.subjects), [db.subjects])

  // The catalogue runs past two hundred syllabuses, so the picker filters on a
  // name or code and keeps what the teacher already holds at the top.
  const pickerSubjects = useMemo(() => {
    const needle = subjectQuery.trim().toLowerCase()
    return offered
      .filter((subject) => (needle ? `${subject.name} ${subject.code} ${subject.level}`.toLowerCase().includes(needle) : true))
      .sort(
        (a, b) =>
          Number(form.subjectIds.includes(b._id)) - Number(form.subjectIds.includes(a._id)) ||
          a.name.localeCompare(b.name) ||
          a.code.localeCompare(b.code),
      )
  }, [offered, subjectQuery, form.subjectIds])

  const staff = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return db.teachers
      .filter((teacher) =>
        needle ? `${teacher.full_name} ${teacher.email} ${teacher.employee_id}`.toLowerCase().includes(needle) : true,
      )
      .filter((teacher) =>
        access === 'all' ? true : access === 'entry' ? hasPermission(teacher, 'marks.enter') : !hasPermission(teacher, 'marks.enter'),
      )
      .sort((a, b) => a.full_name.localeCompare(b.full_name))
  }, [db.teachers, query, access])

  function toggleSubject(subjectId: string) {
    setForm((current) => ({
      ...current,
      subjectIds: current.subjectIds.includes(subjectId)
        ? current.subjectIds.filter((id) => id !== subjectId)
        : [...current.subjectIds, subjectId],
    }))
  }

  async function save() {
    const editingId = editor?.mode === 'edit' ? editor.id : null
    const name = form.full_name.trim().replace(/\s+/g, ' ')
    const email = form.email.trim().toLowerCase()
    const employeeId = form.employee_id.trim()

    if (!name) return setError('Enter the teacher’s full name.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return setError('Enter a staff email address, e.g. j.odhiambo@iupc.academy.')
    }
    if (!employeeId) return setError('Enter the staff number, e.g. EMP-042.')

    const clash = db.teachers.find(
      (teacher) =>
        teacher._id !== editingId &&
        (teacher.email.toLowerCase() === email || teacher.employee_id.toLowerCase() === employeeId.toLowerCase()),
    )
    if (clash) {
      const onEmail = clash.email.toLowerCase() === email
      return setError(
        onEmail
          ? `${clash.full_name} already signs in with ${email}. Use another address.`
          : `Staff number ${employeeId} belongs to ${clash.full_name}. Use another number.`,
      )
    }

    const payload = {
      full_name: name,
      email,
      employee_id: employeeId,
      assigned_subject_ids: form.subjectIds,
      permissions: normalisePermissions(form.permissions),
    }

    if (editingId) {
      await api.teachers.update(editingId, payload)
      setNotice({ tone: 'ok', text: `${name} updated — ${form.subjectIds.length} subject${form.subjectIds.length === 1 ? '' : 's'} assigned.` })
    } else {
      await api.teachers.create(payload)
      setNotice({
        tone: 'ok',
        text: `${name} added to the staff register as a read-only account. Grant mark entry in Settings → Teacher permissions.`,
      })
    }
    setEditor(null)
  }

  async function remove() {
    if (!removeFor) return
    const teacher = db.teachers.find((entry) => entry._id === removeFor)
    const result = await api.teachers.remove(removeFor)
    setRemoveFor(null)
    setNotice(
      result.ok
        ? { tone: 'ok', text: `${teacher?.full_name ?? 'The teacher'} removed from the staff register.` }
        : { tone: 'danger', text: result.reason },
    )
  }

  return (
    <>
      <PageHeader
        title="Teachers"
        subtitle="Staff register, the subjects each teacher holds, and their mark-entry permissions"
        meta={
          <>
            <span>{db.teachers.length} staff</span>
            <span>{entering} may enter marks</span>
            <span>{db.teachers.length - entering} read-only</span>
          </>
        }
        actions={
          isAdmin ? (
            <button type="button" className="btn btn-primary w-full justify-center sm:w-auto" data-action="register-teacher" onClick={openRegister}>
              <UserPlus size={15} /> Register teacher
            </button>
          ) : (
            <p className="text-[12px] text-ink/50">
              {session?.role === 'teacher'
                ? 'Read-only — the registrar maintains the staff register.'
                : 'Sign in as registrar to register staff.'}
            </p>
          )
        }
      />

      {notice ? (
        <p
          role="status"
          className={`mb-4 flex items-center justify-between gap-3 rounded border px-3 py-2 text-[12px] ${
            notice.tone === 'ok' ? 'border-ok/30 bg-ok/8 text-ok' : 'border-danger/30 bg-danger/8 text-danger'
          }`}
        >
          <span>{notice.text}</span>
          <button
            type="button"
            className="text-[11px] font-medium opacity-70 hover:opacity-100"
            onClick={() => setNotice(null)}
          >
            Dismiss
          </button>
        </p>
      ) : null}

      <div className="card mb-4 flex flex-wrap items-end gap-2 p-3 no-print">
        <label className="min-w-0 flex-1">
          <span className="field-label">Find staff</span>
          <span className="relative block">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
            <input
              className="input-field pl-8"
              value={query}
              data-field="staff-search"
              placeholder="Name, email or staff number"
              onChange={(event) => setQuery(event.target.value)}
            />
          </span>
        </label>
        <label className="min-w-0 sm:w-[210px]">
          <span className="field-label">Permissions</span>
          <select
            className="select-field"
            value={access}
            data-filter="access"
            onChange={(event) => setAccess(event.target.value as AccessFilter)}
          >
            <option value="all">All staff</option>
            <option value="entry">May enter marks</option>
            <option value="readonly">Read-only</option>
          </select>
        </label>
      </div>

      {staff.length === 0 ? (
        <EmptyState
          title={db.teachers.length === 0 ? 'No staff registered' : 'No staff match that search'}
          hint={
            db.teachers.length === 0
              ? 'Register a teacher, set the subjects they teach, then grant mark entry where it is needed.'
              : 'Clear the search or switch the permissions filter.'
          }
          action={
            isAdmin && db.teachers.length === 0 ? (
              <button type="button" className="btn btn-primary btn-sm" onClick={openRegister}>
                <UserPlus size={13} /> Register teacher
              </button>
            ) : null
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {staff.map((teacher) => {
            const subjects = db.subjects.filter((subject) => teacher.assigned_subject_ids.includes(subject._id))
            // min-w-0 on the card: the truncating email line would otherwise set
            // the grid track's min-content width and push past the viewport.
            return (
              <article key={teacher._id} className="card min-w-0 p-4" data-teacher={teacher._id}>
                <div className="flex items-start gap-3">
                  <Avatar name={teacher.full_name} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-medium">{teacher.full_name}</p>
                    <p className="truncate text-[11px] text-ink/45">
                      {teacher.email} · {teacher.employee_id}
                    </p>
                  </div>
                  <AccessBadge teacher={teacher} />
                </div>

                <div className="mt-3">
                  <p className="micro">Teaches · {subjects.length} subject{subjects.length === 1 ? '' : 's'}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {subjects.length === 0 ? (
                      <span className="text-[11px] text-ink/40">
                        No subjects assigned — this account can see no records.
                      </span>
                    ) : (
                      subjects.map((subject) => (
                        <span key={subject._id} className="chip" title={subject.name}>
                          {subject.code} · {subject.name}
                        </span>
                      ))
                    )}
                  </div>
                </div>

                <div className="mt-3 border-t border-rule pt-2">
                  <p className="micro">Permissions</p>
                  <div className="mt-1">
                    <PermissionSummary teacher={teacher} />
                  </div>
                </div>

                {isAdmin ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <button type="button" className="btn btn-sm" data-action="manage-teacher" onClick={() => openEdit(teacher)}>
                      <PenLine size={13} /> Manage
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      data-action="remove-teacher"
                      onClick={() => setRemoveFor(teacher._id)}
                    >
                      <Trash2 size={13} /> Remove
                    </button>
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      )}

      <section className="mt-7 no-print">
        <SectionTitle
          right={
            isAdmin ? (
              <span className="text-[11px] text-ink/45">Assign at registration or in the manage dialog</span>
            ) : null
          }
        >
          How access works
        </SectionTitle>
        <div className="card p-4 text-[12px] leading-relaxed text-ink/60">
          <p className="flex items-start gap-2">
            <KeyRound size={14} className="mt-0.5 shrink-0 text-ink/35" />
            <span>
              A teacher sees the records of the subjects assigned to them and nothing else — exams, broadsheets and
              analytics all follow that scope. Broadsheets are always read-only.
            </span>
          </p>
          <p className="mt-2 flex items-start gap-2">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-ink/35" />
            <span>
              Writing is granted, never assumed: an account starts read-only, and mark entry needs the registrar’s
              permission plus an open window. Marks stop being editable when the window closes, and a locked or
              published paper is read-only for everyone.
            </span>
          </p>
        </div>
      </section>

      <Modal
        open={Boolean(editor)}
        title={editor?.mode === 'edit' ? 'Manage teacher' : 'Register teacher'}
        onClose={() => setEditor(null)}
        width={620}
        footer={
          <>
            <button type="button" className="btn btn-sm" onClick={() => setEditor(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary btn-sm" data-action="save-teacher" onClick={() => void save()}>
              {editor?.mode === 'edit' ? 'Save changes' : 'Register teacher'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name">
              <input
                className="input-field"
                autoFocus
                data-field="teacher-name"
                value={form.full_name}
                placeholder="Jane Odhiambo"
                onChange={(event) => setForm({ ...form, full_name: event.target.value })}
              />
            </Field>
            <Field label="Staff number">
              <input
                className="input-field figure"
                data-field="teacher-employee-id"
                value={form.employee_id}
                onChange={(event) => setForm({ ...form, employee_id: event.target.value })}
              />
            </Field>
          </div>

          <Field label="Staff email" hint="This is the address they sign in with.">
            <input
              className="input-field"
              data-field="teacher-email"
              value={form.email}
              placeholder="j.odhiambo@iupc.academy"
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
          </Field>

          <div>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="field-label mb-0">Subjects taught</span>
              <span className="text-[10.5px] text-ink/45">
                {offered.length} offered here · {db.subjects.length} in the catalogue
              </span>
            </div>
            <input
              className="input-field mb-2"
              value={subjectQuery}
              data-field="subject-picker-search"
              placeholder="Find a subject — name or syllabus code"
              onChange={(event) => setSubjectQuery(event.target.value)}
            />
            <div className="flex max-h-[210px] flex-wrap content-start gap-1.5 overflow-y-auto rounded border border-rule bg-sunken/60 p-2">
              {pickerSubjects.length === 0 ? (
                <span className="px-1 py-0.5 text-[11px] text-ink/45">
                  Nothing offered here matches that search.
                </span>
              ) : null}
              {pickerSubjects.map((subject) => {
                const on = form.subjectIds.includes(subject._id)
                return (
                  <button
                    key={subject._id}
                    type="button"
                    data-subject={subject._id}
                    aria-pressed={on}
                    onClick={() => toggleSubject(subject._id)}
                    className={`rounded border px-2 py-1 text-[11px] transition ${
                      on ? 'border-crimson/40 bg-crimson/8 text-crimson' : 'border-rule bg-raised text-ink/55 hover:text-ink'
                    }`}
                  >
                    {subject.name} <span className="font-mono text-[10px] opacity-60">{subject.code}</span>
                  </button>
                )
              })}
            </div>
            <p className="mt-1 text-[11px] text-ink/45">
              {form.subjectIds.length === 0
                ? 'No subjects yet — the account will see no records until subjects are assigned.'
                : `Scopes what they can see read-only: ${form.subjectIds.length} subject${form.subjectIds.length === 1 ? '' : 's'}.`}
            </p>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="field-label mb-0">Permissions</span>
              <Badge tone="neutral">Read-only by default</Badge>
            </div>
            <div className="rounded border border-rule bg-sunken/60 px-2.5 py-1">
              <PermissionToggles
                value={form.permissions}
                idPrefix="form"
                onChange={(key, next) =>
                  setForm((current) => ({
                    ...current,
                    permissions: normalisePermissions(
                      next ? [...current.permissions, key] : current.permissions.filter((entry) => entry !== key),
                    ),
                  }))
                }
              />
            </div>
          </div>

          {error ? (
            <p role="alert" className="rounded border border-danger/30 bg-danger/8 px-3 py-2 text-[12px] text-danger">
              {error}
            </p>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={Boolean(removeFor)}
        title="Remove teacher"
        onClose={() => setRemoveFor(null)}
        width={440}
        footer={
          <>
            <button type="button" className="btn btn-sm" onClick={() => setRemoveFor(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn-danger btn-sm" data-action="confirm-remove-teacher" onClick={() => void remove()} >
              Remove record
            </button>
          </>
        }
      >
        <p className="text-[12.5px] text-ink/70">
          This removes {db.teachers.find((teacher) => teacher._id === removeFor)?.full_name ?? 'the teacher'} from the
          staff register along with their subject load and permissions. Recorded marks are kept. A teacher who still
          holds lessons on the timetable cannot be removed.
        </p>
      </Modal>

      {session?.role === 'guest' ? (
        <p className="mt-4">
          <Badge tone="brass">Read-only</Badge>{' '}
          <span className="text-[11.5px] text-ink/50">The staff register is visible but locked for guests.</span>
        </p>
      ) : null}
    </>
  )
}
