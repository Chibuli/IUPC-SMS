import { DEFAULT_BELL } from '../lib/timetable'
import { CAMBRIDGE_CATALOGUE, catalogueId } from './catalogue'
import type {
  BellSchedule,
  ClassRow,
  Database,
  Exam,
  GradingScale,
  Mark,
  MarkWindow,
  Note,
  ReportCard,
  School,
  Student,
  Subject,
  SubjectLevel,
  Teacher,
  Term,
  TimetableSlot,
} from './types'

export const SCHOOL_ID = 'sch-iupc'

const school: School = {
  _id: SCHOOL_ID,
  name: 'IUPC Academy',
  code: 'IUPC-01',
  // Physical campus in Mombasa; official mail is centralised through the
  // Nairobi postal box, so both appear on every masthead.
  address: 'Off Mount Kenya Road, Nyali, Mombasa',
  postal: 'P.O. Box 1468-00606',
  city: 'Nairobi',
  contact_email: 'info@iupceducation.com',
  phone_number: '+254 788 175 518 / +254 768 334 453',
  logo_url: '/iupc-wordmark.png',
  crest_url: '/iupc-crest.png',
  motto: 'Academic Prestige · Operational Precision',
}

/**
 * The twenty-three syllabus entries this campus teaches, keyed by the ids
 * papers, lessons and the staff register reference. Each row carries Cambridge's
 * own syllabus code and title.
 *
 * The legacy ids (`sub-mat`) survive from before the catalogue existed; the
 * Lower Secondary and AS & A Level rows were added with the Years 7–13 roll.
 */
const TAUGHT: Record<string, { level: SubjectLevel; code: string }> = {
  /* Cambridge IGCSE — Years 10 and 11 */
  'sub-eng': { level: 'IGCSE', code: '0500' }, // English - First Language
  'sub-mat': { level: 'IGCSE', code: '0580' }, // Mathematics
  'sub-bio': { level: 'IGCSE', code: '0610' }, // Biology
  'sub-che': { level: 'IGCSE', code: '0620' }, // Chemistry
  'sub-phy': { level: 'IGCSE', code: '0625' }, // Physics
  'sub-cst': { level: 'IGCSE', code: '0478' }, // Computer Science
  'sub-his': { level: 'IGCSE', code: '0470' }, // History
  'sub-bst': { level: 'IGCSE', code: '0450' }, // Business Studies

  /* Cambridge Lower Secondary — Years 7, 8 and 9 */
  'sub-ls-eng': { level: 'Lower Secondary', code: '0861' }, // English
  'sub-ls-mat': { level: 'Lower Secondary', code: '0862' }, // Mathematics
  'sub-ls-sci': { level: 'Lower Secondary', code: '0893' }, // Science
  'sub-ls-cmp': { level: 'Lower Secondary', code: '0860' }, // Computing
  'sub-ls-glp': { level: 'Lower Secondary', code: '1129' }, // Global Perspectives
  'sub-ls-hum': { level: 'Lower Secondary', code: '0839' }, // Humanities
  'sub-ls-art': { level: 'Lower Secondary', code: '0073' }, // Art & Design
  'sub-ls-pe': { level: 'Lower Secondary', code: '0081' }, // Physical Education

  /* Cambridge International AS & A Level — Years 12 and 13 */
  'sub-as-mat': { level: 'AS & A Level', code: '9709' }, // Mathematics
  'sub-as-phy': { level: 'AS & A Level', code: '9702' }, // Physics
  'sub-as-che': { level: 'AS & A Level', code: '9701' }, // Chemistry
  'sub-as-cst': { level: 'AS & A Level', code: '9618' }, // Computer Science
  'sub-as-eco': { level: 'AS & A Level', code: '9708' }, // Economics
  'sub-as-bio': { level: 'AS & A Level', code: '9700' }, // Biology
  'sub-as-psy': { level: 'AS & A Level', code: '9990' }, // Psychology
}

const taughtIdBySyllabus = new Map(
  Object.entries(TAUGHT).map(([id, entry]) => [`${entry.level}|${entry.code}`, id]),
)

/** The whole Cambridge catalogue: everything is listed, only the ids above are offered. */
const subjects: Subject[] = CAMBRIDGE_CATALOGUE.map((entry) => {
  const legacyId = taughtIdBySyllabus.get(`${entry.level}|${entry.code}`)
  return {
    _id: legacyId ?? catalogueId(entry),
    school_id: SCHOOL_ID,
    name: entry.name,
    code: entry.code,
    category: entry.category,
    level: entry.level,
    offered: Boolean(legacyId),
  }
})

/** The eight papers each Lower Secondary year sits. */
const LOWER_SECONDARY = [
  'sub-ls-eng',
  'sub-ls-mat',
  'sub-ls-sci',
  'sub-ls-cmp',
  'sub-ls-glp',
  'sub-ls-hum',
  'sub-ls-art',
  'sub-ls-pe',
]

/** The eight IGCSE papers Years 10 and 11 sit. */
const IGCSE = ['sub-eng', 'sub-mat', 'sub-bio', 'sub-che', 'sub-phy', 'sub-cst', 'sub-his', 'sub-bst']

/** Year 12's five AS papers. */
const AS_LEVEL = ['sub-as-mat', 'sub-as-phy', 'sub-as-che', 'sub-as-cst', 'sub-as-eco']

/** Year 13's four A Level papers. */
const A_LEVEL = ['sub-as-mat', 'sub-as-bio', 'sub-as-che', 'sub-as-psy']

/**
 * The campus roll: one class per year, Year 7 to Year 13. Years 7–11 sit eight
 * subjects, Year 12 five and Year 13 four — the subject list is what each year
 * group is examined in, and it drives its papers, marks and timetable.
 */
const YEAR_PLAN: { year: number; subjects: string[] }[] = [
  { year: 7, subjects: LOWER_SECONDARY },
  { year: 8, subjects: LOWER_SECONDARY },
  { year: 9, subjects: LOWER_SECONDARY },
  { year: 10, subjects: IGCSE },
  { year: 11, subjects: IGCSE },
  { year: 12, subjects: AS_LEVEL },
  { year: 13, subjects: A_LEVEL },
]

const classId = (year: number) => `c-y${year}`

const classes: ClassRow[] = YEAR_PLAN.map((entry) => ({
  _id: classId(entry.year),
  school_id: SCHOOL_ID,
  class_name: `Year ${entry.year}`,
  stream_name: 'A',
}))

const subjectsOf = (year: number) => YEAR_PLAN.find((entry) => entry.year === year)?.subjects ?? []

/**
 * Every teacher is read-only until the registrar grants a permission. Grace is
 * the one seeded account that may enter marks, so the demo sign-in shows both
 * ends of the model: she writes inside the window, the others read.
 */
const teachers: Teacher[] = [
  { _id: 't-1', school_id: SCHOOL_ID, full_name: 'Grace Wanjiru', email: 'g.wanjiru@iupc.academy', employee_id: 'EMP-011', assigned_subject_ids: ['sub-mat', 'sub-as-mat', 'sub-ls-mat'], permissions: ['marks.enter'], initials: 'GW' },
  { _id: 't-2', school_id: SCHOOL_ID, full_name: 'Peter Otieno', email: 'p.otieno@iupc.academy', employee_id: 'EMP-014', assigned_subject_ids: ['sub-eng', 'sub-ls-eng', 'sub-ls-glp'], permissions: [], initials: 'PO' },
  { _id: 't-3', school_id: SCHOOL_ID, full_name: 'Mary Achieng', email: 'm.achieng@iupc.academy', employee_id: 'EMP-019', assigned_subject_ids: ['sub-bio', 'sub-che', 'sub-as-bio', 'sub-as-che'], permissions: [], initials: 'MA' },
  { _id: 't-4', school_id: SCHOOL_ID, full_name: 'Samuel Kiptoo', email: 's.kiptoo@iupc.academy', employee_id: 'EMP-023', assigned_subject_ids: ['sub-his', 'sub-ls-hum', 'sub-as-psy'], permissions: [], initials: 'SK' },
  { _id: 't-5', school_id: SCHOOL_ID, full_name: 'Esther Njeri', email: 'e.njeri@iupc.academy', employee_id: 'EMP-031', assigned_subject_ids: ['sub-cst', 'sub-ls-cmp', 'sub-as-cst'], permissions: [], initials: 'EN' },
  { _id: 't-6', school_id: SCHOOL_ID, full_name: 'Daniel Mwangi', email: 'd.mwangi@iupc.academy', employee_id: 'EMP-036', assigned_subject_ids: ['sub-phy', 'sub-ls-sci', 'sub-as-phy'], permissions: [], initials: 'DM' },
  { _id: 't-7', school_id: SCHOOL_ID, full_name: 'Faith Wambui', email: 'f.wambui@iupc.academy', employee_id: 'EMP-041', assigned_subject_ids: ['sub-ls-art', 'sub-ls-pe'], permissions: [], initials: 'FW' },
  { _id: 't-8', school_id: SCHOOL_ID, full_name: 'Joseph Odhiambo', email: 'j.odhiambo@iupc.academy', employee_id: 'EMP-047', assigned_subject_ids: ['sub-bst', 'sub-as-eco'], permissions: [], initials: 'JO' },
]

const FIRST = ['Amina', 'Brian', 'Cynthia', 'David', 'Esther', 'Felix', 'Grace', 'Hassan', 'Irene', 'James', 'Kelvin', 'Lydia', 'Moses', 'Nancy', 'Oscar', 'Purity', 'Quincy', 'Rachel', 'Samuel', 'Tabitha', 'Umar', 'Violet', 'Wycliffe', 'Yvonne']
const LAST = ['Abdalla', 'Barasa', 'Chebet', 'Dlamini', 'Ekiru', 'Fondo', 'Gitau', 'Hassan', 'Imani', 'Juma', 'Kariuki', 'Langat', 'Mutiso', 'Nekesa', 'Ochieng', 'Peters', 'Quarshie', 'Ruto', 'Simiyu', 'Toroitich', 'Ugwu', 'Vundi', 'Waweru', 'Yegon']

/** Twelve learners per class — eighty-four on roll. */
const PER_CLASS = 12

const students: Student[] = YEAR_PLAN.flatMap((entry, classIndex) =>
  Array.from({ length: PER_CLASS }, (_, seat) => {
    const i = classIndex * PER_CLASS + seat
    // A fixed stride through the surname list keeps every name distinct while
    // the first names cycle, so a class reads like a real register.
    const last = LAST[(i * 5 + Math.floor(i / FIRST.length)) % LAST.length]
    const birthYear = 2026 - (12 + classIndex)
    const month = String((i % 12) + 1).padStart(2, '0')
    const day = String((i % 27) + 1).padStart(2, '0')
    return {
      _id: `s-${i + 1}`,
      school_id: SCHOOL_ID,
      admission_number: `IUPC/2026/${String(i + 1).padStart(3, '0')}`,
      full_name: `${FIRST[i % FIRST.length]} ${last}`,
      gender: i % 2 === 0 ? 'Female' : 'Male',
      date_of_birth: `${birthYear}-${month}-${day}`,
      class_id: classId(entry.year),
      guardian_name: `${last} Family`,
      guardian_phone: `+254 7${String(10 + (i % 80)).padStart(2, '0')} ${String(100 + (i % 300)).slice(0, 3)} ${String(200 + (i % 700)).slice(0, 3)}`,
      status: 'Active',
    }
  }),
)

const terms: Term[] = [
  { _id: 'term-0', school_id: SCHOOL_ID, name: 'TERM 3', academic_year: '2025/2026', is_active: false, start_date: '2026-05-04' },
  { _id: 'term-1', school_id: SCHOOL_ID, name: 'TERM 1', academic_year: '2026/2027', is_active: true, start_date: '2026-09-07' },
]

const examId = (prefix: string, year: number, subjectId: string) => `ex-${prefix}y${year}-${subjectId}`

/**
 * One paper per subject per class, per term. The first two papers keep their
 * historical ids (`ex-1`, `ex-2`) because links and the demo walkthrough point
 * at them: Mathematics is Grace's, English is Peter's.
 */
const currentExams: Exam[] = [
  {
    _id: 'ex-1',
    term_id: 'term-1',
    subject_id: 'sub-ls-mat',
    class_id: 'c-y7',
    exam_name: 'CAT 1',
    exam_type: 'CAT 1',
    max_score: 100,
    exam_date: '2026-10-05',
    editing_deadline: null,
    status: 'open',
  },
  {
    _id: 'ex-2',
    term_id: 'term-1',
    subject_id: 'sub-ls-eng',
    class_id: 'c-y7',
    exam_name: 'CAT 1',
    exam_type: 'CAT 1',
    max_score: 100,
    exam_date: '2026-10-07',
    editing_deadline: null,
    status: 'open',
  },
]

YEAR_PLAN.forEach((entry) => {
  entry.subjects.forEach((subjectId, subjectIndex) => {
    // Year 7's Mathematics and English papers are the two built by hand above.
    if (entry.year === 7 && (subjectId === 'sub-ls-mat' || subjectId === 'sub-ls-eng')) return
    const id = examId('', entry.year, subjectId)
    // Year 11's History paper closed at the end of September: the registrar's
    // deadline has passed, so it is read-only until the grant is given.
    const locked = entry.year === 11 && subjectId === 'sub-his'
    currentExams.push({
      _id: id,
      term_id: 'term-1',
      subject_id: subjectId,
      class_id: classId(entry.year),
      exam_name: 'CAT 1',
      exam_type: 'CAT 1',
      max_score: 100,
      exam_date: `2026-09-${String(14 + (subjectIndex % 12)).padStart(2, '0')}`,
      editing_deadline: locked ? '2026-09-30T16:00' : null,
      status: locked ? 'locked' : 'open',
    })
  })
})

/** A closed term of results, so term-on-term analytics compares against history. */
const priorExams: Exam[] = YEAR_PLAN.flatMap((entry) =>
  entry.subjects.map((subjectId, subjectIndex) => ({
    _id: examId('t3-', entry.year, subjectId),
    term_id: 'term-0',
    subject_id: subjectId,
    class_id: classId(entry.year),
    exam_name: 'Endterm',
    exam_type: 'Endterm',
    max_score: 100,
    exam_date: `2026-05-${String(11 + subjectIndex).padStart(2, '0')}`,
    editing_deadline: null,
    status: 'published' as const,
  })),
)

const exams: Exam[] = [...currentExams, ...priorExams]

const marks: Mark[] = []

/** Current term: a class-average band, one learner below the pass mark, a few absences. */
currentExams.forEach((exam, examIndex) => {
  const roster = students.filter((student) => student.class_id === exam.class_id)
  roster.forEach((student, seat) => {
    const n = (seat * 13 + examIndex * 7) % 11
    // Two learners per class sit below the 40% pass mark, so every year group
    // has a genuine intervention case rather than an empty at-risk card.
    const struggling = seat === 2 || seat === 9
    const score: Mark['score'] = struggling
      ? 24 + ((seat * 7 + examIndex * 5) % 14)
      : n === 0
        ? 'X'
        : n === 10
          ? 'Y'
          : 42 + ((seat * 17 + examIndex * 11) % 55)
    marks.push({
      _id: `m-${examIndex}-${seat}`,
      exam_id: exam._id,
      student_id: student._id,
      score,
      remarks: '',
      updated_at: '2026-10-12T09:00:00.000Z',
      entered_by: 'Grace Wanjiru',
    })
  })
})

// Deliberately weaker than the current term, so the analytics page has a real
// improvement to report. A few marks were never captured, as in a real term.
priorExams.forEach((exam, examIndex) => {
  const roster = students.filter((student) => student.class_id === exam.class_id)
  roster.forEach((student, seat) => {
    if ((seat + examIndex) % 13 === 0) return
    marks.push({
      _id: `m-t3-${examIndex}-${seat}`,
      exam_id: exam._id,
      student_id: student._id,
      score: 44 + ((seat * 17 + examIndex * 9) % 31),
      remarks: '',
      updated_at: '2026-05-20T09:00:00.000Z',
      entered_by: 'Grace Wanjiru',
    })
  })
})

const gradingScales: GradingScale[] = [
  {
    _id: 'gs-default',
    school_id: SCHOOL_ID,
    name: 'IUPC Institutional Scale',
    pass_mark: 40,
    created_at: '2026-09-01T08:00:00.000Z',
    bands: [
      { grade: 'A*', min_score: 90, points: 9, remark: 'Excellent' },
      { grade: 'A', min_score: 80, points: 8, remark: 'Very Good' },
      { grade: 'B', min_score: 70, points: 7, remark: 'Good' },
      { grade: 'C', min_score: 60, points: 6, remark: 'Average' },
      { grade: 'D', min_score: 50, points: 5, remark: 'Below Average' },
      { grade: 'E', min_score: 40, points: 4, remark: 'Needs to Improve' },
      { grade: 'F', min_score: 30, points: 3, remark: 'Weak' },
      { grade: 'G', min_score: 20, points: 2, remark: 'Very Weak' },
      { grade: 'U', min_score: 0, points: 1, remark: 'Ungraded' },
    ],
  },
]

const reportCards: ReportCard[] = [
  {
    _id: 'rc-1',
    student_id: 's-1',
    term_id: 'term-1',
    attendance_present: 58,
    attendance_total: 60,
    class_teacher: 'Grace Wanjiru',
    academic: 'Consistent and thoughtful across the sciences; keep working on exam timing in Mathematics.',
    activities: 'Debate club, inter-house athletics.',
    conduct: 'Courteous and dependable.',
    principal: 'A promising term. Maintain this trajectory into the end-term examinations.',
    hse: 'Well rested and in good health throughout the term.',
    next_term_begins: '2027-01-06',
    next_term_ends: '2027-04-02',
    updated_at: '2026-10-15T10:00:00.000Z',
  },
]

const notes: Note[] = [
  { _id: 'n-1', student_id: 's-1', body: 'Guardian asked for a copy of the term calendar at the parents meeting.', author_name: 'Grace Wanjiru', created_at: '2026-10-14T11:20:00.000Z' },
]

const PERIOD_DAYS = [1, 2, 3, 4, 5]
const timetableSlots: TimetableSlot[] = []
/** Teachers already in a room at `${day}|${period}|${teacherId}`. */
const busy = new Set<string>()
YEAR_PLAN.forEach((entry, classIndex) => {
  const cls = classes[classIndex]
  PERIOD_DAYS.forEach((day) => {
    for (let period = 1; period <= 8; period++) {
      const fill = (day * 31 + period * 17 + classIndex * 13) % 100
      if (fill < 18) continue // scattered free periods, never a whole empty day
      // Walk the year's subjects from its rotation point and take the first one
      // whose teacher is still free in this period. Eight staff cannot stand in
      // seven rooms at once, so the class takes the next syllabus rather than
      // booking the same person twice — an accidental clash is a broken
      // timetable, and the board should only ever flag the seeded one.
      const choice = entry.subjects
        .map((_, offset) => entry.subjects[(classIndex * 3 + day + period + offset) % entry.subjects.length])
        .map((subjectId) => ({
          subjectId,
          teacher: teachers.find(
            (t) => t.assigned_subject_ids.includes(subjectId) && !busy.has(`${day}|${period}|${t._id}`),
          ),
        }))
        .find((entryChoice) => entryChoice.teacher)
      if (!choice?.teacher) continue // no spare teacher: the period stays free
      busy.add(`${day}|${period}|${choice.teacher._id}`)
      timetableSlots.push({
        _id: `ts-${classIndex}-${day}-${period}`,
        school_id: SCHOOL_ID,
        term_id: 'term-1',
        class_id: cls._id,
        day,
        period,
        subject_id: choice.subjectId,
        teacher_id: choice.teacher._id,
        room: `Y${entry.year}-${String(period).padStart(2, '0')}`,
        week: null,
      })
    }
  })
})

// One deliberate double-booking so clash detection is visible on first load. It
// is planted afterwards, in a period where Grace is otherwise free, so the board
// flags exactly one clash and every other lesson stays staffed.
function seedClash(): void {
  const seven = timetableSlots.filter((slot) => slot.class_id === classId(7))
  const eight = timetableSlots.filter((slot) => slot.class_id === classId(8))
  for (const first of seven) {
    const second = eight.find((slot) => slot.day === first.day && slot.period === first.period)
    if (!second) continue
    const taken = timetableSlots.some(
      (slot) =>
        slot !== first &&
        slot !== second &&
        slot.day === first.day &&
        slot.period === first.period &&
        slot.teacher_id === 't-1',
    )
    if (taken) continue
    for (const slot of [first, second]) {
      slot.subject_id = 'sub-ls-mat'
      slot.teacher_id = 't-1'
    }
    return
  }
}
seedClash()

const bellSchedules: BellSchedule[] = [
  { _id: 'bell-iupc', school_id: SCHOOL_ID, entries: DEFAULT_BELL, updated_at: '2026-09-01T00:00:00.000Z' },
]

// No school-wide deadline by default: papers without their own stay open, and
// the registrar sets the term's closing time from Settings when marks are due.
const markWindows: MarkWindow[] = [
  { _id: 'mw-iupc', school_id: SCHOOL_ID, closes_at: null, updated_at: '2026-09-01T00:00:00.000Z' },
]

export const seedDatabase = (): Database => ({
  schools: [school],
  classes,
  teachers,
  subjects,
  students,
  terms,
  exams,
  marks,
  gradingScales,
  reportCards,
  notes,
  timetableSlots,
  bellSchedules,
  markWindows,
})
