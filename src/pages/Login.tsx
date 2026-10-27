import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, CheckCircle2, Eye, Lock, Mail, ShieldCheck, User, UserPlus } from 'lucide-react'
import { api, useDb } from '../data/db'
import {
  DEMO_HINT,
  MIN_PASSWORD_LENGTH,
  STAFF_EMAIL_PLACEHOLDER,
  createAccount,
  lookupStaff,
  passwordProblem,
  verifyCredentials,
} from '../data/auth'
import { useSession } from '../session'
import { SchoolLogo } from '../components/ui'

type Mode = 'admin' | 'teacher'
type View = 'signin' | 'signup'
type Notice = { tone: 'ok' | 'warn' | 'danger'; text: string }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function Login() {
  const db = useDb()
  const { signIn } = useSession()
  const navigate = useNavigate()
  const school = db.schools[0]

  const [mode, setMode] = useState<Mode>('admin')
  const [view, setView] = useState<View>('signin')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [signUpEmail, setSignUpEmail] = useState('')
  const [signUpPassword, setSignUpPassword] = useState('')
  const [signUpConfirm, setSignUpConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /**
   * Sign-up is invitation-only, so the register is consulted while the address
   * is being typed — the teacher finds out whether the office has added them
   * before they bother choosing a password. A half-typed address has no verdict
   * worth showing, so the lookup stays quiet until it looks like an address.
   */
  const emailLooksComplete = EMAIL.test(signUpEmail.trim())
  const staff = useMemo(() => lookupStaff(db.teachers, signUpEmail), [db.teachers, signUpEmail])

  const signUpNotice: Notice | null = !emailLooksComplete
    ? null
    : staff.state === 'awaiting' && staff.teacher
      ? {
          tone: 'ok',
          text: `Found on the staff register: ${staff.teacher.full_name} · ${staff.teacher.employee_id}. Choose a password to activate the account.`,
        }
      : staff.state === 'active' && staff.teacher
        ? {
            tone: 'warn',
            text: `${staff.teacher.email} already has an account. Sign in with the password you chose.`,
          }
        : {
            tone: 'danger',
            text: 'This email is not on the staff register, so no account can be created for it. Ask the registrar to add you with this address.',
          }

  const teacherSubjects = staff.teacher
    ? db.subjects.filter((subject) => staff.teacher!.assigned_subject_ids.includes(subject._id))
    : []

  const chosenPasswordProblem = passwordProblem(signUpPassword, signUpConfirm)
  const maySubmitSignUp = staff.state === 'awaiting' && !chosenPasswordProblem

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    const result = await verifyCredentials({ role: mode, username, password }, db.teachers)
    setBusy(false)
    if (!result.ok || !result.role || !result.name) {
      setError(result.error ?? 'Sign-in failed.')
      return
    }
    signIn({ role: result.role, name: result.name, teacherId: result.teacherId })
    navigate('/dashboard')
  }

  async function submitSignUp(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    const result = await createAccount(
      { email: signUpEmail, password: signUpPassword, confirm: signUpConfirm },
      db.teachers,
      (teacherId, credentials) => api.teachers.setPassword(teacherId, credentials),
    )
    setBusy(false)
    if (!result.ok || !result.role || !result.name) {
      setError(result.error ?? 'The account could not be created.')
      return
    }
    signIn({ role: result.role, name: result.name, teacherId: result.teacherId })
    navigate('/dashboard')
  }

  function enterAsGuest() {
    signIn({ role: 'guest', name: 'Guest' })
    navigate('/dashboard')
  }

  function openSignUp(email = '') {
    setView('signup')
    setError(null)
    setSignUpEmail(email)
  }

  function backToSignIn() {
    setView('signin')
    setError(null)
  }

  const demo = DEMO_HINT[mode]
  // A teacher whose address is on the register but has no password yet gets the
  // sign-up offer where they are, rather than being sent to a second screen.
  const awaitingHint = mode === 'teacher' ? lookupStaff(db.teachers, username) : null

  return (
    <div className="grid min-h-screen md:grid-cols-[1.05fr_1fr]">
      {/* editorial panel */}
      <section className="relative hidden flex-col justify-between bg-ink px-10 py-10 text-white md:flex">
        <div className="flex items-center gap-3">
          <SchoolLogo school={school} size={38} plate />
          <div>
            <p className="text-[14px] font-semibold">{school.name}</p>
            <p className="text-[10px] uppercase tracking-[0.18em] text-white/40">Academic records office</p>
          </div>
        </div>

        <div className="max-w-md">
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-brass">Academic Prestige · Operational Precision</p>
          <h1 className="mt-4 text-[34px] font-semibold leading-[1.15] tracking-tight">
            The operational record for one campus.
          </h1>
          <p className="mt-4 text-[13.5px] leading-relaxed text-white/60">
            Enrolment, staffing, the weekly timetable, exam windows, mark entry and the printed record.
            One system, one source of truth, from the first bell to the signed report card.
          </p>
          <div className="mt-7 grid grid-cols-3 gap-4 border-t border-white/10 pt-5">
            {[
              ['Students', db.students.length],
              ['Streams', db.classes.length],
              ['Lessons / wk', db.timetableSlots.length],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <p className="text-[22px] font-semibold tabular-nums">{value}</p>
                <p className="text-[10px] uppercase tracking-[0.14em] text-white/40">{label}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="text-[11px] text-white/35">
          {school.address} · {school.city} · {school.phone_number}
        </p>
      </section>

      {/* credential card */}
      <section className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-[400px]">
          <div className="mb-6 flex items-center gap-2.5 md:hidden">
            <SchoolLogo school={school} size={26} />
            <div>
              <p className="text-[13px] font-semibold">{school.name}</p>
              <p className="text-[10px] uppercase tracking-[0.14em] text-ink/40">Academic records office</p>
            </div>
          </div>

          {view === 'signin' ? (
            <>
              <h2 className="text-[20px] font-semibold tracking-tight">Sign in</h2>
              <p className="mt-1 text-[12.5px] text-ink/50">Use your campus account to enter the workspace.</p>

              <div className="mt-5 grid grid-cols-2 gap-1 rounded-md border border-rule bg-sunken p-1" role="tablist" aria-label="Account type">
                {(['admin', 'teacher'] as Mode[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="tab"
                    aria-selected={mode === option}
                    onClick={() => {
                      setMode(option)
                      setError(null)
                    }}
                    className={`rounded px-3 py-1.5 text-[12.5px] font-medium transition ${
                      mode === option ? 'bg-raised text-ink shadow-sm' : 'text-ink/55 hover:text-ink'
                    }`}
                  >
                    {option === 'admin' ? 'Administrator' : 'Teacher'}
                  </button>
                ))}
              </div>

              <form onSubmit={submit} className="mt-5 space-y-3.5">
                <label className="block">
                  <span className="field-label">{mode === 'admin' ? 'Username or email' : 'Staff email'}</span>
                  <span className="relative block">
                    <User size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
                    <input
                      className="input-field pl-8"
                      value={username}
                      data-field="signin-username"
                      onChange={(event) => setUsername(event.target.value)}
                      placeholder={mode === 'admin' ? 'admin' : STAFF_EMAIL_PLACEHOLDER}
                      autoComplete="username"
                    />
                  </span>
                </label>

                <label className="block">
                  <span className="field-label">Password</span>
                  <span className="relative block">
                    <Lock size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
                    <input
                      className="input-field pl-8 pr-16"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      data-field="signin-password"
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="••••••••"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink/45 hover:text-ink"
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </span>
                </label>

                {error ? (
                  <p role="alert" className="rounded border border-danger/25 bg-danger/5 px-3 py-2 text-[12px] text-danger">
                    {error}
                  </p>
                ) : null}

                {awaitingHint?.state === 'awaiting' && awaitingHint.teacher ? (
                  <p className="rounded border border-brass/35 bg-brass/8 px-3 py-2 text-[11.5px] leading-snug text-ink/70">
                    {awaitingHint.teacher.full_name} has not created an account yet.{' '}
                    <button
                      type="button"
                      className="font-medium text-crimson hover:underline"
                      data-action="open-signup"
                      onClick={() => openSignUp(awaitingHint.teacher!.email)}
                    >
                      Create your account
                    </button>
                  </p>
                ) : null}

                <button type="submit" className="btn btn-primary w-full" data-action="signin-submit" disabled={busy}>
                  {busy ? 'Checking…' : 'Enter workspace'} <ArrowRight size={15} />
                </button>
              </form>

              <div className="mt-4 flex items-center justify-between gap-2 border-t border-rule pt-3">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 text-[12px] font-medium text-crimson hover:underline"
                  data-action="open-signup"
                  onClick={() => openSignUp()}
                >
                  <UserPlus size={13} /> Create your account
                </button>
                <button type="button" onClick={enterAsGuest} className="inline-flex items-center gap-1.5 text-[12px] text-ink/55 hover:text-ink">
                  <Eye size={13} /> Preview as guest
                </button>
              </div>

              <div className="mt-4 rounded-md border border-rule bg-sunken/60 px-3 py-2.5">
                <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink/45">
                  <ShieldCheck size={12} /> Demo campus credentials
                </p>
                <p className="mt-1 font-mono text-[11.5px] text-ink/70">
                  {demo.username} / {demo.password}
                </p>
              </div>
            </>
          ) : (
            <>
              <h2 className="text-[20px] font-semibold tracking-tight">Create your account</h2>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink/50">
                The registrar adds you to the staff register first, then you choose the password you will sign in with.
              </p>

              <form onSubmit={submitSignUp} className="mt-5 space-y-3.5">
                <label className="block">
                  <span className="field-label">Staff email</span>
                  <span className="relative block">
                    <Mail size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
                    <input
                      className="input-field pl-8"
                      value={signUpEmail}
                      data-field="signup-email"
                      autoFocus
                      onChange={(event) => {
                        setSignUpEmail(event.target.value)
                        setError(null)
                      }}
                      placeholder={STAFF_EMAIL_PLACEHOLDER}
                      autoComplete="username"
                    />
                  </span>
                </label>

                {signUpNotice ? (
                  <div
                    role="status"
                    data-field="signup-status"
                    data-state={staff.state}
                    className={`rounded border px-3 py-2 text-[11.5px] leading-snug ${
                      signUpNotice.tone === 'ok'
                        ? 'border-ok/35 bg-ok/8 text-ok'
                        : signUpNotice.tone === 'warn'
                          ? 'border-warn/35 bg-warn/8 text-warn'
                          : 'border-danger/30 bg-danger/8 text-danger'
                    }`}
                  >
                    <p className="flex items-start gap-1.5">
                      {signUpNotice.tone === 'ok' ? <CheckCircle2 size={13} className="mt-px shrink-0" /> : <ShieldCheck size={13} className="mt-px shrink-0" />}
                      <span>{signUpNotice.text}</span>
                    </p>
                    {staff.state === 'awaiting' && teacherSubjects.length > 0 ? (
                      <p className="mt-1.5 flex flex-wrap gap-1">
                        {teacherSubjects.map((subject) => (
                          <span key={subject._id} className="rounded border border-ok/30 bg-raised px-1.5 py-0.5 text-[10px] text-ink/70">
                            {subject.name} <span className="font-mono opacity-60">{subject.code}</span>
                          </span>
                        ))}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <label className="block">
                  <span className="field-label">Choose a password</span>
                  <span className="relative block">
                    <Lock size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
                    <input
                      className="input-field pl-8 pr-16"
                      type={showPassword ? 'text' : 'password'}
                      value={signUpPassword}
                      data-field="signup-password"
                      onChange={(event) => {
                        setSignUpPassword(event.target.value)
                        setError(null)
                      }}
                      placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink/45 hover:text-ink"
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </span>
                </label>

                <label className="block">
                  <span className="field-label">Repeat the password</span>
                  <span className="relative block">
                    <Lock size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
                    <input
                      className="input-field pl-8"
                      type={showPassword ? 'text' : 'password'}
                      value={signUpConfirm}
                      data-field="signup-confirm"
                      onChange={(event) => {
                        setSignUpConfirm(event.target.value)
                        setError(null)
                      }}
                      placeholder="••••••••"
                      autoComplete="new-password"
                    />
                  </span>
                </label>

                {signUpPassword && signUpConfirm && chosenPasswordProblem ? (
                  <p className="text-[11.5px] text-warn">{chosenPasswordProblem}</p>
                ) : null}

                {error ? (
                  <p role="alert" className="rounded border border-danger/25 bg-danger/5 px-3 py-2 text-[12px] text-danger">
                    {error}
                  </p>
                ) : null}

                <button
                  type="submit"
                  className="btn btn-primary w-full"
                  data-action="submit-signup"
                  disabled={busy || !maySubmitSignUp}
                >
                  {busy ? 'Creating…' : 'Create account and sign in'} <ArrowRight size={15} />
                </button>
              </form>

              <div className="mt-4 border-t border-rule pt-3">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 text-[12px] text-ink/55 hover:text-ink"
                  data-action="back-to-signin"
                  onClick={backToSignIn}
                >
                  <ArrowLeft size={13} /> Back to sign in
                </button>
              </div>

              <div className="mt-4 rounded-md border border-rule bg-sunken/60 px-3 py-2.5">
                <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink/45">
                  <ShieldCheck size={12} /> Already registered, no password yet
                </p>
                <p className="mt-1 text-[11.5px] leading-snug text-ink/70">
                  {db.teachers.filter((teacher) => !teacher.password_hash).length === 0
                    ? 'Every teacher on the register has an account. Register a teacher to create a new one.'
                    : `${db.teachers.filter((teacher) => !teacher.password_hash).length} teacher${db.teachers.filter((teacher) => !teacher.password_hash).length === 1 ? '' : 's'} on the register are waiting to sign up.`}
                </p>
              </div>
            </>
          )}

          <p className="mt-5 text-[11px] leading-relaxed text-ink/40">
            Demonstration build: credentials are verified in the browser. Production requires server-side
            authentication and a dedicated password hash.
          </p>
        </div>
      </section>
    </div>
  )
}
