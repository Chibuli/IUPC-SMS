import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useDb } from '../data/db'
import { useSession } from '../session'
import { HistoryError, readEnrollmentHistory, saveEnrollmentHistory } from '../data/enrollment-history-repository'
import type { HistoryChange } from '../data/enrollment-history-repository'
import { correctionInput, effectiveHistory, historyHeads, periodText, periodExplanation, stageHistoryInput } from '../lib/enrollment-history-management'
import type { HistoryAxis, HistoryRow, HistorySnapshot, HistoryStep } from '../lib/enrollment-history-management'
import { planHistoryTransition } from '../lib/enrollment-history-transitions'
import './StudentEnrollmentHistory.css'

const axes: HistoryAxis[] = ['school','class','subject']
const sources = { admission_register: 'Admission register', class_register: 'Official class register', subject_selection: 'Verified subject allocation record', transfer_record: 'Transfer record', departure_record: 'Departure record', return_record: 'Return record', administrator_review: 'Other documented school record', legacy_observation: 'Unverified observation' }
const blank = (): Record<string, unknown> => ({ term_id: '', coverage_kind: 'unknown', start_precision: 'unknown', end_precision: 'unknown', effective_from: null, effective_to: null, evidence_state: 'unverified', source_type: 'administrator_review', source_reference: '', reason: '', school_state: 'unknown', entry_kind: 'unknown' })
const fieldsByAxis = { school: ['school_state','entry_kind'], class: ['school_history_id','class_id','subject_scope_complete'], subject: ['class_history_id','subject_id','subject_state'] }
const axisLabel = { school: 'School enrollment', class: 'Class history', subject: 'Subject history' }
function HistoryFormSection({ title, children }: { title:string; children:ReactNode }) {
  return <fieldset className="eh-form-section"><legend>{title}</legend>{children}</fieldset>
}

export default function StudentEnrollmentHistory({ studentId, embedded=false, active=true, onDirtyChange }: { studentId: string; embedded?: boolean; active?: boolean; onDirtyChange?: (dirty:boolean)=>void }) {
  const db = useDb(), { session } = useSession()
  const admin = session?.role === 'admin'
  const [open, setOpen] = useState(embedded), [snapshot, setSnapshot] = useState<HistorySnapshot | null>(null)
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [axis, setAxis] = useState<HistoryAxis>('school'), [form, setForm] = useState(blank)
  const [editing, setEditing] = useState(false), [confirmed, setConfirmed] = useState(false)
  const [steps, setSteps] = useState<HistoryStep[]>([]), [saving, setSaving] = useState(false)
  const [retry, setRetry] = useState<HistoryChange | null>(null), [stale, setStale] = useState(false)
  const [transition, setTransition] = useState<{ axis: HistoryAxis; row: HistoryRow } | null>(null)
  const [bundled, setBundled] = useState(false)
  const busy = useRef(false), generation = useRef(0)
  const editorRef = useRef<HTMLFormElement>(null), reviewRef = useRef<HTMLElement>(null), alertRef = useRef<HTMLParagraphElement>(null)
  const scopeKey = `${studentId}:${session?.schoolId}:${session?.role}`
  useEffect(() => () => { generation.current++ }, [scopeKey])
  useEffect(() => { onDirtyChange?.(editing || Boolean(transition) || steps.length > 0 || Boolean(retry) || saving) }, [editing,transition,steps.length,retry,saving,onDirtyChange])
  useEffect(() => { if (embedded && active && admin && !snapshot && !loading && !error) void load() }, [embedded,active,admin])
  useEffect(() => {
    if (editing && active) {
      editorRef.current?.scrollIntoView({ block:'start' })
      editorRef.current?.querySelector<HTMLElement>('input:not(:disabled),select:not(:disabled),textarea')?.focus({ preventScroll:true })
    }
  }, [editing,active])
  useEffect(() => { if (active && steps.length && !editing && !transition) reviewRef.current?.scrollIntoView({ block:'start' }) }, [steps.length,editing,transition,active])
  useEffect(() => { if (active && error) { alertRef.current?.scrollIntoView({ block:'nearest' }); alertRef.current?.focus({ preventScroll:true }) } }, [error,active])
  async function load() {
    const request = ++generation.current
    setLoading(true); setError('')
    try {
      const data = await readEnrollmentHistory(studentId)
      if (request === generation.current) { setSnapshot(data); setStale(false) }
    } catch (failure) {
      if (request === generation.current) { setError(failure instanceof Error ? failure.message : 'History could not be loaded.'); if (failure instanceof HistoryError && failure.kind === 'permission') { setSnapshot(null); setSteps([]); setEditing(false); setTransition(null); setForm(blank()); setRetry(null) } }
    } finally { if (request === generation.current) setLoading(false) }
  }
  function update(name: string, value: unknown) { setForm(current => ({ ...current, [name]: value })); setConfirmed(false) }
  function label(row: HistoryRow) {
    if ('class_id' in row) { const c = db.classes.find(c => c._id === row.class_id); return c ? `${c.class_name} ${c.stream_name}` : 'Historical class (not in current catalogue)' }
    if ('subject_id' in row) { const s = db.subjects.find(s => s._id === row.subject_id); return s ? `${s.name} (${s.code})` : 'Historical subject (not in current catalogue)' }
    return row.school_state.replaceAll('_',' ')
  }
  function reviewLabel(step: HistoryStep) {
    const { input } = step
    if (step.axis === 'class') { const c = db.classes.find(c => c._id === input.class_id); return c ? `${c.class_name} ${c.stream_name}` : 'Historical class' }
    if (step.axis === 'subject') { const s = db.subjects.find(s => s._id === input.subject_id); return s ? `${s.name} (${s.code}): ${String(input.subject_state).replaceAll('_',' ')}` : 'Historical subject' }
    return String(input.school_state).replaceAll('_',' ')
  }
  const boundaryLabel = (value: unknown) => value === 'term_start' ? 'Selected term start' : value === 'term_end' ? 'Selected term end' : value === 'unknown' ? 'Unresolved date' : String(value ?? 'Unresolved date')
  const evidenceLabel = (value: unknown) => value === 'confirmed' ? 'Verified' : value === 'voided' ? 'Retired evidence' : value === 'conflict' ? 'Conflicting evidence' : 'Unresolved / unverified'
  function begin(target: HistoryAxis, row?: HistoryRow) {
    setTransition(null)
    setAxis(target); setForm(row ? correctionInput(row) : { ...blank(), ...(target === 'class' ? { subject_scope_complete: false } : target === 'subject' ? { subject_state: 'unknown' } : {}) })
    setConfirmed(false); setEditing(true); setError(''); setNotice('')
  }
  function inputForAxis() {
    const input = { ...form }
    for (const other of axes) if (other !== axis) for (const field of fieldsByAxis[other]) delete input[field]
    input.effective_from = input.start_precision === 'exact_date' ? input.effective_from : null
    input.effective_to = input.end_precision === 'exact_date' ? input.effective_to : null
    input.coverage_kind = input.start_precision === 'term_start' && input.end_precision === 'term_end' ? 'whole_term'
      : input.start_precision === 'unknown' && input.end_precision === 'unknown' ? 'unknown'
      : input.start_precision === 'unknown' || input.end_precision === 'unknown' ? 'partial_term_dates_unknown' : 'dated_segment'
    // dated_segment may use one symbolic boundary, as allowed by Phase 2A.
    return input
  }
  function stage() {
    try {
      const input = inputForAxis()
      if (input.evidence_state === 'confirmed' && !confirmed) throw new Error('Confirm that you checked the evidence before staging verified history.')
      if (input.start_precision === 'exact_date' && !input.effective_from || input.end_precision === 'exact_date' && !input.effective_to) throw new Error('Enter each selected exact effective date.')
      if (axis === 'class' && (!input.school_history_id || !input.class_id) || axis === 'subject' && (!input.class_history_id || !input.subject_id)) throw new Error('Select the parent enrollment and the class or offered subject.')
      const step = stageHistoryInput(axis, input, `step${steps.length + 1}`)
      setSteps(current => [...current, step]); setEditing(false); setError('')
    } catch (failure) { setError((failure as Error).message) }
  }
  async function save() {
    if (busy.current || !snapshot || (!retry && !steps.length) || stale) return
    busy.current = true; setSaving(true); setError(''); setNotice('')
    const requestGeneration = generation.current
    const change = retry ?? { id: crypto.randomUUID(), version: snapshot.version, steps }
    try {
      await saveEnrollmentHistory(studentId, change)
      if (generation.current !== requestGeneration) return
      setRetry(null); setSteps([]); setBundled(false); setEditing(false); setNotice('History change confirmed. Current enrollment and academic results were not changed.')
      await load()
    } catch (failure) {
      if (generation.current !== requestGeneration) return
      const issue = failure instanceof HistoryError ? failure : new HistoryError('Save confirmation was not received. Retry this same request.', 'uncertain')
      setError(issue.message)
      if (issue.kind === 'uncertain') setRetry(change)
      if (issue.kind === 'validation' || issue.kind === 'stale') setRetry(null)
      if (issue.kind === 'stale') setStale(true)
      if (issue.kind === 'permission') { setSnapshot(null); setSteps([]); setEditing(false); setTransition(null); setForm(blank()); setRetry(null) }
    } finally { busy.current = false; setSaving(false) }
  }
  function parents(parentAxis: 'school' | 'class') {
    const existing = snapshot ? effectiveHistory(snapshot[parentAxis]).filter(row => row.term_id === form.term_id && (parentAxis !== 'school' || 'school_state' in row && row.school_state === 'enrolled')) : []
    return <><option value="">Select verified parent period</option>{existing.map(row => <option key={row.id} value={row.id}>{label(row)}: {periodText(row)}</option>)}{steps.filter(step => step.axis === parentAxis && step.input.term_id === form.term_id && step.input.evidence_state === 'confirmed' && (parentAxis !== 'school' || step.input.school_state === 'enrolled')).map(step => <option key={step.key} value={`draft:${step.key}`}>Staged change {step.key}</option>)}</>
  }
  return <section className="enrollment-history" aria-label="Enrollment History">
    {embedded ? <div className="eh-heading"><h3>Historical enrollment</h3><span>Online administration</span></div> : <button type="button" className="eh-heading" aria-expanded={open} onClick={() => { setOpen(!open); if (!open && admin && !snapshot) void load() }}>Enrollment History <span>{open ? 'Close' : 'View'}</span></button>}
    {open && <div className="eh-body">
      <p className="eh-intro">Evidence-based history. Current enrollment, marks and official results stay unchanged.</p>
      {!admin ? <p role="status">Read-only: enrollment history administration is restricted to school administrators. Teacher access to historical evidence has not been enabled.</p> : <>
        {loading && <p role="status">Loading enrollment history...</p>}
        {error && <p ref={alertRef} tabIndex={-1} role="alert" className="eh-error">{error}</p>}
        {notice && <p role="status" className="eh-notice">{notice}</p>}
        <button type="button" onClick={() => void load()} disabled={loading || saving || Boolean(retry)}>Reload history</button>
        {snapshot && <>
          {!axes.some(a => snapshot[a].length) && <p className="eh-empty">Historical enrollment not yet verified. Current enrollment and accepted marks do not establish admission dates.</p>}
          {axes.map(a => {
            const active = effectiveHistory(snapshot[a]), heads = historyHeads(snapshot[a])
            const rows = [...new Map([...active, ...heads].map(row => [row.id,row])).values()].sort((x,y) => (db.terms.find(t => t._id === x.term_id)?.start_date ?? '').localeCompare(db.terms.find(t => t._id === y.term_id)?.start_date ?? '') || (x.effective_from ?? '').localeCompare(y.effective_from ?? '') || x.recorded_at.localeCompare(y.recorded_at))
            return <section key={a} aria-label={axisLabel[a]} className="eh-timeline">
              <div className="eh-section-title"><h3>{axisLabel[a]}</h3><button type="button" disabled={saving || Boolean(retry) || bundled} onClick={() => begin(a)}>Record period</button></div>
              {!rows.length && <p>No historical periods recorded. Eligibility remains unresolved.</p>}
              {rows.map(row => <article key={row.id}>
                <div><strong>{label(row)}</strong> <span className="eh-state">{evidenceLabel(row.evidence_state)}</span></div>
                <p>{db.terms.find(t => t._id === row.term_id)?.name ?? 'Historical term'} / {db.terms.find(t => t._id === row.term_id)?.academic_year ?? 'Year unavailable'}</p>
                <p className="eh-period" title={periodExplanation(row)}>{periodText(row)}{'subject_state' in row ? `; ${row.subject_state.replaceAll('_',' ')}` : ''}</p>
                <p className="eh-evidence">{sources[row.source_type]}{row.source_reference ? ` | ${row.source_reference}` : ' (not verified)'}</p>
                <details><summary>Evidence and corrections ({snapshot[a].filter(r => r.fact_id === row.fact_id).length} revisions)</summary>
                  <p>{periodExplanation(row)}</p>
                  {snapshot[a].filter(r => r.fact_id === row.fact_id).sort((x,y) => y.revision - x.revision).map(r => <div key={r.id} className="eh-audit"><p>Revision {r.revision}: {evidenceLabel(r.evidence_state)} - {r.reason}</p><p>{periodText(r)}</p><p>Recorded {new Date(r.recorded_at).toLocaleString()} by administrator account <code>{r.recorded_by}</code></p>{r.confirmed_at && <p>Verified {new Date(r.confirmed_at).toLocaleString()}</p>}<p>{r.source_reference || 'No evidence reference'}</p></div>)}
                </details>
                {heads.some(head => head.id === row.id) && <div className="eh-actions"><button type="button" disabled={saving || Boolean(retry) || bundled} onClick={() => begin(a,row)}>Correct evidence</button>{active.some(r => r.id === row.id) && <button type="button" disabled={saving || Boolean(retry) || steps.length > 0} onClick={() => { setEditing(false); setTransition({ axis:a, row }); setError('') }}>{a === 'class' ? 'Record transfer' : a === 'subject' ? 'Discontinue / change subject' : 'school_state' in row && row.school_state === 'not_enrolled' ? 'Record return' : 'Record withdrawal'}</button>}</div>}
              </article>)}
            </section>
          })}
          {transition && <HistoryTransitionForm key={transition.row.id} {...transition} snapshot={snapshot} onCancel={() => setTransition(null)} onStage={planned => { setSteps(planned); setBundled(true); setTransition(null); setError('') }} />}
          {editing && <form ref={editorRef} className="eh-editor" aria-label="Enrollment evidence and correction" onSubmit={event => { event.preventDefault(); stage() }}>
            <h3>{form.supersedes_id ? 'Correct historical evidence' : 'Record historical period'}: {axisLabel[axis]}</h3>
            <p>Dates are facts supported by school records. No date is automatically inferred. End dates exclude that day.</p>
            <HistoryFormSection title="Academic period"><div className="eh-grid">
              <label>Academic term<select value={String(form.term_id ?? '')} disabled={Boolean(form.supersedes_id)} onChange={e => { update('term_id',e.target.value); setForm(f => ({...f, school_history_id: '', class_history_id: ''})) }} required><option value="">Select term and academic year</option>{db.terms.map(t => <option key={t._id} value={t._id}>{t.name} / {t.academic_year}</option>)}</select></label>
              <label>Start boundary<select value={String(form.start_precision)} onChange={e => update('start_precision',e.target.value)}><option value="unknown">Unknown</option><option value="term_start">Selected term start (no exact date asserted)</option><option value="exact_date">Verified exact date</option></select></label>
              <label>End boundary<select value={String(form.end_precision)} onChange={e => update('end_precision',e.target.value)}><option value="unknown">Unknown</option><option value="term_end">Selected term end (no exact date asserted)</option><option value="exact_date">Verified exact date (excluded)</option></select></label>
              {form.start_precision === 'exact_date' && <label>Effective start<input type="date" required value={String(form.effective_from ?? '')} onChange={e => update('effective_from',e.target.value)} /></label>}
              {form.end_precision === 'exact_date' && <label>Effective end (excluded)<input type="date" required value={String(form.effective_to ?? '')} onChange={e => update('effective_to',e.target.value)} /></label>}
            </div></HistoryFormSection>
            <HistoryFormSection title="Enrollment details"><div className="eh-grid">
              {axis === 'school' && <><label>School enrollment status<select value={String(form.school_state ?? 'unknown')} onChange={e => { update('school_state',e.target.value); if (e.target.value !== 'enrolled') update('entry_kind','unknown') }}><option value="unknown">Unknown</option><option value="enrolled">Enrolled</option><option value="pre_enrollment">Before admission</option><option value="not_enrolled">Not enrolled / withdrawn</option></select></label><label>Entry reason<select value={String(form.entry_kind ?? 'unknown')} disabled={form.school_state !== 'enrolled'} onChange={e => update('entry_kind',e.target.value)}><option value="unknown">Unknown</option><option value="admission">Admission</option><option value="return">Return / re-admission</option><option value="continuation">Continued enrollment</option></select></label></>}
              {axis === 'class' && <><label>Verified school enrollment<select value={String(form.school_history_id ?? '')} onChange={e => update('school_history_id',e.target.value)} required>{parents('school')}</select></label><label>Class<select value={String(form.class_id ?? '')} disabled={Boolean(form.supersedes_id)} onChange={e => update('class_id',e.target.value)} required><option value="">Select class</option>{db.classes.map(c => <option key={c._id} value={c._id}>{c.class_name} {c.stream_name}</option>)}</select></label><label className="eh-check"><input type="checkbox" checked={Boolean(form.subject_scope_complete)} onChange={e => update('subject_scope_complete',e.target.checked)} />The complete subject allocation for this placement is supported by evidence</label></>}
              {axis === 'subject' && <><label>Verified class placement<select value={String(form.class_history_id ?? '')} onChange={e => update('class_history_id',e.target.value)} required>{parents('class')}</select></label><label>School subject offering<select value={String(form.subject_id ?? '')} disabled={Boolean(form.supersedes_id)} onChange={e => update('subject_id',e.target.value)} required><option value="">Select offered subject</option>{db.subjects.filter(s => s.school_id === session?.schoolId && (s.offered || s._id === form.subject_id)).map(s => <option key={s._id} value={s._id}>{s.name} ({s.code}){s.offered ? '' : ' - no longer offered'}</option>)}</select></label><label>Subject eligibility<select value={String(form.subject_state ?? 'unknown')} onChange={e => update('subject_state',e.target.value)}><option value="unknown">Unknown</option><option value="enrolled">Enrolled</option><option value="not_taken">Verified not taken / discontinued</option></select></label></>}
            </div></HistoryFormSection>
            <HistoryFormSection title="Evidence"><div className="eh-grid">
              <label>Evidence source<select value={String(form.source_type)} onChange={e => update('source_type',e.target.value)}>{Object.entries(sources).map(([value,name]) => <option key={value} value={value}>{name}</option>)}</select></label>
              <label>Document / record reference<input maxLength={240} value={String(form.source_reference ?? '')} onChange={e => update('source_reference',e.target.value)} required={form.evidence_state !== 'unverified'} /></label>
            </div>
            <label>Reason for recording or correcting<textarea maxLength={1000} required value={String(form.reason ?? '')} onChange={e => update('reason',e.target.value)} /></label>
            </HistoryFormSection>
            <HistoryFormSection title="Verification"><div className="eh-grid">
              <label>Evidence status<select value={String(form.evidence_state)} onChange={e => update('evidence_state',e.target.value)}><option value="unverified">Unresolved / unverified</option><option value="confirmed">Verified</option><option value="conflict">Conflicting evidence</option>{Boolean(form.supersedes_id) && <option value="voided">Retire erroneous evidence (preserve original)</option>}</select></label>
            </div>
            {form.evidence_state === 'confirmed' && <label className="eh-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} required />I checked the referenced school record and confirm these historical facts. Choosing a source label alone does not verify evidence.</label>}
            </HistoryFormSection>
            <div className="eh-actions"><button type="submit">Add to reviewed change</button><button type="button" onClick={() => setEditing(false)}>Cancel entry</button></div>
          </form>}
          <details className="eh-help"><summary>Withdrawals, transfers, subject changes and corrections</summary><p>To transfer: correct the old period with the verified end date, then record the new placement starting on that date. To withdraw: end the enrolled period and record a not-enrolled period. To return: end the not-enrolled period and record a return period. To discontinue a subject: end its enrolled period and record verified not-taken coverage. Stage all related records and save once.</p><p>Parent corrections with verified dependents require explicit revisions: retire dependent subject evidence first, then class evidence, correct the school period, and establish replacement class and subject revisions using the staged parents. No evidence is deleted. The database refuses a partial or contradictory change. If the evidence cannot support the complete change, do not confirm it.</p><p>For a replacement of a record already revised in this change, select its staged predecessor below. Class and subject identities cannot be changed by correction; use a new period for a transfer. These operations do not update live class or subject choices.</p></details>
          {editing && steps.some(s => s.axis === axis) && <label>Previous revision in this change (for explicit replacement)<select value={String(form.supersedes_id ?? '')} onChange={e => update('supersedes_id',e.target.value)}><option value={String(form.supersedes_id ?? '')}>Keep selected original revision</option>{steps.filter(s => s.axis === axis).map(s => <option key={s.key} value={`draft:${s.key}`}>{s.key}: replace this staged revision</option>)}</select></label>}
          {steps.length > 0 && <section ref={reviewRef} className="eh-review" aria-label="Review enrollment change"><h3>Review change: {steps.length} records</h3><p>All records save in one transaction. A conflict saves none. Current live enrollment is unchanged. Review all dates and evidence before confirming.</p><ol>{steps.map(s => <li key={s.key}><strong>{axisLabel[s.axis]}: {reviewLabel(s)}</strong><p>{evidenceLabel(s.input.evidence_state)} - {db.terms.find(t => t._id === s.input.term_id)?.name} / {db.terms.find(t => t._id === s.input.term_id)?.academic_year}</p><p>{boundaryLabel(s.input.effective_from ?? s.input.start_precision)} to {boundaryLabel(s.input.effective_to ?? s.input.end_precision)} (end excluded)</p><p>{s.input.supersedes_id || s.refs?.supersedes_id ? 'Correction: previous revision is preserved' : 'New historical record'}</p><p>Evidence: {sources[s.input.source_type as keyof typeof sources] ?? 'Documented school record'} - {String(s.input.source_reference || 'Not verified')}. {String(s.input.reason)}</p>{s.refs && <p>Uses earlier staged evidence in this change.</p>}</li>)}</ol>
            <div className="eh-actions"><button type="button" onClick={() => void save()} disabled={saving || loading || stale || editing || Boolean(transition)}>{saving ? 'Awaiting confirmation...' : retry ? 'Retry same change / check receipt' : 'Confirm and save history'}</button><button type="button" disabled={saving || Boolean(retry)} onClick={() => { setSteps(current => bundled ? [] : current.slice(0,-1)); setBundled(false); setError('') }}>{bundled ? 'Discard complete staged transition' : 'Remove last staged record'}</button></div>
            {retry && <p>Confirmation is uncertain. This change is held only in this open page. Retry the same request before closing; it will not create a duplicate if the first save succeeded.</p>}
          </section>}
        </>}
      </>}
    </div>}
  </section>
}

function HistoryTransitionForm({ axis, row, snapshot, onStage, onCancel }: {
  axis: HistoryAxis; row: HistoryRow; snapshot: HistorySnapshot; onStage: (steps: HistoryStep[]) => void; onCancel: () => void
}) {
  const db = useDb(), { session } = useSession()
  const [date,setDate] = useState(''), [reference,setReference] = useState(''), [reason,setReason] = useState('')
  const [nextClass,setNextClass] = useState(''), [nextSubject,setNextSubject] = useState(''), [subjects,setSubjects] = useState<string[]>([])
  const [complete,setComplete] = useState(false), [confirm,setConfirm] = useState(false), [error,setError] = useState('')
  const transitionRef = useRef<HTMLFormElement>(null)
  useEffect(() => { transitionRef.current?.scrollIntoView({ block:'start' }); transitionRef.current?.querySelector<HTMLElement>('input')?.focus({ preventScroll:true }) }, [])
  const returning = 'school_state' in row && row.school_state === 'not_enrolled'
  const title = axis === 'class' ? 'Record class transfer' : axis === 'subject' ? 'Discontinue or change subject' : returning ? 'Record return to school' : 'Record school withdrawal'
  const offerings = db.subjects.filter(s => s.school_id === session?.schoolId && s.offered)
  return <form ref={transitionRef} className="eh-editor" aria-label={title} onSubmit={event => {
    event.preventDefault()
    if (!confirm) { setError('Confirm the evidence before staging.'); return }
    const term = db.terms.find(t => t._id === row.term_id)
    if (term?.start_date && date < term.start_date) { setError('The transition date precedes the selected term.'); return }
    try { onStage(planHistoryTransition(snapshot,{ axis,row,date,reference,reason,nextClass,nextSubject,subjects,completeSubjects:complete,source:axis === 'school' ? returning ? 'return_record' : 'departure_record' : 'transfer_record' })) }
    catch (failure) { setError((failure as Error).message) }
  }}>
    <h3>{title}</h3><p>{periodText(row)}</p>
    <p>The previous period ends on the date below (exclusive). The new period begins on that date. The staged change preserves previous revisions and explicitly revises dependent evidence. It does not change live class or subject assignments.</p>
    {error && <p role="alert" className="eh-error">{error}</p>}
    <div className="eh-grid">
      <label>Verified effective date<input type="date" required value={date} onChange={e => { setDate(e.target.value); setConfirm(false) }} /></label>
      {axis === 'class' && <label>Destination class<select value={nextClass} onChange={e => { setNextClass(e.target.value); setConfirm(false) }} required><option value="">Select destination</option>{db.classes.filter(c => c.school_id === session?.schoolId && (!('class_id' in row) || c._id !== row.class_id)).map(c => <option key={c._id} value={c._id}>{c.class_name} {c.stream_name}</option>)}</select></label>}
      {axis === 'subject' && <label>New subject (optional)<select value={nextSubject} onChange={e => { setNextSubject(e.target.value); setConfirm(false) }}><option value="">Discontinue only</option>{offerings.filter(s => !('subject_id' in row) || s._id !== row.subject_id).map(s => <option key={s._id} value={s._id}>{s.name} ({s.code})</option>)}</select></label>}
      <label>Evidence reference<input required maxLength={240} value={reference} onChange={e => { setReference(e.target.value); setConfirm(false) }} /></label>
    </div>
    {axis === 'class' && <fieldset><legend>Verified subjects in the destination class</legend><p>No subject is copied automatically. Select only documented allocations; an empty or incomplete list leaves subject coverage unresolved.</p>{offerings.map(s => <label key={s._id} className="eh-check"><input type="checkbox" checked={subjects.includes(s._id)} onChange={e => { setSubjects(current => e.target.checked ? [...current,s._id] : current.filter(id => id !== s._id)); setConfirm(false) }} />{s.name} ({s.code})</label>)}<label className="eh-check"><input type="checkbox" checked={complete} onChange={e => { setComplete(e.target.checked); setConfirm(false) }} />The evidence establishes the complete destination subject allocation</label></fieldset>}
    <label>Reason<textarea required maxLength={1000} value={reason} onChange={e => { setReason(e.target.value); setConfirm(false) }} /></label>
    <label className="eh-check"><input type="checkbox" required checked={confirm} onChange={e => setConfirm(e.target.checked)} />I verified this transition and the affected historical periods against school records. I will review all staged records before saving.</label>
    <div className="eh-actions"><button type="submit">Review complete transition</button><button type="button" onClick={onCancel}>Cancel transition</button></div>
  </form>
}
