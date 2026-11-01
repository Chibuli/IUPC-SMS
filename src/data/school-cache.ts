import type { Database, Role } from './types'

// Same lifetime and tab isolation as the Supabase session. Never an authority
// for a server request; only previously verified screen data for offline reloads.
const KEY = 'iupc.school.snapshot.v1'
export interface CachedSession { role: Role; name: string; schoolId: string; teacherId?: string }
interface SchoolCache { version: 2; userId: string; expiresAt: number; session: CachedSession; database: Database }

export function clearSchoolCache(): void {
  try { sessionStorage.removeItem(KEY) } catch { /* Storage may be unavailable. */ }
}

export function saveSchoolCache(userId: string, expiresAt: number, session: CachedSession, database: Database): void {
  try { sessionStorage.setItem(KEY, JSON.stringify({ version: 2, userId, expiresAt, session, database })) }
  catch { clearSchoolCache() /* Never retain a stale snapshot after a failed save. */ }
}

export function readSchoolCache(userId: string, expiresAt: number | undefined): SchoolCache | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as SchoolCache | null
    // Old snapshots may contain the previous 1,000-row truncated marks result.
    // Require one online reload; this never touches the separate offline queue.
    if (!value || value.version !== 2 || value.userId !== userId || !expiresAt || !Number.isFinite(value.expiresAt) ||
      Math.min(expiresAt, value.expiresAt) * 1000 <= Date.now() || !value.session?.schoolId ||
      !['admin', 'teacher', 'guest'].includes(value.session.role)) return null
    const tables: (keyof Database)[] = ['schools','classes','teachers','subjects','students','terms','exams','marks','gradingScales','reportCards','notes','timetableSlots','bellSchedules','markWindows']
    if (!value.database || tables.some(table => !Array.isArray(value.database[table])) ||
      value.database.schools.length !== 1 || value.database.schools[0]._id !== value.session.schoolId) return null
    return value
  } catch { return null }
}
