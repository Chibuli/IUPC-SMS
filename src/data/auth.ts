import type { Teacher } from './types'

export type AccountState = 'unknown' | 'awaiting' | 'active'

export interface StaffLookup {
  state: AccountState
  teacher: Teacher | null
}

/** Resolve a school staff record without authenticating or issuing a session. */
export function lookupStaff(teachers: readonly Teacher[], email: string): StaffLookup {
  const needle = email.trim().toLowerCase()
  if (!needle) return { state: 'unknown', teacher: null }
  const teacher = teachers.find((entry) => entry.email.trim().toLowerCase() === needle) ?? null
  if (!teacher) return { state: 'unknown', teacher: null }
  return { state: teacher.password_hash ? 'active' : 'awaiting', teacher }
}

export function accountState(teacher: Pick<Teacher, 'password_hash'>): AccountState {
  return teacher.password_hash ? 'active' : 'awaiting'
}

export function awaitingSignUp(teachers: readonly Teacher[]): Teacher[] {
  return teachers.filter((teacher) => !teacher.password_hash)
}
