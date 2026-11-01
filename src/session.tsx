import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useDb } from './data/db'
import type { Exam, ExamStatus, ID, Role, Teacher, TeacherPermissionKey } from './data/types'
import { effectiveDeadline, hasPermission, isWindowClosed, windowLabel } from './lib/permissions'
import { supabase, supabaseConfigured } from './data/supabase'
import { clearDatabase, refreshDatabase, replaceDatabase } from './data/db'
import { getAccountScope, setAccountScope } from './data/backend'
import { clearSchoolCache, readSchoolCache, saveSchoolCache } from './data/school-cache'
import { lockOwnerRecords, refreshQueue, setQueueOwner, syncNow, unlockOwnerRecords } from './lib/offline'
import { initialAuthCallback } from './lib/auth-callback'


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
  schoolId?: string
}

interface SessionContextValue {
  session: Session | null
  sessionReady: boolean
  authReady: boolean
  authLinkError: boolean
  hasAuthSession: boolean
  signOut: () => void
  signInWithPassword: (email: string, password: string) => Promise<string | null>
  sendPasswordRecovery: (email: string) => Promise<string | null>
  updatePassword: (password: string) => Promise<string | null>
  passwordSetupRequired: boolean
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

export function SessionProvider({ children }: { children: ReactNode }) {
  const db = useDb()
  const [session, setSession] = useState<Session | null>(null)
  const [sessionReady, setSessionReady] = useState(!supabaseConfigured)
  const [authReady, setAuthReady] = useState(!supabaseConfigured)
  const [authLinkError, setAuthLinkError] = useState(initialAuthCallback.error)
  const callbackReviewed = useRef(false)
  const [hasAuthSession, setHasAuthSession] = useState(false)
  /** The account whose queued marks may be read; null once signed out. */
  const userIdRef = useRef<string | null>(null)
  const activation = useRef(0)
  const [passwordSetupRequired, setPasswordSetupRequired] = useState(false)

  const activateUser = useCallback(async (userId: string): Promise<boolean> => {
    if (!supabase) return false
    const generation = ++activation.current
    const current = () => generation === activation.current
    try {
    if (getAccountScope()?.userId !== userId) {
      setSessionReady(false)
      clearDatabase(); setSession(null); setQueueOwner(null)
    }
    const { data: auth } = await supabase.auth.getSession()
    if (!current() || auth.session?.user.id !== userId) return false
    if (!navigator.onLine) {
      const cached = readSchoolCache(userId, auth.session.expires_at)
      if (!cached) { clearDatabase(); setSession(null); setQueueOwner(null); return false }
      await refreshQueue()
      if (!current()) return false
      setAccountScope({ userId, schoolId: cached.session.schoolId, verified: false })
      replaceDatabase(cached.database)
      userIdRef.current = userId
      setSession(cached.session)
      setQueueOwner({ userId, schoolId: cached.session.schoolId })
      void unlockOwnerRecords(userId)
      return true
    }
    // An offline snapshot never permits network dispatch. Revalidate first.
    const priorScope = getAccountScope()
    if (priorScope) setAccountScope({ ...priorScope, verified: false })
    const { data, error } = await supabase.from('memberships').select('school_id,role,teacher_id,active,schools(name)').eq('user_id', userId).eq('active', true).maybeSingle()
    if (!current()) return false
    if (error || !data) { clearSchoolCache(); clearDatabase(); setSession(null); setQueueOwner(null); return false }
    const { data: profile } = await supabase.from('profiles').select('full_name,active').eq('id', userId).maybeSingle()
    if (!current()) return false
    if (!profile?.active) { clearSchoolCache(); clearDatabase(); setSession(null); setQueueOwner(null); await supabase.auth.signOut(); return false }
    if (priorScope && priorScope.schoolId !== data.school_id) { clearSchoolCache(); clearDatabase(); setSession(null); setQueueOwner(null) }
    setAccountScope({ userId, schoolId: data.school_id, verified: true })
    let loaded
    try { loaded = await refreshDatabase(data.school_id) } catch { if (current()) { clearDatabase(); setSession(null); setQueueOwner(null) } return false }
    if (!current()) return false
    const next: Session = { role: data.role, name: profile.full_name, teacherId: data.teacher_id ?? undefined, schoolId: data.school_id }
    saveSchoolCache(userId, auth.session.expires_at ?? 0, { ...next, schoolId: data.school_id }, loaded)
    setSession(next)
    userIdRef.current = userId
    setQueueOwner({ userId, schoolId: data.school_id })
    // The owner is back: their parked marks become reviewable and sendable again.
    void unlockOwnerRecords(userId)
    void syncNow()
    return true
    } catch {
      if (current()) { clearDatabase(); setSession(null); setQueueOwner(null) }
      return false
    } finally {
      // An older activation must not finish a newer account's restoration.
      if (current()) setSessionReady(true)
    }
  }, [])

  useEffect(() => {
    if (!supabaseConfigured || !supabase) return
    let alive = true
    const restore = () => {
      const generation = activation.current
      const noSession = () => {
        if (alive && generation === activation.current) {
          setHasAuthSession(false); setAuthReady(true)
          clearDatabase(); setSession(null); setQueueOwner(null); setSessionReady(true)
        }
      }
      const readSession = async () => {
        // SDK initialization may keep a prior login after a failed callback.
        // A retained session must not authorize a failed invitation/recovery.
        const { error } = await supabase!.auth.initialize()
        if (!callbackReviewed.current && alive) {
          callbackReviewed.current = true
          const unexchangedCode = initialAuthCallback.pkce && new URL(window.location.href).searchParams.has('code')
          const failed = initialAuthCallback.error || Boolean(initialAuthCallback.setup && (error || unexchangedCode))
          setAuthLinkError(failed)
          setPasswordSetupRequired(initialAuthCallback.setup && !failed)
        }
        return supabase!.auth.getSession()
      }
      void readSession().then(({ data }) => {
        if (!alive) return
        setHasAuthSession(Boolean(data.session)); setAuthReady(true)
        if (data.session) void activateUser(data.session.user.id)
        else noSession()
      }).catch(noSession)
    }
    restore()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, authSession) => {
      if (!alive) return
      setHasAuthSession(Boolean(authSession)); setAuthReady(true)
      if (event === 'SIGNED_OUT' || !authSession) {
        ++activation.current
        setSessionReady(true)
        setPasswordSetupRequired(false)
        clearSchoolCache()
        // Park this account's marks: they stay on the device, they are not shown
        // to whoever signs in next, and they are never sent under that account.
        void lockOwnerRecords(userIdRef.current)
        userIdRef.current = null
        setQueueOwner(null)
        clearDatabase(); setSession(null); return
      }
      if (event === 'PASSWORD_RECOVERY') setPasswordSetupRequired(true)
      if (getAccountScope() && getAccountScope()?.userId !== authSession.user.id) {
        ++activation.current
        setSessionReady(false)
        clearSchoolCache(); clearDatabase(); setSession(null); setQueueOwner(null)
      }
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED' || event === 'PASSWORD_RECOVERY') {
        window.setTimeout(() => { if (alive) void activateUser(authSession.user.id) }, 0)
      }
    })
    const reconnect = restore
    const disconnect = () => { ++activation.current; const scope = getAccountScope(); if (scope) setAccountScope({ ...scope, verified: false }); restore() }
    window.addEventListener('online', reconnect)
    window.addEventListener('offline', disconnect)
    return () => { alive = false; ++activation.current; subscription.unsubscribe(); window.removeEventListener('online', reconnect); window.removeEventListener('offline', disconnect) }
  }, [activateUser])

  const signInWithPassword = useCallback(async (email: string, password: string) => {
    if (!supabase) return 'Production authentication is not configured.'
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
    if (error || !data.user) return 'Email or password is incorrect.'
    // Membership is loaded from the authoritative database by the auth listener.
    // Return success only after the handler has populated the scoped application session.
    for (let attempt=0; attempt<30; attempt+=1) {
      const { data: membership } = await supabase.from('memberships').select('school_id,active').eq('user_id',data.user.id).eq('active',true).maybeSingle()
      if (!membership) { await supabase.auth.signOut(); return 'This account is not linked to an active school.' }
      const { data: profile } = await supabase.from('profiles').select('active').eq('id',data.user.id).maybeSingle()
      if (!profile?.active) { await supabase.auth.signOut(); return 'This account is inactive.' }
      const loaded = await activateUser(data.user.id)
      if (loaded) return null
      await new Promise((resolve)=>setTimeout(resolve,100))
    }
    await supabase.auth.signOut()
    return 'The account could not load its school membership. Contact the administrator.'
  }, [activateUser])

  const sendPasswordRecovery = useCallback(async (email: string) => {
    if (!supabase) return 'Production authentication is not configured.'
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: `${window.location.origin}/auth/callback?setup=1` })
    return error ? 'Password recovery could not be started. Check the email and try again.' : null
  }, [])

  const updatePassword = useCallback(async (password: string) => {
    if (!supabase || password.length < 12) return 'Use a password of at least 12 characters.'
    const { data: auth } = await supabase.auth.getSession()
    if (!auth.session) return 'This sign-in link has expired. Request a new invitation or recovery link.'
    const { data: verified, error: verificationError } = await supabase.auth.getUser()
    if (verificationError || !verified.user || verified.user.id !== auth.session.user.id) return 'This sign-in link is invalid or expired. Request a new invitation or recovery link.'
    const { error } = await supabase.auth.updateUser({ password })
    if (error) return 'The password could not be updated. Request a new recovery link and try again.'
    setPasswordSetupRequired(false)
    window.history.replaceState({}, '', window.location.pathname)
    return null
  }, [])

  const signOut = useCallback(() => {
    ++activation.current
    setSessionReady(true)
    setHasAuthSession(false)
    setPasswordSetupRequired(false)
    clearSchoolCache()
    void lockOwnerRecords(userIdRef.current)
    userIdRef.current = null
    setQueueOwner(null)
    if (supabase) void supabase.auth.signOut()
    clearDatabase()
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
    () => ({ session, sessionReady, authReady, authLinkError, hasAuthSession, signOut, signInWithPassword, sendPasswordRecovery, updatePassword, passwordSetupRequired, canEditExam, canEditPaper, can, subjectScope, teacher, mayEnterMarks, marksCloseAt }),
    [session, sessionReady, authReady, authLinkError, hasAuthSession, signOut, signInWithPassword, sendPasswordRecovery, updatePassword, passwordSetupRequired, canEditExam, canEditPaper, can, subjectScope, teacher, mayEnterMarks, marksCloseAt],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext)
  if (!context) throw new Error('useSession must be used inside SessionProvider')
  return context
}
