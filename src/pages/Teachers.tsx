import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { KeyRound, PenLine, RotateCcw, Search, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react'
import { api, useDb } from '../data/db'
import { useSession } from '../session'
import { supabaseConfigured } from '../data/supabase'
import { StaffInvitation } from '../components/BackendSetup'
import { inviteStaff, staffAccountStatuses } from '../data/backend'
import { invitationMessage, registerTeacherWithInvitation, type StaffAccountStatus } from '../lib/teacher-onboarding'
import { Avatar, Badge, EmptyState, Field, Modal, PageHeader, SectionTitle } from '../components/ui'
import { AccessBadge, AccountBadge, PermissionSummary, PermissionToggles } from '../components/permissions'
import { grantedPermissions, hasPermission, normalisePermissions } from '../lib/permissions'
import { offeredSubjects } from '../lib/subjects'
import {
  assignableClasses,
  classAssignmentLabel,
  classSelectionToSave,
  scopedClassIds,
  toggleClassAssignment,
} from '../lib/teacher-classes'
import { formatDateTime } from '../lib/format'
import type { Teacher, TeacherPermissionKey } from '../data/types'

type AccessFilter = 'all' | 'entry' | 'readonly' | 'awaiting'

interface TeacherForm {
  full_name: string
  email: string
  employee_id: string
  subjectIds: string[]
  classIds: string[]
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
  classIds: [],
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
  const [resetFor, setResetFor] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [accountStatuses, setAccountStatuses] = useState<Record<string, StaffAccountStatus>>({})
  const [statusError, setStatusError] = useState('')
  const statusGeneration = useRef(0)
  const schoolId = session?.schoolId
  const refreshAccountStatuses = useCallback(async () => {
    const generation = ++statusGeneration.current
    if (!supabaseConfigured || !isAdmin) return
    try {
      const statuses = await staffAccountStatuses()
      if (generation === statusGeneration.current) { setAccountStatuses(statuses); setStatusError('') }
    } catch {
      if (generation === statusGeneration.current) { setAccountStatuses({}); setStatusError('Authoritative account status is unavailable. Check the staff invitation service; teacher registration is still available.') }
    }
  }, [isAdmin, schoolId])
  useEffect(() => {
    setAccountStatuses({}); setStatusError('')
    void refreshAccountStatuses()
    return () => { ++statusGeneration.current }
  }, [refreshAccountStatuses])

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
      // Loaded explicitly so saving unrelated details sends the stored set back
      // and cannot leave the class register empty.
      classIds: classSelectionToSave(teacher.assigned_class_ids, undefined),
      permissions: grantedPermissions(teacher),
    })
    setError('')
    setEditor({ mode: 'edit', id: teacher._id })
  }

  const entering = db.teachers.filter((teacher) => hasPermission(teacher, 'marks.enter')).length
  const awaiting = db.teachers.filter((teacher) => supabaseConfigured ? accountStatuses[teacher._id] !== 'email_verified' : !teacher.password_hash).length

  const offered = useMemo(() => offeredSubjects(db.subjects), [db.subjects])
  // Only this school's streams may be assigned, even if a stale cache holds
  // another tenant's rows.
  const assignable = useMemo(
    () => (session?.schoolId ? assignableClasses(db.classes, session.schoolId) : db.classes),
    [db.classes, session?.schoolId],
  )

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
        access === 'all'
          ? true
          : access === 'entry'
            ? hasPermission(teacher, 'marks.enter')
            : access === 'readonly'
              ? !hasPermission(teacher, 'marks.enter')
              : supabaseConfigured ? accountStatuses[teacher._id] !== 'email_verified' : !teacher.password_hash,
      )
      .sort((a, b) => a.full_name.localeCompare(b.full_name))
  }, [db.teachers, query, access, accountStatuses])

  function toggleSubject(subjectId: string) {
    setForm((current) => ({
      ...current,
      subjectIds: current.subjectIds.includes(subjectId)
        ? current.subjectIds.filter((id) => id !== subjectId)
        : [...current.subjectIds, subjectId],
    }))
  }

  function toggleClass(classId: string) {
    setForm((current) => ({ ...current, classIds: toggleClassAssignment(current.classIds, classId) }))
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

    const classScope = session?.schoolId
      ? scopedClassIds(form.classIds, db.classes, session.schoolId)
      : { accepted: form.classIds, rejected: [] as string[] }
    if (classScope.rejected.length) {
      return setError('A selected class belongs to another school. Reload the staff register and try again.')
    }

    const payload = {
      full_name: name,
      email,
      employee_id: employeeId,
      assigned_subject_ids: form.subjectIds,
      assigned_class_ids: classScope.accepted,
      permissions: normalisePermissions(form.permissions),
    }

    if (savingRef.current) return
    savingRef.current = true; setSaving(true)
    try {
    if (editingId) {
      await api.teachers.update(editingId, payload)
      setNotice({
        tone: 'ok',
        text: `${name} updated — ${form.subjectIds.length} subject${form.subjectIds.length === 1 ? '' : 's'} and ${form.classIds.length} class${form.classIds.length === 1 ? '' : 'es'} assigned.`,
      })
    } else {
      const result = await registerTeacherWithInvitation(() => api.teachers.create(payload), supabaseConfigured ? inviteStaff : null)
      if (supabaseConfigured) {
        setAccountStatuses(current => ({ ...current, [result.teacher._id]: result.invitation?.status ?? 'requires_attention' }))
      }
      setNotice({
        tone: result.invitationError ? 'danger' : 'ok',
        text: supabaseConfigured
          ? `${name} was registered successfully. ${result.invitationError ? 'Invitation requires attention. The saved record is retained; use Check / send secure invitation on their card to retry after checking the service.' : result.invitation ? invitationMessage(result.invitation) : 'Invitation has not been started.'}`
          : `${name} added to the staff register. Their permissions and subjects are saved.`,
      })
    }
    setEditor(null)
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Teacher registration could not be completed.') }
    finally { savingRef.current = false; setSaving(false) }
  }

  /**
   * Clears the stored credential so the account goes back to awaiting sign-up.
   * The teacher's subjects and permissions are untouched: this only replaces how
   * they get in, not what they may do once they are in.
   */
  async function resetSignIn() {
    if (!resetFor) return
    const teacher = db.teachers.find((entry) => entry._id === resetFor)
    await api.teachers.setPassword(resetFor, null)
    setResetFor(null)
    setNotice({
      tone: 'ok',
      text: `${teacher?.full_name ?? 'The teacher'} can now create a new password at the sign-in page using ${teacher?.email ?? 'their staff email'}.`,
    })
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
            <span data-count="awaiting-signup">{awaiting} {supabaseConfigured ? 'need activation review' : 'awaiting sign-up'}</span>
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

      {supabaseConfigured && isAdmin ? <div className="mb-3 text-xs text-ink/60"><button type="button" className="btn btn-sm" onClick={() => void refreshAccountStatuses()}>Refresh account status</button>{statusError ? <p role="status" className="mt-2">{statusError}</p> : null}</div> : null}
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
            <option value="awaiting">{supabaseConfigured ? 'Needs activation review' : 'Awaiting sign-up'}</option>
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
            const classes = db.classes.filter((cls) => (teacher.assigned_class_ids ?? []).includes(cls._id))
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

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <AccountBadge teacher={teacher} status={accountStatuses[teacher._id]} />
                  <span className="text-[10.5px] text-ink/45" data-account={supabaseConfigured ? accountStatuses[teacher._id] ?? 'unknown' : teacher.password_hash ? 'active' : 'awaiting'}>
                    {supabaseConfigured ? accountStatuses[teacher._id] === 'email_verified' ? 'Auth confirms email verification and a sign-in. Password setup completion is not confirmed by this status.' : 'Only a secure email link allows password setup; the register alone does not activate an account.' : teacher.password_hash
                      ? `Chose their password ${teacher.activated_at ? formatDateTime(teacher.activated_at) : ''}`.trim()
                      : 'Recorded, but has never signed in — they create their own password.'}
                  </span>
                  {supabaseConfigured && isAdmin ? <StaffInvitation email={teacher.email} teacherId={teacher._id} disabled={saving} onDone={result => { setNotice({tone:'ok',text:invitationMessage(result)}); void refreshAccountStatuses() }}/> : null}
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

                <div className="mt-2" data-classes={classes.length}>
                  <p className="micro">Class assignments · {classes.length}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {classes.length === 0 ? (
                      <span className="text-[11px] text-ink/40">
                        None — class access follows their timetable lessons.
                      </span>
                    ) : (
                      <span className="text-[11px] text-ink/55">{classAssignmentLabel(classes)}</span>
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
                    {supabaseConfigured ? <p className="w-full text-xs text-ink/55">For an existing account, ask the teacher to use Forgot password on the sign-in page. This never clears their password or changes permissions.</p> : null}
                    <button type="button" className="btn btn-sm" data-action="manage-teacher" onClick={() => openEdit(teacher)}>
                      <PenLine size={13} /> Manage
                    </button>
                    {!supabaseConfigured && teacher.password_hash ? (
                      <button
                        type="button"
                        className="btn btn-sm"
                        data-action="reset-signin"
                        title="Clear the stored password so the teacher can choose a new one"
                        onClick={() => setResetFor(teacher._id)}
                      >
                        <RotateCcw size={13} /> Reset sign-in
                      </button>
                    ) : null}
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
          <p className="mt-2 flex items-start gap-2">
            <Users size={14} className="mt-0.5 shrink-0 text-ink/35" />
            <span>
              Class access comes from two places and either one is enough: a stream assigned here, or a lesson on
              their timetable. Assigning a class here lets them open that stream’s students, notes and report cards
              even before the timetable is built; clearing it does not take away lesson-based access.
            </span>
          </p>
          <p className="mt-2 flex items-start gap-2">
            <KeyRound size={14} className="mt-0.5 shrink-0 text-ink/35" />
            <span>
              {supabaseConfigured ? 'Registration saves the teacher and starts a secure email invitation. The teacher opens that email to verify ownership and choose a password. Failed invitations leave the staff record intact for review and retry. Existing accounts use Forgot password; subjects and permissions are preserved.' : 'Recording a teacher saves their staff details, subjects and permissions. Account access is managed separately.'}
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
            <button type="button" className="btn btn-primary btn-sm" data-action="save-teacher" disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving and checking invitation…' : editor?.mode === 'edit' ? 'Save changes' : 'Register teacher'}
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

          <Field label="Staff email" hint="A secure invitation to this official address lets the teacher verify ownership and choose their own password.">
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
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="field-label mb-0">Classes / streams</span>
              {form.classIds.length ? (
                <button
                  type="button"
                  className="text-[10.5px] text-ink/45 underline hover:text-ink"
                  data-action="clear-classes"
                  onClick={() => setForm((current) => ({ ...current, classIds: [] }))}
                >
                  Clear all
                </button>
              ) : (
                <Badge tone="neutral">None assigned</Badge>
              )}
            </div>
            <div className="flex max-h-[170px] flex-wrap content-start gap-1.5 overflow-y-auto rounded border border-rule bg-sunken/60 p-2">
              {assignable.length === 0 ? (
                <span className="px-1 py-0.5 text-[11px] text-ink/45">No streams are set up yet.</span>
              ) : null}
              {assignable.map((cls) => {
                const on = form.classIds.includes(cls._id)
                return (
                  <button
                    key={cls._id}
                    type="button"
                    data-class={cls._id}
                    aria-pressed={on}
                    onClick={() => toggleClass(cls._id)}
                    className={`rounded border px-2 py-1 text-[11px] transition ${
                      on ? 'border-crimson/40 bg-crimson/8 text-crimson' : 'border-rule bg-raised text-ink/55 hover:text-ink'
                    }`}
                  >
                    {cls.class_name} {cls.stream_name}
                  </button>
                )
              })}
            </div>
            <p className="mt-1 text-[11px] text-ink/45">
              {form.classIds.length
                ? `Grants ${form.classIds.length} stream${form.classIds.length === 1 ? '' : 's'} of students, note and report card access.`
                : 'No explicit stream — class access follows their timetable lessons.'}{' '}
              Clearing this list never removes timetable-based access.
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
        open={Boolean(resetFor)}
        title="Reset sign-in"
        onClose={() => setResetFor(null)}
        width={440}
        footer={
          <>
            <button type="button" className="btn btn-sm" onClick={() => setResetFor(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary btn-sm" data-action="confirm-reset-signin" onClick={() => void resetSignIn()}>
              Reset sign-in
            </button>
          </>
        }
      >
        <p className="text-[12.5px] text-ink/70">
          This clears the password stored for {db.teachers.find((teacher) => teacher._id === resetFor)?.full_name ?? 'the teacher'}.
          Their subjects and permissions are kept. The account returns to awaiting sign-up, and they choose a new password
          at the sign-in page with their staff email.
        </p>
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
