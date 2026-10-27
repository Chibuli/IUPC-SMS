import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Building2, GraduationCap, Plus, Printer, Users } from 'lucide-react'
import { api, useDb } from '../data/db'
import { useSession } from '../session'
import { Avatar, Badge, EmptyState, Field, Modal, PageHeader, SectionTitle, StatCard } from '../components/ui'
import { AccessBadge } from '../components/permissions'
import { formatDate } from '../lib/format'
import { usePrintPage } from '../lib/print'

export default function Classes() {
  const db = useDb()
  const { session } = useSession()
  const school = db.schools[0]
  const navigate = useNavigate()
  usePrintPage('classlist')
  const [printClassId, setPrintClassId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [className, setClassName] = useState('')
  const [streamName, setStreamName] = useState('')
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')

  const isAdmin = session?.role === 'admin'

  const grouped = useMemo(() => {
    const map = new Map<string, typeof db.classes>()
    for (const cls of db.classes) {
      const list = map.get(cls.class_name) ?? []
      list.push(cls)
      map.set(cls.class_name, list)
    }
    // Numeric, so Year 7 comes before Year 10 rather than after Year 13.
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
  }, [db.classes])

  const rosterOf = (classId: string) =>
    db.students.filter((student) => student.class_id === classId && student.status === 'Active')

  const printRows = printClassId ? rosterOf(printClassId) : []
  const printClass = printClassId ? db.classes.find((c) => c._id === printClassId) : null

  function printList(classId: string) {
    setPrintClassId(classId)
    window.setTimeout(() => window.print(), 60)
  }

  function startStream() {
    const group = className.trim() || grouped[0]?.[0] || 'Form 1'
    setClassName(group)
    setStreamName('')
    setFormError('')
    setAdding(true)
  }

  async function addStream() {
    const group = className.trim().replace(/\s+/g, ' ')
    const stream = streamName.trim().toUpperCase().replace(/\s+/g, ' ')
    if (!group) return setFormError('Name the class group, e.g. Form 4.')
    if (!stream) return setFormError('Give the stream a label, e.g. A.')
    const clash = db.classes.some(
      (cls) => cls.class_name.toLowerCase() === group.toLowerCase() && cls.stream_name.toUpperCase() === stream,
    )
    if (clash) return setFormError(`${group} ${stream} already exists — pick another stream label.`)
    await api.classes.create({ class_name: group, stream_name: stream })
    setNotice(`${group} ${stream} added — admit students to fill it.`)
    setAdding(false)
    setStreamName('')
  }

  return (
    <>
      <PageHeader
        title="Classes & Teachers"
        subtitle="Streams, staffing and the printed class list"
        meta={
          <>
            <span>{db.classes.length} streams</span>
            <span>{db.teachers.length} staff</span>
            <span>{db.subjects.filter((subject) => subject.offered).length} subjects</span>
          </>
        }
        actions={
          isAdmin ? (
            <button
              type="button"
              className="btn btn-primary w-full justify-center sm:w-auto"
              onClick={() => startStream()}
            >
              <Plus size={15} /> Add class
            </button>
          ) : (
            <p className="text-[12px] text-ink/50">
              {session?.role === 'teacher'
                ? 'Read-only — the registrar creates class streams.'
                : 'Sign in as registrar to create class streams.'}
            </p>
          )
        }
      />

      {notice ? (
        <p
          role="status"
          className="mb-4 flex items-center justify-between gap-3 rounded border border-ok/30 bg-ok/8 px-3 py-2 text-[12px] text-ok"
        >
          <span>{notice}</span>
          <button type="button" className="text-[11px] font-medium text-ok/70 hover:text-ok" onClick={() => setNotice('')}>
            Dismiss
          </button>
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 no-print">
        <StatCard label="Active students" value={db.students.filter((s) => s.status === 'Active').length} icon={Users} />
        <StatCard label="Streams" value={db.classes.length} hint={`${grouped.length} class groups`} icon={GraduationCap} tone="ink" />
        <StatCard label="Staff" value={db.teachers.length} icon={Building2} tone="brass" />
        <StatCard
          label="Subjects"
          value={db.subjects.filter((subject) => subject.offered).length}
          hint={`${db.subjects.length} in catalogue`}
          icon={GraduationCap}
          tone="ok"
        />
      </div>

      <section className="mt-7 no-print">
        <SectionTitle>Classes &amp; streams</SectionTitle>
        <div className="grid gap-3 md:grid-cols-2">
          {grouped.map(([className, streams]) => (
            <div key={className} className="card card-hover p-4">
              <div className="flex items-baseline justify-between">
                <h3 className="text-[14px] font-semibold">{className}</h3>
                <span className="text-[11px] text-ink/45">
                  {streams.length} stream{streams.length === 1 ? '' : 's'}
                </span>
              </div>
              <ul className="mt-2 divide-y divide-rule">
                {streams.map((stream) => {
                  const roster = rosterOf(stream._id)
                  return (
                    <li key={stream._id} className="flex items-center justify-between gap-2 py-2">
                      <div>
                        <p className="text-[13px] font-medium">
                          {stream.class_name} {stream.stream_name}
                        </p>
                        <p className="text-[11px] text-ink/45">
                          {roster.length} active student{roster.length === 1 ? '' : 's'}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {isAdmin ? (
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => navigate('/dashboard/students', { state: { admitInto: stream._id } })}
                          >
                            <Plus size={13} /> Student
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => printList(stream._id)}
                          disabled={roster.length === 0}
                        >
                          <Printer size={13} /> Print list
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-7 no-print">
        <SectionTitle
          right={
            <Link to="/dashboard/teachers" className="text-[11px] font-medium text-crimson hover:underline">
              Manage on the staff register →
            </Link>
          }
        >
          Staff directory
        </SectionTitle>
        <div className="card divide-y divide-rule">
          {db.teachers.map((teacher) => {
            const assigned = db.subjects.filter((subject) => teacher.assigned_subject_ids.includes(subject._id))
            return (
              <div key={teacher._id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Avatar name={teacher.full_name} size={34} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium">{teacher.full_name}</p>
                    <p className="text-[11px] text-ink/45">
                      {teacher.email} · {teacher.employee_id}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {assigned.length === 0 ? (
                      <span className="text-[11px] text-ink/40">No subjects assigned</span>
                    ) : (
                      assigned.map((subject) => (
                        <span key={subject._id} className="chip">
                          {subject.code}
                        </span>
                      ))
                    )}
                  </div>
                  <AccessBadge teacher={teacher} />
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="mt-7 no-print">
        <SectionTitle
          right={
            <span className="text-[11px] text-ink/45">
              {db.subjects.length} Cambridge syllabuses in the catalogue
            </span>
          }
        >
          Subjects taught here
        </SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {db.subjects
            .filter((subject) => subject.offered)
            .map((subject) => (
              <span key={subject._id} className="chip chip-brass">
                {subject.code} · {subject.name}
              </span>
            ))}
        </div>
      </section>

      {/* ── A4 portrait class list ─────────────────────────────────── */}
      {printClass ? (
        <div className="print-only sheet sheet-classlist print-page p-0 text-[11px]">
          <div className="mb-4 flex items-start justify-between border-b border-ink/20 pb-2">
            <div>
              <p className="text-[15px] font-semibold">{school.name}</p>
              <p className="text-[9.5px] text-ink/60">
                {school.address} · {school.postal} · {school.city}
              </p>
              <p className="text-[9.5px] text-ink/60">
                {school.phone_number} · {school.contact_email}
              </p>
            </div>
            <div className="text-right text-[9.5px] text-ink/60">
              <p>Printed {formatDate(new Date().toISOString())}</p>
              <p>{printRows.length} students</p>
            </div>
          </div>

          <h2 className="text-center text-[13px] font-semibold uppercase tracking-[0.16em]">Class List</h2>
          <p className="mb-3 text-center text-[10.5px] text-ink/60">
            {printClass.class_name} {printClass.stream_name} · {printRows.length} students
          </p>

          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr>
                {['#', 'Admission no.', 'Student name', 'Gender'].map((heading) => (
                  <th key={heading} className="border border-ink/25 bg-ink/5 px-2 py-1 text-left font-semibold uppercase tracking-[0.08em]">
                    {heading}
                  </th>
                ))}
                {/* A blank column at the end: ruled space the class teacher can
                    write in on the printed sheet. Deliberately empty, and wide
                    enough (4.5cm) to hold a handwritten remark. */}
                <th
                  aria-label="Blank column"
                  className="w-[4.5cm] min-w-[4.5cm] border border-ink/25 bg-ink/5 px-2 py-1"
                />
              </tr>
            </thead>
            <tbody>
              {printRows.map((student, index) => (
                <tr key={student._id}>
                  <td className="border border-ink/15 px-2 py-1 tabular-nums">{index + 1}</td>
                  <td className="border border-ink/15 px-2 py-1 font-mono">{student.admission_number}</td>
                  <td className="border border-ink/15 px-2 py-1">{student.full_name}</td>
                  <td className="border border-ink/15 px-2 py-1">{student.gender}</td>
                  <td aria-hidden="true" className="w-[4.5cm] min-w-[4.5cm] border border-ink/15" />
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-14 flex justify-between text-[9.5px] text-ink/70">
            <div className="w-[46%] border-t border-ink/40 pt-1">Class teacher</div>
            <div className="w-[46%] border-t border-ink/40 pt-1">Head teacher</div>
          </div>
        </div>
      ) : null}

      {db.classes.length === 0 ? (
        <EmptyState
          title="No streams configured"
          hint="Add a class and stream pair to begin; students and timetables hang off them."
          action={
            isAdmin ? (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => startStream()}>
                <Plus size={13} /> Add class
              </button>
            ) : null
          }
        />
      ) : null}

      <Modal
        open={adding}
        title="Add class &amp; stream"
        onClose={() => setAdding(false)}
        footer={
          <>
            <button type="button" className="btn btn-sm" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void addStream()}>
              Save class
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Class" hint="The form or year group this stream belongs to.">
            <input
              className="input-field"
              autoFocus
              list="class-groups"
              value={className}
              onChange={(event) => setClassName(event.target.value)}
              placeholder="Form 4"
            />
            <datalist id="class-groups">
              {grouped.map(([group]) => (
                <option key={group} value={group} />
              ))}
            </datalist>
          </Field>
          <Field label="Stream" hint="A single letter or short label, stored in upper case.">
            <input
              className="input-field uppercase"
              value={streamName}
              onChange={(event) => setStreamName(event.target.value)}
              placeholder="B"
              onKeyDown={(event) => {
                if (event.key === 'Enter') void addStream()
              }}
            />
          </Field>
          {className.trim() && streamName.trim() ? (
            <p className="text-[11.5px] text-ink/50">
              Creates <span className="font-medium text-ink/75">{className.trim()} {streamName.trim().toUpperCase()}</span> — empty
              until students are admitted to it.
            </p>
          ) : null}
          {formError ? (
            <p role="alert" className="rounded border border-danger/30 bg-danger/8 px-3 py-2 text-[12px] text-danger">
              {formError}
            </p>
          ) : null}
        </div>
      </Modal>

      {session?.role === 'guest' ? (
        <p className="mt-4">
          <Badge tone="brass">Read-only</Badge> <span className="text-[11.5px] text-ink/50">Staff assignments are visible but locked.</span>
        </p>
      ) : null}
    </>
  )
}
