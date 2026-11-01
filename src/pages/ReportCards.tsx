import { useEffect, useMemo, useState } from 'react'
import { Printer, Save } from 'lucide-react'
import { api, useDb } from '../data/db'
import { useSession } from '../session'
import { Badge, Field, PageHeader, SectionTitle } from '../components/ui'
import { resolveScale } from '../lib/grading'
import { buildAcademicReport } from '../lib/academic-report'
import { AcademicReportSheet } from '../components/AcademicReportSheet'
import { usePrintPage } from '../lib/print'
import type { ReportCard } from '../data/types'
import { isOperationalStudent } from '../data/student-lifecycle'

const EMPTY: Omit<ReportCard, '_id' | 'student_id' | 'term_id' | 'updated_at'> = {
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
}

export default function ReportCards() {
  const db = useDb()
  const { session } = useSession()
  const school = db.schools[0] ?? { _id: 'school-unconfigured', name: 'IUPC Academy', code: '', address: '', postal: '', city: '', contact_email: '', phone_number: '', logo_url: null, crest_url: null, motto: '' }
  const scale = resolveScale(db.gradingScales)
  const isAdmin = session?.role === 'admin'

  const activeTerm = db.terms.find((term) => term.is_active) ?? db.terms[0]
  usePrintPage('report')
  const [termId, setTermId] = useState(activeTerm?._id ?? '')
  const [classId, setClassId] = useState(db.classes[0]?._id ?? '')
  const [studentId, setStudentId] = useState(
    db.students.find((student) => student.class_id === (db.classes[0]?._id ?? '') && isOperationalStudent(student))?._id ?? '',
  )

  const term = db.terms.find((t) => t._id === termId)
  const cls = db.classes.find((c) => c._id === classId)
  const classTeacher = db.teachers.find((teacher) => teacher._id === cls?.class_teacher_id)
  const historicalTermIds = new Set(db.terms.filter(t=>t.school_id===term?.school_id && t.academic_year===term?.academic_year && t.start_date <= term.start_date).map(t=>t._id))
  const historicalStudentIds = new Set(db.marks.filter(m=>db.exams.some(e=>e._id===m.exam_id && e.class_id===classId && historicalTermIds.has(e.term_id))).map(m=>m.student_id))
  const roster = db.students.filter(student => student.school_id===term?.school_id && ((student.class_id===classId && isOperationalStudent(student)) || (isAdmin && historicalStudentIds.has(student._id))))
  const student = roster.find((s) => s._id === studentId) ?? roster[0]

  useEffect(() => {
    if (!roster.some((row) => row._id === studentId)) setStudentId(roster[0]?._id ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId])

  const exams = useMemo(
    () =>
      db.exams
        .filter((exam) => exam.term_id === termId && exam.class_id === classId)
        .sort((a, b) => a.exam_date.localeCompare(b.exam_date)),
    [db.exams, termId, classId],
  )

  const reports = useMemo(() => {
    if (!term) return { reports: [], error: '' }
    try {
      return { reports: roster.map(row => ({ studentId: row._id, report: buildAcademicReport(db, row, termId, classId, scale.bands) })), error: '' }
    } catch (error) {
      return { reports: [], error: error instanceof Error ? error.message : 'Report unavailable.' }
    }
  }, [db, termId, classId, scale, term])
  const report = reports.reports.find(row => row.studentId === student?._id)?.report

  const record = db.reportCards.find((r) => r.student_id === student?._id && r.term_id === termId)
  const [form, setForm] = useState(EMPTY)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setForm(record ? { ...record } : { ...EMPTY })
    setSaved(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student?._id, termId, record?._id])

  async function save() {
    if (!student) return
    await api.reportCards.upsert(student._id, termId, form)
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1600)
  }

  return (
    <>
      <PageHeader
        title="Report Cards"
        subtitle="The end-of-term academic report, one student at a time"
        meta={
          <>
            <span>{cls?.class_name} {cls?.stream_name}</span>
            <span>{term?.name} {term?.academic_year}</span>
            <span>{exams.length} assessments in scope</span>
          </>
        }
        actions={
          <>
            <button type="button" className="btn btn-sm" onClick={() => window.print()} disabled={!student}>
              <Printer size={13} /> Print card
            </button>
            {isAdmin ? (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void save()} disabled={!student}>
                <Save size={13} /> {saved ? 'Saved' : 'Save card'}
              </button>
            ) : null}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-2 no-print">
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
          <span className="field-label">Class</span>
          <select className="select-field w-[160px]" value={classId} onChange={(event) => setClassId(event.target.value)}>
            {db.classes.map((option) => (
              <option key={option._id} value={option._id}>
                {option.class_name} {option.stream_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">Student</span>
          <select className="select-field w-[220px]" value={student?._id ?? ''} onChange={(event) => setStudentId(event.target.value)}>
            {roster.map((option) => (
              <option key={option._id} value={option._id}>
                {option.full_name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-5 xl:grid-cols-[320px_1fr]">
        {/* editing panel */}
        <aside className="no-print">
          <div className="card p-4">
            <SectionTitle>{isAdmin ? 'Editing panel' : 'Sign-off details'}</SectionTitle>
            {!isAdmin ? (
              <p className="mb-3 text-[11.5px] text-ink/50">Only administrators can edit attendance and the sign-off details.</p>
            ) : null}

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Field label="Days present">
                  <input
                    className="input-field figure"
                    type="number"
                    min={0}
                    value={form.attendance_present}
                    disabled={!isAdmin}
                    onChange={(event) => setForm({ ...form, attendance_present: Number(event.target.value) })}
                  />
                </Field>
                <Field label="Days in term">
                  <input
                    className="input-field figure"
                    type="number"
                    min={0}
                    value={form.attendance_total}
                    disabled={!isAdmin}
                    onChange={(event) => setForm({ ...form, attendance_total: Number(event.target.value) })}
                  />
                </Field>
              </div>

              <Field label="Class teacher">
                <input
                  className="input-field"
                  value={classTeacher?.full_name ?? ''}
                  disabled
                  placeholder="Assign in Admin Settings"
                />
              </Field>

              <p className="rounded border border-dashed border-rule px-2.5 py-2 text-[11px] leading-snug text-ink/55">
                Remarks are handwritten. The academic, activities, conduct and HSE blocks print blank with ruled
                lines; the principal and class-teacher signatories come from Admin Settings.
              </p>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Next term begins">
                  <input
                    className="input-field"
                    type="date"
                    value={form.next_term_begins}
                    disabled={!isAdmin}
                    onChange={(event) => setForm({ ...form, next_term_begins: event.target.value })}
                  />
                </Field>
                <Field label="Next term ends">
                  <input
                    className="input-field"
                    type="date"
                    value={form.next_term_ends}
                    disabled={!isAdmin}
                    onChange={(event) => setForm({ ...form, next_term_ends: event.target.value })}
                  />
                </Field>
              </div>

              {isAdmin ? (
                <button type="button" className="btn btn-primary btn-sm w-full" onClick={() => void save()} disabled={!student}>
                  <Save size={13} /> {saved ? 'Saved' : 'Save for this term'}
                </button>
              ) : (
                <Badge tone="neutral">Read-only</Badge>
              )}
            </div>
          </div>
        </aside>

        {/* the report sheet */}
        <div className="academic-scroll report-scroll" role="region" aria-label="Student report card; scroll horizontally to view all columns" tabIndex={0}>
          {!student ? (
            <p className="rounded border border-dashed border-rule px-4 py-10 text-center text-[12.5px] text-ink/45">
              No students in this stream.
            </p>
          ) : (
            report ? <AcademicReportSheet school={school} student={student} cls={cls} report={report} population={reports.reports.map(r=>r.report)} bands={scale.bands} record={form} classTeacherName={term?.is_active ? classTeacher?.full_name : undefined} /> : <p role="alert">{reports.error}</p>
          )}
        </div>
      </div>
    </>
  )
}
