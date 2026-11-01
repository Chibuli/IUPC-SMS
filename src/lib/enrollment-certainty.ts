export type EnrollmentCertainty = 'verified_enrolled' | 'verified_no_enrollments' | 'unknown' | 'error'

export interface EnrollmentScope {
  certainty: EnrollmentCertainty
  subjectIds: string[]
}

/** Return a term only when exactly one term is explicitly active. */
export function uniqueActiveTermId(terms: { id: string; is_active: boolean }[]): string | null {
  const activeTerms = terms.filter((term) => term.is_active)
  return activeTerms.length === 1 ? activeTerms[0].id : null
}

interface EnrollmentVerificationRow {
  student_id: string
  certainty: EnrollmentCertainty
  subject_ids?: unknown
}

/**
 * Convert the secure database RPC response into one explicit state per requested
 * student. A missing row is not proof of no enrollments; transport/query failure
 * is kept separate from an authorization-limited unknown result.
 */
export function decodeEnrollmentVerification(
  studentIds: string[],
  rows: unknown,
  failed = false,
): Record<string, EnrollmentScope> {
  const result: Record<string, EnrollmentScope> = Object.fromEntries(
    studentIds.map((studentId) => [studentId, { certainty: failed ? 'error' : 'unknown', subjectIds: [] }]),
  )
  if (failed || !Array.isArray(rows)) return result

  const requestedIds = new Set(studentIds)
  const responseCounts = new Map<string, number>()
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const candidate = row as Partial<EnrollmentVerificationRow>
    if (typeof candidate.student_id !== 'string' || !requestedIds.has(candidate.student_id)) continue
    responseCounts.set(candidate.student_id, (responseCounts.get(candidate.student_id) ?? 0) + 1)
  }

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const candidate = row as Partial<EnrollmentVerificationRow>
    const studentId = candidate.student_id
    if (typeof studentId !== 'string' || !requestedIds.has(studentId) || responseCounts.get(studentId) !== 1) continue

    if (candidate.certainty === 'unknown') {
      result[studentId] = { certainty: 'unknown', subjectIds: [] }
      continue
    }
    if (candidate.certainty !== 'verified_enrolled' && candidate.certainty !== 'verified_no_enrollments') continue
    if (!Array.isArray(candidate.subject_ids) || !Array.from(candidate.subject_ids).every(
      (subjectId) => typeof subjectId === 'string' && subjectId.trim().length > 0,
    )) continue

    const subjectIds = candidate.subject_ids as string[]
    const uniqueSubjectIds = new Set(subjectIds)
    if (uniqueSubjectIds.size !== subjectIds.length) continue
    if (candidate.certainty === 'verified_enrolled' && subjectIds.length === 0) continue
    if (candidate.certainty === 'verified_no_enrollments' && subjectIds.length !== 0) continue
    result[studentId] = { certainty: candidate.certainty, subjectIds: [...subjectIds] }
  }
  return result
}
