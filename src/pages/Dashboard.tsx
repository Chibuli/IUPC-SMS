import { Link } from 'react-router-dom'
import { ArrowRight, BookOpen, CalendarClock, FileText, GraduationCap, Users } from 'lucide-react'
import { useDb } from '../data/db'
import { isOperationalStudent } from '../data/student-lifecycle'
import { useSession } from '../session'
import { Badge, GradePill, PageHeader, ProgressBar, SectionTitle, StatCard } from '../components/ui'
import { displayScore, gradeForMark, resolveScale } from '../lib/grading'
import { formatDate, round } from '../lib/format'

export default function Dashboard() {
  const db = useDb()
  const { session, teacher, canEditExam, subjectScope } = useSession()
  const school = db.schools[0] ?? { _id: 'school-unconfigured', name: 'IUPC Academy', code: '', address: '', postal: '', city: '', contact_email: '', phone_number: '', logo_url: null, crest_url: null, motto: '' }
  const activeTerm = db.terms.find((term) => term.is_active) ?? db.terms[0]
  const scale = resolveScale(db.gradingScales)

  const visibleExams = db.exams
    .filter((exam) => exam.term_id === activeTerm?._id)
    .filter((exam) => !subjectScope || subjectScope.includes(exam.subject_id))
    .sort((a, b) => b.exam_date.localeCompare(a.exam_date))

  const rosterFor = (classId: string) =>
    db.students.filter((student) => student.class_id === classId && isOperationalStudent(student))

  const operationalStudentIds = new Set(db.students.filter(isOperationalStudent).map((student) => student._id))
  const enteredFor = (examId: string) => db.marks.filter((mark) => mark.exam_id === examId && operationalStudentIds.has(mark.student_id) && mark.score !== null).length

  const recent = [...db.marks]
    .filter((mark) => operationalStudentIds.has(mark.student_id) && mark.score !== null)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 6)

  const totalLessons = db.timetableSlots.filter((slot) => slot.term_id === activeTerm?._id).length

  return (
    <div className="overview-page">
      <section className="overview-heading" aria-label="Academic overview">
      <p className="overview-eyebrow">Academic overview</p>
      <PageHeader
        title={session?.role === 'teacher' ? `Good day, ${session.name}` : 'Overview'}
        subtitle={
          session?.role === 'teacher'
            ? `${school.name} · ${subjectScope ? `${subjectScope.length} subjects assigned` : 'Every subject in view'}${teacher?.assigned_class_ids?.length ? ` · ${teacher.assigned_class_ids.length} class${teacher.assigned_class_ids.length === 1 ? '' : 'es'} assigned` : ''}`
            : session?.role === 'guest'
              ? 'Read-only preview of the campus record.'
              : `${school.name} · Mombasa, Kenya`
        }
        meta={
          <>
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock size={15} /> Active term: <span className="font-medium text-ink/80">{activeTerm ? `${activeTerm.name} · ${activeTerm.academic_year}` : 'Not configured'}</span>
            </span>
            <span>{db.classes.length} streams · {totalLessons} lessons on the board</span>
          </>
        }
        actions={
          <>
            <Link to="/dashboard/timetable" className="btn btn-sm">
              Open timetable
            </Link>
            <Link to="/dashboard/marks-entry" className="btn btn-primary btn-sm">
              Marks entry <ArrowRight size={14} />
            </Link>
          </>
        }
      />
      </section>

      <div className="overview-stats grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="School statistics">
        <StatCard
          label="Active students"
          value={db.students.filter(isOperationalStudent).length}
          hint={`${db.students.length} on roll`}
          icon={Users}
        />
        <StatCard label="Classes & streams" value={db.classes.length} hint="Form groups" icon={GraduationCap} tone="ink" />
        <StatCard
          label="Subjects"
          value={db.subjects.filter((subject) => subject.offered).length}
          hint={`${db.subjects.length} Cambridge syllabuses`}
          icon={BookOpen}
          tone="brass"
        />
        <StatCard
          label={`Exams · ${activeTerm?.name ?? '—'}`}
          value={visibleExams.length}
          hint={activeTerm ? `${activeTerm.academic_year}` : 'No active term'}
          icon={FileText}
          tone="ok"
        />
      </div>

      <div className="overview-detail-grid mt-7 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <section className="overview-exams min-w-0">
          <SectionTitle right={<span className="text-[11px] text-ink/45">{visibleExams.length} papers</span>}>
            Exams in {activeTerm?.name ?? 'term'}
          </SectionTitle>
          {visibleExams.length === 0 ? (
            <p className="overview-empty rounded border border-dashed border-rule px-4 py-8 text-center text-[12.5px] text-ink/45">
              No exams scheduled for this term.
            </p>
          ) : (
            <div className="overview-exam-table card overflow-hidden">
              <div className="overflow-x-auto" role="region" aria-label="Current term examinations" tabIndex={0}>
                <table className="data-table min-w-[560px]">
                <thead>
                  <tr>
                    <th>Subject · exam</th>
                    <th>Class</th>
                    <th>Date</th>
                    <th className="text-right">Max</th>
                    <th>Progress</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visibleExams.map((exam) => {
                    const subject = db.subjects.find((s) => s._id === exam.subject_id)
                    const cls = db.classes.find((c) => c._id === exam.class_id)
                    const roster = rosterFor(exam.class_id).length
                    const entered = enteredFor(exam._id)
                    const permission = canEditExam(exam)
                    const complete = roster > 0 && entered >= roster
                    return (
                      <tr key={exam._id}>
                        <td>
                          <p className="font-medium">{subject?.name ?? 'Unknown subject'}</p>
                          <p className="text-[11px] text-ink/45">
                            {exam.exam_name}
                            {exam.exam_type !== exam.exam_name ? ` · ${exam.exam_type}` : ''}
                          </p>
                        </td>
                        <td className="whitespace-nowrap text-[12px]">
                          {cls?.class_name} {cls?.stream_name}
                        </td>
                        <td className="whitespace-nowrap text-[12px] text-ink/60">{formatDate(exam.exam_date)}</td>
                        <td className="num">{exam.max_score}</td>
                        <td className="w-[130px]">
                          <div className="flex items-center gap-2">
                            <ProgressBar value={entered} total={roster} tone={complete ? 'ok' : 'brass'} />
                            <span className="whitespace-nowrap font-mono text-[11px] text-ink/55">
                              {entered}/{roster}
                            </span>
                          </div>
                          {!permission.editable ? (
                            <span className="mt-1 inline-block text-[10px] uppercase tracking-[0.1em] text-danger">Read-only</span>
                          ) : null}
                        </td>
                        <td className="text-right">
                          <Link to={`/dashboard/exams/${exam._id}/entry`} className="btn btn-sm">
                            {permission.editable ? 'Enter' : 'View'}
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="overview-score-guide mt-3 flex flex-wrap items-center gap-4 rounded border border-brass/30 bg-brass/8 px-3 py-2 text-[11.5px] text-brass-deep">
            <span className="font-semibold uppercase tracking-[0.1em]">Score codes</span>
            <span>
              <strong>X</strong> — missing marks (absent or incomplete assessment)
            </span>
            <span>
              <strong>Y</strong> — examination irregularity
            </span>
          </div>
        </section>

        <section className="overview-recent min-w-0">
          <SectionTitle>Recent marks</SectionTitle>
          <div className="overview-marks card divide-y divide-rule">
            {recent.length === 0 ? (
              <p className="px-4 py-6 text-center text-[12px] text-ink/45">No marks entered yet.</p>
            ) : (
              recent.map((mark) => {
                const student = db.students.find((s) => s._id === mark.student_id)
                const exam = db.exams.find((e) => e._id === mark.exam_id)
                const subject = db.subjects.find((s) => s._id === exam?.subject_id)
                const grade =
                  typeof mark.score === 'number'
                    ? gradeForMark(mark.score, exam?.max_score ?? 100, scale.bands)
                    : (mark.score ?? '—')
                return (
                  <div key={mark._id} className="overview-mark-row flex items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-medium">{student?.full_name}</p>
                      <p className="text-[11px] text-ink/45">
                        {subject?.name} · {exam?.exam_name}
                      </p>
                    </div>
                    <span className="figure text-[12px] text-ink/70">{displayScore(mark.score)}</span>
                    <GradePill grade={String(grade)} size="sm" />
                  </div>
                )
              })
            )}
          </div>

          <div className="overview-term mt-4 card p-3.5">
            <p className="micro">This term</p>
            <dl className="mt-2 space-y-1.5 text-[12.5px]">
              <div className="flex justify-between">
                <dt className="text-ink/55">Mean score</dt>
                <dd className="figure">{round(
                  (() => {
                    const values = db.marks
                      .filter((m) => operationalStudentIds.has(m.student_id) && typeof m.score === 'number' && visibleExams.some((e) => e._id === m.exam_id))
                      .map((m) => m.score as number)
                    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
                  })(),
                )}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink/55">Marks entered</dt>
                <dd className="figure">
                  {db.marks.filter((m) => operationalStudentIds.has(m.student_id) && visibleExams.some((e) => e._id === m.exam_id) && m.score !== null).length}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink/55">Grading scale</dt>
                <dd className="text-right text-ink/75">{scale.name}</dd>
              </div>
            </dl>
            <Link to="/dashboard/reports" className="btn btn-sm mt-3 w-full">
              Open broadsheet
            </Link>
          </div>

          {session?.role === 'guest' ? (
            <p className="mt-4">
              <Badge tone="brass">Read-only</Badge>{' '}
              <span className="text-[11.5px] text-ink/50">Guest access cannot change records.</span>
            </p>
          ) : null}
        </section>
      </div>
    </div>
  )
}
