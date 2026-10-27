import type { BellEntry, BellSchedule, TimetableSlot } from '../data/types'

export const DAYS = [
  { value: 1, long: 'Monday', short: 'Mon' },
  { value: 2, long: 'Tuesday', short: 'Tue' },
  { value: 3, long: 'Wednesday', short: 'Wed' },
  { value: 4, long: 'Thursday', short: 'Thu' },
  { value: 5, long: 'Friday', short: 'Fri' },
] as const

export const TERM_WEEKS = 12

/**
 * The day every school starts with: eight 40-minute periods, a 20-minute break
 * and an hour for lunch. It is only a default — the schedule itself is stored
 * per school and edited from the timetable page.
 */
export const DEFAULT_BELL: BellEntry[] = [
  { id: 'bell-1', kind: 'lesson', label: '', start: '08:00', end: '08:40' },
  { id: 'bell-2', kind: 'lesson', label: '', start: '08:40', end: '09:20' },
  { id: 'bell-3', kind: 'lesson', label: '', start: '09:20', end: '10:00' },
  { id: 'bell-break', kind: 'break', label: 'Break', start: '10:00', end: '10:20' },
  { id: 'bell-4', kind: 'lesson', label: '', start: '10:20', end: '11:00' },
  { id: 'bell-5', kind: 'lesson', label: '', start: '11:00', end: '11:40' },
  { id: 'bell-6', kind: 'lesson', label: '', start: '11:40', end: '12:20' },
  { id: 'bell-lunch', kind: 'break', label: 'Lunch', start: '12:20', end: '13:20' },
  { id: 'bell-7', kind: 'lesson', label: '', start: '13:20', end: '14:00' },
  { id: 'bell-8', kind: 'lesson', label: '', start: '14:00', end: '14:40' },
]

/** A teaching period as the boards and sheets need it: number plus clock times. */
export interface Period {
  n: number
  start: string
  end: string
}

export type GridColumn =
  | { kind: 'period'; period: Period }
  | { kind: 'pause'; label: string; start: string; end: string }

/** A stored schedule may be missing or empty in an old browser: use the default. */
export function bellEntries(schedule?: BellSchedule | null): BellEntry[] {
  return schedule?.entries?.length ? schedule.entries : DEFAULT_BELL
}

/** Periods in order. A period's number is its position among the lesson rows. */
export function periodsOf(entries: BellEntry[]): Period[] {
  const periods: Period[] = []
  for (const entry of entries) {
    if (entry.kind === 'lesson') periods.push({ n: periods.length + 1, start: entry.start, end: entry.end })
  }
  return periods
}

/** Periods with the breaks interleaved exactly where the school put them. */
export function columnsOf(entries: BellEntry[]): GridColumn[] {
  let n = 0
  return entries.map((entry): GridColumn => {
    if (entry.kind === 'break') {
      return { kind: 'pause', label: entry.label || 'Break', start: entry.start, end: entry.end }
    }
    n += 1
    return { kind: 'period', period: { n, start: entry.start, end: entry.end } }
  })
}

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/

/** `08:40` → 520. `NaN` for anything that is not a 24-hour clock time. */
export function toMinutes(value: string): number {
  const match = CLOCK.exec(value.trim())
  if (!match) return Number.NaN
  return Number(match[1]) * 60 + Number(match[2])
}

export function fromMinutes(minutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)))
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`
}

/** `08:00` + 40 → `08:40`, clamped to the end of the day. */
export function addMinutes(value: string, delta: number): string {
  const start = toMinutes(value)
  return fromMinutes((Number.isNaN(start) ? 0 : start) + delta)
}

function lessonNumberBefore(entries: BellEntry[], index: number): number {
  return entries.slice(0, index + 1).filter((entry) => entry.kind === 'lesson').length
}

/** The first thing wrong with a draft day, or `null` when it is sound. */
export function bellProblem(entries: BellEntry[]): string | null {
  const lessons = entries.filter((entry) => entry.kind === 'lesson').length
  if (lessons === 0) return 'Keep at least one teaching period.'
  if (lessons > 14) return 'A day holds at most fourteen teaching periods.'
  if (entries.filter((entry) => entry.kind === 'break').length > 6) return 'A day holds at most six breaks.'

  let previousEnd = -1
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    const start = toMinutes(entry.start)
    const end = toMinutes(entry.end)
    if (Number.isNaN(start) || Number.isNaN(end)) return `Row ${index + 1} needs a start and an end time.`
    if (end <= start) {
      return entry.kind === 'break'
        ? `${entry.label || 'That break'} has to end after it starts.`
        : `Period ${lessonNumberBefore(entries, index)} has to end after it starts.`
    }
    if (start < previousEnd) return 'Rows have to run in order and may not overlap.'
    previousEnd = end
  }
  return null
}

/** `Form 2` + `A` → `F2A`: the compact stream badge a printed cell can hold. */
export function shortClass(className: string, streamName: string): string {
  const digits = className.replace(/[^0-9]/g, '')
  const prefix = className.trim().charAt(0).toUpperCase()
  return (digits ? `${prefix}${digits}${streamName}` : `${className}${streamName}`).toUpperCase()
}

/** First Monday on or after 1 September of the academic year. */
export function termAnchor(academicYear: string, fallbackStart: string): Date {
  const year = Number(academicYear.split('/')[0])
  if (Number.isNaN(year)) return mondayOnOrAfter(new Date(fallbackStart))
  return mondayOnOrAfter(new Date(year, 8, 1))
}

export function mondayOnOrAfter(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const day = d.getDay() // 0 = Sunday
  const delta = day === 1 ? 0 : day === 0 ? 1 : 8 - day
  d.setDate(d.getDate() + delta)
  return d
}

export function weekStart(academicYear: string, fallbackStart: string, week: number): Date {
  const anchor = termAnchor(academicYear, fallbackStart)
  const d = new Date(anchor)
  d.setDate(anchor.getDate() + (week - 1) * 7)
  return d
}

export function weekDates(academicYear: string, fallbackStart: string, week: number) {
  const start = weekStart(academicYear, fallbackStart, week)
  return DAYS.map((day, index) => {
    const d = new Date(start)
    d.setDate(start.getDate() + index)
    return {
      day: day.value,
      short: day.short,
      long: day.long,
      date: d,
      label: `${String(d.getDate()).padStart(2, '0')} ${d.toLocaleString('en-GB', { month: 'short' })}`,
    }
  })
}

export function weekRange(academicYear: string, fallbackStart: string, week: number): string {
  const dates = weekDates(academicYear, fallbackStart, week)
  return `${dates[0].label} – ${dates[4].label}`
}

/** Slots are weekly by default; `week` narrows one to a single teaching week. */
export function slotApplies(slot: TimetableSlot, week: number): boolean {
  return slot.week === null || slot.week === week
}

export interface ClashInfo {
  classes: string[]
}

/**
 * A clash is one teacher booked into two streams at the same day/period.
 * Returned as a map keyed by slot id so the board and the print sheet agree.
 */
export function buildConflicts(
  slots: TimetableSlot[],
  classLabel: (id: string) => string,
): Map<string, ClashInfo> {
  const groups = new Map<string, TimetableSlot[]>()
  for (const slot of slots) {
    const key = `${slot.day}-${slot.period}-${slot.teacher_id}`
    const group = groups.get(key)
    if (group) group.push(slot)
    else groups.set(key, [slot])
  }

  const conflicts = new Map<string, ClashInfo>()
  for (const group of groups.values()) {
    for (const slot of group) {
      const others = group.filter(
        (other) =>
          other._id !== slot._id &&
          other.class_id !== slot.class_id &&
          (slot.week === null || other.week === null || slot.week === other.week),
      )
      if (!others.length) continue
      const classes = [...new Set(others.map((other) => classLabel(other.class_id)))]
      const existing = conflicts.get(slot._id)
      conflicts.set(slot._id, {
        classes: existing ? [...new Set([...existing.classes, ...classes])] : classes,
      })
    }
  }
  return conflicts
}

export function lessonsInWeek(
  slots: TimetableSlot[],
  week: number,
  predicate: (slot: TimetableSlot) => boolean,
): TimetableSlot[] {
  return slots.filter((slot) => slotApplies(slot, week) && predicate(slot))
}

export function periodLabel(period: number, periods: Period[]): string {
  const found = periods.find((p) => p.n === period)
  return found ? `${found.start}–${found.end}` : `Period ${period}`
}

/** `MA-4024` → `MA`: the master grid prints codes, so they must stay short. */
export function shortCode(code: string): string {
  return code.split('-')[0].trim()
}

/**
 * One stable accent per subject so a stream's week is legible at a glance on the
 * master grid: the same paper keeps the same colour in every cell.
 */
export const SUBJECT_TONES = [
  '#8f1f2e',
  '#a06a22',
  '#2f5f52',
  '#2e4a5f',
  '#5f3f6b',
  '#7a4a2a',
  '#3b6b86',
  '#6b5a24',
  '#4a6b3e',
  '#6b3654',
  '#7a4636',
  '#3d5470',
]

export function toneFor(subjectId: string, subjects: { _id: string }[]): string {
  const index = subjects.findIndex((subject) => subject._id === subjectId)
  return SUBJECT_TONES[(index < 0 ? 0 : index) % SUBJECT_TONES.length]
}

export interface SlotPosition {
  class_id: string
  day: number
  period: number
}

export interface MoveUpdate extends SlotPosition {
  _id: string
}

export interface MovePlan {
  ok: boolean
  /** Same cell — nothing to write, nothing to complain about. */
  noop?: boolean
  message?: string
  updates: MoveUpdate[]
  /** Slot that trades places with the dragged one. */
  swappedWith?: string
  /** Streams left sharing this teacher at the new time. */
  clashes: string[]
}

const positionOf = (slot: TimetableSlot) => `${slot.class_id}|${slot.day}|${slot.period}`

/**
 * Work out what a drop means before touching storage: a plain move into a free
 * cell, a swap when the cell is taken, or a refusal. A teacher double-booking is
 * allowed (the board flags it) because staffing is a judgement call; two lessons
 * in one stream's period is not, so that becomes a swap instead of an overwrite.
 */
export function planMove(
  slots: TimetableSlot[],
  slotId: string,
  to: SlotPosition,
  classLabel: (id: string) => string,
): MovePlan {
  const source = slots.find((slot) => slot._id === slotId)
  if (!source) return { ok: false, message: 'That lesson is no longer on the board.', updates: [], clashes: [] }

  if (positionOf(source) === positionOf({ ...source, ...to })) {
    return { ok: true, noop: true, updates: [], clashes: [] }
  }

  const occupant = slots.find((slot) => slot._id !== slotId && positionOf(slot) === positionOf({ ...source, ...to }))
  const leaving = new Set([slotId, occupant?._id].filter(Boolean) as string[])

  const updates: MoveUpdate[] = [
    { _id: source._id, class_id: to.class_id, day: to.day, period: to.period },
  ]
  if (occupant) {
    updates.push({ _id: occupant._id, class_id: source.class_id, day: source.day, period: source.period })
  }

  const clashes = new Set<string>()
  const teacherClashes = (teacherId: string, day: number, period: number) =>
    slots.filter(
      (slot) =>
        !leaving.has(slot._id) &&
        slot.teacher_id === teacherId &&
        slot.day === day &&
        slot.period === period,
    )

  for (const slot of teacherClashes(source.teacher_id, to.day, to.period)) {
    clashes.add(classLabel(slot.class_id))
  }
  if (occupant) {
    for (const slot of teacherClashes(occupant.teacher_id, source.day, source.period)) {
      clashes.add(classLabel(slot.class_id))
    }
  }

  return { ok: true, updates, swappedWith: occupant?._id, clashes: [...clashes] }
}
