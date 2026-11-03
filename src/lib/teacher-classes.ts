import type { ClassRow, ID } from '../data/types'

/**
 * Teacher class assignments.
 *
 * A staff record may hold explicit streams. They are separate from timetable
 * lessons: `is_assigned_teacher` grants class access through either a
 * `teacher_classes` row or a lesson on that class, so an assignment survives an
 * empty timetable and a timetable survives an empty assignment list.
 *
 * Two layers keep an unrelated staff edit from erasing an assignment:
 *  - this client always sends the complete set it loaded (see
 *    `classSelectionToSave`), which the deployed `save_teacher` already accepts;
 *  - the reviewed migration makes a NULL array mean "leave the stored rows
 *    untouched", while an explicitly empty array is the only way to clear them
 *    (`classesArgument`).
 */

/** What the client sends for the `classes` argument of `save_teacher`. */
export type ClassAssignment = { mode: 'preserve' } | { mode: 'replace'; classIds: ID[] }

function unique(ids: readonly ID[]): ID[] {
  return [...new Set(ids)]
}

/**
 * The ids to send when saving a teacher.
 *
 * `edited` is the form's selection: `undefined` when the surface does not manage
 * classes at all (preserve what is stored), `[]` when the administrator cleared
 * every class deliberately. The result is never undefined, because the deployed
 * function treats a missing set as "no classes".
 */
export function classSelectionToSave(stored: readonly ID[] | undefined, edited: readonly ID[] | undefined): ID[] {
  return unique(edited ?? stored ?? [])
}

/** The RPC argument: null preserves stored rows; an empty array clears them. */
export function classesArgument(assignment: ClassAssignment): ID[] | null {
  return assignment.mode === 'preserve' ? null : unique(assignment.classIds)
}

/** Toggle one stream in a selection, keeping the school's order irrelevant. */
export function toggleClassAssignment(selected: readonly ID[], classId: ID): ID[] {
  return selected.includes(classId) ? selected.filter((id) => id !== classId) : [...selected, classId]
}

/** Streams that belong to this school; a foreign id is never offered. */
export function assignableClasses(classes: readonly ClassRow[], schoolId: ID): ClassRow[] {
  return classes.filter((cls) => cls.school_id === schoolId)
}

/**
 * Split a requested set into ids this school owns and ids it does not. The
 * caller must refuse a non-empty `rejected` list rather than silently dropping
 * it, so a cross-school assignment can never be accepted by accident.
 */
export function scopedClassIds(
  ids: readonly ID[],
  classes: readonly ClassRow[],
  schoolId: ID,
): { accepted: ID[]; rejected: ID[] } {
  const owned = new Set(assignableClasses(classes, schoolId).map((cls) => cls._id))
  const accepted: ID[] = []
  const rejected: ID[] = []
  for (const id of unique(ids)) (owned.has(id) ? accepted : rejected).push(id)
  return { accepted, rejected }
}

/** One line for the staff card: what the explicit assignment grants. */
export function classAssignmentLabel(assigned: readonly ClassRow[]): string {
  if (!assigned.length) return 'No explicit class assignment — class access follows their timetable lessons.'
  return assigned.map((cls) => `${cls.class_name} ${cls.stream_name}`.trim()).join(' · ')
}
