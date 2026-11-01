import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from './types'
import { clearSchoolCache, readSchoolCache, saveSchoolCache } from './school-cache'

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('VITE_SUPABASE_URL', '')
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '')
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.doUnmock('./supabase'); vi.doUnmock('../lib/offline-store') })

describe('backend integration invariants', () => {
  it('keeps the client disabled when controlled public configuration is absent', async () => {
    const config = await import('./supabase')
    expect(config.supabaseConfigured).toBe(false)
    expect(config.supabase).toBeNull()
  })

  it('performs no protected query without an authenticated account and school scope', async () => {
    const from = vi.fn()
    const getSession = vi.fn().mockResolvedValue({ data: { session: null } })
    vi.doMock('./supabase', () => ({ supabase: { from, auth: { getSession } }, supabaseConfigured: true }))
    const { loadSchoolDatabase, setAccountScope } = await import('./backend')
    const expectEmpty = async () => {
      const result: Database = await loadSchoolDatabase('school-a')
      expect(result.students).toEqual([])
      expect(result.teachers).toEqual([])
      expect(result.marks).toEqual([])
    }
    await expectEmpty()
    setAccountScope({ userId: 'user-a', schoolId: 'school-b', verified: true })
    await expectEmpty()
    setAccountScope({ userId: 'user-a', schoolId: 'school-a', verified: false })
    await expectEmpty()
    setAccountScope({ userId: 'user-a', schoolId: 'school-a', verified: true })
    await expectEmpty()
    getSession.mockResolvedValue({ data: { session: { user: { id: 'user-b' }, expires_at: Date.now() / 1000 + 3600 } } })
    await expectEmpty()
    getSession.mockResolvedValue({ data: { session: { user: { id: 'user-a' }, expires_at: 1 } } })
    await expectEmpty()
    expect(from).not.toHaveBeenCalled()
  })

  it('loads records only for the currently verified account and school', async () => {
    const from = vi.fn().mockImplementation((table: string) => {
      const result = { data: table === 'schools' ? [{ id: 'school-a' }] : [], error: null, count: 0 }
      const query = { select: () => query, eq: () => query, or: () => query, order: () => query, limit: () => query, gt: () => query, then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve) }
      return query
    })
    vi.doMock('./supabase', () => ({ supabase: { from, auth: { getSession: async () => ({ data: { session: { user: { id: 'user-a' }, expires_at: Date.now() / 1000 + 3600 } } }) } }, supabaseConfigured: true }))
    const { loadSchoolDatabase, setAccountScope } = await import('./backend')
    setAccountScope({ userId: 'user-a', schoolId: 'school-a', verified: true })
    expect((await loadSchoolDatabase('school-a')).schools[0]._id).toBe('school-a')
    expect(from).toHaveBeenCalledWith('students')
  })
})

describe('cached sessions cannot authorize synchronization', () => {
  it('keeps a mark pending until membership is verified and refuses another account', async () => {
    const rpc = vi.fn()
    const getSession = vi.fn().mockResolvedValue({ data: { session: { user: { id: 'user-a' }, expires_at: Date.now() / 1000 + 3600 } } })
    vi.doMock('./supabase', () => ({ supabase: { rpc, auth: { getSession } }, supabaseConfigured: true }))
    const write = vi.fn()
    vi.doMock('../lib/offline-store', () => ({
      OfflineStorageError: class extends Error {}, readAll: async () => [], write,
      storageAvailable: () => true, pruneExpired: async () => 0,
      readOne: vi.fn(), remove: vi.fn(), updateRecord: vi.fn(),
    }))
    vi.stubGlobal('navigator', { onLine: true })
    const { setAccountScope } = await import('./backend')
    const { currentActor, submitMarkScore, syncNow } = await import('../lib/offline')
    setAccountScope({ userId: 'user-a', schoolId: 'school-a', verified: false })
    expect(await currentActor()).toBeNull()
    const outcome = await submitMarkScore({ examId: '10000000-0000-4000-8000-000000000001', studentId: '10000000-0000-4000-8000-000000000002', score: 42 }, { actor: { userId: 'user-a', schoolId: 'school-a' }, summary: 'Fictional mark' })
    expect(outcome).toMatchObject({ persisted: true, state: 'Pending', token: 'NOT_SENT' })
    expect(write).toHaveBeenCalledOnce()
    await syncNow()
    const { api } = await import('./db')
    await expect(api.students.archive('student-a')).rejects.toThrow('No verified school database session')
    await expect(api.students.reactivate('student-a')).rejects.toThrow('No verified school database session')
    await expect(api.terms.activate('term-a')).rejects.toThrow('No verified school database session')
    expect(rpc).not.toHaveBeenCalled()
    setAccountScope({ userId: 'user-a', schoolId: 'school-a', verified: true })
    expect(await currentActor()).toEqual({ userId: 'user-a', schoolId: 'school-a' })
    getSession.mockResolvedValue({ data: { session: { user: { id: 'user-b' }, expires_at: Date.now() / 1000 + 3600 } } })
    expect(await currentActor()).toBeNull()
    getSession.mockResolvedValue({ data: { session: { user: { id: 'user-a' }, expires_at: 1 } } })
    expect(await currentActor()).toBeNull()
  })
})

describe('offline school snapshot isolation', () => {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600
  const session = { name: 'Test Teacher', role: 'teacher' as const, schoolId: 'school-a' }
  const database: Database = { schools: [{ _id: 'school-a' } as Database['schools'][number]], classes: [], teachers: [], subjects: [], students: [], terms: [], exams: [], marks: [], gradingScales: [], reportCards: [], notes: [], timetableSlots: [], bellSchedules: [], markWindows: [] }
  beforeEach(() => {
    const storage = new Map<string, string>()
    vi.stubGlobal('sessionStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) })
    saveSchoolCache('user-a', expiresAt, session, database)
  })
  it('restores previously loaded records for the same unexpired account', () => {
    expect(readSchoolCache('user-a', expiresAt)?.database).toEqual(database)
  })
  it('refuses legacy snapshots that may contain silently truncated marks without clearing the offline queue', () => {
    sessionStorage.setItem('iupc.school.snapshot.v1', JSON.stringify({ userId:'user-a', expiresAt, session, database }))
    sessionStorage.setItem('unrelated-offline-queue', 'retained')
    expect(readSchoolCache('user-a', expiresAt)).toBeNull()
    expect(sessionStorage.getItem('unrelated-offline-queue')).toBe('retained')
  })
  it('refuses a different account, expired session, or mismatched school snapshot', () => {
    expect(readSchoolCache('user-b', expiresAt)).toBeNull()
    expect(readSchoolCache('user-a', 1)).toBeNull()
    saveSchoolCache('user-a', expiresAt, { ...session, schoolId: 'school-b' }, database)
    expect(readSchoolCache('user-a', expiresAt)).toBeNull()
  })
  it('removes cached records on sign-out and fails closed on unavailable storage', () => {
    clearSchoolCache()
    expect(readSchoolCache('user-a', expiresAt)).toBeNull()
    vi.stubGlobal('sessionStorage', { getItem() { throw new Error('blocked') }, setItem() { throw new Error('quota') }, removeItem() {} })
    expect(() => saveSchoolCache('user-a', expiresAt, session, database)).not.toThrow()
    expect(readSchoolCache('user-a', expiresAt)).toBeNull()
  })
})
