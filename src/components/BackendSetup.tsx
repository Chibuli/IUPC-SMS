import { useRef, useState } from 'react'
import { supabase } from '../data/supabase'
import { inviteStaff } from '../data/backend'
import { useSession } from '../session'
import { invitationMessage, type StaffInvitationResult } from '../lib/teacher-onboarding'

export function InitialAdminSetup({ onDone: _onDone }: { onDone: () => void }) {
  const [name,setName]=useState('')
  const [email,setEmail]=useState('')
  const [password,setPassword]=useState('')
  const [school,setSchool]=useState('IUPC Academy')
  const [code,setCode]=useState('IUPC-01')
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [busy,setBusy]=useState(false)
  async function submit(event:React.FormEvent){event.preventDefault();setBusy(true);setError('');setNotice('');
    if(!supabase){setError('Backend configuration is missing.');setBusy(false);return}
    const {data,error:authError}=await supabase.auth.signUp({email:email.trim().toLowerCase(),password,options:{data:{full_name:name.trim()},emailRedirectTo:`${window.location.origin}/auth/callback`}})
    setBusy(false)
    if(authError||!data.user){setError('Account setup could not be started. Check the email, password, and Auth configuration.');return}
    if(!data.session){setNotice('Check your email to confirm this account. Once confirmed, contact the project owner to provision the initial administrator securely; public signup cannot grant administrator access.');return}
    setNotice('Account created. Initial administrator membership must be provisioned by the project owner in Supabase; no browser request can assign that role.')
  }
  return <form onSubmit={submit} className="mt-5 space-y-3 rounded border border-rule bg-white p-4">
    <h3 className="text-sm font-semibold">Create the first administrator account</h3>
    <p className="text-xs text-ink/60">The first administrator is intentionally provisioned by the project owner, not self-assigned from browser claims. This creates an Auth identity only.</p>
    <input className="input-field" required minLength={2} placeholder="Full name" value={name} onChange={e=>setName(e.target.value)}/>
    <input className="input-field" required type="email" placeholder="Administrator email" value={email} onChange={e=>setEmail(e.target.value)}/>
    <input className="input-field" required minLength={12} type="password" autoComplete="new-password" placeholder="At least 12 characters" value={password} onChange={e=>setPassword(e.target.value)}/>
    <input className="input-field" required placeholder="School name" value={school} onChange={e=>setSchool(e.target.value)}/>
    <input className="input-field" required placeholder="Unique school code" value={code} onChange={e=>setCode(e.target.value)}/>
    {school || code ? <p className="text-xs text-ink/50">Once the identity is confirmed, use the documented owner provisioning SQL to create {school} ({code}) and its first admin membership.</p> : null}
    {error&&<p role="alert" className="text-xs text-danger">{error}</p>}{notice&&<p role="status" className="text-xs text-ok">{notice}</p>}
    <button className="btn btn-primary w-full" disabled={busy}>{busy?'Creating…':'Create account'}</button>
  </form>
}

export function StaffInvitation({ email, teacherId, onDone, disabled = false }: { email:string; teacherId:string; onDone:(result: StaffInvitationResult)=>void; disabled?: boolean }) {
  const [error,setError]=useState(''); const [busy,setBusy]=useState(false); const [message,setMessage]=useState(''); const sending=useRef(false)
  async function send() {
    if (sending.current) return
    sending.current = true; setBusy(true); setError(''); setMessage('')
    try {
      const result = await inviteStaff(email, teacherId)
      setMessage(invitationMessage(result)); onDone(result)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Invitation requires attention. The teacher record is retained.')
    } finally { sending.current = false; setBusy(false) }
  }
  return <div className="mt-2"><button type="button" className="btn btn-sm" disabled={busy||disabled} onClick={()=>void send()}>{busy?'Checking invitation…':error?'Retry secure invitation':'Check / send secure invitation'}</button>{error&&<p role="alert" className="mt-1 text-xs text-danger">{error}</p>}{message&&<p role="status" className="mt-1 text-xs">{message}</p>}</div>
}

export function PasswordRecovery({ email, onDone }: { email:string; onDone:()=>void }) {
  const {sendPasswordRecovery}=useSession(); const [message,setMessage]=useState(''); const [busy,setBusy]=useState(false)
  async function send(){setBusy(true);const error=await sendPasswordRecovery(email);setBusy(false);setMessage(error??'If the account exists, a recovery link has been sent.')}
  return <div className="auth-recovery">
    <h3>Password recovery</h3>
    <p>Use your registered account email above. We will send a secure link if the account exists.</p>
    <div className="auth-recovery-actions">
      <button type="button" className="auth-text-button" onClick={onDone}>Back to sign in</button>
      <button type="button" className="auth-submit" disabled={busy||!email} onClick={()=>void send()}>{busy?'Sending…':'Send recovery email'}</button>
    </div>
    {message&&<p role="status" className="auth-notice">{message}</p>}
  </div>
}

export function PasswordRecoveryForm({ onDone }: { onDone:()=>void }) {
  const {passwordSetupRequired,authReady,hasAuthSession,updatePassword,signOut}=useSession(); const [password,setPassword]=useState('');const [error,setError]=useState('');const [done,setDone]=useState(false)
  if(!authReady||!hasAuthSession||(!passwordSetupRequired&&!done))return null
  async function save(event:React.FormEvent){event.preventDefault();const problem=await updatePassword(password);if(problem){setError(problem);return}setDone(true)}
  return <div className="auth-password-dialog-backdrop"><form onSubmit={save} className="auth-password-dialog" role="dialog" aria-modal="true" aria-labelledby="password-setup-title" onKeyDown={event => {
    if (event.key !== 'Tab') return
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)')]
    const first = controls[0], last = controls.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }}>
    <h2 id="password-setup-title">Set a new password</h2>
    {done ? <>
      <p>Password updated. Sign in with your new password.</p>
      <button type="button" className="auth-submit" autoFocus onClick={()=>{setDone(false);setPassword('');signOut();onDone()}}>Continue</button>
    </> : <>
      <p>Your verified email link lets you choose a password for your existing school account.</p>
      <label className="auth-field-label" htmlFor="account-new-password">New password</label>
      <input id="account-new-password" className="auth-input" required minLength={12} type="password" autoComplete="new-password" autoFocus value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 12 characters" aria-describedby="password-length-help"/>
      <p id="password-length-help" className="auth-setup-caption">Use at least 12 characters.</p>
      {error&&<p role="alert" className="auth-notice auth-error">{error}</p>}
      <button className="auth-submit">Update password</button>
    </>}
  </form></div>
}
