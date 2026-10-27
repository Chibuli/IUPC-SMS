import { useEffect, useMemo, useRef, useState } from 'react'
import { GripVertical } from 'lucide-react'
import type { ClassRow, Subject, Teacher, TimetableSlot } from '../data/types'
import type { ClashInfo, GridColumn } from '../lib/timetable'
import { DAYS, shortCode, toneFor } from '../lib/timetable'

export type BoardDensity = 'fit' | 'detail'

interface SchoolBoardProps {
  classes: ClassRow[]
  subjects: Subject[]
  teachers: Teacher[]
  slots: TimetableSlot[]
  conflicts: Map<string, ClashInfo>
  /** The school's day, breaks included; only the lesson columns are drawn here. */
  columns: GridColumn[]
  dates: { day: number; label: string }[]
  canEdit: boolean
  density: BoardDensity
  /** A lesson picked up with its grip, waiting for a cell to be clicked. */
  movingId: string | null
  flashKey: string | null
  onMove: (slotId: string, classId: string, day: number, period: number) => void
  onPickUp: (slot: TimetableSlot | null) => void
  onCreate: (classId: string, day: number, period: number) => void
  onEdit: (slot: TimetableSlot) => void
}

const cellKey = (classId: string, day: number, period: number) => `${classId}|${day}|${period}`

/** Below this a cell can only carry a two-letter subject code. */
const MIN_CELL = 20
const DETAIL_CELL = 92
const CLASS_COLUMN = 112
const CLASS_COLUMN_NARROW = 92

/**
 * The master switchboard: every stream on a row, every day's periods across the
 * header. "Fit week" shrinks the columns until all five days are on screen — the
 * cells then carry the subject's colour and code, which is why the legend sits
 * under the board — while "Detailed" returns to full-width cards. A lesson is
 * moved by dragging it onto another cell; a taken cell trades the two lessons.
 */
export default function SchoolBoard({
  classes,
  subjects,
  teachers,
  slots,
  conflicts,
  columns,
  dates,
  canEdit,
  density,
  movingId,
  flashKey,
  onMove,
  onPickUp,
  onCreate,
  onEdit,
}: SchoolBoardProps) {
  const [dragId, setDragId] = useState<string | null>(null)
  // The drop handlers must see the drag immediately: a re-render between
  // dragstart and drop is not guaranteed on a fast drag.
  const dragRef = useRef<string | null>(null)
  const [hoverKey, setHoverKey] = useState<string | null>(null)

  const scrollerRef = useRef<HTMLDivElement>(null)
  const [available, setAvailable] = useState(0)

  useEffect(() => {
    const element = scrollerRef.current
    if (!element) return
    const measure = () => setAvailable(element.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const lessonColumns = useMemo(
    () => columns.filter((column) => column.kind === 'period').map((column) => column.period),
    [columns],
  )
  /** A period that follows a break gets a heavier left rule, as on the sheets. */
  const gapBefore = useMemo(() => {
    const gaps = new Set<number>()
    columns.forEach((column, index) => {
      if (column.kind === 'period' && columns[index - 1]?.kind === 'pause') gaps.add(column.period.n)
    })
    return gaps
  }, [columns])
  const COLUMN_COUNT = DAYS.length * lessonColumns.length

  const subjectById = useMemo(() => new Map(subjects.map((subject) => [subject._id, subject])), [subjects])
  const teacherById = useMemo(() => new Map(teachers.map((teacher) => [teacher._id, teacher])), [teachers])
  const slotLookup = useMemo(() => {
    const map = new Map<string, TimetableSlot>()
    for (const slot of slots) map.set(cellKey(slot.class_id, slot.day, slot.period), slot)
    return map
  }, [slots])

  const moving = movingId ? slots.find((slot) => slot._id === movingId) : undefined
  const dateLabel = (day: number) => dates.find((entry) => entry.day === day)?.label ?? ''

  const boxWidth = available || 1086
  const classColumn = boxWidth < 620 ? CLASS_COLUMN_NARROW : CLASS_COLUMN
  // Fractional widths on purpose: the remainder would otherwise leave a gap at
  // the right edge of the board.
  const fitted = Math.max(MIN_CELL, (boxWidth - classColumn) / COLUMN_COUNT)
  const cellWidth = density === 'fit' ? fitted : DETAIL_CELL

  const compact = cellWidth < 40
  const showTime = cellWidth >= 40
  const showInitials = cellWidth >= 34
  const showName = cellWidth >= 58

  return (
    <>
      <div ref={scrollerRef} className="card master-frame overflow-auto no-print">
        <table className="master" style={{ width: classColumn + COLUMN_COUNT * cellWidth }}>
          <colgroup>
            <col style={{ width: classColumn }} />
            {DAYS.flatMap((day) => lessonColumns.map((period) => <col key={`${day.value}-${period.n}`} style={{ width: cellWidth }} />))}
          </colgroup>
          <thead>
            <tr>
              <th scope="col" rowSpan={2} className="master-corner">
                Class
              </th>
              {DAYS.map((day) => (
                <th key={day.value} scope="colgroup" colSpan={lessonColumns.length} className="master-day">
                  {cellWidth >= 24 ? day.long : day.short}
                  <span className="ml-1.5 font-mono text-[9px] font-normal normal-case tracking-normal text-ink/40">
                    {dateLabel(day.value)}
                  </span>
                </th>
              ))}
            </tr>
            <tr>
              {DAYS.flatMap((day) =>
                lessonColumns.map((period) => (
                  <th
                    key={`${day.value}-${period.n}`}
                    scope="col"
                    className={`master-period ${gapBefore.has(period.n) ? 'master-gap' : ''}`}
                  >
                    <span className="block leading-none">{period.n}</span>
                    {showTime ? (
                      <span className="mt-0.5 block font-mono text-[9px] font-normal text-ink/40">{period.start}</span>
                    ) : null}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {classes.map((cls) => {
              const filled = slots.filter((slot) => slot.class_id === cls._id).length
              return (
                <tr key={cls._id}>
                  <th scope="row" className="master-class">
                    <span className="block truncate text-[12px] font-semibold leading-tight text-ink">{cls.class_name}</span>
                    <span
                      className="mt-1 flex items-center gap-1 text-[9.5px] leading-none text-ink/45"
                      title={`${filled} of ${COLUMN_COUNT} periods scheduled`}
                    >
                      <span className="rounded border border-rule bg-sunken px-1 py-[1px] font-semibold text-ink/60">
                        {cls.stream_name}
                      </span>
                      <span className="font-mono">
                        {filled}/{COLUMN_COUNT}
                      </span>
                    </span>
                  </th>

                  {DAYS.flatMap((day) =>
                    lessonColumns.map((period) => {
                      const key = cellKey(cls._id, day.value, period.n)
                      const slot = slotLookup.get(key)
                      const subject = slot ? subjectById.get(slot.subject_id) : undefined
                      const teacher = slot ? teacherById.get(slot.teacher_id) : undefined
                      const clash = slot ? conflicts.get(slot._id) : undefined
                      const tone = slot ? toneFor(slot.subject_id, subjects) : ''
                      const isDragTarget = Boolean(dragId) && dragId !== slot?._id
                      const stateClass = [
                        gapBefore.has(period.n) ? 'master-gap' : '',
                        dragId && dragId === slot?._id ? 'is-source' : '',
                        hoverKey === key && isDragTarget ? (slot ? 'is-swap' : 'is-drop') : '',
                        flashKey === key ? 'is-flash' : '',
                        movingId && moving ? 'cursor-copy' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')

                      return (
                        <td
                          key={key}
                          data-cell={key}
                          className={`master-cell ${stateClass}`}
                          onDragOver={(event) => {
                            if (!dragRef.current) return
                            event.preventDefault()
                            event.dataTransfer.dropEffect = 'move'
                            setHoverKey(key)
                          }}
                          onDragLeave={(event) => {
                            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
                            setHoverKey((current) => (current === key ? null : current))
                          }}
                          onDrop={(event) => {
                            if (!dragRef.current) return
                            event.preventDefault()
                            const id = event.dataTransfer.getData('text/plain') || dragRef.current
                            dragRef.current = null
                            setDragId(null)
                            setHoverKey(null)
                            if (id) onMove(id, cls._id, day.value, period.n)
                          }}
                        >
                          {slot ? (
                            <>
                              <button
                                type="button"
                                className={`slot master-slot ${compact ? 'master-slot--compact' : ''} ${clash ? 'slot-clash' : ''}`}
                                style={{
                                  borderLeftColor: tone,
                                  borderColor: clash ? 'var(--color-danger)' : `color-mix(in srgb, ${tone} 42%, #fff)`,
                                  background: `color-mix(in srgb, ${tone} 16%, #fff)`,
                                }}
                                draggable={canEdit}
                                aria-grabbed={dragId === slot._id}
                                disabled={!canEdit}
                                onClick={() => (movingId ? onMove(movingId, cls._id, day.value, period.n) : onEdit(slot))}
                                onDragStart={(event) => {
                                  event.dataTransfer.setData('text/plain', slot._id)
                                  event.dataTransfer.effectAllowed = 'move'
                                  dragRef.current = slot._id
                                  setDragId(slot._id)
                                  setHoverKey(null)
                                }}
                                onDragEnd={() => {
                                  dragRef.current = null
                                  setDragId(null)
                                  setHoverKey(null)
                                }}
                                title={[
                                  `${subject?.name ?? 'Lesson'} · ${subject?.code ?? ''}`,
                                  `${teacher?.full_name ?? 'Unassigned'}${slot.room ? ` · ${slot.room}` : ''}`,
                                  `${cls.class_name} ${cls.stream_name} · ${day.long} P${period.n}`,
                                  clash ? `Clash: already booked with ${clash.classes.join(', ')}` : '',
                                  canEdit ? 'Drag to move, or click to edit' : '',
                                ]
                                  .filter(Boolean)
                                  .join('\n')}
                              >
                                {compact ? (
                                  <span className="flex h-full flex-col items-center justify-center gap-0.5">
                                    <span className="text-[9.5px] font-bold leading-none tracking-tight" style={{ color: tone }}>
                                      {shortCode(subject?.code ?? '')}
                                    </span>
                                    {showInitials ? (
                                      <span className={`font-mono text-[7.5px] leading-none ${clash ? 'text-danger' : 'text-ink/45'}`}>
                                        {teacher?.initials ?? '—'}
                                      </span>
                                    ) : null}
                                  </span>
                                ) : (
                                  <>
                                    <span
                                      className={`block pr-3 font-semibold leading-[1.15] text-ink ${showName ? 'text-[10.5px] line-clamp-2' : 'truncate text-[10px]'}`}
                                    >
                                      {showName ? (subject?.name ?? 'Lesson') : shortCode(subject?.code ?? '')}
                                    </span>
                                    {showInitials ? (
                                      <span
                                        className={`mt-auto block truncate pr-3 pt-0.5 font-mono text-[8.5px] leading-none ${
                                          clash ? 'text-danger' : 'text-ink/55'
                                        }`}
                                      >
                                        {teacher?.initials ?? '—'}
                                      </span>
                                    ) : null}
                                  </>
                                )}
                              </button>
                              {canEdit && showName ? (
                                <button
                                  type="button"
                                  className="master-grip"
                                  aria-label={`Move ${subject?.name ?? 'lesson'} from ${cls.class_name} ${cls.stream_name}`}
                                  aria-pressed={movingId === slot._id}
                                  title="Pick up to move"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    onPickUp(movingId === slot._id ? null : slot)
                                  }}
                                >
                                  <GripVertical size={12} />
                                </button>
                              ) : null}
                            </>
                          ) : (
                            <button
                              type="button"
                              className="slot-empty h-full w-full"
                              disabled={!canEdit}
                              onClick={() =>
                                movingId ? onMove(movingId, cls._id, day.value, period.n) : onCreate(cls._id, day.value, period.n)
                              }
                              aria-label={
                                movingId
                                  ? `Place the lesson at ${cls.class_name} ${cls.stream_name}, ${day.long} P${period.n}`
                                  : `Add a lesson at ${cls.class_name} ${cls.stream_name}, ${day.long} P${period.n}`
                              }
                              title={
                                canEdit
                                  ? movingId
                                    ? `Place the lesson here · ${day.long} P${period.n}`
                                    : `Add a lesson · ${cls.class_name} ${cls.stream_name} · ${day.long} P${period.n}`
                                  : 'Free period'
                              }
                            >
                              {compact ? '' : 'free'}
                            </button>
                          )}
                        </td>
                      )
                    }),
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] text-ink/40 no-print">
        <span className="font-semibold uppercase tracking-[0.1em]">Periods</span>
        {lessonColumns.map((period) => (
          <span key={period.n} className="font-mono">
            {period.n} {period.start}–{period.end}
          </span>
        ))}
      </div>

      {/* The key lists what the week actually uses: the catalogue holds over two
          hundred syllabuses, and a legend of all of them would be unreadable. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 no-print">
        {subjects
          .filter((subject) => slots.some((slot) => slot.subject_id === subject._id))
          .map((subject) => (
            <span key={subject._id} className="inline-flex items-center gap-1.5 text-[10.5px] text-ink/60">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: toneFor(subject._id, subjects) }}
              />
              <span className="font-mono text-[9.5px] font-semibold text-ink/45">{shortCode(subject.code)}</span>
              {subject.name}
            </span>
          ))}
      </div>
    </>
  )
}
