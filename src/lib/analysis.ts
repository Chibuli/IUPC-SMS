import type { Database, Exam, GradeBand, Mark, Student, Term } from '../data/types'
import { isOperationalStudent } from '../data/student-lifecycle'
import { bandFor } from './grading'
import { mean } from './analytics'
import { round } from './format'

const numeric = (value: Mark['score']): value is number => typeof value === 'number'

export interface SubjectPerformance {
  subjectId: string
  name: string
  code: string
  category: string
  average: number | null
  entries: number
  papers: number
  highest: number | null
  lowest: number | null
  /** Percentage-point change on the previous term, over the same stream scope. */
  delta: number | null
}

export interface StreamPerformance {
  classId: string
  label: string
  students: number
  average: number | null
  topStudent: { name: string; average: number } | null
  expected: number
  entered: number
  /** 0–100, capped so a re-entry cannot report more marks than the roster. */
  completion: number
  atRisk: number
}

export interface GradeSlice {
  grade: string
  count: number
  /** Share of the graded cohort, 0–100. */
  share: number
  minScore: number | null
}

export type InsightTone = 'ok' | 'warn' | 'danger' | 'brass'

export interface Insight {
  tone: InsightTone
  title: string
  body: string
}

export interface AnalysisRequest {
  db: Database
  bands: GradeBand[]
  passMark: number
  termId: string
  /** `all` or a stream id. */
  classId: string
  /** `all` or a subject id. */
  subjectId: string
  /** Teacher scope: only these subjects are visible. Null for admin / guest. */
  allowedSubjectIds?: string[] | null
}

export interface Analysis {
  term: Term | null
  previousTerm: Term | null
  scope: { className: string; subjectName: string; examCount: number; studentCount: number }
  average: number | null
  /** Mean of the per-subject changes, so the two terms are compared like for like. */
  delta: number | null
  deltaSubjects: number
  completion: { entered: number; expected: number; rate: number; papers: number; completePapers: number }
  topSubject: SubjectPerformance | null
  atRisk: {
    threshold: number
    count: number
    students: { id: string; name: string; average: number; classLabel: string }[]
  }
  distribution: GradeSlice[]
  graded: number
  passing: number
  subjects: SubjectPerformance[]
  streams: StreamPerformance[]
  insights: Insight[]
}

export function classLabel(cls: { class_name: string; stream_name: string }): string {
  return `${cls.class_name} ${cls.stream_name}`.trim()
}

export function termLabel(term: Term | null | undefined): string {
  if (!term) return '—'
  return `${term.name} ${term.academic_year}`.trim()
}

/** Terms oldest first, so "previous term" means the one taught before this one. */
export function orderedTerms(terms: Term[]): Term[] {
  return [...terms].sort((a, b) => a.start_date.localeCompare(b.start_date) || a.name.localeCompare(b.name))
}

export function previousTermOf(terms: Term[], termId: string): Term | null {
  const ordered = orderedTerms(terms)
  const index = ordered.findIndex((term) => term._id === termId)
  return index > 0 ? ordered[index - 1] : null
}

function examsIn(
  db: Database,
  termId: string,
  filter: { classId?: string; subjectId?: string; allowed?: string[] | null },
): Exam[] {
  return db.exams.filter(
    (exam) =>
      exam.term_id === termId &&
      (!filter.classId || filter.classId === 'all' || exam.class_id === filter.classId) &&
      (!filter.subjectId || filter.subjectId === 'all' || exam.subject_id === filter.subjectId) &&
      (!filter.allowed || filter.allowed.includes(exam.subject_id)),
  )
}

function activeRoster(db: Database, classIds: string[]): Student[] {
  const scope = new Set(classIds)
  return db.students.filter((student) => isOperationalStudent(student) && scope.has(student.class_id))
}

interface StudentScore {
  student: Student
  average: number
}

/** Each student's mean percentage across the scoped papers, so papers with different maxima weigh equally. */
function studentScores(db: Database, exams: Exam[], roster: Student[]): StudentScore[] {
  const examById = new Map(exams.map((exam) => [exam._id, exam]))
  const rosterIds = new Set(roster.map((student) => student._id))
  const values = new Map<string, number[]>()

  for (const mark of db.marks) {
    const exam = examById.get(mark.exam_id)
    if (!exam || !numeric(mark.score) || !rosterIds.has(mark.student_id)) continue
    const list = values.get(mark.student_id) ?? []
    list.push((mark.score / exam.max_score) * 100)
    values.set(mark.student_id, list)
  }

  const scores: StudentScore[] = []
  for (const student of roster) {
    const average = mean(values.get(student._id) ?? [])
    if (average !== null) scores.push({ student, average })
  }
  return scores
}

function completionOf(db: Database, exams: Exam[], roster: Student[]) {
  const rosterByClass = new Map<string, number>()
  const rosterIds = new Set(roster.map((student) => student._id))
  for (const student of roster) {
    rosterByClass.set(student.class_id, (rosterByClass.get(student.class_id) ?? 0) + 1)
  }

  let expected = 0
  let entered = 0
  let completePapers = 0
  for (const exam of exams) {
    const seats = rosterByClass.get(exam.class_id) ?? 0
    const marked = db.marks.filter((mark) => mark.exam_id === exam._id && rosterIds.has(mark.student_id) && mark.score !== null).length
    expected += seats
    entered += Math.min(marked, seats)
    if (seats > 0 && marked >= seats) completePapers += 1
  }

  return {
    entered,
    expected,
    rate: expected ? (entered / expected) * 100 : 0,
    papers: exams.length,
    completePapers,
  }
}

function subjectPerformance(db: Database, current: Exam[], previous: Exam[], activeStudentIds: Set<string>): SubjectPerformance[] {
  const groups = new Map<string, Exam[]>()
  for (const exam of current) {
    const list = groups.get(exam.subject_id) ?? []
    list.push(exam)
    groups.set(exam.subject_id, list)
  }

  const previousBySubject = new Map<string, Exam[]>()
  for (const exam of previous) {
    const list = previousBySubject.get(exam.subject_id) ?? []
    list.push(exam)
    previousBySubject.set(exam.subject_id, list)
  }

  const rows: SubjectPerformance[] = []
  for (const [subjectId, exams] of groups) {
    const subject = db.subjects.find((entry) => entry._id === subjectId)
    const values: number[] = []
    for (const exam of exams) {
      for (const mark of db.marks) {
        if (mark.exam_id === exam._id && activeStudentIds.has(mark.student_id) && numeric(mark.score)) values.push((mark.score / exam.max_score) * 100)
      }
    }
    const average = mean(values)
    const prior = percentagesFor(db, previousBySubject.get(subjectId) ?? [], activeStudentIds)
    const priorAverage = mean(prior)

    rows.push({
      subjectId,
      name: subject?.name ?? 'Unknown subject',
      code: subject?.code ?? '—',
      category: subject?.category ?? '—',
      average,
      entries: values.length,
      papers: exams.length,
      highest: values.length ? Math.max(...values) : null,
      lowest: values.length ? Math.min(...values) : null,
      delta: average !== null && priorAverage !== null ? average - priorAverage : null,
    })
  }

  // Best average first; papers without marks sit at the foot rather than pretending to be zero.
  return rows.sort((a, b) => {
    if (a.average === null && b.average === null) return a.name.localeCompare(b.name)
    if (a.average === null) return 1
    if (b.average === null) return -1
    return b.average - a.average || a.name.localeCompare(b.name)
  })
}

function percentagesFor(db: Database, exams: Exam[], activeStudentIds: Set<string>): number[] {
  const examById = new Map(exams.map((exam) => [exam._id, exam]))
  const values: number[] = []
  for (const mark of db.marks) {
    const exam = examById.get(mark.exam_id)
    if (!exam || !activeStudentIds.has(mark.student_id) || !numeric(mark.score)) continue
    values.push((mark.score / exam.max_score) * 100)
  }
  return values
}

function streamPerformance(db: Database, exams: Exam[], passMark: number): StreamPerformance[] {
  const classIds = [...new Set(exams.map((exam) => exam.class_id))]
  const rows = classIds.map((classId) => {
    const cls = db.classes.find((entry) => entry._id === classId)
    const classExams = exams.filter((exam) => exam.class_id === classId)
    const roster = activeRoster(db, [classId])
    const scores = studentScores(db, classExams, roster)
    const completion = completionOf(db, classExams, roster)
    const top = [...scores].sort((a, b) => b.average - a.average)[0]

    return {
      classId,
      label: cls ? classLabel(cls) : 'Unknown stream',
      students: roster.length,
      average: mean(scores.map((score) => score.average)),
      topStudent: top ? { name: top.student.full_name, average: top.average } : null,
      expected: completion.expected,
      entered: completion.entered,
      completion: completion.rate,
      atRisk: scores.filter((score) => score.average < passMark).length,
    }
  })

  return rows.sort((a, b) => {
    if (a.average === null && b.average === null) return a.label.localeCompare(b.label)
    if (a.average === null) return 1
    if (b.average === null) return -1
    return b.average - a.average || a.label.localeCompare(b.label)
  })
}

function distributionOf(scores: StudentScore[], rosterSize: number, bands: GradeBand[]): GradeSlice[] {
  const counts = new Map<string, number>()
  for (const score of scores) {
    const grade = bandFor(score.average, bands).grade
    counts.set(grade, (counts.get(grade) ?? 0) + 1)
  }

  const ordered = [...bands].sort((a, b) => b.min_score - a.min_score)
  const slices: GradeSlice[] = ordered.map((band) => ({
    grade: band.grade,
    count: counts.get(band.grade) ?? 0,
    share: scores.length ? ((counts.get(band.grade) ?? 0) / scores.length) * 100 : 0,
    minScore: band.min_score,
  }))

  const ungraded = rosterSize - scores.length
  if (ungraded > 0) {
    slices.push({ grade: 'Z', count: ungraded, share: 0, minScore: null })
  }
  return slices
}

function buildInsights(input: {
  subjects: SubjectPerformance[]
  streams: StreamPerformance[]
  atRisk: Analysis['atRisk']
  completion: Analysis['completion']
  previousTerm: Term | null
  graded: number
  passMark: number
}): Insight[] {
  const { subjects, streams, atRisk, completion, previousTerm, graded, passMark } = input
  const scored = subjects.filter((subject): subject is SubjectPerformance & { average: number } => subject.average !== null)
  const insights: Insight[] = []

  const riser = [...subjects]
    .filter((subject): subject is SubjectPerformance & { delta: number } => subject.delta !== null)
    .sort((a, b) => b.delta - a.delta)[0]
  if (riser && riser.delta >= 0.5) {
    insights.push({
      tone: 'brass',
      title: `${riser.name} is improving`,
      body: `Up ${round(riser.delta)} points on ${termLabel(previousTerm)} in this scope.`,
    })
  }

  if (atRisk.count > 0) {
    const concentrated = [...streams].filter((stream) => stream.atRisk > 0).sort((a, b) => b.atRisk - a.atRisk)[0]
    insights.push({
      tone: 'danger',
      title: `${atRisk.count} ${atRisk.count === 1 ? 'student needs' : 'students need'} intervention`,
      body: `Averaging below the ${passMark}% pass mark${
        concentrated && streams.length > 1 ? `, concentrated in ${concentrated.label} (${concentrated.atRisk})` : ''
      }.`,
    })
  } else if (graded > 0) {
    insights.push({
      tone: 'ok',
      title: 'Every graded student is above the pass mark',
      body: `No student in this scope averages below ${passMark}%.`,
    })
  }

  if (scored.length >= 2) {
    const best = scored[0]
    const worst = scored[scored.length - 1]
    insights.push({
      tone: best.average >= passMark ? 'ok' : 'warn',
      title: `${best.name} leads the scope`,
      body: `${round(best.average)}% average, ${round(best.average - worst.average)} points ahead of ${worst.name} (${round(worst.average)}%).`,
    })
  }

  if (completion.expected > 0 && completion.entered < completion.expected) {
    const missing = completion.expected - completion.entered
    insights.push({
      tone: 'warn',
      title: 'Marks are still outstanding',
      body: `${missing} of ${completion.expected} expected marks are blank across ${completion.papers} ${
        completion.papers === 1 ? 'paper' : 'papers'
      }, holding completion at ${round(completion.rate)}%.`,
    })
  }

  if (insights.length < 3) {
    const ranked = streams.filter((stream): stream is StreamPerformance & { average: number } => stream.average !== null)
    if (ranked.length >= 2) {
      const gap = ranked[0].average - ranked[ranked.length - 1].average
      if (gap >= 1) {
        insights.push({
          tone: 'brass',
          title: 'The streams are uneven',
          body: `${ranked[0].label} averages ${round(gap)} points above ${ranked[ranked.length - 1].label}.`,
        })
      }
    }
  }

  return insights.slice(0, 4)
}

export function buildAnalysis({
  db,
  bands,
  passMark,
  termId,
  classId,
  subjectId,
  allowedSubjectIds = null,
}: AnalysisRequest): Analysis {
  const term = db.terms.find((entry) => entry._id === termId) ?? null
  const previousTerm = previousTermOf(db.terms, termId)
  const filter = { classId, subjectId, allowed: allowedSubjectIds }
  const exams = examsIn(db, termId, filter)
  const previousExams = previousTerm ? examsIn(db, previousTerm._id, filter) : []

  const classes = db.classes
  const scopeClassIds = [...new Set(exams.map((exam) => exam.class_id))]
  const roster = activeRoster(db, scopeClassIds)
  const scores = studentScores(db, exams, roster)
  const average = mean(scores.map((score) => score.average))
  const completion = completionOf(db, exams, roster)

  const activeStudentIds = new Set(db.students.filter(isOperationalStudent).map((student) => student._id))
  const subjectRows = subjectPerformance(db, exams, previousExams, activeStudentIds)
  const subjectDeltas = subjectRows
    .map((subject) => subject.delta)
    .filter((delta): delta is number => delta !== null)
  const delta = subjectDeltas.length ? mean(subjectDeltas) : null

  const atRiskStudents = [...scores]
    .filter((score) => score.average < passMark)
    .sort((a, b) => a.average - b.average)
    .map((score) => {
      const cls = classes.find((entry) => entry._id === score.student.class_id)
      return {
        id: score.student._id,
        name: score.student.full_name,
        average: score.average,
        classLabel: cls ? classLabel(cls) : 'Unassigned',
      }
    })

  const passing = scores.filter((score) => score.average >= passMark).length
  const streamRows = streamPerformance(db, examsIn(db, termId, { subjectId, allowed: allowedSubjectIds }), passMark)
  const topSubject = subjectRows.find((subject) => subject.average !== null) ?? null

  const className = classId === 'all' ? 'All classes' : classLabel(classes.find((cls) => cls._id === classId) ?? { class_name: 'Unknown', stream_name: '' })
  const subjectName = subjectId === 'all' ? 'All subjects' : db.subjects.find((subject) => subject._id === subjectId)?.name ?? 'Unknown subject'

  const analysis: Analysis = {
    term,
    previousTerm,
    scope: { className, subjectName, examCount: exams.length, studentCount: roster.length },
    average,
    delta,
    deltaSubjects: subjectDeltas.length,
    completion,
    topSubject,
    atRisk: { threshold: passMark, count: atRiskStudents.length, students: atRiskStudents },
    distribution: distributionOf(scores, roster.length, bands),
    graded: scores.length,
    passing,
    subjects: subjectRows,
    streams: streamRows,
    insights: [],
  }

  analysis.insights = buildInsights({
    subjects: analysis.subjects,
    streams: analysis.streams,
    atRisk: analysis.atRisk,
    completion: analysis.completion,
    previousTerm,
    graded: analysis.graded,
    passMark,
  })

  return analysis
}

/* ── export ─────────────────────────────────────────────────────────────── */

const escapeCell = (value: string | number | null | undefined) => {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function analysisCsv(analysis: Analysis, schoolName: string): string {
  const rows: (string | number | null)[][] = [
    [`${schoolName} — Academic analytics`],
    ['Term', termLabel(analysis.term)],
    ['Scope', `${analysis.scope.className} · ${analysis.scope.subjectName}`],
    ['Generated', new Date().toISOString()],
    [],
    ['Metric', 'Value'],
    ['Campus average %', analysis.average === null ? '' : Number(round(analysis.average))],
    ['Change vs previous term (points)', analysis.delta === null ? '' : Number(round(analysis.delta))],
    ['Papers in scope', analysis.scope.examCount],
    ['Students in scope', analysis.scope.studentCount],
    ['Marks entered', analysis.completion.entered],
    ['Marks expected', analysis.completion.expected],
    ['Completion %', Number(round(analysis.completion.rate))],
    ['Graded students', analysis.graded],
    ['Students at or above pass mark', analysis.passing],
    ['Pass mark %', analysis.atRisk.threshold],
    ['At-risk students', analysis.atRisk.count],
    [],
    ['Grade', 'Students', 'Share %', 'Minimum %'],
    ...analysis.distribution.map((slice) => [slice.grade, slice.count, Number(round(slice.share)), slice.minScore ?? '']),
    [],
    ['Subject', 'Code', 'Category', 'Average %', 'Marks', 'Papers', 'Highest %', 'Lowest %', 'Change vs previous term'],
    ...analysis.subjects.map((subject) => [
      subject.name,
      subject.code,
      subject.category,
      subject.average === null ? '' : Number(round(subject.average)),
      subject.entries,
      subject.papers,
      subject.highest === null ? '' : Number(round(subject.highest)),
      subject.lowest === null ? '' : Number(round(subject.lowest)),
      subject.delta === null ? '' : Number(round(subject.delta)),
    ]),
    [],
    ['Stream', 'Students', 'Average %', 'Top student', 'Top average %', 'Marks entered', 'Marks expected', 'Completion %', 'At risk'],
    ...analysis.streams.map((stream) => [
      stream.label,
      stream.students,
      stream.average === null ? '' : Number(round(stream.average)),
      stream.topStudent?.name ?? '',
      stream.topStudent ? Number(round(stream.topStudent.average)) : '',
      stream.entered,
      stream.expected,
      Number(round(stream.completion)),
      stream.atRisk,
    ]),
    [],
    ['Insight'],
    ...analysis.insights.map((insight) => [`${insight.title}: ${insight.body}`]),
  ]

  // UTF-8 BOM so Excel opens the file with the right encoding.
  return `\ufeff${rows.map((row) => row.map(escapeCell).join(',')).join('\r\n')}`
}
