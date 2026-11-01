// Testable independently of Deno, SMTP and hosted accounts.
type ClientFactory = (url: string, key: string, options?: any) => any
type Env = (name: string) => string | undefined
type AuthUser = { id: string; email?: string; invited_at?: string; email_confirmed_at?: string; last_sign_in_at?: string; banned_until?: string }
export type StaffStatus = 'invitation_pending' | 'email_verified' | 'requires_attention'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const sameLink = (row: any, school: string, teacher: string, user: string) => row.school_id === school && row.teacher_id === teacher && row.user_id === user && row.role === 'teacher' && row.active === true
const eligible = (user: AuthUser, email: string) => user.email?.toLowerCase() === email && !(user.banned_until && Date.parse(user.banned_until) > Date.now())
const statusOf = (user: AuthUser): StaffStatus => user.email_confirmed_at && user.last_sign_in_at ? 'email_verified' : user.invited_at ? 'invitation_pending' : 'requires_attention'

export function createStaffHandler(createClient: ClientFactory, env: Env) {
  // Coalesce duplicate requests handled by this running instance.
  const inFlight = new Map<string, Promise<{ status: StaffStatus; invitation: string }>>()
  return async (request: Request): Promise<Response> => {
    const origin = env('APP_ORIGIN')
    const headers = { 'Access-Control-Allow-Origin': origin ?? 'null', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin', 'Cache-Control': 'no-store' }
    const reply = (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } })
    if (request.method === 'OPTIONS') return reply({}, 204)
    if (request.method !== 'POST') return reply({ error: 'Not found' }, 404)
    const authorization = request.headers.get('Authorization')
    const url = env('SUPABASE_URL'), anon = env('SUPABASE_ANON_KEY'), secret = env('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !anon || !secret || !origin) return reply({ error: 'Staff invitation service is not configured' }, 503)
    if (!authorization?.startsWith('Bearer ')) return reply({ error: 'Unauthorized' }, 401)
    if (request.headers.get('Origin') !== origin) return reply({ error: 'Invalid request origin' }, 403)
    try {
      const scoped = createClient(url, anon, { global: { headers: { Authorization: authorization } } })
      const { data: auth, error: authError } = await scoped.auth.getUser()
      if (authError || !auth?.user) return reply({ error: 'Unauthorized' }, 401)
      const body = await request.json()
      const schoolId = body.schoolId, teacherId = body.teacherId
      const action = body.action ?? 'invite'
      if (typeof schoolId !== 'string' || !uuid.test(schoolId) || !['invite', 'status'].includes(action)) return reply({ error: 'Invalid request' }, 400)
      const { data: member, error: memberError } = await scoped.from('memberships').select('role,active').eq('school_id', schoolId).eq('user_id', auth.user.id).maybeSingle()
      if (memberError || member?.active !== true || member.role !== 'admin') return reply({ error: 'Forbidden' }, 403)
      const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
      async function bindings(teacher: string, user?: string) {
        const { data, error } = await admin.from('memberships').select('school_id,user_id,teacher_id,role,active').or(`teacher_id.eq.${teacher}${user ? `,user_id.eq.${user}` : ''}`)
        if (error) throw Error('Membership inspection failed')
        return data ?? []
      }
      async function checkedStatus(teacher: any): Promise<StaffStatus> {
        const links = await bindings(teacher.id)
        if (links.length !== 1) return 'requires_attention'
        const { data, error } = await admin.auth.admin.getUserById(links[0].user_id)
        if (error || !data?.user || !eligible(data.user, teacher.email.toLowerCase())) return 'requires_attention'
        const all = await bindings(teacher.id, data.user.id)
        if (all.length !== 1 || !sameLink(all[0], schoolId, teacher.id, data.user.id)) return 'requires_attention'
        return statusOf(data.user)
      }
      if (action === 'status') {
        const { data: teachers, error } = await scoped.from('teachers').select('id,email,active').eq('school_id', schoolId)
        if (error) return reply({ error: 'Staff status unavailable' }, 503)
        const statuses: Record<string, StaffStatus> = {}
        const rows = teachers ?? []
        for (let start = 0; start < rows.length; start += 6) {
          await Promise.all(rows.slice(start, start + 6).map(async (teacher: any) => {
            statuses[teacher.id] = teacher.active ? await checkedStatus(teacher) : 'requires_attention'
          }))
        }
        return reply({ statuses })
      }
      if (typeof teacherId !== 'string' || !uuid.test(teacherId) || typeof body.email !== 'string') return reply({ error: 'Invalid invitation request' }, 400)
      const email = body.email.trim().toLowerCase()
      const { data: teacher, error: teacherError } = await scoped.from('teachers').select('id,email,full_name,active').eq('school_id', schoolId).eq('id', teacherId).maybeSingle()
      if (teacherError || !teacher?.active || teacher.email.toLowerCase() !== email) return reply({ error: 'Staff record not found' }, 404)
      const key = `${schoolId}:${teacherId}:${email}`
      async function invite() {
        // Bound the scan and fail closed if identity inspection is incomplete.
        let existing: AuthUser | undefined
        for (let page = 1; ; page++) {
          if (page > 100) throw Error('Identity inspection requires attention')
          const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
          if (error || !data?.users) throw Error('Identity inspection failed')
          const matches = data.users.filter((u: AuthUser) => u.email?.toLowerCase() === email)
          if (matches.length > 1) throw Error('Conflicting identity')
          if (matches.length) { existing = matches[0]; break }
          if (data.users.length < 1000) break
        }
        const linked = await bindings(teacherId, existing?.id)
        let sent = false
        if (existing) {
          if (!eligible(existing, email)) throw Error('Conflicting identity')
          if (linked.length === 1 && sameLink(linked[0], schoolId, teacherId, existing.id)) return { status: statusOf(existing), invitation: 'existing' }
          // An unlinked Auth identity has no trusted teacher provenance. A
          // partial invitation therefore needs owner review, not automatic
          // adoption based on matching email or editable user metadata.
          throw Error('Existing identity requires owner review')
        } else {
          if (linked.length) throw Error('Teacher already has an identity')
          const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${origin}/auth/callback?setup=1`, data: { full_name: teacher.full_name } })
          if (error || !data?.user) throw Error('Invitation could not be sent')
          existing = data.user
          if (!existing || !eligible(existing, email)) throw Error('Invitation identity mismatch')
          sent = true
        }
        // Insert only. No upsert can replace roles, activity or teacher links.
        const fresh = await bindings(teacherId, existing.id)
        if (fresh.length && !(fresh.length === 1 && sameLink(fresh[0], schoolId, teacherId, existing.id))) throw Error('Conflicting membership')
        if (!fresh.length) {
          const { error } = await admin.from('memberships').insert({ school_id: schoolId, user_id: existing.id, teacher_id: teacherId, role: 'teacher', active: true })
          if (error) {
            const retry = await bindings(teacherId, existing.id)
            if (retry.length !== 1 || !sameLink(retry[0], schoolId, teacherId, existing.id)) throw Error('Invitation linking requires attention')
          }
        }
        return { status: statusOf(existing), invitation: sent ? 'accepted' : 'existing' }
      }
      let task = inFlight.get(key)
      if (!task) { task = invite(); inFlight.set(key, task) }
      try { return reply({ accepted: true, ...await task }) }
      finally { if (inFlight.get(key) === task) inFlight.delete(key) }
    } catch {
      return reply({ error: 'Invitation requires attention. Registration is retained; check the account before retrying.' }, 409)
    }
  }
}
