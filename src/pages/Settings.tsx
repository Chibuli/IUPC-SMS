import { useEffect, useState } from 'react'
import { RotateCcw, Save, ShieldAlert, UserCog } from 'lucide-react'
import { api, useDb } from '../data/db'
import { supabaseConfigured } from '../data/supabase'
import { useSession } from '../session'
import { Badge, Field, PageHeader, SectionTitle } from '../components/ui'
import { TeacherPermissionsPanel } from '../components/permissions'
import { DEFAULT_BANDS, DEFAULT_SCALE, resolveScale } from '../lib/grading'
import { hasPermission } from '../lib/permissions'
import { formatDateTime } from '../lib/format'
import type { GradeBand } from '../data/types'

export default function Settings() {
  const db = useDb()
  const { session } = useSession()
  const school = db.schools[0] ?? { _id: 'school-unconfigured', name: 'IUPC Academy', code: '', address: '', postal: '', city: '', contact_email: '', phone_number: '', logo_url: null, crest_url: null, motto: '' }
  const scale = resolveScale(db.gradingScales)
  const isAdmin = session?.role === 'admin'

  const [name, setName] = useState(scale.name)
  const [passMark, setPassMark] = useState(scale.pass_mark)
  const [bands, setBands] = useState<GradeBand[]>(scale.bands.map((band) => ({ ...band })))
  const [saved, setSaved] = useState(false)
  const [permissionsOpen, setPermissionsOpen] = useState(false)
  const [principalName, setPrincipalName] = useState(school.principal_name ?? '')
  const [principalSaved, setPrincipalSaved] = useState(false)

  useEffect(() => setPrincipalName(school.principal_name ?? ''), [school._id, school.principal_name])

  const mayEnterMarks = db.teachers.filter((teacher) => hasPermission(teacher, 'marks.enter')).length
  const awaitingSignUp = db.teachers.filter((teacher) => !teacher.password_hash).length
  const closing = db.markWindows[0]?.closes_at ?? null

  useEffect(() => {
    setName(scale.name)
    setPassMark(scale.pass_mark)
    setBands(scale.bands.map((band) => ({ ...band })))
  }, [scale._id, scale.name, scale.pass_mark, scale.bands])

  async function saveScale() {
    await api.gradingScales.save({
      _id: scale._id,
      school_id: school._id,
      name,
      pass_mark: Number(passMark),
      created_at: new Date().toISOString(),
      bands: bands.map((band) => ({ ...band, min_score: Number(band.min_score), points: Number(band.points) })),
    })
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1600)
  }

  function updateBand(index: number, patch: Partial<GradeBand>) {
    setBands((current) => current.map((band, i) => (i === index ? { ...band, ...patch } : band)))
  }

  async function savePrincipalName() {
    await api.schools.setPrincipalName(principalName)
    setPrincipalSaved(true)
    window.setTimeout(() => setPrincipalSaved(false), 1600)
  }

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Campus profile, grading scale and school data"
        meta={<span>Administrators only</span>}
        actions={
          isAdmin ? (
            <>
              <button type="button" className="btn btn-sm" onClick={() => setBands(DEFAULT_BANDS.map((band) => ({ ...band })))}>
                <RotateCcw size={13} /> Default bands
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void saveScale()}>
                <Save size={13} /> {saved ? 'Saved' : 'Save scale'}
              </button>
            </>
          ) : null
        }
      />

      {!isAdmin ? (
        <div className="mb-4 flex items-center gap-2 rounded border border-warn/35 bg-warn/8 px-3 py-2 text-[12px] text-warn">
          <ShieldAlert size={14} /> Settings are available to administrators only.
        </div>
      ) : null}

      <TeacherPermissionsPanel open={permissionsOpen} onClose={() => setPermissionsOpen(false)} />

      <div className="grid gap-5 lg:grid-cols-2">
        <section>
          <SectionTitle>Campus profile</SectionTitle>
          <div className="card p-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[12.5px]">
              {[
                ['School name', school.name],
                ['School code', school.code],
                ['Address', school.address],
                ['Postal address', `${school.postal} · ${school.city}`],
                ['Contact email', school.contact_email],
                ['Phone', school.phone_number],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="micro">{label}</dt>
                  <dd className="mt-0.5 text-ink/80">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 border-t border-rule pt-3 text-[11px] text-ink/45">
              The crest appears in the top bar and on every printed masthead. Logo upload is modelled in the data
              (`logo_url`) but not enabled in this build — the monogram stands in for the crest.
            </p>
            <div className="mt-4 grid gap-3 border-t border-rule pt-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <Field label="Principal name on reports">
                <input className="input-field" value={principalName} disabled={!isAdmin} onChange={(event) => setPrincipalName(event.target.value)} placeholder="Principal's full name" />
              </Field>
              {isAdmin ? <button type="button" className="btn btn-primary btn-sm" onClick={() => void savePrincipalName()}>
                <Save size={13} /> {principalSaved ? 'Saved' : 'Save principal'}
              </button> : null}
            </div>
            <div className="mt-4 border-t border-rule pt-3">
              <p className="field-label">Class teachers on reports</p>
              <p className="mb-2 text-[11px] text-ink/50">Assign a registered teacher to each class stream. This name prints on that class’s report cards.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {db.classes.map((classRow) => (
                  <Field key={classRow._id} label={`${classRow.class_name} ${classRow.stream_name}`}>
                    <select className="select-field" value={classRow.class_teacher_id ?? ''} disabled={!isAdmin} onChange={(event) => void api.classes.setClassTeacher(classRow._id, event.target.value || null)}>
                      <option value="">No class teacher assigned</option>
                      {db.teachers.map((teacher) => <option key={teacher._id} value={teacher._id}>{teacher.full_name}</option>)}
                    </select>
                  </Field>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-5">
            <SectionTitle
              right={<Badge tone={mayEnterMarks ? 'ok' : 'neutral'}>{mayEnterMarks} of {db.teachers.length} may write</Badge>}
            >
              Teacher permissions
            </SectionTitle>
            <div className="card p-4">
              <p className="text-[12.5px] leading-relaxed text-ink/60">
                Every teacher account starts read-only, whatever subjects it holds. Open the list to grant or reduce
                what each teacher may do, and to set the date marks close for the term. A teacher who has never signed
                up holds no password yet and appears there as awaiting sign-up.
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
                <div>
                  <dt className="micro">May enter marks</dt>
                  <dd className="mt-0.5 text-ink/80">{mayEnterMarks} teacher{mayEnterMarks === 1 ? '' : 's'}</dd>
                </div>
                <div>
                  <dt className="micro">Read-only</dt>
                  <dd className="mt-0.5 text-ink/80">
                    {db.teachers.length - mayEnterMarks} teacher{db.teachers.length - mayEnterMarks === 1 ? '' : 's'}
                  </dd>
                </div>
                <div>
                  <dt className="micro">Awaiting sign-up</dt>
                  <dd className="mt-0.5 text-ink/80" data-count="awaiting-signup">
                    {awaitingSignUp} teacher{awaitingSignUp === 1 ? '' : 's'}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="micro">School-wide marks close</dt>
                  <dd className="mt-0.5 text-ink/80">
                    {closing ? formatDateTime(closing) : 'No deadline — papers without one stay open'}
                  </dd>
                </div>
              </dl>
              <button
                type="button"
                className="btn btn-sm mt-3"
                data-action="open-teacher-permissions"
                onClick={() => setPermissionsOpen(true)}
                disabled={!isAdmin}
              >
                <UserCog size={13} /> Open teacher permissions
              </button>
            </div>
          </div>


          <div className="mt-5">
            <SectionTitle>About</SectionTitle>
            <div className="card p-4 text-[12px] text-ink/60">
              <p>
                <span className="font-medium text-ink">IUPC Academy</span> · v1.0 · single-campus build
              </p>
              <p className="mt-1">React 19 · TypeScript · Vite 8 · Tailwind CSS v4</p>
              <p className="mt-2">
                <strong className="text-ink">X</strong> missing marks · <strong className="text-ink">Y</strong>{' '}
                examination irregularity. Codes never contribute to totals, means or positions.
              </p>
              <p className="mt-2 text-[11px] text-ink/40">
                {supabaseConfigured ? 'School records are loaded from the authenticated shared database. Authentication tokens are session-scoped on this device.' : 'School records are not stored locally. Configure the authenticated school database to begin operations.'}
              </p>
            </div>
          </div>
        </section>

        <section>
          <SectionTitle right={<Badge tone="brass">{bands.length} bands</Badge>}>Grading scale</SectionTitle>
          <div className="card p-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Scale name">
                <input className="input-field" value={name} onChange={(event) => setName(event.target.value)} disabled={!isAdmin} />
              </Field>
              <Field label="Pass mark">
                <input
                  className="input-field figure"
                  type="number"
                  value={passMark}
                  onChange={(event) => setPassMark(Number(event.target.value))}
                  disabled={!isAdmin}
                />
              </Field>
            </div>

            <div className="mt-4 overflow-hidden rounded border border-rule">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-[64px]">Grade</th>
                    <th className="w-[84px]">Min</th>
                    <th className="w-[70px]">Pts</th>
                    <th>Remark</th>
                  </tr>
                </thead>
                <tbody>
                  {bands.map((band, index) => (
                    <tr key={`${band.grade}-${index}`}>
                      <td>
                        <input
                          className="input-field px-1.5 py-1 text-center font-mono text-[12px]"
                          value={band.grade}
                          disabled={!isAdmin}
                          onChange={(event) => updateBand(index, { grade: event.target.value.toUpperCase() })}
                        />
                      </td>
                      <td>
                        <input
                          className="input-field px-1.5 py-1 text-right font-mono text-[12px]"
                          type="number"
                          value={band.min_score}
                          disabled={!isAdmin}
                          onChange={(event) => updateBand(index, { min_score: Number(event.target.value) })}
                        />
                      </td>
                      <td>
                        <input
                          className="input-field px-1.5 py-1 text-right font-mono text-[12px]"
                          type="number"
                          value={band.points}
                          disabled={!isAdmin}
                          onChange={(event) => updateBand(index, { points: Number(event.target.value) })}
                        />
                      </td>
                      <td>
                        <input
                          className="input-field px-1.5 py-1 text-[12px]"
                          value={band.remark}
                          disabled={!isAdmin}
                          onChange={(event) => updateBand(index, { remark: event.target.value })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {isAdmin ? (
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setBands((current) => [...current, { grade: '', min_score: 0, points: 0, remark: '' }])}
                >
                  Add band
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setBands((current) => current.slice(0, -1))}
                  disabled={bands.length <= 1}
                >
                  Remove last
                </button>
                <span className="ml-auto text-[11px] text-ink/40">Bands are matched highest first</span>
              </div>
            ) : null}

            <p className="mt-3 border-t border-rule pt-3 text-[11px] text-ink/45">
              A custom scale applies to new grading immediately; existing printed cards keep the values they were
              generated with. Default: {DEFAULT_SCALE.name}.
            </p>
          </div>
        </section>
      </div>
    </>
  )
}
