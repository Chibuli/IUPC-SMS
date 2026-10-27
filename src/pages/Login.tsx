import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Eye, Lock, ShieldCheck, User } from 'lucide-react'
import { useDb } from '../data/db'
import { DEMO_HINT, verifyCredentials } from '../data/auth'
import { useSession } from '../session'
import { SchoolLogo } from '../components/ui'

type Mode = 'admin' | 'teacher'

export default function Login() {
  const db = useDb()
  const { signIn } = useSession()
  const navigate = useNavigate()
  const school = db.schools[0]

  const [mode, setMode] = useState<Mode>('admin')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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

  function enterAsGuest() {
    signIn({ role: 'guest', name: 'Guest' })
    navigate('/dashboard')
  }

  const demo = DEMO_HINT[mode]

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
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder={mode === 'admin' ? 'admin' : 'g.wanjiru@iupc.academy'}
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

            <button type="submit" className="btn btn-primary w-full" disabled={busy}>
              {busy ? 'Checking…' : 'Enter workspace'} <ArrowRight size={15} />
            </button>
          </form>

          <div className="mt-4 flex items-center justify-between gap-2 border-t border-rule pt-3">
            <button type="button" onClick={enterAsGuest} className="inline-flex items-center gap-1.5 text-[12px] text-ink/55 hover:text-ink">
              <Eye size={13} /> Preview as guest (read-only)
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

          <p className="mt-5 text-[11px] leading-relaxed text-ink/40">
            Demonstration build: credentials are verified in the browser. Production requires server-side
            authentication and password hashing.
          </p>
        </div>
      </section>
    </div>
  )
}
