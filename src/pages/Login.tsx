import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Lock, Mail, MapPin } from 'lucide-react'
import { useDb } from '../data/db'
import { useSession } from '../session'
import { supabaseConfigured } from '../data/supabase'
import { PasswordRecovery } from '../components/BackendSetup'

export default function Login({ initialError }: { initialError?: string } = {}) {
  const db = useDb()
  const { signInWithPassword, passwordSetupRequired } = useSession()
  const navigate = useNavigate()
  const school = db.schools[0] ?? {
    _id: 'school-unconfigured', name: 'IUPC Academy', code: '', address: '', postal: '', city: '',
    contact_email: '', phone_number: '', logo_url: null, crest_url: null, motto: '',
  }
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(initialError ?? null)
  const [busy, setBusy] = useState(false)
  const [recovering, setRecovering] = useState(false)
  const [activating, setActivating] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (!supabaseConfigured) {
      setError('School sign-in is unavailable because the authenticated database is not configured.')
      return
    }
    setBusy(true)
    try {
      const failure = await signInWithPassword(email, password)
      if (failure) {
        setError(failure)
        return
      }
      navigate('/dashboard')
    } catch {
      setError('Sign-in failed. Check your account and connection.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-layout" data-auth-layout="diagonal">
      <section className="auth-brand" aria-labelledby="academy-name">
        <div className="auth-brand-content">
          <img className="auth-logo" src={school.logo_url || '/iupc-wordmark.png'} alt={`${school.name} official logo`} width="174" height="71" />
          <h1 id="academy-name" className="auth-academy-name">{school.name}</h1>
          <p className="auth-location"><MapPin size={14} aria-hidden="true" /> Mombasa, Kenya</p>
          <p className="auth-mission">Navigating the Future, Empowering the Leaders of Today and Tomorrow</p>
          <div className="auth-philosophy">
            <span>Our philosophy</span>
            <p>We make sure that everyone blossoms.</p>
          </div>
        </div>
      </section>
      <section className="auth-panel" aria-labelledby="signin-title">
        <div className="auth-panel-content">
          <p className="auth-eyebrow">School management system</p>
          <h2 id="signin-title" className="auth-form-title">Welcome back</h2>
          <p className="auth-intro">Sign in to your IUPC Academy workspace.</p>
          <form onSubmit={submit} className="auth-signin-form">
            <label className="block">
              <span className="auth-field-label">Account email</span>
              <span className="relative block">
                <Mail size={17} className="auth-input-icon" aria-hidden="true" />
                <input className="auth-input auth-input-with-icon" type="email" required value={email} data-field="signin-email" onChange={(event) => setEmail(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="Your registered email" />
              </span>
            </label>
            <label className="block">
              <span className="auth-field-label">Password</span>
              <span className="relative block">
                <Lock size={17} className="auth-input-icon" aria-hidden="true" />
                <input className="auth-input auth-input-with-icon auth-password-input" type={showPassword ? 'text' : 'password'} required value={password} data-field="signin-password" onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="Enter your password" />
                <button type="button" onClick={() => setShowPassword((value) => !value)} className="auth-password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>{showPassword ? 'Hide' : 'Show'}</button>
              </span>
            </label>
            {error ? <p role="alert" className="auth-notice auth-error">{error}</p> : null}
            {!supabaseConfigured ? <p role="status" className="auth-notice">School sign-in is unavailable until the authenticated database is configured.</p> : null}
            <button type="submit" className="auth-submit" data-action="signin-submit" disabled={busy || !supabaseConfigured}>
              {busy ? 'Checking…' : 'Sign in'} <ArrowRight size={17} aria-hidden="true" />
            </button>
          </form>
          {supabaseConfigured ? (
            <div className="auth-account-options">
              {recovering
                ? <PasswordRecovery email={email} onDone={() => setRecovering(false)} />
                : <div className="auth-recovery-link"><button type="button" className="auth-text-button" onClick={() => { setRecovering(true); setActivating(false); setError(null) }}>Forgot password?</button></div>}
              <div className="auth-activation-card">
                <p>New teacher? <button type="button" className="auth-text-button" data-action="activate-teacher" aria-expanded={activating} aria-controls="teacher-activation-help" onClick={() => { setActivating(value => !value); setRecovering(false) }}>Activate teacher account</button></p>
                <p className="auth-activation-caption">Your school administrator sends your invitation.</p>
              </div>
              {activating ? <div role="status" id="teacher-activation-help" className="auth-notice auth-activation-help" data-field="teacher-activation-help">
                <p>Your school administrator must first register your official email and send a secure invitation. Open the invitation from that mailbox to verify ownership and choose your own password.</p>
                <p className="mt-2">Check your inbox and spam folder. If no invitation arrived or the link has expired, contact your school administrator through the school office and ask them to review your invitation. Entering an email here does not activate an account.</p>
                <p className="mt-2">Already set a password? Sign in above, or use Forgot password. Never share your invitation link or password.</p>
              </div> : null}
            </div>
          ) : null}
          {passwordSetupRequired ? <p className="auth-setup-caption">Choose a new password to finish account setup or recovery.</p> : null}
          <footer className="auth-footer">IUPC Academy <span aria-hidden="true">·</span> Mombasa, Kenya</footer>
        </div>
      </section>
    </main>
  )
}
