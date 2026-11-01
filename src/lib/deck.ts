import type { Database, Exam, GradeBand, Mark, Student, Term } from '../data/types'
import { isOperationalStudent } from '../data/student-lifecycle'
import { mean } from './analytics'
import { classLabel, orderedTerms, termLabel } from './analysis'
import { round } from './format'
import { bandFor } from './grading'

/**
 * The performance deck: a slide-by-slide reading of the same marks the analytics
 * page summarises, laid out as the printed department report a head teacher
 * presents at the end of term.
 *
 * Everything here is derived from the marks in scope — per stream, per term.
 * Nothing is asserted that the data does not measure, so a slide can honestly
 * report "no marks" instead of a narrative.
 */

export type DeckTone = 'teal' | 'sand' | 'sun' | 'coral' | 'ink' | 'slate'

export interface DeckTerm {
  id: string
  /** "Term 1 2026/2027" */
  label: string
  /** "T1" — the chart legend and column captions. */
  short: string
  name: string
}

export interface DeckPoint {
  termId: string
  mean: number | null
  grade: string
}

export interface DeckAction {
  key: string
  title: string
  body: string
  /** The measurement that asked for this action. */
  because: string
  /** False for standing practice, which no measurement called for. */
  triggered: boolean
}

export interface DeckVerdict {
  label: string
  tone: DeckTone
}

export interface DeckStream {
  classId: string
  /** "Form 1 A" */
  label: string
  /** "1A" — the chart category and tile caption. */
  short: string
  yearGroup: string
  points: DeckPoint[]
  first: number | null
  /**
   * The mean in the deck's closing term — the last term any stream in scope was
   * marked in. Cross-stream comparisons use this and nothing else, so "best" and
   * "needs intervention" are never two different terms in disguise.
   */
  closing: number | null
  closingGrade: string
  /** Where this stream's own record ends, for the trend narrative. */
  lastMeasured: { term: string; mean: number; grade: string } | null
  peak: number | null
  peakTerm: string | null
  change: number | null
  topStudent: string | null
  topAverage: number | null
  /** Per-subject means in scope: the report names the best and worst paper. */
  strongest: { name: string; mean: number } | null
  weakest: { name: string; mean: number } | null
  subjectCount: number
  students: number
  entered: number
  expected: number
  atRisk: number
  verdict: DeckVerdict
  narrative: string
  challenges: string[]
  actions: DeckAction[]
}

export interface DeckYearGroup {
  name: string
  label: string
  streams: DeckStream[]
  mean: number | null
  change: number | null
  leader: DeckStream | null
  lagger: DeckStream | null
}

export interface DeckTile {
  label: string
  value: string
  grade: string | null
  note: string
  tone: DeckTone
}

export interface DeckModel {
  /** "Mathematics 0580" or "All examined subjects". */
  scopeTitle: string
  scopeLine: string
  streamLine: string
  timeline: string
  terms: DeckTerm[]
  streams: DeckStream[]
  yearGroups: DeckYearGroup[]
  tiles: DeckTile[]
  summary: string[]
  recommendations: DeckAction[]
  conclusion: string[]
  hasMarks: boolean
}

export interface DeckRequest {
  db: Database
  bands: GradeBand[]
  passMark: number
  /** `all` or a stream id. */
  classId: string
  /** `all` or a subject id. */
  subjectId: string
  /** Teacher scope: only these subjects are visible. Null for admin / guest. */
  allowedSubjectIds?: string[] | null
}

const numeric = (value: Mark['score']): value is number => typeof value === 'number'
const gradeOf = (score: number | null, bands: GradeBand[]): string =>
  score === null ? '—' : bandFor(score, bands).grade

/** "Form 1" + "A" → "1A": the caption style the department report uses. */
export function streamShortCode(cls: { class_name: string; stream_name: string }): string {
  const digits = cls.class_name.match(/\d+/)?.[0] ?? cls.class_name.slice(0, 2)
  const initial = (cls.stream_name.match(/[A-Za-z]/)?.[0] ?? '').toUpperCase()
  return `${digits}${initial}`
}

function percentage(mark: Mark, exam: Exam): number | null {
  if (!numeric(mark.score)) return null
  return (mark.score / exam.max_score) * 100
}

export function buildDeck({
  db,
  bands,
  passMark,
  classId,
  subjectId,
  allowedSubjectIds = null,
}: DeckRequest): DeckModel {
  const inSubjectScope = (exam: Exam) =>
    (subjectId === 'all' || exam.subject_id === subjectId) &&
    (!allowedSubjectIds || allowedSubjectIds.includes(exam.subject_id))

  const scoped = db.exams.filter((exam) => inSubjectScope(exam) && (classId === 'all' || exam.class_id === classId))
  const operationalStudentIds = new Set(db.students.filter(isOperationalStudent).map((student) => student._id))
  const marksByExam = new Map<string, Mark[]>()
  for (const mark of db.marks) {
    if (!operationalStudentIds.has(mark.student_id)) continue
    const list = marksByExam.get(mark.exam_id) ?? []
    list.push(mark)
    marksByExam.set(mark.exam_id, list)
  }

  /** Mean percentage of a set of papers, or null when nothing is marked. */
  const meanOf = (exams: Exam[]): number | null => {
    const values: number[] = []
    for (const exam of exams) {
      for (const mark of marksByExam.get(exam._id) ?? []) {
        const value = percentage(mark, exam)
        if (value !== null) values.push(value)
      }
    }
    return mean(values)
  }

  // Only terms that actually hold marks in scope: an empty term would draw a
  // zero-height column and read as a collapse in performance.
  const termsWithMarks = orderedTerms(db.terms).filter((term) =>
    scoped.some((exam) => exam.term_id === term._id && (marksByExam.get(exam._id) ?? []).some((mark) => numeric(mark.score))),
  )
  const terms = termsWithMarks.slice(-4)
  const deckTerms: DeckTerm[] = terms.map((term, index) => ({
    id: term._id,
    label: termLabel(term),
    short: `T${index + 1}`,
    name: term.name,
  }))
  const closingLabel = deckTerms[deckTerms.length - 1]?.label ?? 'the closing term'

  const classIds = [...new Set(scoped.filter((exam) => terms.some((term) => term._id === exam.term_id)).map((exam) => exam.class_id))]
  const classRows = classIds
    .map((id) => db.classes.find((cls) => cls._id === id))
    .filter((cls): cls is NonNullable<typeof cls> => Boolean(cls))
    .sort((a, b) => a.class_name.localeCompare(b.class_name, undefined, { numeric: true }) || a.stream_name.localeCompare(b.stream_name))

  const rosterOf = (id: string): Student[] => db.students.filter((student) => student.class_id === id && isOperationalStudent(student))

  const streams: DeckStream[] = classRows.map((cls) => {
    const examsForStream = (termId?: string) =>
      scoped.filter((exam) => exam.class_id === cls._id && (!termId || exam.term_id === termId))

    const points: DeckPoint[] = deckTerms.map((term) => {
      const value = meanOf(examsForStream(term.id))
      return { termId: term.id, mean: value, grade: gradeOf(value, bands) }
    })

    const measured = points.filter((point): point is DeckPoint & { mean: number } => point.mean !== null)
    const first = measured[0]?.mean ?? null
    const last = measured[measured.length - 1] ?? null
    const closingPoint = points[points.length - 1]
    const closing = closingPoint?.mean ?? null
    const peakPoint = [...measured].sort((a, b) => b.mean - a.mean)[0]
    const termOf = (termId: string | undefined) => deckTerms.find((entry) => entry.id === termId) ?? null

    // Per-student averages across the whole scope, so "at risk" counts learners
    // rather than marks.
    const roster = rosterOf(cls._id)
    const scores: { student: Student; average: number }[] = []
    for (const student of roster) {
      const values: number[] = []
      for (const exam of examsForStream()) {
        for (const mark of marksByExam.get(exam._id) ?? []) {
          if (mark.student_id !== student._id) continue
          const value = percentage(mark, exam)
          if (value !== null) values.push(value)
        }
      }
      const average = mean(values)
      if (average !== null) scores.push({ student, average })
    }
    const top = [...scores].sort((a, b) => b.average - a.average)[0] ?? null

    const allExams = examsForStream()

    const bySubject = new Map<string, number[]>()
    for (const exam of allExams) {
      const values = bySubject.get(exam.subject_id) ?? []
      for (const mark of marksByExam.get(exam._id) ?? []) {
        const value = percentage(mark, exam)
        if (value !== null) values.push(value)
      }
      bySubject.set(exam.subject_id, values)
    }
    const subjectMeans = [...bySubject.entries()]
      .map(([subjectId, values]) => ({
        name: db.subjects.find((entry) => entry._id === subjectId)?.name ?? 'Unknown subject',
        mean: mean(values),
      }))
      .filter((row): row is { name: string; mean: number } => row.mean !== null)
      .sort((a, b) => b.mean - a.mean)

    let expected = 0
    let entered = 0
    for (const exam of allExams) {
      const seats = roster.length
      expected += seats
      entered += Math.min((marksByExam.get(exam._id) ?? []).filter((mark) => mark.score !== null).length, seats)
    }

    const change = first !== null && last !== null && measured.length > 1 ? last.mean - first : null
    const atRisk = scores.filter((score) => score.average < passMark).length
    const closingGrade = gradeOf(closing, bands)
    const peakTerm = termOf(peakPoint?.termId)?.label ?? null
    const lastTerm = termOf(last?.termId)?.label ?? null
    const firstTerm = termOf(measured[0]?.termId)?.label ?? null

    const stream: DeckStream = {
      classId: cls._id,
      label: classLabel(cls),
      short: streamShortCode(cls),
      yearGroup: cls.class_name,
      points,
      first,
      closing,
      closingGrade,
      lastMeasured: last && lastTerm ? { term: lastTerm, mean: last.mean, grade: last.grade } : null,
      peak: peakPoint?.mean ?? null,
      peakTerm,
      change,
      topStudent: top?.student.full_name ?? null,
      topAverage: top?.average ?? null,
      strongest: subjectMeans.length >= 2 ? subjectMeans[0] : null,
      weakest: subjectMeans.length >= 2 ? subjectMeans[subjectMeans.length - 1] : null,
      subjectCount: subjectMeans.length,
      students: roster.length,
      entered,
      expected,
      atRisk,
      verdict: { label: 'No marks', tone: 'slate' },
      narrative: '',
      challenges: [],
      actions: [],
    }

    stream.verdict = verdictFor(stream, passMark)
    stream.narrative = narrativeFor(stream, { firstTerm, lastTerm, peakTerm, closingLabel })
    stream.challenges = challengesFor(stream, { passMark, peakTerm, terms: deckTerms })
    stream.actions = actionsFor(stream, { passMark })
    return stream
  })

  const yearNames = [...new Set(streams.map((stream) => stream.yearGroup))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  )
  const yearGroups: DeckYearGroup[] = yearNames.map((name) => {
    const rows = streams.filter((stream) => stream.yearGroup === name)
    const ranked = rows.filter((stream): stream is DeckStream & { closing: number } => stream.closing !== null)
    const ordered = [...ranked].sort((a, b) => b.closing - a.closing)
    const changes = rows.map((stream) => stream.change).filter((value): value is number => value !== null)
    return {
      name,
      label: name,
      streams: rows,
      mean: mean(ranked.map((stream) => stream.closing)),
      change: changes.length ? mean(changes) : null,
      leader: ordered[0] ?? null,
      lagger: ordered[ordered.length - 1] ?? null,
    }
  })

  // Streams are ranked on the closing term only, so "best" and "needs
  // intervention" can never be two different terms in disguise.
  const ranked = streams.filter((stream): stream is DeckStream & { closing: number } => stream.closing !== null)
  const dormant = streams.filter((stream) => stream.closing === null)
  const best = [...ranked].sort((a, b) => b.closing - a.closing)[0] ?? null
  const challenged = [...ranked].sort((a, b) => a.closing - b.closing)[0] ?? null
  const improver =
    [...streams]
      .filter((stream): stream is DeckStream & { change: number } => stream.change !== null && stream.change > 0)
      .sort((a, b) => b.change - a.change)[0] ?? null
  const peakStream = [...streams].filter((stream) => stream.peak !== null).sort((a, b) => (b.peak ?? 0) - (a.peak ?? 0))[0] ?? null
  const improvingCount = streams.filter((stream) => (stream.change ?? 0) > 0).length
  const trendedCount = streams.filter((stream) => stream.change !== null).length
  const closingTerm = deckTerms[deckTerms.length - 1] ?? null
  const closingName = closingLabel

  const tiles: DeckTile[] = [
    {
      label: 'Best stream',
      value: best ? best.short : '—',
      grade: best?.closingGrade ?? null,
      note: best ? `${round(best.closing ?? 0)}% average in ${closingName}` : `No stream has marks in ${closingName}`,
      tone: 'teal',
    },
    {
      label: 'Top improver',
      value: improver ? improver.short : '—',
      grade: improver ? `${gradeOf(improver.first, bands)} → ${improver.closingGrade}` : null,
      note: improver ? `+${round(improver.change ?? 0)} points across the measured terms` : 'No stream has two measured terms',
      tone: 'teal',
    },
    {
      label: 'Most challenged',
      value: challenged ? challenged.short : '—',
      grade: challenged?.closingGrade ?? null,
      note: challenged
        ? (challenged.closing ?? 0) < passMark
          ? `${round(challenged.closing ?? 0)}% in ${closingName} — below the ${passMark}% pass mark`
          : `Lowest in ${closingName} at ${round(challenged.closing ?? 0)}%, still above the ${passMark}% pass mark`
        : `No stream has marks in ${closingName}`,
      tone: 'coral',
    },
    {
      label: 'Peak average',
      value: peakStream ? round(peakStream.peak ?? 0) : '—',
      grade: peakStream ? gradeOf(peakStream.peak, bands) : null,
      note: peakStream ? `${peakStream.short} in ${peakStream.peakTerm ?? '—'}` : 'No marks yet',
      tone: 'sand',
    },
    {
      label: 'Improving',
      value: `${improvingCount} of ${trendedCount}`,
      grade: null,
      note:
        trendedCount === 0
          ? 'no stream has two measured terms yet'
          : trendedCount === 1
            ? 'stream measured over two or more terms'
            : 'streams trending upwards',
      tone: 'sun',
    },
  ]

  const summary = buildSummary({ streams, ranked, dormant, yearGroups, deckTerms, closingName, passMark, best, challenged, improver })
  const recommendations = buildRecommendations(streams)
  const scopeTitle = scopeTitleOf(db, subjectId)
  const conclusion = buildConclusion({
    scopeTitle,
    streams,
    dormant,
    closingName,
    best,
    improver,
    challenged,
    recommendations,
    passMark,
  })

  const firstTerm = deckTerms[0]
  const lastTerm = deckTerms[deckTerms.length - 1]
  // A narrow scope names the streams themselves; a whole-department deck names
  // the year groups instead, because six stream labels do not fit a footer.
  const streamLine =
    streams.length === 0
      ? 'No streams in scope'
      : streams.length <= 3
        ? `${streams.map((stream) => stream.label).join(' · ')} — ${streams.length} ${streams.length === 1 ? 'stream' : 'streams'}`
        : `${yearNames.join(' · ')} — ${streams.length} streams`

  return {
    scopeTitle,
    scopeLine: scopeLineOf(db, classId, subjectId),
    streamLine,
    timeline: deckTerms.length
      ? `${firstTerm.label} → ${lastTerm.label} · ${deckTerms.length} ${deckTerms.length === 1 ? 'term' : 'terms'}`
      : 'No term holds marks in this scope',
    terms: deckTerms,
    streams,
    yearGroups,
    tiles,
    summary,
    recommendations,
    conclusion,
    hasMarks: ranked.length > 0,
  }
}

function scopeTitleOf(db: Database, subjectId: string): string {
  if (subjectId === 'all') return 'All examined subjects'
  const subject = db.subjects.find((entry) => entry._id === subjectId)
  return subject ? `${subject.name} ${subject.code}` : 'Unknown subject'
}

function scopeLineOf(db: Database, classId: string, subjectId: string): string {
  const cls = classId === 'all' ? null : db.classes.find((entry) => entry._id === classId)
  const className = cls ? classLabel(cls) : 'All streams'
  const subject = subjectId === 'all' ? null : db.subjects.find((entry) => entry._id === subjectId)
  return `${className} · ${subject ? `${subject.name} (${subject.code})` : 'all subjects'}`
}

function verdictFor(stream: DeckStream, passMark: number): DeckVerdict {
  if (stream.closing === null) return { label: 'No marks this term', tone: 'slate' }
  if (stream.closing < passMark) return { label: 'Intervention needed', tone: 'coral' }
  if (stream.change === null) return { label: 'Single term', tone: 'slate' }
  if (stream.change >= 5) return { label: 'Strong improvement', tone: 'teal' }
  if (stream.change >= 1.5) return { label: 'Improving', tone: 'teal' }
  if (stream.change <= -5) return { label: 'Declining', tone: 'coral' }
  if (stream.change <= -1.5) return { label: 'Slight decline', tone: 'sand' }
  return { label: 'Steady', tone: 'sand' }
}

function narrativeFor(
  stream: DeckStream,
  context: { firstTerm: string | null; lastTerm: string | null; peakTerm: string | null; closingLabel: string },
): string {
  const { firstTerm, lastTerm, peakTerm, closingLabel } = context
  const last = stream.lastMeasured
  if (last === null || stream.first === null || !firstTerm || !lastTerm) {
    return `${stream.label} has no numeric marks in scope yet, so there is no trend to report.`
  }
  const move =
    stream.change === null || Math.abs(stream.change) < 0.05
      ? 'holding level'
      : stream.change > 0
        ? `a gain of ${round(stream.change)} points`
        : `a fall of ${round(Math.abs(stream.change))} points`
  const openSentence =
    stream.first === last.mean && firstTerm === lastTerm
      ? `${stream.label} has a single measured term, ${firstTerm}, at ${round(stream.first)}% (${last.grade}).`
      : `Opened ${firstTerm} at ${round(stream.first)}% and reached ${round(last.mean)}% by ${lastTerm} — ${move}, ending on ${last.grade}.`
  const ceiling =
    peakTerm && peakTerm === lastTerm
      ? `${lastTerm} is the high-water mark so far, at ${round(stream.peak ?? last.mean)}%.`
      : peakTerm
        ? `The ceiling was ${round(stream.peak ?? 0)}% in ${peakTerm}; ${lastTerm} gave ${round(last.mean)}%.`
        : ''
  const unmarked =
    stream.closing === null
      ? ` ${closingLabel} carries no marks for this stream yet, so it is not ranked against the others.`
      : ''
  return `${openSentence}${ceiling ? ` ${ceiling}` : ''}${unmarked}`
}

function challengesFor(
  stream: DeckStream,
  context: { passMark: number; peakTerm: string | null; terms: DeckTerm[] },
): string[] {
  const { passMark } = context
  const out: string[] = []
  const measured = stream.points.filter((point) => point.mean !== null)
  const last = stream.lastMeasured

  const closed = measured[measured.length - 1]
  const previous = measured[measured.length - 2]
  if (closed && previous && closed.mean !== null && previous.mean !== null && closed.mean < previous.mean) {
    const term = context.terms.find((entry) => entry.id === closed.termId)?.label ?? 'the closing term'
    out.push(`Fell ${round(previous.mean - closed.mean)} points into ${term}, so the term closed weaker than it opened.`)
  }
  if (stream.closing === null) {
    out.push('The closing term has no marks for this stream, so it cannot be compared with the rest of the scope.')
  }
  if (last && last.mean < passMark) {
    out.push(`The last measured term closed ${round(passMark - last.mean)} points below the ${passMark}% pass mark.`)
  }
  if (stream.atRisk > 0) {
    out.push(`${stream.atRisk} of ${stream.students} learners average below the pass mark.`)
  }
  if (stream.expected > stream.entered) {
    out.push(
      `${stream.expected - stream.entered} of ${stream.expected} expected marks are still outstanding, so part of this picture is incomplete.`,
    )
  }
  if (stream.peak !== null && last && stream.peak - last.mean >= 4) {
    out.push(
      `The ceiling of ${round(stream.peak)}%${context.peakTerm ? ` in ${context.peakTerm}` : ''} has not been held — consistency, not ability, is the gap.`,
    )
  }
  if (out.length === 0) {
    out.push('No measured weakness in scope: every learner is above the pass mark and all expected marks are in.')
  }
  return out.slice(0, 4)
}

interface Strategy {
  key: string
  title: string
  body: string
  /** Lower sorts first when several streams want the same action. */
  weight: number
}

const STRATEGIES: Strategy[] = [
  {
    key: 'remedial',
    title: 'Remedial lessons',
    body: 'Small-group sessions for the learners carrying the lowest averages, timetabled before the next paper rather than after it.',
    weight: 1,
  },
  {
    key: 'revision',
    title: 'Revision culture',
    body: 'Short retrieval practice every week, so revision is spread across the term instead of concentrated in the week before a paper.',
    weight: 2,
  },
  {
    key: 'peer',
    title: 'Peer teaching',
    body: 'Pair the strongest learners with those who need support; the pairing is measured by the weaker learner’s next paper, not by attendance.',
    weight: 3,
  },
  {
    key: 'quizzes',
    title: 'Monthly quizzes',
    body: 'A short assessment each month keeps progress visible between the papers that count, and flags a slide while it is still cheap to fix.',
    weight: 4,
  },
  {
    key: 'consistency',
    title: 'Consistency programme',
    body: 'Hold the ceiling: the stream has already reached its best average, so the work is repeating it rather than raising it.',
    weight: 5,
  },
  {
    key: 'practical',
    title: 'Practical-first teaching',
    body: 'More hands-on work behind the weaker topics, so understanding is built on doing rather than on notes.',
    weight: 6,
  },
  {
    key: 'shared',
    title: 'Shared planning across streams',
    body: 'The streams diverge more than their intake explains; common schemes of work and shared assessments narrow the gap.',
    weight: 7,
  },
  {
    key: 'enrichment',
    title: 'Enrichment & competitions',
    body: 'Stretch the strongest stream with advanced projects and external competitions, so its ceiling keeps moving.',
    weight: 8,
  },
]

function actionsFor(stream: DeckStream, context: { passMark: number }): DeckAction[] {
  const out: DeckAction[] = []
  const add = (key: string, because: string, triggered = true) => {
    const strategy = STRATEGIES.find((entry) => entry.key === key)
    if (!strategy || out.some((action) => action.key === key)) return
    out.push({ key: strategy.key, title: strategy.title, body: strategy.body, because, triggered })
  }

  const last = stream.lastMeasured
  if (stream.closing !== null && stream.closing < context.passMark) {
    add('remedial', `The closing average of ${round(stream.closing)}% sits below the ${context.passMark}% pass mark.`)
  }
  if (stream.change !== null && stream.change <= -1.5) {
    add('revision', `Down ${round(Math.abs(stream.change))} points between the first and last measured term.`)
  }
  if (stream.atRisk > 0) {
    add('peer', `${stream.atRisk} of ${stream.students} learners average below the pass mark.`)
  }
  if (stream.expected > stream.entered) {
    add(
      'quizzes',
      `${stream.expected - stream.entered} of ${stream.expected} expected marks are outstanding, so assessment is not yet continuous.`,
    )
  }
  if (stream.peak !== null && last && stream.peak - last.mean >= 4) {
    add('consistency', `The ${round(stream.peak)}% reached earlier has not been repeated.`)
  }
  if (stream.closing !== null && stream.closing < context.passMark && stream.expected <= stream.entered) {
    add(
      'practical',
      'Every expected mark is in and the average is still below the pass mark, so the gap is performance rather than missing entries.',
    )
  }
  if (stream.closing !== null && stream.closing >= 80 && (stream.change ?? 0) > 0) {
    add('enrichment', `Averages ${round(stream.closing)}% and still climbing, so the ceiling can be raised.`)
  }

  // Standing practice fills the card out when the marks ask for little: a stream
  // card that reads as a single line looks like an oversight, not a finding.
  for (const key of ['revision', 'peer', 'practical']) {
    if (out.length >= 2) break
    add(key, 'standing practice; nothing in these marks asked for it', false)
  }
  return out
}

function buildRecommendations(streams: DeckStream[]): DeckAction[] {
  // Strategies the marks asked for come first, ranked by how many streams asked;
  // standing practice follows, so the priority order is never diluted.
  const gapLeader = (() => {
    const ranked = streams.filter((stream): stream is DeckStream & { closing: number } => stream.closing !== null)
    if (ranked.length < 2) return null
    const sorted = [...ranked].sort((a, b) => b.closing - a.closing)
    const top = sorted[0]
    const bottom = sorted[sorted.length - 1]
    const gap = top.closing - bottom.closing
    return gap >= 5 ? { top, bottom, gap } : null
  })()

  const tally = new Map<string, { strategy: Strategy; reasons: string[]; streams: string[] }>()
  for (const stream of streams) {
    for (const action of stream.actions) {
      if (!action.triggered) continue
      const strategy = STRATEGIES.find((entry) => entry.key === action.key)
      if (!strategy) continue
      const entry = tally.get(action.key) ?? { strategy, reasons: [], streams: [] }
      entry.reasons.push(action.because)
      entry.streams.push(stream.short)
      tally.set(action.key, entry)
    }
  }

  const ranked = [...tally.values()].sort(
    (a, b) => b.streams.length - a.streams.length || a.strategy.weight - b.strategy.weight,
  )

  const rows: DeckAction[] = ranked.map((entry) => ({
    key: entry.strategy.key,
    title: entry.strategy.title,
    body: entry.strategy.body,
    because: `${entry.streams.length === 1 ? entry.streams[0] : `${entry.streams.length} streams (${entry.streams.join(', ')})`} — ${entry.reasons[0]}`,
    triggered: true,
  }))

  if (gapLeader) {
    rows.push({
      key: 'shared',
      title: 'Shared planning across streams',
      body: STRATEGIES.find((entry) => entry.key === 'shared')!.body,
      because: `${gapLeader.top.short} runs ${round(gapLeader.gap)} points ahead of ${gapLeader.bottom.short} in the closing term.`,
      triggered: true,
    })
  }

  for (const key of ['revision', 'peer', 'practical']) {
    if (rows.length >= 8 || rows.some((row) => row.key === key)) continue
    const strategy = STRATEGIES.find((entry) => entry.key === key)
    if (!strategy) continue
    rows.push({
      key,
      title: strategy.title,
      body: strategy.body,
      because: 'standing practice; no measurement this term asked for it, but it holds the gains the priorities above win.',
      triggered: false,
    })
  }

  return rows.slice(0, 8)
}

function buildSummary(input: {
  streams: DeckStream[]
  ranked: (DeckStream & { closing: number })[]
  dormant: DeckStream[]
  yearGroups: DeckYearGroup[]
  deckTerms: DeckTerm[]
  closingName: string
  passMark: number
  best: DeckStream | null
  challenged: DeckStream | null
  improver: DeckStream | null
}): string[] {
  const { streams, ranked, dormant, yearGroups, deckTerms, closingName, passMark, best, challenged, improver } = input
  const out: string[] = []
  if (streams.length === 0 || deckTerms.length === 0) {
    return ['No papers hold marks in this scope yet, so the deck has nothing to report.']
  }

  const firstTerm = deckTerms[0]
  const lastTerm = deckTerms[deckTerms.length - 1]
  // Only streams measured at both ends can carry a year-on-year movement: a
  // stream marked in one term only would otherwise read as a collapse or a spike.
  const pairs = streams
    .map((stream) => ({ first: stream.points[0]?.mean ?? null, closing: stream.closing }))
    .filter((pair): pair is { first: number; closing: number } => pair.first !== null && pair.closing !== null)

  if (deckTerms.length === 1) {
    out.push(
      `In ${lastTerm.label}, the ${ranked.length} measured ${ranked.length === 1 ? 'stream averages' : 'streams average'} ${round(
        mean(ranked.map((stream) => stream.closing)),
      )}%. One term of marks is recorded in this scope, so there is no trend line yet.`,
    )
  } else if (pairs.length > 0) {
    const opening = mean(pairs.map((pair) => pair.first))
    const closing = mean(pairs.map((pair) => pair.closing))
    const move = opening !== null && closing !== null ? closing - opening : null
    out.push(
      `Across the ${pairs.length} ${pairs.length === 1 ? 'stream' : 'streams'} measured in both ${firstTerm.label} and ${lastTerm.label}, the average moved from ${round(
        opening,
      )}% to ${round(closing)}%${
        move === null || Math.abs(move) < 0.05 ? ' — unchanged' : ` (${move > 0 ? '+' : ''}${round(move)} points)`
      }.`,
    )
  } else {
    out.push(`No stream holds marks in both ${firstTerm.label} and ${lastTerm.label}, so the deck reports the closing term only.`)
  }

  for (const group of yearGroups) {
    const ordered = group.streams
      .filter((stream): stream is DeckStream & { closing: number } => stream.closing !== null)
      .sort((a, b) => b.closing - a.closing)
    if (ordered.length >= 2) {
      const top = ordered[0]
      const bottom = ordered[ordered.length - 1]
      out.push(
        `${group.name}: ${top.short} closes at ${round(top.closing)}% (${top.closingGrade}), ${bottom.short} at ${round(
          bottom.closing,
        )}% (${bottom.closingGrade}) — a ${round(top.closing - bottom.closing)} point spread.`,
      )
    } else if (ordered.length === 1) {
      out.push(`${group.name}: ${ordered[0].short} closes ${closingName} at ${round(ordered[0].closing)}% (${ordered[0].closingGrade}).`)
    } else {
      const seen = group.streams
        .map((stream) => ({ stream, last: stream.lastMeasured }))
        .filter((row): row is { stream: DeckStream; last: { term: string; mean: number; grade: string } } => row.last !== null)
        .sort((a, b) => b.last.mean - a.last.mean)
      if (seen.length) {
        out.push(
          `${group.name}: nothing is marked in ${closingName} yet — ${seen[0].stream.short} was last measured in ${seen[0].last.term} at ${round(
            seen[0].last.mean,
          )}% (${seen[0].last.grade}).`,
        )
      }
    }
  }

  if (improver && improver.change !== null) {
    out.push(
      `${improver.short} recorded the strongest trend, up ${round(improver.change)} points from ${round(
        improver.first ?? 0,
      )}% to ${round(improver.lastMeasured?.mean ?? improver.closing ?? 0)}% (${improver.closingGrade}).`,
    )
  }

  const riskTotal = streams.reduce((sum, stream) => sum + stream.atRisk, 0)
  if (riskTotal > 0 && challenged) {
    out.push(
      `${riskTotal} ${riskTotal === 1 ? 'learner sits' : 'learners sit'} below the ${passMark}% pass mark, concentrated in ${challenged.short} (${challenged.atRisk}).`,
    )
  } else if (best) {
    out.push(`No learner in scope averages below the ${passMark}% pass mark; ${best.short} closes strongest on ${round(best.closing ?? 0)}%.`)
  }

  if (dormant.length === 1) {
    out.push(`${dormant[0].short} has no marks in ${closingName}, so it sits outside the ranking until that paper is marked.`)
  } else if (dormant.length > 1) {
    out.push(
      `${dormant.length} streams (${dormant.map((stream) => stream.short).join(', ')}) have no marks in ${closingName}, so they sit outside the ranking.`,
    )
  }

  const entered = streams.reduce((sum, stream) => sum + stream.entered, 0)
  const expected = streams.reduce((sum, stream) => sum + stream.expected, 0)
  if (expected > 0) {
    out.push(
      entered >= expected
        ? `Every expected mark is captured (${entered} across the scope), so this reading rests on complete data.`
        : `${entered} of ${expected} expected marks are in (${Math.round((entered / expected) * 100)}%); the outstanding ${
            expected - entered
          } leave part of the picture blank.`,
    )
  }

  return out.slice(0, 5)
}

function buildConclusion(input: {
  scopeTitle: string
  streams: DeckStream[]
  dormant: DeckStream[]
  closingName: string
  best: DeckStream | null
  improver: DeckStream | null
  challenged: DeckStream | null
  recommendations: DeckAction[]
  passMark: number
}): string[] {
  const { scopeTitle, streams, dormant, closingName, best, improver, challenged, recommendations, passMark } = input
  if (streams.length === 0) return ['No marks are recorded in this scope, so there is no conclusion to draw yet.']

  const out: string[] = []
  if (best) {
    out.push(
      `${scopeTitle}: ${best.short} closed ${closingName} as the strongest stream on ${round(best.closing ?? 0)}% (${best.closingGrade}).`,
    )
  }
  if (improver && improver.change !== null) {
    out.push(
      `${improver.short} improved most, ${improver.change > 0 ? '+' : ''}${round(improver.change)} points across the measured terms.`,
    )
  }
  const riskTotal = streams.reduce((sum, stream) => sum + stream.atRisk, 0)
  if (challenged && (riskTotal > 0 || (challenged.closing ?? 100) < passMark)) {
    out.push(
      `${challenged.short} needs intervention: ${round(challenged.closing ?? 0)}% (${challenged.closingGrade}) with ${
        challenged.atRisk
      } ${challenged.atRisk === 1 ? 'learner' : 'learners'} below the ${passMark}% pass mark.`,
    )
  }
  if (dormant.length) {
    out.push(
      `${dormant.map((stream) => stream.short).join(', ')} ${dormant.length === 1 ? 'has' : 'have'} no marks in ${closingName}, so ${dormant.length === 1 ? 'it' : 'they'} stay outside this ranking.`,
    )
  }
  const entered = streams.reduce((sum, stream) => sum + stream.entered, 0)
  const expected = streams.reduce((sum, stream) => sum + stream.expected, 0)
  if (expected > entered) {
    out.push(`${expected - entered} marks remain outstanding; the next report is only as good as those entries.`)
  }
  const names = recommendations
    .filter((action) => action.triggered)
    .slice(0, 3)
    .map((action) => action.title.toLowerCase())
  if (names.length) {
    out.push(`Acting on the priorities above — ${names.join(', ')} — is the shortest route to lifting the weaker streams.`)
  }
  return out.slice(0, 5)
}

