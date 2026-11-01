import type { Database, Teacher } from '../data/types'

/** Report formatting only. Strip recognized leading titles, retain every meaningful name part.
 * Hyphenated components each contribute an initial; apostrophes stay inside one name part.
 * This does not rewrite the teacher record or the initials used elsewhere in the application.
 */
export function reportTeacherInitials(name: string | null | undefined): string {
  if(typeof name!=='string')return '—'
  let normalized=name.normalize('NFC').trim()
  const title=/^(?:mr|mrs|ms|miss|dr|prof)(?:\.\s*|\s+|$)/i
  while(title.test(normalized))normalized=normalized.replace(title,'').trim()
  const letters=normalized.split(/[\s\-\u2010\u2011]+/u).map(part=>part.match(/\p{L}/u)?.[0].toUpperCase()).filter((letter):letter is string=>Boolean(letter))
  return letters.length ? letters.map(letter=>`${letter}.`).join('') : '—'
}

export interface SubjectTeacherScope { schoolId: string; termId: string; classId: string; subjectId: string }
/** The existing period-specific timetable is authoritative. No primary-teacher field exists. */
export function resolveReportSubjectTeacher(db: Pick<Database,'teachers'|'timetableSlots'>, scope: SubjectTeacherScope): Teacher | undefined {
  const ids=new Set(db.timetableSlots.filter(slot=>slot.school_id===scope.schoolId && slot.term_id===scope.termId && slot.class_id===scope.classId && slot.subject_id===scope.subjectId).map(slot=>slot.teacher_id))
  if(ids.size!==1)return undefined
  const matches=db.teachers.filter(teacher=>teacher._id===[...ids][0] && teacher.school_id===scope.schoolId)
  return matches.length===1 ? matches[0] : undefined
}
