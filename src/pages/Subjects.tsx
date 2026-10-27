import { useMemo, useState } from 'react'
import { Check, Plus, Search, Trash2, Undo2 } from 'lucide-react'
import { api, useDb } from '../data/db'
import { useSession } from '../session'
import { Badge, EmptyState, Field, Modal, PageHeader, SectionTitle } from '../components/ui'
import { LEVEL_ORDER, countByLevel, filterSubjects, groupByLevel } from '../lib/subjects'
import type { SubjectLevel } from '../data/types'

type OfferedFilter = 'all' | 'offered' | 'catalogue'

export default function Subjects() {
  const db = useDb()
  const { session } = useSession()
  const isAdmin = session?.role === 'admin'

  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [category, setCategory] = useState('Sciences')
  const [level, setLevel] = useState<SubjectLevel>('IGCSE')

  const [query, setQuery] = useState('')
  const [levelFilter, setLevelFilter] = useState<SubjectLevel | 'all'>('all')
  const [offeredFilter, setOfferedFilter] = useState<OfferedFilter>('all')

  const shown = useMemo(
    () => filterSubjects(db.subjects, { query, level: levelFilter, offered: offeredFilter }),
    [db.subjects, query, levelFilter, offeredFilter],
  )
  const grouped = useMemo(() => groupByLevel(shown), [shown])
  const levels = useMemo(() => countByLevel(db.subjects), [db.subjects])

  const examCount = (subjectId: string) => db.exams.filter((exam) => exam.subject_id === subjectId).length
  const lessonCount = (subjectId: string) => db.timetableSlots.filter((slot) => slot.subject_id === subjectId).length

  const offeredCount = db.subjects.filter((subject) => subject.offered).length
  const filtered = Boolean(query.trim()) || levelFilter !== 'all' || offeredFilter !== 'all'

  async function addSubject() {
    if (!name.trim() || !code.trim()) return
    await api.subjects.create(name.trim(), code.trim(), category.trim() || 'General', level)
    setName('')
    setCode('')
    setOpen(false)
  }

  return (
    <>
      <PageHeader
        title="Subjects"
        subtitle="Every subject Cambridge examines, with its official syllabus code — plus whatever this campus offers"
        meta={
          <>
            <span>
              {offeredCount} offered · {db.subjects.length} in the catalogue
            </span>
            <span>{levels.length} syllabus levels</span>
          </>
        }
        actions={
          isAdmin ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)} data-action="add-subject">
              <Plus size={14} /> Add subject
            </button>
          ) : null
        }
      />

      <div className="card mb-4 flex flex-wrap items-end gap-2 p-3">
        <label className="min-w-0 flex-1">
          <span className="field-label">Find a subject</span>
          <span className="relative block">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
            <input
              className="input-field pl-8"
              value={query}
              data-field="subject-search"
              placeholder="Name or syllabus code, e.g. Swahili or 0580"
              onChange={(event) => setQuery(event.target.value)}
            />
          </span>
        </label>
        <label className="min-w-0 sm:w-[210px]">
          <span className="field-label">Syllabus level</span>
          <select
            className="select-field"
            value={levelFilter}
            data-filter="subject-level"
            onChange={(event) => setLevelFilter(event.target.value as SubjectLevel | 'all')}
          >
            <option value="all">All levels</option>
            {levels.map((entry) => (
              <option key={entry.level} value={entry.level}>
                {entry.label} ({entry.total})
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 sm:w-[190px]">
          <span className="field-label">Show</span>
          <select
            className="select-field"
            value={offeredFilter}
            data-filter="subject-offered"
            onChange={(event) => setOfferedFilter(event.target.value as OfferedFilter)}
          >
            <option value="all">Everything</option>
            <option value="offered">Offered here</option>
            <option value="catalogue">Not offered</option>
          </select>
        </label>
        {filtered ? (
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setQuery('')
              setLevelFilter('all')
              setOfferedFilter('all')
            }}
          >
            Reset
          </button>
        ) : null}
      </div>

      {grouped.length === 0 ? (
        <EmptyState
          title="No subject matches that"
          hint="Clear the search or widen the level filter — the catalogue holds every Cambridge syllabus."
        />
      ) : (
        <div className="space-y-6">
          {grouped.map((group) => (
            <section key={group.level} data-level={group.level}>
              <SectionTitle
                right={
                  <span className="text-[11px] text-ink/45">
                    {group.subjects.filter((subject) => subject.offered).length} offered · {group.subjects.length} listed
                  </span>
                }
              >
                {group.label}
              </SectionTitle>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {group.subjects.map((subject) => {
                  const used = examCount(subject._id)
                  const lessons = lessonCount(subject._id)
                  return (
                    <div key={subject._id} className="card card-hover flex items-start justify-between gap-2 p-3" data-subject={subject._id}>
                      <div className="min-w-0">
                        <p className="min-w-0 text-[13px] font-medium leading-snug" title={subject.name}>
                          {subject.name}
                        </p>
                        <p className="mt-1 flex flex-wrap items-center gap-1.5">
                          {/* Cambridge's own syllabus code, exactly as published. */}
                          <span className="rounded border border-ink/15 bg-sunken px-1.5 py-0.5 font-mono text-[11px] font-semibold text-ink/75">
                            {subject.code}
                          </span>
                          <span className="chip">{subject.category}</span>
                        </p>
                        <p className="mt-1.5 text-[10.5px] text-ink/45">
                          {used} exam{used === 1 ? '' : 's'} · {lessons} lesson{lessons === 1 ? '' : 's'}
                          {subject.offered ? '' : ' · not offered here'}
                        </p>
                      </div>
                      {isAdmin ? (
                        <div className="flex shrink-0 flex-col items-center gap-2">
                          <button
                            type="button"
                            className={`btn btn-sm ${subject.offered ? 'text-ok' : ''}`}
                            data-action="toggle-offered"
                            aria-pressed={subject.offered}
                            title={
                              subject.offered
                                ? 'Offered here — withdraw it from the timetable, exams and staff subject picker'
                                : 'Add this subject to what the campus offers'
                            }
                            onClick={() => void api.subjects.setOffered(subject._id, !subject.offered)}
                          >
                            {subject.offered ? <Check size={13} /> : <Plus size={13} />}
                            {subject.offered ? 'Offered' : 'Offer'}
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete ${subject.name}`}
                            className="text-ink/25 transition hover:text-danger disabled:opacity-30"
                            disabled={used > 0}
                            title={used > 0 ? 'Cannot delete: exams reference this subject' : 'Delete subject'}
                            onClick={() => void api.subjects.remove(subject._id)}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <p className="mt-5 text-[11.5px] leading-relaxed text-ink/50">
        <Badge tone="brass">Official codes</Badge> Codes are Cambridge syllabus codes, never school-minted ones — the
        same number a candidate enters with on an entry form. Only offered subjects appear in the timetable, in new exam
        papers and in the staff register&rsquo;s subject picker.
      </p>

      <Modal
        open={open}
        title="Add subject"
        onClose={() => setOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => void addSubject()}
              disabled={!name.trim() || !code.trim()}
            >
              Save subject
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Subject name">
            <input className="input-field" value={name} onChange={(event) => setName(event.target.value)} placeholder="Mathematics" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Syllabus code" hint="Cambridge's own code, e.g. 0580.">
              <input
                className="input-field font-mono"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="0580"
              />
            </Field>
            <Field label="Syllabus level">
              <select className="select-field" value={level} onChange={(event) => setLevel(event.target.value as SubjectLevel)}>
                {LEVEL_ORDER.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Faculty">
            <input
              className="input-field"
              list="subject-categories"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              placeholder="Sciences"
            />
            <datalist id="subject-categories">
              {[...new Set(db.subjects.map((subject) => subject.category))].sort().map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          </Field>
          <p className="text-[11.5px] text-ink/50">
            A subject added here is offered immediately. Use <strong>School subjects</strong> as the level for anything
            Cambridge does not examine.
          </p>
        </div>
      </Modal>

      {!isAdmin ? (
        <p className="mt-3">
          <Badge tone="neutral">Read-only</Badge>{' '}
          <span className="text-[11.5px] text-ink/50">
            Only administrators can change the catalogue. <Undo2 size={11} className="inline" /> Withdrawing a subject
            leaves its recorded marks alone.
          </span>
        </p>
      ) : null}
    </>
  )
}
