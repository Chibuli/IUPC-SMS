import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useDb } from './data/db'
import type { Exam, ExamStatus, ID, Role, Teacher, TeacherPermissionKey } from './data/types'
import { effectiveDeadline, hasPermission, isWindowClosed, windowLabel } from './lib/permissions'

const SESSION_KEY = 'iupc.session.v1'
const LEGACY_SESSION_KEY = 'meridian.session.v1'

/**
 * What a teacher selects on the Marks Entry bar, before any paper row exists.
 * `status` and `editing_deadline` are absent for a paper yet to be recorded, and
 * then only the school-wide window governs it.
 */
export interface PaperRef {
  subject_id: ID
  status?: ExamStatus
  editing_deadline?: string | null
}

export interface EditPermission {
  editable: boolean
  reason: string | null
}

export interface Session {
  role: Role
  name: string
  teacherId?: string
}

interface SessionContextValue {
  session: Session | null
  signIn: (session: Session) => void
  signOut: () => void
  canEditExam: (exam: Exam) => EditPermission
  /** The same check for a selection that may not have a paper row yet. */
  canEditPaper: (paper: PaperRef) => EditPermission
  /** Capability check for surfaces that are not tied to one exam. */
  can: (key: TeacherPermissionKey) => boolean
  /**
   * Subject ids this account may see, or null for every subject. Assigned
   * subjects scope a teacher; `records.view_all_subjects` widens it to the school.
   */
  subjectScope: ID[] | null
  teacher: Teacher | null
  /** True when the account may write marks somewhere, so pages can say so. */
  mayEnterMarks: boolean
  /** The school-wide deadline, when the registrar has set one. */
  marksCloseAt: string | null
}

const SessionContext = createContext<SessionContextValue | null>(null)

function read(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY) ?? localStorage.getItem(LEGACY_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Session
    if (!parsed || !parsed.role || !parsed.name) return null
    if (!localStorage.getItem(SESSION_KEY)) localStorage.setItem(SESSION_KEY, JSON.stringify(parsed))
    return parsed
  } catch {
    return null
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const db = useDb()
  const [session, setSession] = useState<Session | null>(() => read())

  const signIn = useCallback((next: Session) => {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(next))
    } catch {
      /* ignore */
    }
    setSession(next)
  }, [])

  const signOut = useCallback(() => {
    try {
      localStorage.removeItem(SESSION_KEY)
      localStorage.removeItem(LEGACY_SESSION_KEY)
    } catch {
      /* ignore */
    }
    setSession(null)
  }, [])

  const teacher = useMemo(
    () => (session?.teacherId ? db.teachers.find((t) => t._id === session.teacherId) ?? null : null),
    [db.teachers, session?.teacherId],
  )

  const marksCloseAt = db.markWindows[0]?.closes_at ?? null

  const can = useCallback(
    (key: TeacherPermissionKey) => {
      if (!session || session.role === 'guest') return false
      // The registrar is not a staff record: administration rights are not
      // capability grants and cannot be reduced from the staff list.
      if (session.role === 'admin') return true
      return hasPermission(teacher, key)
    },
    [session, teacher],
  )

  const subjectScope = useMemo<ID[] | null>(() => {
    if (session?.role !== 'teacher' || !teacher) return null
    if (hasPermission(teacher, 'records.view_all_subjects')) return null
    return teacher.assigned_subject_ids
  }, [session?.role, teacher])

  /**
   * Mark-entry editability. Order matters: a paper that is out of the teacher's
   * subject list is refused before anything about permissions, so the reason
   * they read is the one that actually blocks them.
   */
  const canEditPaper = useCallback(
    (paper: PaperRef): EditPermission => {
      if (!session) return { editable: false, reason: 'You are not signed in.' }
      if (session.role === 'guest') {
        return { editable: false, reason: 'Guest access is read-only.' }
      }
      const status = paper.status ?? 'open'
      if (status === 'locked' || status === 'published') {
        return { editable: false, reason: 'This exam has been locked by the administrator.' }
      }
      if (session.role === 'admin') return { editable: true, reason: null }
      if (!teacher) return { editable: false, reason: 'No staff profile is linked to this account.' }
      if (!teacher.assigned_subject_ids.includes(paper.subject_id)) {
        return { editable: false, reason: 'This subject is not assigned to your staff profile.' }
      }
      if (!hasPermission(teacher, 'marks.enter')) {
        return {
          editable: false,
          reason: 'Your account is read-only — the registrar has not granted you mark-entry permission.',
        }
      }
      const deadline = effectiveDeadline({ editing_deadline: paper.editing_deadline ?? null }, db.markWindows[0])
      if (isWindowClosed(deadline) && !hasPermission(teacher, 'marks.after_deadline')) {
        return {
          editable: false,
          reason: `The mark-entry window closed on ${windowLabel(deadline)} — this paper is read-only.`,
        }
      }
      return { editable: true, reason: null }
    },
    [session, teacher, db.markWindows],
  )

  const canEditExam = useCallback(
    (exam: Exam) =>
      canEditPaper({ subject_id: exam.subject_id, status: exam.status, editing_deadline: exam.editing_deadline }),
    [canEditPaper],
  )

  const mayEnterMarks = useMemo(() => {
    if (session?.role === 'admin') return true
    return session?.role === 'teacher' && hasPermission(teacher, 'marks.enter')
  }, [session?.role, teacher])

  const value = useMemo(
    () => ({ session, signIn, signOut, canEditExam, canEditPaper, can, subjectScope, teacher, mayEnterMarks, marksCloseAt }),
    [session, signIn, signOut, canEditExam, canEditPaper, can, subjectScope, teacher, mayEnterMarks, marksCloseAt],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext)
  if (!context) throw new Error('useSession must be used inside SessionProvider')
  return context
}
