import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadAuthorizedMarks } from './load-marks'

const makeRows = (count: number, school = 'school-a') => Array.from({ length: count }, (_, i) => ({
  id: `10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, school_id: school,
  exam_id: `exam-${i % 108}`, student_id: `student-${i % 70}`, score: i % 101,
}))

function fixture(rows = makeRows(1080), cap = 1000) {
  const pages: { cursor?: string; limit: number; school?: string }[] = []
  const state = { failPage: 0, missingCount: false, headDelta: 0, headError: false, emptyPage: 0, duplicatePage: 0, wrongSchool: false }
  const from = vi.fn((table: string) => {
    expect(table).toBe('marks')
    let cursor: string | undefined, school: string | undefined, limit = 0, head = false, count = false
    const query: any = {
      select: (_columns: string, options?: { head?: boolean; count?: string }) => { head = options?.head ?? false; count = options?.count === 'exact'; return query },
      eq: (column: string, value: string) => { expect(column).toBe('school_id'); school = value; return query },
      order: (column: string, options: unknown) => { expect(column).toBe('id'); expect(options).toEqual({ ascending: true }); return query },
      limit: (n: number) => { limit = n; return query },
      gt: (column: string, value: string) => { expect(column).toBe('id'); cursor = value; return query },
      then: (resolve: (result: unknown) => unknown) => {
        const visible = rows.filter(r => r.school_id === school)
        if (head) return Promise.resolve({ data: null, count: visible.length + state.headDelta, error: state.headError ? { message: 'Denied' } : null }).then(resolve)
        pages.push({ cursor, limit, school })
        if (state.failPage === pages.length) return Promise.resolve({ data: null, error: { message: 'Page failed' }, count: null }).then(resolve)
        let data = visible.filter(r => !cursor || r.id > cursor).slice(0, Math.min(cap, limit))
        if (state.emptyPage === pages.length) data = []
        if (state.duplicatePage === pages.length) data = [visible.find(r => r.id === cursor)!, ...data.slice(1)]
        if (state.wrongSchool && data.length) data = [{ ...data[0], school_id: 'school-b' }, ...data.slice(1)]
        return Promise.resolve({ data, error: null, count: count && !state.missingCount ? visible.length : null }).then(resolve)
      },
    }
    return query
  })
  return { client: { from } as unknown as SupabaseClient, pages, state }
}

afterEach(() => { vi.doUnmock('./supabase'); vi.unstubAllGlobals(); vi.resetModules() })

describe('complete authorized marks retrieval', () => {
  it('retrieves all 1,080 marks under a 1,000-row server cap with no duplicates or changed associations', async () => {
    const rows = makeRows(1080), f = fixture(rows)
    const actual = await loadAuthorizedMarks(f.client, 'school-a', async () => {})
    expect(actual).toEqual(rows)
    expect(new Set(actual.map(r => r.id)).size).toBe(1080)
    expect(f.pages.map(p => p.limit)).toEqual([500, 500, 500])
    expect(f.pages.map(p => p.cursor)).toEqual([undefined, rows[499].id, rows[999].id])
  })
  it('does not mistake a smaller server cap for the end of the authorized set', async () => {
    const f = fixture(makeRows(1080), 200)
    expect(await loadAuthorizedMarks(f.client, 'school-a', async () => {})).toHaveLength(1080)
    expect(f.pages).toHaveLength(6)
    expect(f.pages.slice(1).every(p => p.limit === 200)).toBe(true)
  })
  it('preserves RLS-filtered teacher visibility and the selected school', async () => {
    // The authenticated API supplies only this teacher's authorized subset.
    const allowed = makeRows(137), f = fixture([...allowed, ...makeRows(80, 'school-b')])
    const actual = await loadAuthorizedMarks(f.client, 'school-a', async () => {})
    expect(actual).toEqual(allowed)
    expect(f.pages.every(p => p.school === 'school-a')).toBe(true)
  })
  it('handles empty and exact-page-sized sets without an unbounded extra-page loop', async () => {
    for (const n of [0, 500, 1000]) {
      const f = fixture(makeRows(n))
      expect(await loadAuthorizedMarks(f.client, 'school-a', async () => {})).toHaveLength(n)
      expect(f.pages).toHaveLength(Math.max(1, Math.ceil(n / 500)))
    }
  })
  it.each(['failPage', 'emptyPage', 'duplicatePage'] as const)('rejects partial retrieval on %s instead of returning a complete-looking snapshot', async failure => {
    const f = fixture(); f.state[failure] = 2
    await expect(loadAuthorizedMarks(f.client, 'school-a', async () => {})).rejects.toThrow(/marks|mark/i)
  })
  it('rejects missing counts, wrong-school rows and failed final count checks', async () => {
    const a = fixture(); a.state.missingCount = true
    const b = fixture(); b.state.wrongSchool = true
    const c = fixture(); c.state.headError = true
    for (const f of [a,b,c]) await expect(loadAuthorizedMarks(f.client, 'school-a', async () => {})).rejects.toThrow(/mark/i)
  })
  it('rejects changed visibility/concurrent additions rather than silently omitting records', async () => {
    const f = fixture(); f.state.headDelta = 1
    await expect(loadAuthorizedMarks(f.client, 'school-a', async () => {})).rejects.toThrow('changed while loading')
  })
  it('stops loading if account/school verification is lost between pages', async () => {
    const f = fixture()
    await expect(loadAuthorizedMarks(f.client, 'school-a', async () => { if (f.pages.length) throw Error('Account scope changed') })).rejects.toThrow('Account scope changed')
    expect(f.pages).toHaveLength(1)
  })
  it('does not commit partial pages to the school database when refresh fails', async () => {
    const f = fixture(); f.state.failPage = 2
    const session = { user: { id: 'user-a' }, expires_at: Date.now()/1000 + 3600 }
    vi.doMock('./supabase', () => ({ supabaseConfigured: true, supabase: {
      auth: { getSession: async () => ({ data: { session } }) },
      from: (table: string) => {
        if (table === 'marks') return f.client.from(table)
        const result = { data: table === 'schools' ? [{ id: 'school-a' }] : [], error: null }
        const query: any = { select: () => query, eq: () => query, or: () => query, order: () => query, then: (resolve: any) => Promise.resolve(result).then(resolve) }
        return query
      },
    } }))
    const { setAccountScope } = await import('./backend')
    const { replaceDatabase, getDb, refreshDatabase } = await import('./db')
    const prior = getDb()
    const saved = { ...prior, marks: [{ _id: 'previous-complete-mark' } as typeof prior.marks[number]] }
    replaceDatabase(saved); setAccountScope({ userId: 'user-a', schoolId: 'school-a', verified: true })
    await expect(refreshDatabase('school-a')).rejects.toThrow('Unable to load all authorized marks')
    expect(getDb()).toBe(saved)
    expect(f.pages).toHaveLength(2)
  })
})
