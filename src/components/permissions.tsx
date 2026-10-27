import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock, KeyRound, ShieldOff } from 'lucide-react'
import { api, useDb } from '../data/db'
import type { Teacher, TeacherPermissionKey } from '../data/types'
import {
  PERMISSIONS,
  accessSummary,
  grantedPermissions,
  hasPermission,
  permissionDefinition,
  windowSummary,
} from '../lib/permissions'
import { isoToLocalInput } from '../lib/format'
import { Avatar, Badge, Modal, SectionTitle } from './ui'

/** One phrase for what an account may do: read-only, or writing marks. */
export function AccessBadge({ teacher }: { teacher: Pick<Teacher, 'permissions'> }) {
  const entering = hasPermission(teacher, 'marks.enter')
  return <Badge tone={entering ? 'ok' : 'neutral'}>{accessSummary(teacher)}</Badge>
}

/**
 * The catalogue as checkboxes. Used both on a teacher's record and in the
 * registrar's school-wide permissions list, so a grant means the same thing
 * wherever it is made.
 */
export function PermissionToggles({
  value,
  onChange,
  idPrefix,
  disabled = false,
}: {
  value: TeacherPermissionKey[]
  onChange: (key: TeacherPermissionKey, next: boolean) => void
  idPrefix: string
  disabled?: boolean
}) {
  return (
    <ul className="divide-y divide-rule">
      {PERMISSIONS.map((entry) => {
        const on = value.includes(entry.key)
        const inputId = `${idPrefix}-${entry.key.replace(/\./g, '-')}`
        return (
          <li key={entry.key} className="flex items-start gap-2.5 py-2 first:pt-0 last:pb-0">
            <input
              id={inputId}
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-crimson"
              checked={on}
              disabled={disabled}
              data-permission={entry.key}
              onChange={(event) => onChange(entry.key, event.target.checked)}
            />
            <label htmlFor={inputId} className={`min-w-0 ${disabled ? '' : 'cursor-pointer'}`}>
              <span className="block text-[12.5px] font-medium text-ink">{entry.label}</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-ink/50">{entry.summary}</span>
              <span className="mt-0.5 block text-[10.5px] leading-snug text-ink/40">{entry.note}</span>
            </label>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * The registrar's list: every teacher with the permissions they hold, the
 * school-wide deadline, and one-click reduction back to read-only.
 */
export function TeacherPermissionsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const db = useDb()
  const markWindow = db.markWindows[0] ?? null
  const [closesAt, setClosesAt] = useState(() => isoToLocalInput(markWindow?.closes_at ?? null))
  const [confirmAll, setConfirmAll] = useState(false)
  const [saved, setSaved] = useState(false)

  const entering = db.teachers.filter((teacher) => hasPermission(teacher, 'marks.enter')).length

  async function saveWindow(value: string | null) {
    await api.markWindow.save(value ? new Date(value).toISOString() : null)
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1600)
  }

  return (
    <Modal
      open={open}
      title="Teacher permissions"
      onClose={onClose}
      width={780}
      footer={
        <button type="button" className="btn btn-sm" onClick={onClose}>
          Done
        </button>
      }
    >
      <section className="rounded border border-rule bg-sunken/50 p-3">
        <SectionTitle right={<Clock size={14} className="text-ink/35" />}>Mark-entry window</SectionTitle>
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1">
            <span className="field-label">Marks close after</span>
            <input
              className="input-field"
              type="datetime-local"
              // Left empty when nothing is stored: an empty field is the honest
              // reading of "papers stay open", a placeholder date is not.
              value={closesAt}
              data-field="marks-window"
              onChange={(event) => setClosesAt(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            data-action="save-window"
            onClick={() => void saveWindow(closesAt)}
          >
            {saved ? 'Saved' : 'Save window'}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            data-action="clear-window"
            onClick={() => {
              setClosesAt('')
              void saveWindow(null)
            }}
          >
            Leave open
          </button>
        </div>
        <p className="mt-2 text-[11.5px] leading-snug text-ink/55">{windowSummary(markWindow)}</p>
        <p className="mt-1 text-[11px] leading-snug text-ink/40">
          A deadline set on one paper on the Exams page overrides this. Teachers with “keep editing after the
          window closes” are exempt; a locked or published paper refuses everyone.
        </p>
      </section>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <SectionTitle right={<span className="text-[11px] text-ink/45">{entering} of {db.teachers.length} may enter marks</span>}>
          Staff permissions
        </SectionTitle>
      </div>

      {confirmAll ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded border border-danger/30 bg-danger/5 px-3 py-2 text-[12px] text-danger">
          <span>Revoke every granted permission and make all {db.teachers.length} accounts read-only?</span>
          <button
            type="button"
            className="btn btn-danger btn-sm"
            data-action="confirm-revoke-all"
            onClick={() => {
              void Promise.all(db.teachers.map((teacher) => api.teachers.setPermissions(teacher._id, []))).then(() =>
                setConfirmAll(false),
              )
            }}
          >
            Yes, revoke all
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setConfirmAll(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn-sm mb-3"
          data-action="revoke-all"
          disabled={entering === 0}
          onClick={() => setConfirmAll(true)}
        >
          <ShieldOff size={13} /> Make every teacher read-only
        </button>
      )}

      <div className="space-y-3">
        {db.teachers.map((teacher) => {
          const granted = grantedPermissions(teacher)
          const subjects = db.subjects.filter((subject) => teacher.assigned_subject_ids.includes(subject._id))
          return (
            <article key={teacher._id} className="rounded border border-rule p-3" data-permission-row={teacher._id}>
              <div className="flex flex-wrap items-center gap-2">
                <Avatar name={teacher.full_name} size={30} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">{teacher.full_name}</p>
                  <p className="truncate text-[11px] text-ink/45">
                    {teacher.email} · {teacher.employee_id}
                  </p>
                </div>
                <AccessBadge teacher={teacher} />
                {granted.length > 0 ? (
                  <button
                    type="button"
                    className="btn btn-sm"
                    data-action="revoke-teacher"
                    onClick={() => void api.teachers.setPermissions(teacher._id, [])}
                  >
                    <ShieldOff size={12} /> Read-only
                  </button>
                ) : null}
              </div>

              <p className="mt-2 text-[11px] text-ink/50">
                <KeyRound size={11} className="mr-1 inline text-ink/35" />
                {subjects.length
                  ? `Subject access: ${subjects.map((subject) => subject.code).join(', ')}`
                  : 'No subjects assigned — this account can see no records at all.'}{' '}
                <Link to="/dashboard/teachers" className="text-crimson hover:underline">
                  Change on the register
                </Link>
              </p>

              <div className="mt-2 border-t border-rule pt-2">
                <PermissionToggles
                  value={granted}
                  idPrefix={`panel-${teacher._id}`}
                  onChange={(key) => void api.teachers.togglePermission(teacher._id, key)}
                />
              </div>
            </article>
          )
        })}
      </div>

      <p className="mt-4 border-t border-rule pt-3 text-[11px] leading-relaxed text-ink/45">
        Every account starts read-only and only ever writes what is granted here. Permissions are also summarised
        on each teacher’s record on the register, with the catalogue: {PERMISSIONS.map((entry) => entry.label).join(' · ')}.
        Enforcement runs in this browser build; the same checks move server-side behind the <code>api</code> seam.
      </p>
    </Modal>
  )
}

/** Compact "what they hold" line for a staff card. */
export function PermissionSummary({ teacher }: { teacher: Pick<Teacher, 'permissions'> }) {
  const granted = grantedPermissions(teacher)
  return (
    <p className="text-[11px] leading-snug text-ink/50">
      {granted.length
        ? `Granted: ${granted.map((key) => permissionDefinition(key).label).join(' · ')}`
        : 'No write permissions — read-only account.'}
    </p>
  )
}
