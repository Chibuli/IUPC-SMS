import type { Exam, MarkWindow, Teacher, TeacherPermissionKey } from '../data/types'
import { formatDateTime } from './format'

/**
 * The permission catalogue. A teacher account starts with none of these — the
 * registrar grants them one by one in Settings → Teacher permissions. Every
 * entry here is enforced somewhere in the app, so the list is a contract rather
 * than a wish list; adding a capability means adding its check too.
 */
export interface PermissionDefinition {
  key: TeacherPermissionKey
  label: string
  /** One line, shown beside the toggle. */
  summary: string
  /** How the permission interacts with the others. */
  note: string
}

export const PERMISSIONS: PermissionDefinition[] = [
  {
    key: 'marks.enter',
    label: 'Enter and edit marks',
    summary: 'Write marks for assigned subjects while the mark-entry window is open.',
    note: 'Without this the teacher sees every record they are entitled to, read-only.',
  },
  {
    key: 'marks.after_deadline',
    label: 'Keep editing after the window closes',
    summary: 'Ignore the registrar’s deadline for papers not yet locked or published.',
    note: 'Needs “Enter and edit marks” too; a locked or published paper still refuses.',
  },
  {
    key: 'records.view_all_subjects',
    label: 'View every subject (read-only)',
    summary: 'See all subjects and streams on exams, broadsheets and analytics.',
    note: 'Assigned subjects are what a teacher sees by default; this widens that view, never their writing rights.',
  },
]

export function permissionDefinition(key: TeacherPermissionKey): PermissionDefinition {
  return PERMISSIONS.find((entry) => entry.key === key) ?? PERMISSIONS[0]
}

/**
 * Keeps only known keys, de-duplicated and in catalogue order. A deadline
 * extension is meaningless without marks entry, so it never stands alone —
 * revoking the first drops the second rather than leaving a dead grant.
 */
export function normalisePermissions(values: readonly string[] | null | undefined): TeacherPermissionKey[] {
  const wanted = new Set(values ?? [])
  if (!wanted.has('marks.enter')) wanted.delete('marks.after_deadline')
  return PERMISSIONS.filter((entry) => wanted.has(entry.key)).map((entry) => entry.key)
}

export function hasPermission(
  teacher: Pick<Teacher, 'permissions'> | null | undefined,
  key: TeacherPermissionKey,
): boolean {
  return Boolean(teacher?.permissions?.includes(key))
}

/** Short label for badges and lists: what the account may do, in one phrase. */
export function accessSummary(teacher: Pick<Teacher, 'permissions'>): string {
  if (hasPermission(teacher, 'marks.enter')) {
    return hasPermission(teacher, 'records.view_all_subjects') ? 'Marks entry · all subjects' : 'Marks entry'
  }
  return hasPermission(teacher, 'records.view_all_subjects') ? 'Read-only · all subjects' : 'Read-only'
}

export function grantedPermissions(teacher: Pick<Teacher, 'permissions'>): TeacherPermissionKey[] {
  return normalisePermissions(teacher.permissions)
}

/* ── the mark-entry window ─────────────────────────────────────────────── */

/**
 * The deadline that governs a paper: its own if the registrar set one on the
 * Exams page, otherwise the school-wide default.
 */
export function effectiveDeadline(
  exam: Pick<Exam, 'editing_deadline'>,
  window: Pick<MarkWindow, 'closes_at'> | null | undefined,
): string | null {
  return exam.editing_deadline ?? window?.closes_at ?? null
}

export function isWindowClosed(deadline: string | null, at: number = Date.now()): boolean {
  if (!deadline) return false
  const time = new Date(deadline).getTime()
  return !Number.isNaN(time) && time < at
}

export function windowLabel(deadline: string | null): string {
  return deadline ? formatDateTime(deadline) : 'no deadline'
}

/** Human sentence for the panel, e.g. "Paper deadlines override this." */
export function windowSummary(window: Pick<MarkWindow, 'closes_at'> | null | undefined): string {
  if (!window?.closes_at) {
    return 'No school-wide deadline: papers without their own deadline stay open for teachers who may enter marks.'
  }
  return `Papers without their own deadline close for teachers on ${formatDateTime(window.closes_at)}.`
}
