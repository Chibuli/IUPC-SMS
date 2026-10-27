import { useState } from 'react'
import { CheckCircle2, Plus } from 'lucide-react'
import { api, useDb } from '../data/db'
import { useSession } from '../session'
import { Badge, Field, Modal, PageHeader, SectionTitle } from '../components/ui'
import { formatDate } from '../lib/format'

export default function Terms() {
  const db = useDb()
  const { session } = useSession()
  const isAdmin = session?.role === 'admin'
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [year, setYear] = useState('2026/2027')
  const [startDate, setStartDate] = useState('2026-09-07')

  const examsFor = (termId: string) => db.exams.filter((exam) => exam.term_id === termId)
  const subjectsFor = (termId: string) =>
    new Set(examsFor(termId).map((exam) => exam.subject_id)).size

  async function addTerm() {
    if (!name.trim() || !year.trim()) return
    await api.terms.create(name.trim().toUpperCase(), year.trim(), startDate)
    setName('')
    setOpen(false)
  }

  return (
    <>
      <PageHeader
        title="Academic Terms"
        subtitle="One term is open for evaluation at a time"
        meta={<span>{db.terms.length} terms · {db.terms.filter((t) => t.is_active).length} active</span>}
        actions={
          isAdmin ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
              <Plus size={14} /> Add term
            </button>
          ) : null
        }
      />

      <div className="grid gap-3 md:grid-cols-2">
        {[...db.terms]
          .sort((a, b) => b.academic_year.localeCompare(a.academic_year) || b.name.localeCompare(a.name))
          .map((term) => {
            const exams = examsFor(term._id)
            return (
              <div key={term._id} className={`card p-4 ${term.is_active ? 'border-brass/60' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-[15px] font-semibold">
                      {term.name} <span className="text-ink/45">·</span> {term.academic_year}
                    </h3>
                    <p className="mt-0.5 text-[11.5px] text-ink/50">Starts {formatDate(term.start_date)}</p>
                  </div>
                  <Badge tone={term.is_active ? 'brass' : 'neutral'}>{term.is_active ? 'Active' : 'Closed'}</Badge>
                </div>

                <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-rule pt-3 text-[12px]">
                  <div>
                    <dt className="micro">Exams</dt>
                    <dd className="figure mt-0.5 text-[15px]">{exams.length}</dd>
                  </div>
                  <div>
                    <dt className="micro">Subjects</dt>
                    <dd className="figure mt-0.5 text-[15px]">{subjectsFor(term._id)}</dd>
                  </div>
                  <div>
                    <dt className="micro">Weeks</dt>
                    <dd className="figure mt-0.5 text-[15px]">12</dd>
                  </div>
                </dl>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <p className="text-[11.5px] text-ink/45">
                    {term.is_active ? 'Open for evaluation' : 'Records retained'}
                  </p>
                  {isAdmin && !term.is_active ? (
                    <button type="button" className="btn btn-sm" onClick={() => void api.terms.activate(term._id)}>
                      <CheckCircle2 size={13} /> Make active
                    </button>
                  ) : null}
                  {isAdmin && term.is_active ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-ok">
                      <CheckCircle2 size={12} /> Current
                    </span>
                  ) : null}
                </div>
              </div>
            )
          })}
      </div>

      <section className="mt-6">
        <SectionTitle>How activation works</SectionTitle>
        <p className="max-w-2xl text-[12.5px] leading-relaxed text-ink/55">
          Activating a term re-routes new exams, mark entry and printed reports to that window. Closed terms
          keep their exams, marks, broadsheets and report cards exactly as they were.
        </p>
      </section>

      <Modal
        open={open}
        title="Add academic term"
        onClose={() => setOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void addTerm()} disabled={!name.trim() || !year.trim()}>
              Save term
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Term name" hint="Stored in upper case, e.g. TERM 1.">
            <input className="input-field uppercase" value={name} onChange={(event) => setName(event.target.value)} placeholder="TERM 1" />
          </Field>
          <Field label="Academic year">
            <input className="input-field" value={year} onChange={(event) => setYear(event.target.value)} placeholder="2026/2027" />
          </Field>
          <Field label="First teaching day" hint="Week dates are derived from the first Monday on or after 1 September.">
            <input className="input-field" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </Field>
        </div>
      </Modal>
    </>
  )
}
