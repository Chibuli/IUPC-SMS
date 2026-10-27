import { useSyncExternalStore } from 'react'
import { SCHOOL_ID, seedDatabase } from './seed'
import { initialsOf } from '../lib/format'
import { normalisePermissions } from '../lib/permissions'
import type {
  BellSchedule,
  ClassRow,
  Database,
  Exam,
  GradingScale,
  Mark,
  Note,
  ReportCard,
  Student,
  Subject,
  SubjectLevel,
  Teacher,
  TeacherPermissionKey,
  Term,
  TimetableSlot,
} from './types'

const DB_KEY = 'iupc.db.v1'
const LEGACY_DB_KEY = 'meridian.db.v1'
const SEED_VERSION_KEY = 'iupc.seedVersion'
/**
 * Bumped when the demo dataset changes shape in a way every browser must pick
 * up. Version 3 is the Years 7–13 campus: new classes, a new roll, new papers
 * and marks. Rows from an older shape cannot be merged into it, so a stale
 * browser rebuilds the demo tables from the seed and keeps only catalogue
 * additions the registrar made by hand (which stand alone).
 */
const SEED_VERSION = 3

const TABLES: (keyof Database)[] = [
  'schools',
  'classes',
  'teachers',
  'subjects',
  'students',
  'terms',
  'exams',
  'marks',
  'gradingScales',
  'reportCards',
  'notes',
  'timetableSlots',
  'bellSchedules',
  'markWindows',
]

/** A subject row as it may sit in storage from before the catalogue existed. */
type StoredSubject = Omit<Subject, 'level' | 'offered'> & { level?: SubjectLevel; offered?: boolean }

function parse(raw: string | null): Database | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<Database>
    if (!value || typeof value !== 'object') return null
    return value as Database
  } catch {
    return null
  }
}

/** Seed + whatever survives in storage, with new tables back-filled. */
function load(): Database {
  const base = seedDatabase()
  let stored: Database | null = null
  let migrated = false
  try {
    stored = parse(localStorage.getItem(DB_KEY))
    if (!stored) {
      stored = parse(localStorage.getItem(LEGACY_DB_KEY))
      migrated = Boolean(stored)
    }
  } catch {
    stored = null // storage unavailable or blocked — fall back to seed
  }
  if (!stored) {
    try {
      localStorage.setItem(SEED_VERSION_KEY, String(SEED_VERSION))
    } catch {
      /* storage unavailable — the in-memory seed still applies */
    }
    return base
  }

  const merged: Database = { ...base }
  for (const table of TABLES) {
    const rows = stored[table]
    merged[table] = Array.isArray(rows) ? (rows as never) : (base[table] as never)
  }

  // Staff recorded before permissions existed inherit the seed's grants for the
  // same person and are read-only otherwise — a permission is never implied.
  const seededPermissions = new Map(base.teachers.map((teacher) => [teacher._id, teacher.permissions]))
  merged.teachers = merged.teachers.map((teacher) => ({
    ...teacher,
    permissions: normalisePermissions(teacher.permissions ?? seededPermissions.get(teacher._id) ?? []),
  }))

  // Subjects stored before the Cambridge catalogue: the seed's rows take over by
  // id — so every paper and lesson picks up the real syllabus code — while
  // anything the registrar added survives as a school subject they do teach.
  const seedSubjectIds = new Set(base.subjects.map((subject) => subject._id))
  const storedSubjects = merged.subjects as StoredSubject[]
  if (storedSubjects.some((subject) => typeof subject.level !== 'string')) {
    const custom: Subject[] = storedSubjects
      .filter((subject) => !seedSubjectIds.has(subject._id))
      .map((subject) => ({ ...subject, level: subject.level ?? 'Custom', offered: true }))
    merged.subjects = [...base.subjects, ...custom]
  } else {
    merged.subjects = storedSubjects.map((subject) => ({
      ...subject,
      level: subject.level ?? 'Custom',
      offered: subject.offered ?? true,
    }))
  }

  let seedVersion = SEED_VERSION
  try {
    seedVersion = Number(localStorage.getItem(SEED_VERSION_KEY) ?? '1')
  } catch {
    seedVersion = SEED_VERSION
  }
  const stale = seedVersion < SEED_VERSION
  if (stale) {
    // A different campus shape: Year 7–13 classes, a new roll, new papers and
    // marks. Nothing from the old demo can be carried across without orphans
    // (students in classes that no longer exist), so the demo is rebuilt. Any
    // subject the registrar added to the catalogue survives: it references no
    // class, paper or learner.
    const added = (stored.subjects as StoredSubject[])
      .filter((subject) => !base.subjects.some((seeded) => seeded._id === subject._id))
      .map((subject) => ({ ...subject, level: subject.level ?? 'Custom', offered: subject.offered ?? true }))
    const rebuilt: Database = { ...base, subjects: [...base.subjects, ...added] }
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(rebuilt))
      localStorage.setItem(SEED_VERSION_KEY, String(SEED_VERSION))
    } catch {
      /* storage unavailable — the in-memory seed still applies */
    }
    return rebuilt
  }

  if (migrated) {
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(merged))
      localStorage.setItem(SEED_VERSION_KEY, String(SEED_VERSION))
    } catch {
      /* ignore quota errors */
    }
  }
  return merged
}

let db: Database = load()
const listeners = new Set<() => void>()

function persist() {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db))
  } catch {
    /* a very large logo library can exceed quota — keep working in memory */
  }
}

function commit(next: Database) {
  db = next
  persist()
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const snapshot = () => db

export function useDb(): Database {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

export const getDb = snapshot

export const uid = (prefix = 'loc') =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

const now = () => new Date().toISOString()

/** Raw tree edit. Used by term, subject and grading operations. */
export function mutate(fn: (draft: Database) => void) {
  const draft: Database = structuredClone(db)
  fn(draft)
  commit(draft)
}

export function resetDatabase() {
  commit(seedDatabase())
}

export interface NewExam {
  term_id: string
  subject_id: string
  class_id: string
  exam_name: string
  exam_type: string
  max_score: number
  exam_date: string
}

/** The four choices that identify one paper — what the Marks Entry bar picks. */
export interface PaperKey {
  term_id: string
  class_id: string
  subject_id: string
  exam_type: string
}

/** Find the paper a selection names, if it has been recorded yet. */
export function findPaper(db: Database, key: PaperKey): Exam | undefined {
  return db.exams.find(
    (exam) =>
      exam.term_id === key.term_id &&
      exam.class_id === key.class_id &&
      exam.subject_id === key.subject_id &&
      exam.exam_type === key.exam_type,
  )
}

export type SlotInput = Omit<TimetableSlot, '_id' | 'school_id'> & { _id?: string }

export interface NewTeacher {
  full_name: string
  email: string
  employee_id: string
  assigned_subject_ids: string[]
  /** Omitted = read-only, which is how every new account starts. */
  permissions?: TeacherPermissionKey[]
}

/**
 * Convex-shaped seam: every mutation is async and returns the affected row or { ok: true }.
 * Swapping this object for Convex client calls is the only change needed for a live backend.
 */
export const api = {
  marks: {
    async setScore(examId: string, studentId: string, score: number | 'X' | 'Y' | null): Promise<Mark> {
      let result: Mark | undefined
      mutate((draft) => {
        const existing = draft.marks.find((m) => m.exam_id === examId && m.student_id === studentId)
        if (existing) {
          existing.score = score
          existing.updated_at = now()
          result = existing
        } else {
          const created: Mark = {
            _id: uid('m'),
            exam_id: examId,
            student_id: studentId,
            score,
            remarks: '',
            updated_at: now(),
            entered_by: 'IUPC staff',
          }
          draft.marks.push(created)
          result = created
        }
      })
      return result as Mark
    },
    async setRemarks(examId: string, studentId: string, remarks: string) {
      mutate((draft) => {
        const existing = draft.marks.find((m) => m.exam_id === examId && m.student_id === studentId)
        if (existing) existing.remarks = remarks
      })
      return { ok: true as const }
    },
  },

  /**
   * Papers are identified by what a teacher picks on the Marks Entry page —
   * term, class, subject and paper type — so there is nothing to create up
   * front. `ensure` returns the paper that already matches, or records it the
   * first time a result is keyed in, which is the only moment a paper exists.
   */
  exams: {
    async ensure(input: NewExam): Promise<Exam> {
      const existing = findPaper(db, input)
      if (existing) return existing
      const exam: Exam = {
        _id: uid('ex'),
        status: 'open',
        editing_deadline: null,
        ...input,
      }
      mutate((draft) => {
        draft.exams.push(exam)
      })
      return exam
    },
    /** The total a paper is marked out of — percentages are read from it. */
    async setMaxScore(examId: string, maxScore: number) {
      mutate((draft) => {
        const exam = draft.exams.find((e) => e._id === examId)
        if (exam && maxScore > 0) exam.max_score = maxScore
      })
      return { ok: true as const }
    },
  },

  /** The bell schedule is one row per school: the timetable page edits it. */
  bell: {
    async save(schedule: BellSchedule) {
      mutate((draft) => {
        const index = draft.bellSchedules.findIndex((row) => row._id === schedule._id)
        const next: BellSchedule = { ...schedule, updated_at: now() }
        if (index >= 0) draft.bellSchedules[index] = next
        else draft.bellSchedules.push(next)
      })
      return { ok: true as const }
    },
  },

  timetable: {
    async save(input: SlotInput): Promise<TimetableSlot> {
      let result: TimetableSlot | undefined
      mutate((draft) => {
        if (input._id) {
          const index = draft.timetableSlots.findIndex((s) => s._id === input._id)
          if (index >= 0) {
            draft.timetableSlots[index] = { ...draft.timetableSlots[index], ...input, _id: input._id }
            result = draft.timetableSlots[index]
            return
          }
        }
        const created: TimetableSlot = { ...input, _id: uid('ts'), school_id: SCHOOL_ID }
        draft.timetableSlots.push(created)
        result = created
      })
      return result as TimetableSlot
    },
    async remove(slotId: string) {
      mutate((draft) => {
        draft.timetableSlots = draft.timetableSlots.filter((s) => s._id !== slotId)
      })
      return { ok: true as const }
    },
    /**
     * One storage write for a drag: a move is a single cell, a swap is two, and
     * both must land together so the board never shows a half-applied drop.
     */
    async move(updates: { _id: string; class_id: string; day: number; period: number }[]) {
      mutate((draft) => {
        for (const update of updates) {
          const slot = draft.timetableSlots.find((s) => s._id === update._id)
          if (!slot) continue
          slot.class_id = update.class_id
          slot.day = update.day
          slot.period = update.period
        }
      })
      return { ok: true as const }
    },
  },

  notes: {
    async create(studentId: string, body: string, authorName: string): Promise<Note> {
      const note: Note = { _id: uid('n'), student_id: studentId, body, author_name: authorName, created_at: now() }
      mutate((draft) => {
        draft.notes.push(note)
      })
      return note
    },
    async remove(noteId: string) {
      mutate((draft) => {
        draft.notes = draft.notes.filter((n) => n._id !== noteId)
      })
      return { ok: true as const }
    },
  },

  reportCards: {
    async upsert(studentId: string, termId: string, patch: Partial<ReportCard>): Promise<ReportCard> {
      let result: ReportCard | undefined
      mutate((draft) => {
        const existing = draft.reportCards.find((r) => r.student_id === studentId && r.term_id === termId)
        if (existing) {
          Object.assign(existing, patch, { updated_at: now() })
          result = existing
        } else {
          const created: ReportCard = {
            _id: uid('rc'),
            student_id: studentId,
            term_id: termId,
            attendance_present: 0,
            attendance_total: 0,
            class_teacher: '',
            academic: '',
            activities: '',
            conduct: '',
            principal: '',
            hse: '',
            next_term_begins: '',
            next_term_ends: '',
            updated_at: now(),
            ...patch,
          }
          draft.reportCards.push(created)
          result = created
        }
      })
      return result as ReportCard
    },
  },

  subjects: {
    async create(name: string, code: string, category: string, level: SubjectLevel): Promise<Subject> {
      const subject: Subject = { _id: uid('sub'), school_id: SCHOOL_ID, name, code, category, level, offered: true }
      mutate((draft) => {
        draft.subjects.push(subject)
      })
      return subject
    },
    /** Adds a catalogue subject to what the campus teaches, or withdraws it. */
    async setOffered(subjectId: string, offered: boolean) {
      mutate((draft) => {
        const subject = draft.subjects.find((s) => s._id === subjectId)
        if (subject) subject.offered = offered
      })
      return { ok: true as const }
    },
    async remove(subjectId: string) {
      mutate((draft) => {
        draft.subjects = draft.subjects.filter((s) => s._id !== subjectId)
      })
      return { ok: true as const }
    },
  },

  terms: {
    async create(name: string, academicYear: string, startDate: string): Promise<Term> {
      const term: Term = { _id: uid('term'), school_id: SCHOOL_ID, name, academic_year: academicYear, is_active: false, start_date: startDate }
      mutate((draft) => {
        draft.terms.push(term)
      })
      return term
    },
    async activate(termId: string) {
      mutate((draft) => {
        draft.terms.forEach((t) => {
          t.is_active = t._id === termId
        })
      })
      return { ok: true as const }
    },
  },

  students: {
    async create(input: Omit<Student, '_id' | 'school_id'>): Promise<Student> {
      const student: Student = { ...input, _id: uid('s'), school_id: SCHOOL_ID }
      mutate((draft) => {
        draft.students.push(student)
      })
      return student
    },
    async update(studentId: string, patch: Partial<Student>) {
      mutate((draft) => {
        const student = draft.students.find((s) => s._id === studentId)
        if (student) Object.assign(student, patch)
      })
      return { ok: true as const }
    },
  },

  teachers: {
    async create(input: NewTeacher): Promise<Teacher> {
      const teacher: Teacher = {
        _id: uid('t'),
        school_id: SCHOOL_ID,
        full_name: input.full_name.trim(),
        email: input.email.trim().toLowerCase(),
        employee_id: input.employee_id.trim(),
        assigned_subject_ids: [...input.assigned_subject_ids],
        permissions: normalisePermissions(input.permissions ?? []),
        initials: initialsOf(input.full_name),
      }
      mutate((draft) => {
        draft.teachers.push(teacher)
      })
      return teacher
    },
    async update(teacherId: string, patch: Partial<NewTeacher>) {
      mutate((draft) => {
        const teacher = draft.teachers.find((t) => t._id === teacherId)
        if (!teacher) return
        if (patch.full_name !== undefined) {
          teacher.full_name = patch.full_name.trim()
          teacher.initials = initialsOf(teacher.full_name)
        }
        if (patch.email !== undefined) teacher.email = patch.email.trim().toLowerCase()
        if (patch.employee_id !== undefined) teacher.employee_id = patch.employee_id.trim()
        if (patch.assigned_subject_ids) teacher.assigned_subject_ids = [...patch.assigned_subject_ids]
        if (patch.permissions) teacher.permissions = normalisePermissions(patch.permissions)
      })
      return { ok: true as const }
    },
    async toggleSubject(teacherId: string, subjectId: string) {
      mutate((draft) => {
        const teacher = draft.teachers.find((t) => t._id === teacherId)
        if (!teacher) return
        teacher.assigned_subject_ids = teacher.assigned_subject_ids.includes(subjectId)
          ? teacher.assigned_subject_ids.filter((id) => id !== subjectId)
          : [...teacher.assigned_subject_ids, subjectId]
      })
      return { ok: true as const }
    },
    /** Replaces the whole permission set — the panel toggles one key at a time. */
    async setPermissions(teacherId: string, keys: TeacherPermissionKey[]) {
      mutate((draft) => {
        const teacher = draft.teachers.find((t) => t._id === teacherId)
        if (teacher) teacher.permissions = normalisePermissions(keys)
      })
      return { ok: true as const }
    },
    async togglePermission(teacherId: string, key: TeacherPermissionKey) {
      mutate((draft) => {
        const teacher = draft.teachers.find((t) => t._id === teacherId)
        if (!teacher) return
        const next = teacher.permissions.includes(key)
          ? teacher.permissions.filter((entry) => entry !== key)
          : [...teacher.permissions, key]
        teacher.permissions = normalisePermissions(next)
      })
      return { ok: true as const }
    },
    /** Refused while the staff member still holds lessons on the timetable. */
    async remove(teacherId: string) {
      const lessons = db.timetableSlots.filter((slot) => slot.teacher_id === teacherId).length
      if (lessons > 0) {
        return {
          ok: false as const,
          reason: `${lessons} timetable lesson${lessons === 1 ? '' : 's'} are still assigned to this teacher. Reassign them before removing the record.`,
        }
      }
      mutate((draft) => {
        draft.teachers = draft.teachers.filter((t) => t._id !== teacherId)
      })
      return { ok: true as const }
    },
  },

  /** One row per school: the registrar's deadline for papers without their own. */
  markWindow: {
    async save(closesAt: string | null) {
      mutate((draft) => {
        const existing = draft.markWindows[0]
        if (existing) {
          existing.closes_at = closesAt
          existing.updated_at = now()
          return
        }
        draft.markWindows.push({
          _id: uid('mw'),
          school_id: SCHOOL_ID,
          closes_at: closesAt,
          updated_at: now(),
        })
      })
      return { ok: true as const }
    },
  },

  classes: {
    async create(classRow: Omit<ClassRow, '_id' | 'school_id'>): Promise<ClassRow> {
      const created: ClassRow = { ...classRow, _id: uid('c'), school_id: SCHOOL_ID }
      mutate((draft) => {
        draft.classes.push(created)
      })
      return created
    },
  },

  gradingScales: {
    async save(scale: GradingScale) {
      mutate((draft) => {
        const index = draft.gradingScales.findIndex((s) => s._id === scale._id)
        if (index >= 0) draft.gradingScales[index] = scale
        else draft.gradingScales.push(scale)
      })
      return { ok: true as const }
    },
  },
}
