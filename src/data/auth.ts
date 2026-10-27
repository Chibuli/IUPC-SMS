import type { Role } from './types'

/**
 * Demo authentication only.
 * The documentation is explicit that a browser-side check is not a security boundary — this
 * module exists so the sign-in flow, role scoping and teacher assignment behave correctly until
 * the `api` seam is pointed at a real backend, where hashing (Argon2id/bcrypt) and enforcement
 * move server-side.
 */
const DEMO_PASSWORD = 'iupc'
const DEMO_SALT = 'iupc-academy-v1'

const encoder = new TextEncoder()

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export const hashPassword = (password: string, salt: string) => sha256Hex(`${salt}:${password}`)

export interface SignInInput {
  role: Exclude<Role, 'guest'>
  username: string
  password: string
}

export interface SignInResult {
  ok: boolean
  error?: string
  role?: Role
  name?: string
  teacherId?: string
}

const ADMIN_USERNAMES = ['admin', 'registrar@iupc.academy']

export async function verifyCredentials(
  input: SignInInput,
  teachers: { _id: string; email: string; full_name: string }[],
): Promise<SignInResult> {
  const username = input.username.trim().toLowerCase()
  const password = input.password

  if (!username) return { ok: false, error: 'Enter your username or staff email.' }
  if (!password) return { ok: false, error: 'Enter your password.' }

  const supplied = await hashPassword(password, DEMO_SALT)
  const expected = await hashPassword(DEMO_PASSWORD, DEMO_SALT)

  if (input.role === 'admin') {
    if (!ADMIN_USERNAMES.includes(username)) {
      return { ok: false, error: 'No administrator account matches that username.' }
    }
    if (supplied !== expected) return { ok: false, error: 'That password is not correct.' }
    return { ok: true, role: 'admin', name: 'Registrar' }
  }

  const teacher = teachers.find((t) => t.email.toLowerCase() === username)
  if (!teacher) return { ok: false, error: 'No staff account matches that email.' }
  if (supplied !== expected) return { ok: false, error: 'That password is not correct.' }
  return { ok: true, role: 'teacher', name: teacher.full_name, teacherId: teacher._id }
}

export const DEMO_HINT = {
  admin: { username: 'admin', password: DEMO_PASSWORD },
  teacher: { username: 'g.wanjiru@iupc.academy', password: DEMO_PASSWORD },
}
