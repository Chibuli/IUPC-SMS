import type { Student } from './types'

/** Students eligible for ordinary current-school workflows. */
export function isOperationalStudent(student: Pick<Student, 'status'> & Partial<Pick<Student, 'archived'>>): boolean {
  return student.status === 'Active' && student.archived !== true
}
