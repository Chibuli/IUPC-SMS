import type { Exam, Mark } from '../data/types'
import { buildBroadsheet, mean, stdDev, type Broadsheet, type BuildBroadsheetInput, type ScoreValue } from './analytics'
import { gradeFor } from './grading'
import { formatBroadsheetNumber as round } from './broadsheet-presentation'

export type BroadsheetAssessment = 'all' | 'Midterm' | 'Endterm'
type CellState = 'valid' | 'not-taken' | 'incomplete' | 'X' | 'Y' | 'Z'
export interface CompactBroadsheet extends Broadsheet {
  cellDetails: Record<string, Record<string, { state: CellState; detail: string }>>
}
export interface CompactBroadsheetInput extends BuildBroadsheetInput {
  assessment: BroadsheetAssessment
  /** An authorized subject list, never a way to expand server permissions. */
  subjectScope?: string[] | null
}

/** Broadsheet-only adapter. Original exams, marks and the report-card engine stay untouched. */
export function buildCompactBroadsheet(input: CompactBroadsheetInput): CompactBroadsheet {
  const { assessment, subjectScope, bands } = input
  const allowed = (id: string) => !subjectScope || subjectScope.includes(id)
  const students = input.students.map(student => {
    const ids = student.subject_ids
    const validIds = Array.isArray(ids) && ids.every(id => typeof id === 'string' && id.trim().length > 0) && new Set(ids).size === ids.length
    const hiddenEnrollment = validIds && ids.some(id => !allowed(id))
    return !validIds || hiddenEnrollment ? { ...student,
      subject_ids: Array.isArray(ids) ? ids.filter(id => typeof id === 'string' && id.trim().length > 0 && allowed(id)) : [],
      enrollment_certainty: student.enrollment_certainty === 'error' ? 'error' as const : 'unknown' as const,
    } : student
  })
  const exams = input.exams.filter(e => e.term_id === input.assessmentTermId && allowed(e.subject_id))
  const periods = assessment === 'all' ? ['Midterm', 'Endterm'] : [assessment]
  // Enrollment-only subjects remain visible even if one or both papers were never configured.
  const subjectIds = [...new Set([
    ...exams.filter(e => periods.includes(e.exam_type)).map(e => e.subject_id),
    ...students.flatMap(s => s.subject_ids ?? []).filter(allowed),
  ])].sort((a, b) => (input.subjectCode?.(a) ?? a).localeCompare(input.subjectCode?.(b) ?? b, undefined, { numeric: true }) || a.localeCompare(b))
  const columnId = (subject: string) => `subject:${subject}`
  const paperId = (classId: string, subject: string) => JSON.stringify([classId, subject])
  const virtualExams: Exam[] = []
  const virtualMarks: Mark[] = []
  const cellDetails: CompactBroadsheet['cellDetails'] = {}
  const classIds = [...new Set([...students.map(s => s.class_id), ...exams.map(e => e.class_id)])]
  for (const classId of classIds) for (const subject of subjectIds) {
    virtualExams.push({ _id: paperId(classId, subject), class_id: classId, subject_id: subject,
      term_id: input.assessmentTermId ?? '', exam_name: assessment === 'all' ? 'Combined' : assessment === 'Endterm' ? 'End Term' : 'Midterm',
      exam_type: assessment, max_score: 100, exam_date: '', editing_deadline: null, status: 'published' })
  }
  const markIndex = new Map<string, Mark[]>()
  for (const mark of input.marks) {
    const key = JSON.stringify([mark.student_id, mark.exam_id])
    markIndex.set(key, [...(markIndex.get(key) ?? []), mark])
  }
  for (const student of students) {
    cellDetails[student._id] = {}
    for (const subject of subjectIds) {
      const id = columnId(subject)
      const verified = student.enrollment_certainty === 'verified_enrolled' || student.enrollment_certainty === 'verified_no_enrollments'
      if (verified && student.enrollment_term_id === input.assessmentTermId && !student.subject_ids?.includes(subject)) {
        cellDetails[student._id][id] = { state: 'not-taken', detail: 'Subject not taken' }
        continue
      }
      const values: number[] = [], details: string[] = [], states: CellState[] = []
      for (const period of periods) {
        const label = period === 'Endterm' ? 'End Term' : period
        const papers = exams.filter(e => e.class_id === student.class_id && e.subject_id === subject && e.exam_type === period)
        // Multiple papers have no configured weighting rule; do not invent one or pick a winner.
        if (papers.length !== 1) { states.push('incomplete'); details.push(`${label}: ${papers.length ? 'multiple papers; assessment ambiguous' : 'paper not configured'}`); continue }
        const paper = papers[0], marks = markIndex.get(JSON.stringify([student._id, paper._id])) ?? []
        const value = marks.length === 1 ? marks[0].score : null
        const valid = typeof value === 'number' && Number.isFinite(value) && Number.isFinite(paper.max_score) && paper.max_score > 0 && value >= 0 && value <= paper.max_score
        if (valid) { values.push(value / paper.max_score * 100); details.push(`${label}: ${value}/${paper.max_score}`) }
        else {
          states.push(value === 'X' || value === 'Y' ? value : value === null ? 'incomplete' : 'Z')
          details.push(`${label}: ${marks.length > 1 ? 'duplicate marks' : value === null ? 'missing score' : String(value)}${!Number.isFinite(paper.max_score) || paper.max_score <= 0 ? ' (invalid maximum)' : ''}`)
        }
      }
      const valid = values.length === periods.length && states.length === 0
      const state: CellState = valid ? 'valid' : states.includes('Y') ? 'Y' : states.includes('X') ? 'X' : states.includes('Z') ? 'Z' : 'incomplete'
      cellDetails[student._id][id] = { state, detail: details.join('; ') }
      const value: ScoreValue = valid ? values.reduce((sum, n) => sum + n, 0) / periods.length : state === 'X' || state === 'Y' ? state : null
      virtualMarks.push({ _id: JSON.stringify([student._id, subject]), student_id: student._id, exam_id: paperId(student.class_id, subject), score: value, remarks: '', updated_at: '' })
    }
  }
  const result = buildBroadsheet({ ...input, students, exams: virtualExams, marks: virtualMarks })
  const remap = (row: Broadsheet['rows'][number]) => {
    const student = students.find(s => s._id === row.studentId)!
    return { ...row,
      cells: Object.fromEntries(subjectIds.map(subject => [columnId(subject), row.cells[paperId(student.class_id, subject)] ?? null])),
      requiredExamIds: row.requiredExamIds.map(id => columnId(virtualExams.find(e => e._id === id)!.subject_id)),
      outstandingPapers: row.requiredExamIds.flatMap(id => {
        const subject = virtualExams.find(e => e._id === id)!.subject_id, cell = cellDetails[row.studentId][columnId(subject)]
        return cell.state === 'valid' ? [] : [`${input.subjectCode?.(subject) ?? subject} · ${cell.detail}`]
      }),
    }
  }
  const rows = result.rows.map(remap)
  const columns = subjectIds.map(subject => ({ examId: columnId(subject), subjectCode: input.subjectCode?.(subject) ?? subject,
    examName: assessment === 'all' ? 'Combined' : assessment === 'Endterm' ? 'End Term' : 'Midterm', classCode: '', maxScore: 100, date: '' }))
  return { ...result, rows, completedRows: rows.filter(r => r.assessmentComplete), incompleteRows: rows.filter(r => !r.assessmentComplete), columns, cellDetails,
    summary: columns.map(column => {
      const values = rows.filter(row => cellDetails[row.studentId][column.examId].state === 'valid').map(row => row.cells[column.examId]).filter((value): value is number => typeof value === 'number')
      const average = mean(values)
      return { examId: column.examId, subjectCode: column.subjectCode, average, grade: average === null ? '—' : gradeFor(average, bands), entries: values.length,
        highest: values.length ? Math.max(...values) : null, lowest: values.length ? Math.min(...values) : null, sd: stdDev(values) }
    }),
  }
}

/** Presentation only; numeric calculations above retain full precision. */
export function toCompactCsv(sheet: CompactBroadsheet): string {
  const escape = (value: string | number) => /[",\r\n]/.test(String(value)) ? `"${String(value).replaceAll('"', '""')}"` : String(value)
  const rows: (string | number)[][] = [['Rank', 'ADM NO.', 'Name', 'MG', 'Total %', 'Average % (Provisional when incomplete; blank when enrollment unavailable)', 'Enrollment verification', 'Assessment', 'Completed', 'Outstanding subjects', ...sheet.columns.map(c => `${c.subjectCode} · ${c.examName} (%)`)]]
  for (const row of sheet.rows) rows.push([
    row.rank ?? '', row.admission, row.name, row.completionKnown ? row.grade : '', row.completionKnown ? round(row.total) : '',
    row.completionKnown && row.mean !== null ? round(row.mean, 2) : '',
    !row.assessmentTermVerified ? 'Assessment term unavailable or enrollment scope belongs to another term' : row.enrollmentCertainty === 'verified_no_enrollments' ? 'Verified · no enrollments' : row.enrollmentCertainty === 'error' ? 'Enrollment verification error' : row.enrollmentCertainty === 'unknown' ? 'Enrollment scope unknown' : row.completionKnown ? 'Verified enrolled' : 'Assessment scope unavailable',
    !row.completionKnown ? 'Unavailable / unverified' : row.assessmentComplete ? 'Completed' : 'Incomplete / provisional', row.completionKnown ? `${row.completed}/${row.required}` : '', row.outstandingPapers.join('; '),
    ...sheet.columns.map(c => { const cell = sheet.cellDetails[row.studentId][c.examId], value = row.cells[c.examId]; return cell.state === 'valid' && typeof value === 'number' ? round(value) : cell.state === 'not-taken' ? '==' : cell.state === 'incomplete' ? 'INC' : cell.state }),
  ])
  return '\ufeff' + rows.map(row => row.map(escape).join(',')).join('\r\n')
}
