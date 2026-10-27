import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, CalendarDays, Clock, GripVertical, Printer, Plus, Trash2, Undo2, X } from 'lucide-react'
import { api, useDb } from '../data/db'
import { useSession } from '../session'
import { Badge, EmptyState, Field, Modal, PageHeader, SchoolLogo } from '../components/ui'
import SchoolBoard, { type BoardDensity } from '../components/SchoolBoard'
import { offeredSubjects } from '../lib/subjects'
import { formatDate } from '../lib/format'
import { usePrintPage } from '../lib/print'
import type { BellEntry, TimetableSlot } from '../data/types'
import {
  DAYS,
  TERM_WEEKS,
  addMinutes,
  bellEntries,
  bellProblem,
  buildConflicts,
  columnsOf,
  periodLabel,
  periodsOf,
  planMove,
  shortClass,
  shortCode,
  slotApplies,
  toMinutes,
  toneFor,
  weekDates,
  weekRange,
  type GridColumn,
  type MoveUpdate,
} from '../lib/timetable'

type Mode = 'school' | 'class' | 'teacher'

const MODES: { value: Mode; label: string }[] = [
  { value: 'school', label: 'Whole school' },
  { value: 'class', label: 'Class' },
  { value: 'teacher', label: 'Teacher' },
]

interface EditorState {
  open: boolean
  id?: string
}

interface Notice {
  tone: 'ok' | 'warn' | 'danger'
  text: string
  undo?: MoveUpdate[]
}

const NOTICE_TONE: Record<Notice['tone'], string> = {
  ok: 'border-ok/35 bg-ok/8 text-ink',
  warn: 'border-warn/40 bg-warn/10 text-ink',
  danger: 'border-danger/35 bg-danger/8 text-ink',
}

const columnKey = (column: GridColumn) => (column.kind === 'period' ? `p${column.period.n}` : `x-${column.label}`)

/** The period number a row holds: the count of lesson rows up to and including it. */
const periodNumberAt = (entries: BellEntry[], index: number) =>
  entries.slice(0, index + 1).filter((entry) => entry.kind === 'lesson').length

export default function Timetable() {
  const db = useDb()
  const { session, teacher } = useSession()
  const isAdmin = session?.role === 'admin'
  const school = db.schools[0]
  const [params] = useSearchParams()

  const requested = params.get('view')
  const [mode, setMode] = useState<Mode>(() => {
    if (requested === 'school' || requested === 'class' || requested === 'teacher') return requested
    return session?.role === 'teacher' ? 'teacher' : 'school'
  })
  usePrintPage(mode === 'school' ? 'master' : 'timetable')

  const activeTerm = db.terms.find((term) => term.is_active) ?? db.terms[0]
  const [termId, setTermId] = useState(activeTerm?._id ?? '')
  const [week, setWeek] = useState(1)
  const [classId, setClassId] = useState(db.classes[0]?._id ?? '')
  const [teacherId, setTeacherId] = useState(session?.teacherId ?? db.teachers[0]?._id ?? '')
  const [density, setDensity] = useState<BoardDensity>('fit')

  const term = db.terms.find((t) => t._id === termId) ?? activeTerm
  const dates = useMemo(() => weekDates(term?.academic_year ?? '2026/2027', term?.start_date ?? '2026-09-07', week), [term, week])

  /* ── the school day ──────────────────────────────────────────────────────
     Periods, their clock times and where the breaks fall all come from the
     stored bell schedule; nothing about the day is hard-coded. */
  const schedule = db.bellSchedules?.[0]
  const bell = useMemo(() => bellEntries(schedule), [schedule])
  const columns = useMemo(() => columnsOf(bell), [bell])
  const periods = useMemo(() => periodsOf(bell), [bell])
  /** Periods that follow a break carry the heavier rule, as on the sheets. */
  const gapBefore = useMemo(() => {
    const gaps = new Set<number>()
    columns.forEach((column, index) => {
      if (column.kind === 'period' && columns[index - 1]?.kind === 'pause') gaps.add(column.period.n)
    })
    return gaps
  }, [columns])

  const classLabel = (id: string) => {
    const cls = db.classes.find((c) => c._id === id)
    return cls ? `${cls.class_name} ${cls.stream_name}` : 'Unknown stream'
  }
  const subjectOf = (id: string) => db.subjects.find((s) => s._id === id)
  const teacherOf = (id: string) => db.teachers.find((t) => t._id === id)
  // The catalogue holds every Cambridge syllabus; only what the campus offers can
  // be timetabled. Colour is keyed to this same list so cells and keys agree.
  const offeredList = useMemo(() => offeredSubjects(db.subjects), [db.subjects])

  const termSlots = db.timetableSlots.filter((slot) => slot.term_id === termId)
  const weekSlots = termSlots.filter((slot) => slotApplies(slot, week))
  const conflicts = useMemo(() => buildConflicts(weekSlots, classLabel), [weekSlots, db.classes])

  // The printed master is one A3 page. A row is 34mm when the school is small,
  // but the roll must still fit: seven year groups share the sheet's 188mm of
  // row budget instead of pushing a sliver onto a second page.
  const masterRowHeight = `${Math.min(34, 188 / Math.max(db.classes.length, 1)).toFixed(2)}mm`

  const schoolView = mode === 'school'
  const visibleSlots = schoolView
    ? weekSlots
    : weekSlots.filter((slot) => (mode === 'class' ? slot.class_id === classId : slot.teacher_id === teacherId))

  const lessonCount = visibleSlots.length
  const clashCount = [...conflicts.keys()].filter((id) => visibleSlots.some((slot) => slot._id === id)).length

  const slotAt = (day: number, period: number): TimetableSlot | undefined =>
    visibleSlots.find((slot) => slot.day === day && slot.period === period)

  /* ── moving lessons ──────────────────────────────────────────────────── */

  const [movingId, setMovingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [flashKey, setFlashKey] = useState<string | null>(null)
  const [gridDragId, setGridDragId] = useState<string | null>(null)
  const gridDragRef = useRef<string | null>(null)
  const flashTimer = useRef<number | undefined>(undefined)

  const movingSlot = movingId ? db.timetableSlots.find((slot) => slot._id === movingId) : undefined

  const flash = (key: string) => {
    window.clearTimeout(flashTimer.current)
    setFlashKey(key)
    flashTimer.current = window.setTimeout(() => setFlashKey(null), 1300)
  }

  useEffect(() => () => window.clearTimeout(flashTimer.current), [])

  useEffect(() => {
    if (!movingId) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMovingId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [movingId])

  useEffect(() => {
    setMovingId(null)
    gridDragRef.current = null
    setGridDragId(null)
  }, [mode, termId, week])

  async function moveSlot(slotId: string, toClassId: string, day: number, period: number) {
    const plan = planMove(weekSlots, slotId, { class_id: toClassId, day, period }, classLabel)
    setMovingId(null)
    gridDragRef.current = null
    setGridDragId(null)
    if (!plan.ok) {
      if (plan.message) setNotice({ tone: 'danger', text: plan.message })
      return
    }
    if (plan.noop) return

    const restore: MoveUpdate[] = plan.updates.map((update) => {
      const slot = db.timetableSlots.find((row) => row._id === update._id)
      return { _id: update._id, class_id: slot?.class_id ?? '', day: slot?.day ?? 1, period: slot?.period ?? 1 }
    })
    const source = db.timetableSlots.find((slot) => slot._id === slotId)
    const partner = plan.swappedWith ? db.timetableSlots.find((slot) => slot._id === plan.swappedWith) : undefined
    const subjectName = subjectOf(source?.subject_id ?? '')?.name ?? 'Lesson'
    const partnerName = subjectOf(partner?.subject_id ?? '')?.name ?? 'that lesson'
    const where = `${classLabel(toClassId)} · ${DAYS.find((d) => d.value === day)?.short} P${period}`

    await api.timetable.move(plan.updates)

    const base = plan.swappedWith
      ? `${subjectName} moved to ${where}; ${partnerName} took its place.`
      : `${subjectName} moved to ${where}.`
    const clashNote = plan.clashes.length
      ? ` ${teacherOf(source?.teacher_id ?? '')?.full_name ?? 'The teacher'} is now double-booked with ${plan.clashes.join(' and ')}.`
      : ''
    setNotice({ tone: plan.clashes.length ? 'warn' : 'ok', text: base + clashNote, undo: restore })
    flash(`${toClassId}|${day}|${period}`)
  }

  async function undoMove() {
    if (!notice?.undo) return
    await api.timetable.move(notice.undo)
    setNotice({ tone: 'ok', text: 'Move undone — the lessons are back where they were.' })
  }

  /* ── slot editor ─────────────────────────────────────────────────────── */

  const [editor, setEditor] = useState<EditorState>({ open: false })
  const editing = editor.id ? db.timetableSlots.find((slot) => slot._id === editor.id) : undefined
  const [form, setForm] = useState({
    class_id: classId || db.classes[0]?._id || '',
    day: 1,
    period: 1,
    subject_id: db.subjects.find((subject) => subject.offered)?._id ?? db.subjects[0]?._id ?? '',
    teacher_id: db.teachers[0]?._id || '',
    room: '',
    repeat: 'every' as 'every' | 'week',
  })
  const [formError, setFormError] = useState<string | null>(null)

  function openCreate(target?: { class_id?: string; day?: number; period?: number }) {
    setForm((current) => ({
      ...current,
      class_id: target?.class_id ?? (classId || db.classes[0]?._id || ''),
      day: target?.day ?? 1,
      period: target?.period ?? 1,
      room: '',
      repeat: 'every',
    }))
    setFormError(null)
    setEditor({ open: true })
  }

  function openEdit(slot: TimetableSlot) {
    setForm({
      class_id: slot.class_id,
      day: slot.day,
      period: slot.period,
      subject_id: slot.subject_id,
      teacher_id: slot.teacher_id,
      room: slot.room,
      repeat: slot.week === null ? 'every' : 'week',
    })
    setFormError(null)
    setEditor({ open: true, id: slot._id })
  }

  /** Live validation: a duplicate stream booking blocks; a teacher double-booking warns. */
  const duplicate = termSlots.find(
    (slot) =>
      slot._id !== editor.id &&
      slot.class_id === form.class_id &&
      slot.day === form.day &&
      slot.period === form.period &&
      (form.repeat === 'every' ? true : slot.week === null || slot.week === week),
  )

  const teacherClash = termSlots.filter(
    (slot) =>
      slot._id !== editor.id &&
      slot.teacher_id === form.teacher_id &&
      slot.day === form.day &&
      slot.period === form.period &&
      slot.class_id !== form.class_id &&
      (form.repeat === 'every' ? true : slot.week === null || slot.week === week),
  )

  async function saveSlot() {
    if (duplicate) {
      setFormError(`${classLabel(form.class_id)} already has a lesson in that period.`)
      return
    }
    await api.timetable.save({
      _id: editor.id,
      term_id: termId,
      class_id: form.class_id,
      day: form.day,
      period: form.period,
      subject_id: form.subject_id,
      teacher_id: form.teacher_id,
      room: form.room.trim(),
      week: form.repeat === 'every' ? null : week,
    })
    setEditor({ open: false })
  }

  async function deleteSlot() {
    if (editor.id) await api.timetable.remove(editor.id)
    setEditor({ open: false })
  }

  /* ── the bell schedule editor ────────────────────────────────────────── */

  const [bellOpen, setBellOpen] = useState(false)
  const [bellDraft, setBellDraft] = useState<BellEntry[]>([])
  const [bellError, setBellError] = useState<string | null>(null)

  const draftPeriods = useMemo(() => periodsOf(bellDraft), [bellDraft])
  const draftBreaks = bellDraft.filter((entry) => entry.kind === 'break').length
  const draftProblem = bellOpen ? bellProblem(bellDraft) : null

  function openBell() {
    setBellDraft(bell.map((entry) => ({ ...entry })))
    setBellError(null)
    setBellOpen(true)
  }

  const patchBellLabel = (index: number, label: string) =>
    setBellDraft((current) => current.map((entry, i) => (i === index ? { ...entry, label } : entry)))

  /**
   * Editing a time ripples the rest of the day by the same amount, so the bell
   * stays continuous: lengthening period 1 pushes period 2 back, it does not
   * create an overlap the admin has to chase row by row.
   */
  function patchBellTime(index: number, field: 'start' | 'end', value: string) {
    setBellDraft((current) => {
      const entry = current[index]
      if (!entry) return current
      const previous = toMinutes(field === 'start' ? entry.start : entry.end)
      const next = toMinutes(value)
      const delta = Number.isNaN(previous) || Number.isNaN(next) ? 0 : next - previous
      return current.map((row, i) => {
        if (i < index) return row
        if (i === index) return field === 'start' ? { ...row, start: value, end: addMinutes(row.end, delta) } : { ...row, end: value }
        return { ...row, start: addMinutes(row.start, delta), end: addMinutes(row.end, delta) }
      })
    })
  }

  /** A new break pushes the rest of the day back, so nothing ever overlaps. */
  function addBreakAfter(index: number) {
    setBellDraft((current) => {
      const anchor = current[index]
      if (!anchor) return current
      const span = 20
      const created: BellEntry = {
        id: `bell-${Math.random().toString(36).slice(2, 8)}`,
        kind: 'break',
        label: 'Break',
        start: anchor.end,
        end: addMinutes(anchor.end, span),
      }
      const next = [...current]
      next.splice(index + 1, 0, created)
      return next.map((entry, i) =>
        i > index + 1 ? { ...entry, start: addMinutes(entry.start, span), end: addMinutes(entry.end, span) } : entry,
      )
    })
  }

  /** Removing a break pulls the rest of the day forward by its length. */
  function removeBellEntry(index: number) {
    setBellDraft((current) => {
      const target = current[index]
      if (!target) return current
      const span = toMinutes(target.end) - toMinutes(target.start)
      const delta = Number.isNaN(span) ? 0 : -span
      return current
        .filter((_, i) => i !== index)
        .map((entry, i) =>
          i >= index ? { ...entry, start: addMinutes(entry.start, delta), end: addMinutes(entry.end, delta) } : entry,
        )
    })
  }

  /** Lessons are only ever appended: numbering existing periods would move lessons. */
  function addPeriod() {
    setBellDraft((current) => {
      const lessons = current.filter((entry) => entry.kind === 'lesson')
      const last = lessons[lessons.length - 1]
      const length = last ? Math.max(5, toMinutes(last.end) - toMinutes(last.start)) : 40
      const start = last?.end ?? '08:00'
      return [
        ...current,
        {
          id: `bell-${Math.random().toString(36).slice(2, 8)}`,
          kind: 'lesson',
          label: '',
          start,
          end: addMinutes(start, length),
        },
      ]
    })
  }

  async function saveBell() {
    const problem = bellProblem(bellDraft)
    if (problem) {
      setBellError(problem)
      return
    }
    const beyond = db.timetableSlots.filter((slot) => slot.period > draftPeriods.length)
    if (beyond.length) {
      setBellError(
        `${beyond.length} scheduled lesson${beyond.length === 1 ? ' sits' : 's sit'} in the periods you removed. Move or delete ${beyond.length === 1 ? 'it' : 'them'} first.`,
      )
      return
    }
    await api.bell.save({
      _id: schedule?._id ?? 'bell-iupc',
      school_id: school._id,
      entries: bellDraft,
      updated_at: new Date().toISOString(),
    })
    setBellOpen(false)
    setNotice({
      tone: 'ok',
      text: `Bell schedule saved — ${draftPeriods.length} periods and ${draftBreaks} breaks a day.`,
    })
  }

  const printDates = dates
  const printedLessons = visibleSlots.length
  const printHeading = mode === 'class' ? classLabel(classId) : (teacherOf(teacherId)?.full_name ?? 'Staff')
  const movingSubject = subjectOf(movingSlot?.subject_id ?? '')?.name ?? 'lesson'
  const movingFrom = movingSlot
    ? `${classLabel(movingSlot.class_id)} · ${DAYS.find((d) => d.value === movingSlot.day)?.short} P${movingSlot.period}`
    : ''

  return (
    <>
      <PageHeader
        title="Timetable"
        subtitle={`${school.name} · ${term?.name ?? 'Term'} ${term?.academic_year ?? ''}`}
        meta={
          <>
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays size={13} /> Week {week} · {weekRange(term?.academic_year ?? '', term?.start_date ?? '', week)}
            </span>
            <span>{lessonCount} lessons</span>
            <span className={clashCount ? 'text-danger' : 'text-ok'}>
              {clashCount ? `${clashCount} clash${clashCount === 1 ? '' : 'es'}` : 'No clashes'}
            </span>
          </>
        }
        actions={
          <>
            {isAdmin ? (
              <button type="button" className="btn btn-sm" onClick={openBell} title="Set the periods and breaks for the school day">
                <Clock size={13} /> Periods
              </button>
            ) : null}
            <button type="button" className="btn btn-sm" onClick={() => window.print()}>
              <Printer size={13} /> Print / PDF
            </button>
            {isAdmin ? (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => openCreate()}>
                <Plus size={14} /> Create slot
              </button>
            ) : null}
          </>
        }
      />

      {/* toolbar */}
      <div className="card mb-3 flex flex-wrap items-end gap-2 p-3 no-print">
        <label>
          <span className="field-label">Term</span>
          <select className="select-field w-[190px]" value={termId} onChange={(event) => setTermId(event.target.value)}>
            {db.terms.map((option) => (
              <option key={option._id} value={option._id}>
                {option.name} · {option.academic_year}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">Week</span>
          <select className="select-field w-[130px]" value={week} onChange={(event) => setWeek(Number(event.target.value))}>
            {Array.from({ length: TERM_WEEKS }, (_, index) => index + 1).map((value) => (
              <option key={value} value={value}>
                Week {value}
              </option>
            ))}
          </select>
        </label>

        <div className="flex rounded-md border border-rule bg-sunken p-1" role="tablist" aria-label="Timetable view">
          {MODES.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={mode === option.value}
              onClick={() => setMode(option.value)}
              className={`rounded px-2.5 py-1 text-[12px] font-medium transition ${
                mode === option.value ? 'bg-raised text-ink shadow-sm' : 'text-ink/55 hover:text-ink'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {mode === 'class' ? (
          <label>
            <span className="field-label">Class / stream</span>
            <select className="select-field w-[170px]" value={classId} onChange={(event) => setClassId(event.target.value)}>
              {db.classes.map((cls) => (
                <option key={cls._id} value={cls._id}>
                  {cls.class_name} {cls.stream_name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {schoolView ? (
          <div className="flex rounded-md border border-rule bg-sunken p-1" role="tablist" aria-label="Grid density">
            {(
              [
                { value: 'fit', label: 'Fit week' },
                { value: 'detail', label: 'Detailed' },
              ] as { value: BoardDensity; label: string }[]
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={density === option.value}
                onClick={() => setDensity(option.value)}
                className={`rounded px-2.5 py-1 text-[12px] font-medium transition ${
                  density === option.value ? 'bg-raised text-ink shadow-sm' : 'text-ink/55 hover:text-ink'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}

        {mode === 'teacher' ? (
          <label>
            <span className="field-label">Teacher</span>
            <select
              className="select-field w-[190px]"
              value={teacherId}
              onChange={(event) => setTeacherId(event.target.value)}
              disabled={session?.role === 'teacher'}
            >
              {db.teachers.map((option) => (
                <option key={option._id} value={option._id}>
                  {option.full_name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="ml-auto flex items-center gap-2 text-[11px] text-ink/45">
          {isAdmin ? (
            <>
              <span className="hidden items-center gap-1 md:inline-flex">
                <GripVertical size={12} /> drag a lesson · drop on a lesson to swap
              </span>
              <span className="inline-flex items-center gap-1 md:hidden">
                <GripVertical size={12} /> tap a lesson, then Move…
              </span>
            </>
          ) : null}
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-danger/70" /> clash
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm border border-dashed border-rule" /> free
          </span>
        </div>
      </div>

      {movingSlot ? (
        <div
          role="status"
          className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-brass/50 bg-brass/10 px-3 py-2 text-[12px] no-print"
        >
          <GripVertical size={14} className="text-brass-deep" />
          <span>
            <strong>Moving {movingSubject}</strong> from {movingFrom} — click the cell it should move to. A taken cell
            trades places.
          </span>
          <button type="button" className="btn btn-sm ml-auto" onClick={() => setMovingId(null)}>
            <X size={12} /> Cancel
          </button>
        </div>
      ) : null}

      {notice ? (
        <div
          role="status"
          className={`mb-3 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-[12px] no-print ${NOTICE_TONE[notice.tone]}`}
        >
          <span>{notice.text}</span>
          {notice.undo ? (
            <button type="button" className="btn btn-sm" onClick={() => void undoMove()}>
              <Undo2 size={12} /> Undo
            </button>
          ) : null}
          <button
            type="button"
            className="ml-auto rounded p-0.5 text-ink/40 transition hover:text-ink"
            onClick={() => setNotice(null)}
            aria-label="Dismiss message"
          >
            <X size={13} />
          </button>
        </div>
      ) : null}

      {/* board */}
      {schoolView ? (
        <SchoolBoard
          classes={db.classes}
          subjects={offeredList}
          teachers={db.teachers}
          slots={weekSlots}
          conflicts={conflicts}
          columns={columns}
          dates={printDates}
          canEdit={isAdmin}
          density={density}
          movingId={movingId}
          flashKey={flashKey}
          onMove={(slotId, targetClassId, day, period) => void moveSlot(slotId, targetClassId, day, period)}
          onPickUp={(slot) => {
            setMovingId(slot?._id ?? null)
            setNotice(null)
          }}
          onCreate={(targetClassId, day, period) => openCreate({ class_id: targetClassId, day, period })}
          onEdit={openEdit}
        />
      ) : (
        <div className="card overflow-x-auto p-3 no-print">
          <table
            className="period-board"
            style={{ minWidth: `${Math.max(840, columns.length * 74 + 96)}px` }}
          >
            <colgroup>
              <col style={{ width: '8.5%' }} />
              {columns.map((column) => (
                <col key={columnKey(column)} style={{ width: column.kind === 'pause' ? '4.6%' : undefined }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th aria-label="Day" />
                {columns.map((column) =>
                  column.kind === 'period' ? (
                    <th key={columnKey(column)} scope="col" className="px-1 py-1.5">
                      <span className="block text-[15px] font-semibold leading-none">{column.period.n}</span>
                      <span className="mt-1 block font-mono text-[9px] font-normal leading-none text-ink/55">
                        {column.period.start}–{column.period.end}
                      </span>
                    </th>
                  ) : (
                    <th key={columnKey(column)} scope="col" className="px-0.5 py-1">
                      <span className="block text-[9px] font-semibold uppercase leading-none tracking-[0.06em]">
                        {column.label}
                      </span>
                      <span className="mt-1 block font-mono text-[8px] font-normal leading-none text-ink/55">{column.start}</span>
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {DAYS.map((day, dayIndex) => (
                <tr key={day.value} className="h-[92px]">
                  <th scope="row" className="px-1 py-2 text-center">
                    <span className="block text-[24px] font-semibold leading-none">{day.short.slice(0, 2)}</span>
                    <span className="mt-1.5 block font-mono text-[9px] font-normal text-ink/50">
                      {printDates.find((entry) => entry.day === day.value)?.label}
                    </span>
                  </th>
                  {columns.map((column) => {
                    if (column.kind === 'pause') {
                      if (dayIndex > 0) return null
                      return (
                        <td key={columnKey(column)} rowSpan={DAYS.length} className="p-0 text-center">
                          <span className="pb-rotate text-[11px] font-semibold uppercase tracking-[0.28em] text-ink/75">
                            {column.label}
                          </span>
                        </td>
                      )
                    }
                    const period = column.period
                    const slot = slotAt(day.value, period.n)
                    const clash = slot ? conflicts.get(slot._id) : undefined
                    const subject = slot ? subjectOf(slot.subject_id) : undefined
                    const staff = slot ? teacherOf(slot.teacher_id) : undefined
                    const stream = slot ? db.classes.find((cls) => cls._id === slot.class_id) : undefined
                    const isDropTarget = Boolean(gridDragId) && gridDragId !== slot?._id
                    return (
                      <td
                        key={columnKey(column)}
                        className={`p-[3px] align-top ${isDropTarget ? 'bg-ok/5' : ''}`}
                        onDragOver={(event) => {
                          if (!gridDragRef.current) return
                          event.preventDefault()
                          event.dataTransfer.dropEffect = 'move'
                        }}
                        onDrop={(event) => {
                          if (!gridDragRef.current) return
                          event.preventDefault()
                          const id = event.dataTransfer.getData('text/plain') || gridDragRef.current
                          const source = db.timetableSlots.find((row) => row._id === id)
                          gridDragRef.current = null
                          setGridDragId(null)
                          if (id && source) void moveSlot(id, source.class_id, day.value, period.n)
                        }}
                      >
                        {slot ? (
                          <button
                            type="button"
                            onClick={() => (isAdmin ? openEdit(slot) : undefined)}
                            draggable={isAdmin}
                            onDragStart={(event) => {
                              event.dataTransfer.setData('text/plain', slot._id)
                              event.dataTransfer.effectAllowed = 'move'
                              gridDragRef.current = slot._id
                              setGridDragId(slot._id)
                            }}
                            onDragEnd={() => {
                              gridDragRef.current = null
                              setGridDragId(null)
                            }}
                            className={`flex h-full w-full flex-col items-center justify-center gap-1 px-1 py-1.5 text-center transition ${
                              clash ? 'bg-danger/5' : 'bg-white hover:bg-sunken/60'
                            } ${gridDragId === slot._id ? 'opacity-40' : ''}`}
                            style={{ borderLeft: `3px solid ${clash ? 'var(--color-danger)' : toneFor(slot.subject_id, offeredList)}` }}
                            title={
                              clash
                                ? `Clash: ${clash.classes.join(', ')} also booked at this time`
                                : `${subject?.name} · ${staff?.full_name}`
                            }
                          >
                            <span className="block max-w-full truncate text-[11.5px] font-semibold leading-tight text-ink">
                              {mode === 'teacher'
                                ? stream
                                  ? shortClass(stream.class_name, stream.stream_name)
                                  : classLabel(slot.class_id)
                                : (subject?.name ?? 'Lesson')}
                            </span>
                            <span className="block max-w-full truncate text-[10px] leading-tight text-ink/55">
                              {slot.room || '—'}
                            </span>
                            <span className="block max-w-full truncate font-mono text-[10px] uppercase leading-tight text-ink/50">
                              {mode === 'teacher' ? shortCode(subject?.code ?? '') : (staff?.initials ?? '—')}
                            </span>
                            {clash ? (
                              <span className="text-[8px] font-bold uppercase leading-none tracking-[0.08em] text-danger">
                                Clash
                              </span>
                            ) : null}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              movingId
                                ? void moveSlot(movingId, mode === 'class' ? classId : (movingSlot?.class_id ?? classId), day.value, period.n)
                                : isAdmin
                                  ? openCreate({ class_id: mode === 'class' ? classId : undefined, day: day.value, period: period.n })
                                  : undefined
                            }
                            className="flex h-full min-h-[64px] w-full items-center justify-center text-[14px] text-ink/25 transition hover:bg-sunken/60 hover:text-ink/45 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                            disabled={!isAdmin}
                            aria-label={`Add a lesson, ${day.long} period ${period.n}`}
                          >
                            +
                          </button>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {lessonCount === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="Nothing on the board for this selection"
            hint={
              mode === 'teacher'
                ? 'This member of staff has no lessons in the chosen week.'
                : 'Create a slot to begin building this stream’s week.'
            }
            action={
              isAdmin ? (
                <button type="button" className="btn btn-sm" onClick={() => openCreate()}>
                  Create timetable slot
                </button>
              ) : null
            }
          />
        </div>
      ) : null}

      {clashCount ? (
        <div className="mt-3 flex items-start gap-2 rounded border border-danger/30 bg-danger/5 px-3 py-2 text-[11.5px] text-danger no-print">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <p>
            {clashCount} lesson{clashCount === 1 ? '' : 's'} in this view double-book the same teacher. Drag a flagged
            lesson elsewhere, or open it to reassign the subject to another member of staff.
          </p>
        </div>
      ) : null}

      {/* slot editor */}
      <Modal
        open={editor.open}
        title={editor.id ? 'Edit timetable slot' : 'Create timetable slot'}
        onClose={() => setEditor({ open: false })}
        width={560}
        footer={
          <>
            {editor.id ? (
              <button type="button" className="btn btn-danger btn-sm" onClick={() => void deleteSlot()}>
                <Trash2 size={13} /> Delete
              </button>
            ) : null}
            {editor.id ? (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  const slotId = editor.id
                  setEditor({ open: false })
                  setMovingId(slotId ?? null)
                  setNotice(null)
                }}
              >
                <GripVertical size={13} /> Move…
              </button>
            ) : null}
            <span className="flex-1" />
            <button type="button" className="btn btn-sm" onClick={() => setEditor({ open: false })}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void saveSlot()} disabled={Boolean(duplicate)}>
              Save slot
            </button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Class / stream">
            <select className="select-field" value={form.class_id} onChange={(event) => setForm({ ...form, class_id: event.target.value })}>
              {db.classes.map((cls) => (
                <option key={cls._id} value={cls._id}>
                  {cls.class_name} {cls.stream_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Day">
            <select className="select-field" value={form.day} onChange={(event) => setForm({ ...form, day: Number(event.target.value) })}>
              {DAYS.map((day) => (
                <option key={day.value} value={day.value}>
                  {day.long}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Period">
            <select className="select-field" value={form.period} onChange={(event) => setForm({ ...form, period: Number(event.target.value) })}>
              {periods.map((period) => (
                <option key={period.n} value={period.n}>
                  P{period.n} · {periodLabel(period.n, periods)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Subject" hint={`${offeredList.length} offered here`}>
            <select className="select-field" value={form.subject_id} onChange={(event) => setForm({ ...form, subject_id: event.target.value })}>
              {offeredList.map((subject) => (
                <option key={subject._id} value={subject._id}>
                  {subject.name} · {subject.code}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Teacher">
            <select className="select-field" value={form.teacher_id} onChange={(event) => setForm({ ...form, teacher_id: event.target.value })}>
              {db.teachers.map((option) => (
                <option key={option._id} value={option._id}>
                  {option.full_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Room">
            <input className="input-field" value={form.room} onChange={(event) => setForm({ ...form, room: event.target.value })} placeholder="F1A-03" />
          </Field>
          <Field label="Repeat">
            <select
              className="select-field"
              value={form.repeat}
              onChange={(event) => setForm({ ...form, repeat: event.target.value as 'every' | 'week' })}
            >
              <option value="every">Every week</option>
              <option value="week">Only week {week}</option>
            </select>
          </Field>
        </div>

        {duplicate ? (
          <p role="alert" className="mt-3 rounded border border-danger/30 bg-danger/5 px-3 py-2 text-[12px] text-danger">
            {classLabel(form.class_id)} already has a lesson at {DAYS.find((d) => d.value === form.day)?.long}, P{form.period}.
            Choose another period or edit the existing slot.
          </p>
        ) : null}

        {teacherClash.length > 0 && !duplicate ? (
          <p className="mt-3 rounded border border-warn/35 bg-warn/8 px-3 py-2 text-[12px] text-warn">
            {teacherOf(form.teacher_id)?.full_name} is already teaching {teacherClash.map((slot) => classLabel(slot.class_id)).join(', ')} at
            that time. You can still save — the board will flag the clash.
          </p>
        ) : null}

        {formError ? (
          <p role="alert" className="mt-3 text-[12px] text-danger">
            {formError}
          </p>
        ) : null}
      </Modal>

      {/* period and break editor */}
      <Modal
        open={bellOpen}
        title="Periods & breaks"
        onClose={() => setBellOpen(false)}
        width={680}
        footer={
          <>
            <span className="mr-auto hidden text-[11px] text-ink/50 sm:inline">
              {draftPeriods.length} teaching periods · {draftBreaks} breaks
            </span>
            <button type="button" className="btn btn-sm" onClick={() => setBellOpen(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void saveBell()}>
              Save schedule
            </button>
          </>
        }
      >
        <p className="mb-3 text-[11.5px] leading-snug text-ink/55">
          A period's number is its position in this list, so changing a time never moves a lesson. New periods are
          added at the end of the day; the rest of the day shifts automatically when you add or remove a break.
        </p>

        <div className="max-h-[52vh] space-y-1.5 overflow-y-auto pr-1">
          {bellDraft.map((entry, index) => (
            <div
              key={entry.id}
              className={`flex flex-wrap items-center gap-2 rounded border px-2 py-1.5 ${
                entry.kind === 'break' ? 'border-brass/40 bg-brass/10' : 'border-rule'
              }`}
            >
              <span className="w-[76px] shrink-0 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink/60">
                {entry.kind === 'lesson' ? `Period ${periodNumberAt(bellDraft, index)}` : 'Break'}
              </span>
              {entry.kind === 'break' ? (
                <input
                  className="input-field w-[112px]"
                  value={entry.label}
                  aria-label={`Break name, row ${index + 1}`}
                  onChange={(event) => patchBellLabel(index, event.target.value)}
                />
              ) : null}
              <span className="flex items-center gap-1.5">
                <input
                  className="input-field w-[82px] font-mono"
                  value={entry.start}
                  inputMode="numeric"
                  maxLength={5}
                  placeholder="HH:MM"
                  aria-label={`Start time, row ${index + 1}`}
                  onChange={(event) => patchBellTime(index, 'start', event.target.value)}
                />
                <span className="text-ink/40">–</span>
                <input
                  className="input-field w-[82px] font-mono"
                  value={entry.end}
                  inputMode="numeric"
                  maxLength={5}
                  placeholder="HH:MM"
                  aria-label={`End time, row ${index + 1}`}
                  onChange={(event) => patchBellTime(index, 'end', event.target.value)}
                />
              </span>
              <span className="ml-auto flex items-center gap-1">
                {entry.kind === 'lesson' ? (
                  <button
                    type="button"
                    className="btn btn-sm"
                    title="Add a break after this period"
                    onClick={() => addBreakAfter(index)}
                  >
                    <Plus size={12} /> Break
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn-sm text-danger"
                  aria-label={`Remove ${entry.kind === 'lesson' ? `period ${periodNumberAt(bellDraft, index)}` : entry.label || 'break'}`}
                  onClick={() => removeBellEntry(index)}
                >
                  <Trash2 size={12} />
                </button>
              </span>
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between">
          <button type="button" className="btn btn-sm" onClick={addPeriod}>
            <Plus size={13} /> Add period
          </button>
          <span className="font-mono text-[11px] text-ink/45">
            {bellDraft[0]?.start ?? '—'}–{bellDraft[bellDraft.length - 1]?.end ?? '—'}
          </span>
        </div>

        {bellError ?? draftProblem ? (
          <p role="alert" className="mt-3 rounded border border-danger/30 bg-danger/5 px-3 py-2 text-[12px] text-danger">
            {bellError ?? draftProblem}
          </p>
        ) : null}
      </Modal>

      {/* ── print: whole-school master grid (A3 landscape) ─────────── */}
      {schoolView ? (
        <div className="print-only sheet sheet-master print-page text-[8px]">
          <div className="mb-2 flex items-start justify-between border-b border-ink/25 pb-1.5">
            <div className="flex min-w-0 items-start gap-2.5">
              <SchoolLogo school={school} size={30} />
              <div className="min-w-0">
                <p className="text-[14px] font-semibold leading-tight">{school.name}</p>
                <p className="text-[8px] text-ink/60">{school.address}</p>
                <p className="text-[8px] text-ink/60">
                  {school.postal} · {school.city} · TEL {school.phone_number}
                </p>
                <p className="text-[8px] text-ink/60">{school.contact_email}</p>
              </div>
            </div>
            <div className="max-w-[38%] shrink-0 text-right">
              <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-crimson">Whole-school master timetable</p>
              <p className="text-[11px] font-semibold">
                {term?.name} {term?.academic_year} · Week {week}
              </p>
              <p className="text-[8px] text-ink/60">
                {weekRange(term?.academic_year ?? '', term?.start_date ?? '', week)} · {db.classes.length} streams ·{' '}
                {weekSlots.length} lessons
              </p>
            </div>
          </div>

          <table className="master-sheet-table w-full table-fixed border-collapse">
            <colgroup>
              <col style={{ width: '6.5%' }} />
              {DAYS.flatMap((day) =>
                periods.map((period) => (
                  <col key={`${day.value}-${period.n}`} style={{ width: `${93.5 / (DAYS.length * periods.length)}%` }} />
                )),
              )}
            </colgroup>
            <thead>
              <tr>
                <th
                  rowSpan={2}
                  className="border border-ink/30 bg-ink px-1 py-0.5 text-left align-middle text-[7px] font-semibold uppercase tracking-[0.1em] text-white"
                >
                  Class
                </th>
                {DAYS.map((day) => (
                  <th
                    key={day.value}
                    colSpan={periods.length}
                    className="border border-ink/30 bg-ink px-1 py-0.5 text-center text-[7.5px] font-semibold uppercase tracking-[0.14em] text-white"
                  >
                    {day.long}
                  </th>
                ))}
              </tr>
              <tr>
                {DAYS.flatMap((day) =>
                  periods.map((period) => (
                    <th
                      key={`${day.value}-${period.n}`}
                      className={`border border-ink/20 bg-sunken py-0.5 text-center text-[6px] font-semibold text-ink/70 ${
                        gapBefore.has(period.n) ? 'border-l-2 border-l-ink/45' : ''
                      }`}
                    >
                      {period.n}
                    </th>
                  )),
                )}
              </tr>
            </thead>
            <tbody>
              {db.classes.map((cls) => (
                <tr key={cls._id} style={{ height: masterRowHeight }}>
                  <th className="border border-ink/25 bg-ink/5 px-1 py-1 text-left align-middle">
                    <span className="block text-[9px] font-semibold uppercase leading-tight">{cls.class_name}</span>
                    <span className="block text-[7px] text-ink/55">Stream {cls.stream_name}</span>
                  </th>
                  {DAYS.flatMap((day) =>
                    periods.map((period) => {
                      const slot = weekSlots.find(
                        (row) => row.class_id === cls._id && row.day === day.value && row.period === period.n,
                      )
                      const subject = slot ? subjectOf(slot.subject_id) : undefined
                      const staff = slot ? teacherOf(slot.teacher_id) : undefined
                      const clash = slot ? conflicts.get(slot._id) : undefined
                      return (
                        <td
                          key={`${day.value}-${period.n}`}
                          className={`border border-ink/20 px-0.5 py-0.5 text-center align-middle ${
                            clash ? 'bg-danger/5' : ''
                          } ${
                            gapBefore.has(period.n) ? 'border-l-2 border-l-ink/45' : ''
                          }`}
                        >
                          {slot ? (
                            <>
                              <p
                                className="text-[12px] font-bold leading-none"
                                style={{ color: toneFor(slot.subject_id, offeredList) }}
                              >
                                {shortCode(subject?.code ?? '')}
                              </p>
                              <p className="mt-1 font-mono text-[7px] leading-none text-ink/60">{staff?.initials}</p>
                              {clash ? (
                                <p className="mt-1 text-[6px] font-bold uppercase leading-none text-danger">clash</p>
                              ) : null}
                            </>
                          ) : null}
                        </td>
                      )
                    }),
                  )}
                </tr>
              ))}
            </tbody>
          </table>

          <div className="master-sheet-key border-t border-ink/20 pt-1.5">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[6.5px] leading-tight">
              {db.subjects
                .filter((subject) => weekSlots.some((slot) => slot.subject_id === subject._id))
                .map((subject) => (
                  <span key={subject._id} className="inline-flex items-center gap-1">
                    <span className="font-bold" style={{ color: toneFor(subject._id, offeredList) }}>
                      {shortCode(subject.code)}
                    </span>
                    <span className="text-ink/70">{subject.name}</span>
                  </span>
                ))}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[6.5px] leading-tight text-ink/65">
              {db.teachers
                .filter((member) => weekSlots.some((slot) => slot.teacher_id === member._id))
                .map((member) => (
                  <span key={member._id}>
                    <span className="font-mono font-semibold text-ink/80">{member.initials}</span> {member.full_name}
                  </span>
                ))}
            </div>
            <div className="mt-2 flex items-end justify-between text-[7px] text-ink/55">
              <p className="flex gap-8">
                <span>Head of Academics ____________________</span>
                <span>Date ____________________</span>
              </p>
              <p>
                Generated {formatDate(new Date().toISOString())} · {school.name} · A3 landscape
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── print: one class / one teacher (A4 landscape) ─────────── */}
      {!schoolView ? (
        <div className="print-only sheet sheet-timetable print-page">
          <div className="mb-1 flex items-baseline justify-between text-[7px] uppercase tracking-[0.14em] text-ink/55">
            <span>
              Memo · {term?.name} {term?.academic_year} · Week {week}
            </span>
            <span className="normal-case tracking-normal">{school.name}</span>
          </div>

          <h2 className="mb-2 text-center text-[26px] font-bold uppercase leading-none tracking-[0.02em]">
            {mode === 'class' ? 'Class ' : 'Teacher '}
            {printHeading}
          </h2>

          <table className="tt-sheet">
            <colgroup>
              <col style={{ width: '8.5%' }} />
              {columns.map((column) => (
                <col key={columnKey(column)} style={{ width: column.kind === 'pause' ? '4.6%' : undefined }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th />
                {columns.map((column) =>
                  column.kind === 'period' ? (
                    <th key={columnKey(column)} className="px-1 py-1">
                      <span className="block text-[13px] font-semibold leading-none">{column.period.n}</span>
                      <span className="mt-0.5 block font-mono text-[6.5px] font-normal leading-none text-ink/60">
                        {column.period.start}–{column.period.end}
                      </span>
                    </th>
                  ) : (
                    <th key={columnKey(column)} className="px-0.5 py-1">
                      <span className="block text-[7px] font-semibold uppercase leading-none tracking-[0.04em]">
                        {column.label}
                      </span>
                      <span className="mt-0.5 block font-mono text-[6px] font-normal leading-none text-ink/60">
                        {column.start}
                      </span>
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {DAYS.map((day, dayIndex) => (
                <tr key={day.value} style={{ height: '30mm' }}>
                  <th scope="row" className="px-1 text-center">
                    <span className="block text-[22px] font-semibold leading-none">{day.short.slice(0, 2)}</span>
                    <span className="mt-1 block font-mono text-[6.5px] font-normal text-ink/55">
                      {printDates.find((entry) => entry.day === day.value)?.label}
                    </span>
                  </th>
                  {columns.map((column) => {
                    if (column.kind === 'pause') {
                      if (dayIndex > 0) return null
                      return (
                        <td key={columnKey(column)} rowSpan={DAYS.length} className="p-0 text-center">
                          <span className="pb-rotate text-[12px] font-semibold uppercase tracking-[0.3em] text-ink/80">
                            {column.label}
                          </span>
                        </td>
                      )
                    }
                    const period = column.period
                    const slot = visibleSlots.find((item) => item.day === day.value && item.period === period.n)
                    const clash = slot ? conflicts.get(slot._id) : undefined
                    const subject = slot ? subjectOf(slot.subject_id) : undefined
                    const staff = slot ? teacherOf(slot.teacher_id) : undefined
                    const stream = slot ? db.classes.find((cls) => cls._id === slot.class_id) : undefined
                    return (
                      <td key={columnKey(column)} className={`px-1 py-1 ${clash ? 'bg-danger/5' : ''}`}>
                        {slot ? (
                          <div className="flex h-full min-h-[22mm] flex-col justify-between gap-0.5">
                            <p className="text-left text-[9px] font-bold uppercase leading-tight">
                              {mode === 'teacher'
                                ? stream
                                  ? shortClass(stream.class_name, stream.stream_name)
                                  : classLabel(slot.class_id)
                                : (subject?.name ?? 'Lesson')}
                            </p>
                            <p className="text-center text-[7px] uppercase leading-tight text-ink/60">{slot.room || ''}</p>
                            <p className="flex items-baseline justify-between gap-1 font-mono text-[6.5px] uppercase leading-tight text-ink/70">
                              <span>{mode === 'teacher' ? shortCode(subject?.code ?? '') : (staff?.initials ?? '')}</span>
                              {clash ? <span className="font-sans font-bold text-danger">clash</span> : null}
                            </p>
                          </div>
                        ) : null}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-auto flex items-end justify-between pt-1 text-[7px] text-ink/60">
            <span>Timetable generated: {formatDate(new Date().toISOString())}</span>
            <span>
              {term?.name} {term?.academic_year} · Week {week} · {printedLessons} lessons
              {clashCount ? ` · ${clashCount} clashes` : ''} · A4 landscape
            </span>
          </div>
        </div>
      ) : null}

      {session?.role === 'guest' ? (
        <p className="mt-4 no-print">
          <Badge tone="brass">Read-only</Badge>{' '}
          <span className="text-[11.5px] text-ink/50">Guests can browse and print, but not edit the board.</span>
        </p>
      ) : null}
    </>
  )
}
