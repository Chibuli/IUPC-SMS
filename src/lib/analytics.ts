import type { Exam, GradeBand, Mark, Student } from '../data/types'
import type { EnrollmentCertainty } from './enrollment-certainty'
import { isOperationalStudent } from '../data/student-lifecycle'
import { bandFor, gradeFor } from './grading'

export type ScoreValue = number | 'X' | 'Y' | null

export interface BroadsheetColumn {
  examId: string
  subjectCode: string
  examName: string
  /** Stream tag, so two streams' papers on the same subject stay distinct. */
  classCode: string
  maxScore: number
  date: string
}

export interface BroadsheetRow {
  studentId: string
  admission: string
  name: string
  gender: Student['gender']
  cells: Record<string, ScoreValue>
  total: number
  mean: number | null
  grade: string
  points: number | null
  /** Number of required papers with a valid numeric score; zero is a valid score. */
  completed: number
  required: number
  outstandingPapers: string[]
  requiredExamIds: string[]
  unassessedSubjects: string[]
  completionKnown: boolean
  /** Whether the adapter supplied authoritative enrollment scope for this student. */
  enrollmentKnown: boolean
  enrollmentCertainty: EnrollmentCertainty
  assessmentTermVerified: boolean
  assessmentComplete: boolean
  rank: number | null
}

export interface SubjectSummary {
  examId: string
  subjectCode: string
  average: number | null
  grade: string
  entries: number
  highest: number | null
  lowest: number | null
  sd: number | null
}

export interface Broadsheet {
  columns: BroadsheetColumn[]
  /** Completed rows first, followed by incomplete rows in stable admission order. */
  rows: BroadsheetRow[]
  completedRows: BroadsheetRow[]
  incompleteRows: BroadsheetRow[]
  summary: SubjectSummary[]
  distribution: { grade: string; count: number }[]
  overall: {
    meanScore: number | null
    meanPoints: number | null
    meanGrade: string
    studentCount: number
    entered: number
  }
}

const numeric = (value: ScoreValue): value is number => typeof value === 'number'

export function mean(values: number[]): number | null {
  if (!values.length) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function stdDev(values: number[]): number | null {
  if (values.length < 2) return null
  const m = mean(values) as number
  const variance = values.reduce((sum, value) => sum + (value - m) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

/** Ties share a rank; ordering inside a tie is by admission number. */
function withRanks(rows: Omit<BroadsheetRow, 'rank'>[]): BroadsheetRow[] {
  const ranked = [...rows].sort((a, b) => {
    if (a.mean === null && b.mean === null) return a.admission.localeCompare(b.admission)
    if (a.mean === null) return 1
    if (b.mean === null) return -1
    return b.mean - a.mean || a.admission.localeCompare(b.admission)
  })

  const result: BroadsheetRow[] = ranked.map((row) => ({ ...row, rank: null }))
  let lastMean: number | null = null
  let lastRank = 0
  result.forEach((row, index) => {
    if (row.mean === null) return
    if (lastMean !== null && Math.abs(row.mean - lastMean) < 1e-9) {
      row.rank = lastRank
    } else {
      row.rank = index + 1
      lastRank = index + 1
      lastMean = row.mean
    }
  })
  return result
}

export interface BuildBroadsheetInput {
  students: Student[]
  exams: Exam[]
  marks: Mark[]
  bands: GradeBand[]
  /** Resolves a syllabus code for a subject id; falls back to the exam name. */
  subjectCode?: (subjectId: string) => string
  /** Resolves a short stream tag (e.g. "1A") for a class id. */
  classCode?: (classId: string) => string
  /** False when the caller cannot verify all required papers/enrollments for an overall class ranking. */
  completionScopeComplete?: boolean
  /** Exact explicitly active term selected for this broadsheet; null means unavailable. */
  assessmentTermId?: string | null
}

export function buildBroadsheet({ students, exams, marks, bands, subjectCode, classCode, completionScopeComplete = true, assessmentTermId = null }: BuildBroadsheetInput): Broadsheet {
  students = students.filter(isOperationalStudent)
  const activeStudentIds = new Set(students.map((student) => student._id))
  marks = marks.filter((mark) => activeStudentIds.has(mark.student_id))
  const columns: BroadsheetColumn[] = exams.map((exam) => ({
    examId: exam._id,
    subjectCode: subjectCode ? subjectCode(exam.subject_id) : exam.exam_name,
    examName: exam.exam_name,
    classCode: classCode ? classCode(exam.class_id) : '',
    maxScore: exam.max_score,
    date: exam.exam_date,
  }))

  const rows = students.map((student) => {
    const cells: Record<string, ScoreValue> = {}
    const percentages: number[] = []
    const reportedCertainty = student.enrollment_certainty ?? 'unknown'
    const assessmentTermVerified = assessmentTermId !== null && student.enrollment_term_id === assessmentTermId
    const subjectIds = student.subject_ids
    const validSubjectIds = Array.isArray(subjectIds) && Array.from(subjectIds).every(
      (subjectId) => typeof subjectId === 'string' && subjectId.trim().length > 0,
    ) && new Set(subjectIds).size === subjectIds.length
    const verifiedSubjectIds = validSubjectIds ? subjectIds as string[] : []
    const enrollmentScopeValid =
      (reportedCertainty === 'verified_enrolled' && validSubjectIds && verifiedSubjectIds.length > 0) ||
      (reportedCertainty === 'verified_no_enrollments' && validSubjectIds && verifiedSubjectIds.length === 0)
    // The calculation validates the scope itself instead of assuming every caller
    // passed through the backend decoder. Malformed verified claims fail closed.
    const enrollmentCertainty =
      (reportedCertainty === 'verified_enrolled' || reportedCertainty === 'verified_no_enrollments') && !enrollmentScopeValid
        ? 'unknown'
        : reportedCertainty
    const enrollmentKnown = assessmentTermVerified && enrollmentScopeValid
    const hasVerifiedEnrollments = enrollmentKnown && enrollmentCertainty === 'verified_enrolled'
    const requiredPapers = exams.filter((exam) =>
      exam.class_id === student.class_id && hasVerifiedEnrollments && verifiedSubjectIds.includes(exam.subject_id),
    )
    const unassessedSubjects = hasVerifiedEnrollments
      ? verifiedSubjectIds.filter((subjectId) => !requiredPapers.some((paper) => paper.subject_id === subjectId))
          .map((subjectId) => subjectCode ? subjectCode(subjectId) : subjectId)
      : []
    const scopeKnown = completionScopeComplete && enrollmentKnown
    const assessmentScopeAvailable = scopeKnown && hasVerifiedEnrollments
    const outstandingPapers: string[] = []
    let completed = 0
    for (const exam of exams) {
      const required = requiredPapers.some((paper) => paper._id === exam._id)
      const mark = marks.find((m) => m.exam_id === exam._id && m.student_id === student._id)
      const value: ScoreValue = mark?.score ?? null
      cells[exam._id] = value
      if (!required) continue
      const validScore = numeric(value) && Number.isFinite(value) && exam.max_score > 0 && value >= 0 && value <= exam.max_score
      if (validScore) completed += 1
      else outstandingPapers.push(`${subjectCode ? subjectCode(exam.subject_id) : exam.exam_name}${exam.exam_name ? ` · ${exam.exam_name}` : ''} · ${exam.exam_date}${value === 'X' || value === 'Y' ? ` (${value} recorded, awaiting valid score)` : ''}`)
      if (validScore && assessmentScopeAvailable) {
        // Existing IUPC aggregates are the mean of recorded numeric paper percentages.
        percentages.push((value / exam.max_score) * 100)
      }
    }
    const total = percentages.reduce((sum, value) => sum + value, 0)
    const avg = mean(percentages)
    const band = avg === null ? null : bandFor(avg, bands)
    // Enrollment verification does not assert that every enrolled subject has a
    // paper in this term; withhold final ranking when the assessment rows omit one.
    const assessmentComplete = assessmentScopeAvailable && unassessedSubjects.length === 0 && requiredPapers.length > 0 && completed === requiredPapers.length
    return {
      studentId: student._id,
      admission: student.admission_number,
      name: student.full_name,
      gender: student.gender,
      cells,
      total: assessmentScopeAvailable ? total : 0,
      mean: assessmentScopeAvailable ? avg : null,
      grade: assessmentScopeAvailable ? (band ? band.grade : 'Z') : '—',
      points: assessmentScopeAvailable ? (band ? band.points : null) : null,
      completed,
      required: requiredPapers.length,
      outstandingPapers,
      requiredExamIds: requiredPapers.map((paper) => paper._id),
      unassessedSubjects,
      completionKnown: assessmentScopeAvailable,
      enrollmentKnown,
      enrollmentCertainty,
      assessmentTermVerified,
      assessmentComplete,
    }
  })

  const completedRows = withRanks(rows.filter((row) => row.assessmentComplete))
    .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) || a.admission.localeCompare(b.admission))
  const incompleteRows = rows.filter((row) => !row.assessmentComplete)
    .map((row) => ({ ...row, rank: null }))
    .sort((a, b) => a.admission.localeCompare(b.admission) || a.name.localeCompare(b.name))
  const orderedRows = [...completedRows, ...incompleteRows]

  const summary: SubjectSummary[] = exams.map((exam) => {
    const values = marks
      .filter((mark) => mark.exam_id === exam._id)
      .map((mark) => mark.score)
      .filter(numeric)
      .map((value) => (value / exam.max_score) * 100)
    const avg = mean(values)
    return {
      examId: exam._id,
      subjectCode: exam.exam_name,
      average: avg,
      grade: avg === null ? '—' : gradeFor(avg, bands),
      entries: values.length,
      highest: values.length ? Math.max(...values) : null,
      lowest: values.length ? Math.min(...values) : null,
      sd: stdDev(values),
    }
  })

  const gradeOrder = bands.map((band) => band.grade)
  const counts = new Map<string, number>()
  for (const row of completedRows) counts.set(row.grade, (counts.get(row.grade) ?? 0) + 1)
  const distribution = [
    ...gradeOrder.map((grade) => ({ grade, count: counts.get(grade) ?? 0 })),
    { grade: 'Z', count: counts.get('Z') ?? 0 },
  ]

  const allMeans = completedRows.map((row) => row.mean).filter((value): value is number => value !== null)
  const allPoints = completedRows.map((row) => row.points).filter((value): value is number => value !== null)
  const overallMean = mean(allMeans)
  const meanPoints = mean(allPoints)

  return {
    columns,
    rows: orderedRows,
    completedRows,
    incompleteRows,
    summary,
    distribution,
    overall: {
      meanScore: overallMean,
      meanPoints,
      meanGrade: overallMean === null ? '—' : gradeFor(overallMean, bands),
      studentCount: students.length,
      entered: marks.filter((mark) => numeric(mark.score)).length,
    },
  }
}

export function toCsv(sheet: Broadsheet, columnLabel: (column: Broadsheet['columns'][number]) => string = column => column.subjectCode): string {
  const escape = (value: string | number | null) => {
    const text = value === null ? '' : String(value)
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const header = [
    'Rank',
    'Admission No',
    'Name',
    'MC',
    'Total %',
    'Average % (Provisional when incomplete; blank when enrollment unavailable)',
    'Enrollment verification',
    'Assessment',
    'Completed',
    'Outstanding papers',
    ...sheet.columns.map(columnLabel),
  ]
  const lines = [header.map(escape).join(',')]
  for (const row of sheet.rows) {
    lines.push(
      [
        row.rank ?? '',
        row.admission,
        row.name,
        row.completionKnown ? row.grade : '',
        row.completionKnown ? row.total : '',
        row.completionKnown && row.mean !== null ? row.mean.toFixed(2) : '',
        !row.assessmentTermVerified
          ? 'Assessment term unavailable or enrollment scope belongs to another term'
          : row.unassessedSubjects.length > 0
            ? 'Incomplete · enrolled subject has no assessment paper configured'
          : row.enrollmentCertainty === 'verified_no_enrollments'
            ? 'Verified · no enrollments'
              : row.enrollmentCertainty === 'error'
                ? 'Enrollment verification error'
                : row.enrollmentCertainty === 'unknown'
                  ? 'Enrollment scope unknown'
                  : 'Verified enrolled',
        !row.completionKnown ? 'Unavailable / unverified' : row.assessmentComplete ? 'Completed' : 'Incomplete / provisional',
        row.completionKnown ? `${row.completed}/${row.required}` : '',
        row.completionKnown ? [...row.outstandingPapers, ...row.unassessedSubjects.map((subject) => `${subject} · no assessment paper configured`)].join('; ') : '',
        ...sheet.columns.map((column) => {
          const value = row.cells[column.examId]
          return value === null || value === undefined ? '' : value
        }),
      ]
        .map(escape)
        .join(','),
    )
  }
  // UTF-8 BOM so Excel opens the file with the right encoding.
  return `\ufeff${lines.join('\r\n')}`
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
