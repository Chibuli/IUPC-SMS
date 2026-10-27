import type { Exam, GradeBand, Mark, Student } from '../data/types'
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
  completed: number
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
  rows: BroadsheetRow[]
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
}

export function buildBroadsheet({ students, exams, marks, bands, subjectCode, classCode }: BuildBroadsheetInput): Broadsheet {
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
    let completed = 0
    for (const exam of exams) {
      const mark = marks.find((m) => m.exam_id === exam._id && m.student_id === student._id)
      const value: ScoreValue = mark ? mark.score : null
      cells[exam._id] = value
      if (numeric(value)) {
        // Papers carry different maxima, so every aggregate is a percentage:
        // a 42/50 and a 84/100 must count the same towards the mean.
        percentages.push((value / exam.max_score) * 100)
        completed += 1
      }
    }
    const total = percentages.reduce((sum, value) => sum + value, 0)
    const avg = mean(percentages)
    const band = avg === null ? null : bandFor(avg, bands)
    return {
      studentId: student._id,
      admission: student.admission_number,
      name: student.full_name,
      gender: student.gender,
      cells,
      total,
      mean: avg,
      grade: band ? band.grade : 'Z',
      points: band ? band.points : null,
      completed,
    }
  })

  // The printed sheet reads top-down by position; unranked students sit last.
  const ranked = withRanks(rows).sort(
    (a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) || a.admission.localeCompare(b.admission),
  )

  const summary: SubjectSummary[] = exams.map((exam) => {
    const values = marks
      .filter((m) => m.exam_id === exam._id)
      .map((m) => m.score)
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
  for (const row of ranked) counts.set(row.grade, (counts.get(row.grade) ?? 0) + 1)
  const distribution = [
    ...gradeOrder.map((grade) => ({ grade, count: counts.get(grade) ?? 0 })),
    { grade: 'Z', count: counts.get('Z') ?? 0 },
  ]

  const allMeans = ranked.map((row) => row.mean).filter((value): value is number => value !== null)
  const allPoints = ranked.map((row) => row.points).filter((value): value is number => value !== null)
  const overallMean = mean(allMeans)
  const meanPoints = mean(allPoints)

  return {
    columns,
    rows: ranked,
    summary,
    distribution,
    overall: {
      meanScore: overallMean,
      meanPoints,
      meanGrade: overallMean === null ? '—' : gradeFor(overallMean, bands),
      studentCount: students.length,
      entered: marks.filter((m) => numeric(m.score)).length,
    },
  }
}

export function toCsv(sheet: Broadsheet): string {
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
    'Average %',
    'Completed',
    ...sheet.columns.map((column) => column.subjectCode),
  ]
  const lines = [header.map(escape).join(',')]
  for (const row of sheet.rows) {
    lines.push(
      [
        row.rank ?? '',
        row.admission,
        row.name,
        row.grade,
        row.total,
        row.mean === null ? '' : row.mean.toFixed(2),
        row.completed,
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
