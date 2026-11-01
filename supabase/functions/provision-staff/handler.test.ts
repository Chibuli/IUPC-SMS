import { describe, expect, it, vi } from 'vitest'
import { createStaffHandler } from './handler'
const school = '10000000-0000-4000-8000-000000000001'
const teacher = '10000000-0000-4000-8000-000000000002'
const user = '10000000-0000-4000-8000-000000000003'
const other = '10000000-0000-4000-8000-000000000004'
const email = 'teacher@example.invalid'
const origin = 'https://school.example.invalid'
const invited = () => ({ id: user, email, invited_at: new Date().toISOString() })
const link = () => ({ school_id: school, user_id: user, teacher_id: teacher, role: 'teacher', active: true })

function fixture() {
  const state = { role: 'admin', active: true, authError: false, teacherActive: true, teacherSchool: school, users: [] as any[], links: [] as any[], lookupError: false, inviteError: false, insertError: false, queryError: false }
  const invite = vi.fn(async () => {
    if (state.inviteError) return { data: {}, error: {} }
    const identity = invited(); state.users.push(identity)
    return { data: { user: identity }, error: null }
  })
  const insert = vi.fn(async (value: any) => {
    if (state.insertError) return { error: {} }
    state.links.push(value); return { error: null }
  })
  function scopedQuery(table: string) {
    const filters: Record<string, string> = {}
    const result = () => ({ error: state.queryError ? {} : null, data: table === 'memberships' ? { role: state.role, active: state.active } : filters.school_id === state.teacherSchool ? { id: teacher, email, full_name: 'Fictional Teacher', active: state.teacherActive } : null })
    const query: any = { select: () => query, eq: (key: string, value: string) => { filters[key] = value; return query }, maybeSingle: async () => result(), then: (resolve: any) => { const r = result(); return Promise.resolve({ ...r, data: r.data ? [r.data] : [] }).then(resolve) } }
    return query
  }
  const scoped = { auth: { getUser: async () => ({ data: { user: state.authError ? null : { id: other } }, error: state.authError ? {} : null }) }, from: scopedQuery }
  const admin = {
    auth: { admin: {
      listUsers: vi.fn(async () => ({ data: { users: state.users }, error: state.lookupError ? {} : null })),
      getUserById: vi.fn(async (id: string) => ({ data: { user: state.users.find(u => u.id === id) }, error: null })),
      inviteUserByEmail: invite,
    } },
    from: vi.fn(() => {
      const query: any = { select: () => query, or: async (filter: string) => ({ data: state.links.filter(row => filter.split(',').some(part => { const [key, , value] = part.split('.'); return row[key] === value })), error: state.queryError ? {} : null }), insert }
      return query
    }),
  }
  const handler = createStaffHandler((_url, key) => key === 'private-test-key' ? admin : scoped, name => ({ APP_ORIGIN: origin, SUPABASE_URL: 'https://backend.example.invalid', SUPABASE_ANON_KEY: 'public-test-key', SUPABASE_SERVICE_ROLE_KEY: 'private-test-key' })[name])
  const request = (body: any = {}, overrides: Record<string, string> = {}) => new Request('https://function.example.invalid', { method: 'POST', headers: { Origin: origin, Authorization: 'Bearer fictional', 'Content-Type': 'application/json', ...overrides }, body: JSON.stringify({ schoolId: school, teacherId: teacher, email, ...body }) })
  return { state, invite, insert, admin, call: (body?: any, headers?: Record<string, string>) => handler(request(body, headers)) }
}

describe('administrator-controlled staff invitations', () => {
  it('sends an invitation then inserts only a teacher membership', async () => {
    const f = fixture(); const response = await f.call()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ accepted: true, status: 'invitation_pending', invitation: 'accepted' })
    expect(f.invite).toHaveBeenCalledWith(email, expect.objectContaining({ redirectTo: `${origin}/auth/callback?setup=1` }))
    expect(f.state.links).toEqual([link()])
  })
  it('retains registration when SMTP fails and permits a subsequent safe retry', async () => {
    const f = fixture(); f.state.inviteError = true
    expect((await f.call()).status).toBe(409); expect(f.insert).not.toHaveBeenCalled()
    f.state.inviteError = false
    expect((await f.call()).status).toBe(200)
    expect(f.state.links).toEqual([link()]); expect(f.state.users).toHaveLength(1)
  })
  it('does not resend or create another identity on repeated invitations', async () => {
    const f = fixture(); await f.call()
    expect(await (await f.call()).json()).toMatchObject({ invitation: 'existing' })
    expect(f.invite).toHaveBeenCalledTimes(1); expect(f.insert).toHaveBeenCalledTimes(1)
  })
  it('coalesces overlapping requests in one running instance', async () => {
    const f = fixture(); const results = await Promise.all([f.call(), f.call()])
    expect(results.map(r => r.status)).toEqual([200, 200]); expect(f.invite).toHaveBeenCalledTimes(1)
  })
  it.each([
    { role: 'admin' }, { teacher_id: other }, { school_id: other }, { active: false },
  ])('never overwrites a conflicting membership: %j', async conflict => {
    const f = fixture(); f.state.users = [invited()]; f.state.links = [{ ...link(), ...conflict }]
    const before = structuredClone(f.state.links)
    expect((await f.call()).status).toBe(409)
    expect(f.state.links).toEqual(before); expect(f.invite).not.toHaveBeenCalled(); expect(f.insert).not.toHaveBeenCalled()
  })
  it('preserves a legitimate existing membership and verified identity', async () => {
    const f = fixture(); f.state.users = [{ ...invited(), email_confirmed_at: '2026-01-01', last_sign_in_at: '2026-01-01' }]; f.state.links = [link()]
    expect(await (await f.call()).json()).toMatchObject({ invitation: 'existing', status: 'email_verified' })
    expect(f.insert).not.toHaveBeenCalled(); expect(f.invite).not.toHaveBeenCalled()
  })
  it('does not adopt an unlinked identity, even if it has an invite or editable metadata', async () => {
    const f = fixture(); f.state.users = [{ ...invited(), user_metadata: { teacher_id: teacher, school_id: school } }]
    expect((await f.call()).status).toBe(409); expect(f.invite).not.toHaveBeenCalled(); expect(f.insert).not.toHaveBeenCalled()
  })
  it('fails closed after partial linking failure; a retry does not send another email', async () => {
    const f = fixture(); f.state.insertError = true
    expect((await f.call()).status).toBe(409)
    f.state.insertError = false
    expect((await f.call()).status).toBe(409)
    expect(f.invite).toHaveBeenCalledTimes(1); expect(f.state.users).toHaveLength(1)
  })
  it.each(['teacher', 'guest'])('rejects %s callers before privileged access', async role => {
    const f = fixture(); f.state.role = role
    expect((await f.call()).status).toBe(403); expect(f.admin.from).not.toHaveBeenCalled(); expect(f.invite).not.toHaveBeenCalled()
  })
  it('rejects inactive admins, invalid sessions, wrong origin, inactive/wrong-school teachers and email mismatches', async () => {
    const a = fixture(); a.state.active = false; expect((await a.call()).status).toBe(403)
    const b = fixture(); b.state.authError = true; expect((await b.call()).status).toBe(401)
    const c = fixture(); expect((await c.call({}, { Origin: 'https://attacker.example.invalid' })).status).toBe(403)
    const d = fixture(); d.state.teacherActive = false; expect((await d.call()).status).toBe(404)
    const e = fixture(); e.state.teacherSchool = other; expect((await e.call()).status).toBe(404)
    const f = fixture(); expect((await f.call({ email: 'other@example.invalid' })).status).toBe(404)
    for (const item of [a,b,c,d,e,f]) expect(item.invite).not.toHaveBeenCalled()
  })
  it('fails closed when identity lookup fails', async () => {
    const f = fixture(); f.state.lookupError = true
    expect((await f.call()).status).toBe(409); expect(f.invite).not.toHaveBeenCalled()
  })
  it('returns admin-only authoritative statuses without exposing Auth user data or claiming a password exists', async () => {
    const f = fixture(); await f.call()
    expect(await (await f.call({ action: 'status' })).json()).toEqual({ statuses: { [teacher]: 'invitation_pending' } })
    f.state.users[0].email_confirmed_at = '2026-01-01'; f.state.users[0].last_sign_in_at = '2026-01-01'
    expect(await (await f.call({ action: 'status' })).json()).toEqual({ statuses: { [teacher]: 'email_verified' } })
    f.state.role = 'teacher'; expect((await f.call({ action: 'status' })).status).toBe(403)
  })
})
