import type { Role, Teacher } from './types'

/**
 * Demo authentication only.
 * The documentation is explicit that a browser-side check is not a security boundary — this
 * module exists so the sign-in flow, the sign-up gate, role scoping and teacher assignment behave
 * correctly until the `api` seam is pointed at a real backend, where a password KDF (Argon2id or
 * bcrypt, salted and slow by design) and enforcement move server-side. A single SHA-256 pass over
 * a salted password is enough to prove the mechanism here and is *not* enough to store a real one.
 */
const DEMO_PASSWORD = 'iupc'
const DEMO_SALT = 'iupc-academy-v1'
/**
 * `sha256('iupc-academy-v1:iupc')`. The demo password is the same for every seeded staff record,
 * so its hash is a constant rather than something the seed has to compute — seeding is
 * synchronous and WebCrypto is not. Sign-up writes a per-teacher random salt instead.
 */
const DEMO_HASH = '5aa669a319d34d45ac5ec29d49ffcba615a5a4b8290a112de8809bbfd960306f'

/** A password a teacher picks for themselves has to clear this. */
export const MIN_PASSWORD_LENGTH = 8

const encoder = new TextEncoder()

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export const hashPassword = (password: string, salt: string) => sha256Hex(`${salt}:${password}`)

/** A fresh salt per account, so two teachers who pick the same password differ in storage. */
export function newSalt(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/* ── the staff register is the only way in ─────────────────────────────── */

export type AccountState =
  /** No staff record carries that address — sign-up and sign-in both refuse. */
  | 'unknown'
  /** On the register, but the teacher has not chosen a password yet. */
  | 'awaiting'
  /** Sign-up is done; the teacher's own password opens the account. */
  | 'active'

export interface StaffLookup {
  state: AccountState
  teacher: Teacher | null
}

/**
 * Resolve an email against the staff register. This single lookup is what makes
 * sign-up invitation-only: the registrar records a person with their address
 * first, and only then can that address create an account.
 */
export function lookupStaff(teachers: readonly Teacher[], email: string): StaffLookup {
  const needle = email.trim().toLowerCase()
  if (!needle) return { state: 'unknown', teacher: null }
  const teacher = teachers.find((entry) => entry.email.trim().toLowerCase() === needle) ?? null
  if (!teacher) return { state: 'unknown', teacher: null }
  return { state: teacher.password_hash ? 'active' : 'awaiting', teacher }
}

/** Awaiting sign-up means the registrar added them but they have not set a password. */
export function accountState(teacher: Pick<Teacher, 'password_hash'>): AccountState {
  return teacher.password_hash ? 'active' : 'awaiting'
}

export function awaitingSignUp(teachers: readonly Teacher[]): Teacher[] {
  return teachers.filter((teacher) => !teacher.password_hash)
}

/** Mirrors the seeded staff credential, so administrators sign in as before. */
export const SEEDED_CREDENTIALS = {
  password_salt: DEMO_SALT,
  password_hash: DEMO_HASH,
  activated_at: '2026-09-01T00:00:00.000Z',
}

export const STAFF_EMAIL_PLACEHOLDER = 'j.odhiambo@iupc.academy'

/* ── sign in ───────────────────────────────────────────────────────────── */

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
  teachers: readonly Teacher[],
): Promise<SignInResult> {
  const username = input.username.trim().toLowerCase()
  const password = input.password

  if (!username) return { ok: false, error: 'Enter your username or staff email.' }
  if (!password) return { ok: false, error: 'Enter your password.' }

  if (input.role === 'admin') {
    if (!ADMIN_USERNAMES.includes(username)) {
      return { ok: false, error: 'No administrator account matches that username.' }
    }
    const supplied = await hashPassword(password, DEMO_SALT)
    if (supplied !== DEMO_HASH) return { ok: false, error: 'That password is not correct.' }
    return { ok: true, role: 'admin', name: 'Registrar' }
  }

  const { state, teacher } = lookupStaff(teachers, username)
  if (!teacher) return { ok: false, error: 'No staff account matches that email.' }
  if (state === 'awaiting') {
    return {
      ok: false,
      error: `${teacher.email} is on the staff register but has no password yet. Use “Create your account” to set one.`,
    }
  }

  const supplied = await hashPassword(password, teacher.password_salt ?? DEMO_SALT)
  if (supplied !== teacher.password_hash) return { ok: false, error: 'That password is not correct.' }
  return { ok: true, role: 'teacher', name: teacher.full_name, teacherId: teacher._id }
}

/* ── sign up ───────────────────────────────────────────────────────────── */

export interface SignUpInput {
  email: string
  password: string
  confirm: string
}

export interface SignUpResult {
  ok: boolean
  error?: string
  name?: string
  teacherId?: string
  role?: Role
}

/** What is wrong with the chosen password, or null when it is acceptable. */
export function passwordProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  if (password !== confirm) return 'The two passwords do not match.'
  return null
}

/**
 * Turn a staff record into a usable account. The register decides who may do
 * this at all, so the order of the checks matters: an address that is not on the
 * register is refused before anything about the password is considered.
 *
 * `saveCredentials` is the caller's persistence step (the `api` seam), so this
 * module stays free of storage.
 */
export async function createAccount(
  input: SignUpInput,
  teachers: readonly Teacher[],
  saveCredentials: (teacherId: string, credentials: { salt: string; hash: string } | null) => Promise<unknown>,
): Promise<SignUpResult> {
  const { state, teacher } = lookupStaff(teachers, input.email)

  if (state === 'unknown' || !teacher) {
    return {
      ok: false,
      error:
        'That email is not on the staff register, so no account can be created for it. Ask the registrar to add you with this address first.',
    }
  }
  if (state === 'active') {
    return {
      ok: false,
      error: `${teacher.email} already has an account. Sign in with the password you chose.`,
    }
  }

  const problem = passwordProblem(input.password, input.confirm)
  if (problem) return { ok: false, error: problem }

  const salt = newSalt()
  const hash = await hashPassword(input.password, salt)
  await saveCredentials(teacher._id, { salt, hash })

  return { ok: true, role: 'teacher', name: teacher.full_name, teacherId: teacher._id }
}

export const DEMO_HINT = {
  admin: { username: 'admin', password: DEMO_PASSWORD },
  teacher: { username: 'g.wanjiru@iupc.academy', password: DEMO_PASSWORD },
}
