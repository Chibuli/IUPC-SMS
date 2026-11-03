import type { Database, School, Teacher, TeacherPermissionKey } from './types'
import { supabase } from './supabase'
import { decodeEnrollmentVerification, uniqueActiveTermId } from '../lib/enrollment-certainty'
import { isStaffAccountStatus, type StaffAccountStatus, type StaffInvitationResult } from '../lib/teacher-onboarding'
import { loadAuthorizedMarks } from './load-marks'

let activeSchoolId: string | null = null
export interface AccountScope { userId: string; schoolId: string; verified: boolean }
let accountScope: AccountScope | null = null
export const setAccountScope = (scope: AccountScope | null) => { accountScope = scope; activeSchoolId = scope?.schoolId ?? null }
export const getAccountScope = () => accountScope
export const setActiveSchoolId = (id: string | null) => { if (id !== activeSchoolId || id === null) accountScope = null; activeSchoolId = id }
export const getActiveSchoolId = () => activeSchoolId

const empty: Database = { schools: [], classes: [], teachers: [], subjects: [], students: [], terms: [], exams: [], marks: [], gradingScales: [], reportCards: [], notes: [], timetableSlots: [], bellSchedules: [], markWindows: [] }

function requireClient() {
  if (!supabase) throw new Error('School database is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.')
  if (!activeSchoolId || !accountScope?.verified) throw new Error('This account is not linked to a verified active school.')
  return { client: supabase, schoolId: activeSchoolId }
}

function id(row: Record<string, unknown>) { return String(row.id) }

/** All queries use the authenticated RLS context; school ids are taken from the verified membership. */
export async function loadSchoolDatabase(schoolId: string): Promise<Database> {
  if (!supabase) return empty
  const scope = accountScope
  if (!scope?.verified || scope.schoolId !== schoolId) return empty
  const { data: auth } = await supabase.auth.getSession()
  if (accountScope !== scope || auth.session?.user.id !== scope.userId || !auth.session.expires_at || auth.session.expires_at * 1000 <= Date.now()) return empty
  const client = supabase
  const assertMarkScope = async () => {
    const { data } = await client.auth.getSession()
    if (accountScope !== scope || !scope.verified || data.session?.user.id !== scope.userId || !data.session.expires_at || data.session.expires_at * 1000 <= Date.now()) throw new Error('The account or school changed while loading marks. Reconnect before using reports.')
  }
  const names = ['schools','classes','teachers','teacher_permissions','teacher_subjects','subjects','teacher_classes','students','terms','exams','marks','grading_scales','report_cards','student_notes','timetable_slots','bell_schedules','mark_windows'] as const
  const results = await Promise.all(names.map((name) => {
    if (name === 'marks') return loadAuthorizedMarks(client, schoolId, assertMarkScope).then(data => ({ data, error: null }))
    let query = client.from(name).select('*')
    if (name === 'subjects') return query.or(`school_id.eq.${schoolId},school_id.is.null`).order('school_id',{ascending:false})
    if (name === 'schools') return query.eq('id', schoolId)
    // The RLS policy scopes this relation through its owning teacher record;
    // it intentionally has no redundant school_id column.
    if (name === 'teacher_permissions') return query
    if (name === 'teacher_classes') return query.eq('school_id', schoolId)
    return query.eq('school_id', schoolId)
  }))
  if (accountScope !== scope) return empty
  const rows = Object.fromEntries(names.map((name, index) => {
    const result = results[index]
    if (result.error) throw new Error(`Unable to load school records (${name}).`)
    return [name, result.data ?? []]
  })) as Record<(typeof names)[number], Record<string, any>[]>

  const schoolRows: School[] = rows.schools.map((r) => ({ _id: id(r), name:r.name, code:r.code, address:r.address, postal:r.postal, city:r.city, contact_email:r.contact_email, phone_number:r.phone_number, logo_url:r.logo_url, crest_url:r.crest_url, motto:r.motto, principal_name:r.principal_name ?? '' }))
  const teacherIds = new Set(rows.teachers.map((teacher) => teacher.id))
  const permissions = new Map<string, TeacherPermissionKey[]>()
  for (const r of rows.teacher_permissions) {
    if (!teacherIds.has(r.teacher_id)) continue
    permissions.set(r.teacher_id, [...(permissions.get(r.teacher_id) ?? []), r.permission])
  }
  const assigned = new Map<string, string[]>()
  for (const r of rows.teacher_subjects) {
    if (!teacherIds.has(r.teacher_id)) continue
    assigned.set(r.teacher_id, [...(assigned.get(r.teacher_id) ?? []), r.subject_id])
  }
  const assignedClasses = new Map<string, string[]>()
  for (const r of rows.teacher_classes) {
    if (!teacherIds.has(r.teacher_id)) continue
    assignedClasses.set(r.teacher_id, [...(assignedClasses.get(r.teacher_id) ?? []), r.class_id])
  }
  const teacherRows: Teacher[] = rows.teachers.map((r) => ({ _id:id(r), school_id:r.school_id, full_name:r.full_name, email:r.email, employee_id:r.employee_id, initials:r.initials, assigned_subject_ids:assigned.get(r.id) ?? [], assigned_class_ids:assignedClasses.get(r.id) ?? [], permissions:permissions.get(r.id) ?? [], password_hash:null, password_salt:null, activated_at:null }))
  // Tenant offerings shadow their corresponding global catalogue entries using
  // the same per-level syllabus code-derived local ids as the existing UI.
  const tenantCodes = new Set(rows.subjects.filter((row) => row.school_id === schoolId).map((row) => row.code))
  const subjectRows = rows.subjects.map((r) => ({ _id:id(r), school_id:r.school_id, name:r.name, code:r.code, category:r.category, level:r.level, offered:r.school_id === schoolId ? r.offered : false }))
  const visibleSubjects = subjectRows.filter((r) => r.school_id === schoolId || !tenantCodes.has(r.code))
  const studentIds = rows.students.map((row) => row.id as string)
  const enrollmentScopes = new Map<string, ReturnType<typeof decodeEnrollmentVerification>[string]>()
  // Only the explicitly active term is unambiguous here; never infer a term from
  // row ordering. Scope is tied to this term and the reports screen checks it.
  const assessmentTermId = uniqueActiveTermId(rows.terms.map((term) => ({ id: String(term.id), is_active: term.is_active === true })))
  if (studentIds.length && assessmentTermId) {
    for (let start = 0; start < studentIds.length; start += 500) {
      const batch = studentIds.slice(start, start + 500)
      try {
        const { data, error } = await client.rpc('verify_student_enrollments', {
          target_school: schoolId,
          target_term: assessmentTermId,
          target_students: batch,
        })
        const decoded = decodeEnrollmentVerification(batch, data, Boolean(error))
        for (const [studentId, scope] of Object.entries(decoded)) enrollmentScopes.set(studentId, scope)
      } catch {
        for (const studentId of batch) enrollmentScopes.set(studentId, { certainty: 'error', subjectIds: [] })
      }
    }
  }
  if (accountScope !== scope) return empty
  return {
    schools: schoolRows,
    classes: rows.classes.map((r) => ({ _id:id(r), school_id:r.school_id, class_name:r.class_name, stream_name:r.stream_name, class_teacher_id:r.class_teacher_id ?? null })),
    teachers: teacherRows,
    subjects: visibleSubjects,
    students: rows.students.map((r) => {
      const scope = enrollmentScopes.get(r.id) ?? { certainty: 'unknown' as const, subjectIds: [] }
      return { _id:id(r), school_id:r.school_id, admission_number:r.admission_number, full_name:r.full_name, gender:r.gender, date_of_birth:r.date_of_birth ?? '', class_id:r.class_id, subject_ids:scope.subjectIds, enrollment_certainty:scope.certainty, enrollment_term_id:assessmentTermId, guardian_name:r.guardian_name, guardian_phone:r.guardian_phone, status:r.status, archived:r.archived ?? false, archived_at:r.archived_at ?? null }
    }),
    terms: rows.terms.map((r) => ({ _id:id(r), school_id:r.school_id, name:r.name, academic_year:r.academic_year, is_active:r.is_active, start_date:r.start_date })),
    exams: rows.exams.map((r) => ({ _id:id(r), term_id:r.term_id, subject_id:r.subject_id, class_id:r.class_id, exam_name:r.exam_name, exam_type:r.exam_type, max_score:Number(r.max_score), exam_date:r.exam_date, editing_deadline:r.editing_deadline, status:r.status })),
    marks: rows.marks.map((r) => ({ _id:id(r), exam_id:r.exam_id, student_id:r.student_id, score:r.score_code ?? (r.score === null ? null : Number(r.score)), remarks:r.remarks, updated_at:r.updated_at, entered_by:r.entered_by })),
    gradingScales: rows.grading_scales.map((r) => ({ _id:id(r), school_id:r.school_id, name:r.name, pass_mark:Number(r.pass_mark), bands:r.bands, created_at:r.created_at })),
    reportCards: rows.report_cards.map((r) => ({ _id:id(r), student_id:r.student_id, term_id:r.term_id, attendance_present:r.attendance_present, attendance_total:r.attendance_total, class_teacher:r.class_teacher, academic:r.academic, activities:r.activities, conduct:r.conduct, principal:r.principal, hse:r.hse, next_term_begins:r.next_term_begins ?? '', next_term_ends:r.next_term_ends ?? '', updated_at:r.updated_at })),
    notes: rows.student_notes.map((r) => ({ _id:id(r), student_id:r.student_id, body:r.body, author_name:r.author_name, created_at:r.created_at })),
    timetableSlots: rows.timetable_slots.map((r) => ({ _id:id(r), school_id:r.school_id, term_id:r.term_id, class_id:r.class_id, day:r.day, period:r.period, subject_id:r.subject_id, teacher_id:r.teacher_id, room:r.room, week:r.week })),
    bellSchedules: rows.bell_schedules.map((r) => ({ _id:r.school_id, school_id:r.school_id, entries:r.entries, updated_at:r.updated_at })),
    markWindows: rows.mark_windows.map((r) => ({ _id:r.school_id, school_id:r.school_id, closes_at:r.closes_at, updated_at:r.updated_at })),
  }
}

export async function inviteStaff(email: string, teacherId: string) {
  const { client, schoolId } = requireClient()
  const { data, error } = await client.functions.invoke('provision-staff', { body: { schoolId, email:email.trim().toLowerCase(), teacherId } })
  if (error || !data?.accepted || !isStaffAccountStatus(data.status) || !['accepted', 'existing'].includes(data.invitation)) throw new Error('Invitation requires attention. The saved teacher record is retained; check service configuration and account identity before retrying.')
  return data as StaffInvitationResult
}

export async function staffAccountStatuses(): Promise<Record<string, StaffAccountStatus>> {
  const { client, schoolId } = requireClient()
  const { data, error } = await client.functions.invoke('provision-staff', { body: { schoolId, action: 'status' } })
  if (error || !data?.statuses || typeof data.statuses !== 'object' || Array.isArray(data.statuses) || !Object.values(data.statuses).every(isStaffAccountStatus)) throw new Error('Authoritative account status is unavailable. Check the staff invitation service.')
  return data.statuses
}

/** Generic authenticated table operations. RLS and database triggers make the authority decisions. */
export async function insertRow(table: string, values: Record<string, unknown>) {
  const { client, schoolId } = requireClient()
  const { data, error } = await client.from(table).insert({ ...values, school_id:schoolId }).select('*').single()
  if (error) throw new Error(error.message.includes('duplicate') ? 'A record with those details already exists.' : 'The record could not be saved. Check your access and the entered values.')
  return data as Record<string, any>
}
export async function updateRow(table: string, rowId: string, values: Record<string, unknown>) {
  const { client } = requireClient()
  const { data, error } = await client.from(table).update(values).eq('id',rowId).select('*').maybeSingle()
  if (error || !data) throw new Error('The record could not be updated. It may no longer exist or you may not have access.')
  return data as Record<string, any>
}
export async function deleteRow(table: string, rowId: string) {
  const { client } = requireClient()
  const { error, count } = await client.from(table).delete({count:'exact'}).eq('id',rowId)
  if (error || count === 0) throw new Error('The record could not be deleted. It may no longer exist or you may not have access.')
}
export async function saveRow(table: string, values: Record<string, unknown>, keys: string[]) {
  const { client, schoolId } = requireClient()
  const { data, error } = await client.from(table).upsert({ ...values, school_id:schoolId }, { onConflict:keys.join(',') }).select('*').single()
  if (error) throw new Error('The record could not be saved. Check your access and the entered values.')
  return data as Record<string, any>
}
