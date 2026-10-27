export type ID = string

export type Role = 'admin' | 'teacher' | 'guest'

export interface School {
  _id: ID
  name: string
  code: string
  address: string
  postal: string
  city: string
  contact_email: string
  phone_number: string
  /** Full lockup used on mastheads and sign-in. */
  logo_url: string | null
  /** Square emblem used where the lockup would render too small to read. */
  crest_url?: string | null
  motto: string
}

export interface ClassRow {
  _id: ID
  school_id: ID
  class_name: string
  stream_name: string
}

/**
 * What a staff account may do beyond reading. Every teacher starts with none of
 * these: subject access alone is read-only. `assigned_subject_ids` decides
 * *which* records a teacher sees, permissions decide what they may write.
 */
export type TeacherPermissionKey =
  | 'marks.enter'
  | 'marks.after_deadline'
  | 'records.view_all_subjects'

export interface Teacher {
  _id: ID
  school_id: ID
  full_name: string
  email: string
  employee_id: string
  assigned_subject_ids: ID[]
  /** Empty array = read-only account. */
  permissions: TeacherPermissionKey[]
  initials: string
  /**
   * The teacher's own sign-in credential, absent until they complete sign-up.
   * The register alone does not let anyone in: the registrar records the person,
   * the person chooses the password. `password_hash` is null while the account
   * is waiting for that first sign-up.
   */
  password_salt?: string | null
  password_hash?: string | null
  /** When the teacher set their password. Null = awaiting sign-up. */
  activated_at?: string | null
}

/**
 * Which Cambridge syllabus family a subject belongs to. A subject is one entry
 * per level — Mathematics is 0862, 0580, 4024 and 9709 — because each level is a
 * separate syllabus with its own code and grading. `Custom` is a subject this
 * school runs that Cambridge does not examine.
 */
export type SubjectLevel = 'Lower Secondary' | 'IGCSE' | 'O Level' | 'AS & A Level' | 'Custom'

export interface Subject {
  _id: ID
  name: string
  /** Cambridge's own syllabus code (`0580`), not a school invention. */
  code: string
  category: string
  level: SubjectLevel
  /**
   * Whether this campus teaches the subject. The catalogue holds every
   * Cambridge syllabus; only offered subjects appear in the timetable, exams
   * and the staff register's subject picker.
   */
  offered: boolean
  school_id: ID | null
}

export interface Student {
  _id: ID
  school_id: ID
  admission_number: string
  full_name: string
  gender: 'Male' | 'Female'
  date_of_birth: string
  class_id: ID
  guardian_name: string
  guardian_phone: string
  status: 'Active' | 'Alumni'
}

export interface Term {
  _id: ID
  school_id: ID
  name: string
  academic_year: string
  is_active: boolean
  start_date: string
}

export type ExamStatus = 'draft' | 'open' | 'locked' | 'published'

export interface Exam {
  _id: ID
  term_id: ID
  subject_id: ID
  class_id: ID
  exam_name: string
  exam_type: string
  max_score: number
  exam_date: string
  editing_deadline: string | null
  status: ExamStatus
}

export interface Mark {
  _id: ID
  exam_id: ID
  student_id: ID
  score: number | 'X' | 'Y' | null
  remarks: string
  updated_at: string
  entered_by?: string
}

export interface GradeBand {
  grade: string
  min_score: number
  points: number
  remark: string
}

export interface GradingScale {
  _id: ID
  school_id: ID
  name: string
  pass_mark: number
  bands: GradeBand[]
  created_at: string
}

export interface ReportCard {
  _id: ID
  student_id: ID
  term_id: ID
  attendance_present: number
  attendance_total: number
  class_teacher: string
  academic: string
  activities: string
  conduct: string
  principal: string
  hse: string
  next_term_begins: string
  next_term_ends: string
  updated_at: string
}

export interface Note {
  _id: ID
  student_id: ID
  body: string
  author_name: string
  created_at: string
}

/** One row of the school day: a teaching period or a break. */
export interface BellEntry {
  id: string
  kind: 'lesson' | 'break'
  /** Free text for breaks ("Break", "Lunch", "Assembly"); lesson rows ignore it. */
  label: string
  /** `HH:MM`, 24-hour. */
  start: string
  end: string
}

/**
 * The school-wide mark-entry window: the registrar's default deadline for every
 * paper that has no deadline of its own. One row per school.
 */
export interface MarkWindow {
  _id: ID
  school_id: ID
  /** ISO datetime, or null for "papers stay open until a deadline is set". */
  closes_at: string | null
  updated_at: string
}

/**
 * The bell schedule. A period's number is its position among the lesson rows,
 * which is what `TimetableSlot.period` refers to, so editing clock times never
 * moves a lesson and removing a period is refused while that period is in use.
 */
export interface BellSchedule {
  _id: ID
  school_id: ID
  entries: BellEntry[]
  updated_at: string
}

export interface TimetableSlot {
  _id: ID
  school_id: ID
  term_id: ID
  class_id: ID
  day: number // 1 = Monday … 5 = Friday
  period: number // 1 … 8
  subject_id: ID
  teacher_id: ID
  room: string
  week: number | null // null = every week
}

export interface Database {
  schools: School[]
  classes: ClassRow[]
  teachers: Teacher[]
  subjects: Subject[]
  students: Student[]
  terms: Term[]
  exams: Exam[]
  marks: Mark[]
  gradingScales: GradingScale[]
  reportCards: ReportCard[]
  notes: Note[]
  timetableSlots: TimetableSlot[]
  bellSchedules: BellSchedule[]
  markWindows: MarkWindow[]
}

export type DbTable = keyof Database
