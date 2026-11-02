import { correctionInput, effectiveHistory, historyHeads, type HistoryAxis, type HistoryRow, type HistorySnapshot, type HistoryStep, stageHistoryInput } from './enrollment-history-management'

export interface TransitionRequest {
  axis: HistoryAxis
  row: HistoryRow
  date: string
  source: string
  reference: string
  reason: string
  nextClass?: string
  nextSubject?: string
  /** Explicit subject allocation for a new class; never copied from live choices. */
  subjects?: string[]
  completeSubjects?: boolean
}

/** Atomic factual split. Dates are supplied by an administrator, never inferred.
 * Dependent evidence is retired leaf-first and explicitly restored parent-first.
 * Unknown bounds or dependents wholly after the boundary require manual review.
 */
export function planHistoryTransition(snapshot: HistorySnapshot, request: TransitionRequest): HistoryStep[] {
  const { axis, row, date } = request
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) throw new Error('Enter a valid verified transition date.')
  const heads = historyHeads(snapshot[axis])
  if (!effectiveHistory(snapshot[axis]).some(r => r.id === row.id) || !heads.some(r => r.id === row.id)) throw new Error('This period has changed or has an unresolved correction. Reload and review it first.')
  if (row.coverage_kind === 'unknown' || row.coverage_kind === 'partial_term_dates_unknown') throw new Error('Confirm the existing period boundaries before recording a transition.')
  if (row.effective_from && date <= row.effective_from || row.effective_to && date >= row.effective_to) throw new Error('The transition must fall inside the existing period.')
  if (axis === 'class' && (!request.nextClass || 'class_id' in row && request.nextClass === row.class_id)) throw new Error('Select a different destination class.')
  if (axis === 'school' && 'school_state' in row && !['enrolled','not_enrolled'].includes(row.school_state)) throw new Error('Only an enrolled or withdrawn period can be split into a withdrawal or return.')
  if (axis === 'subject' && 'subject_state' in row && row.subject_state !== 'enrolled') throw new Error('Select a verified enrolled subject to discontinue or change.')
  if (axis === 'subject' && 'subject_id' in row && request.nextSubject === row.subject_id) throw new Error('Select a different new subject, or leave it blank to discontinue only.')

  const classes = axis === 'school' ? effectiveHistory(snapshot.class).filter(r => 'school_history_id' in r && r.school_history_id === row.id) : []
  const classIds = new Set(classes.map(r => r.id))
  const subjects = axis === 'subject' ? [] : effectiveHistory(snapshot.subject).filter(r => 'class_history_id' in r && (axis === 'class' ? r.class_history_id === row.id : classIds.has(r.class_history_id)))
  for (const dependent of [...classes,...subjects]) {
    const list = 'subject_id' in dependent ? snapshot.subject : snapshot.class
    if (!historyHeads(list).some(r => r.id === dependent.id) || ['unknown','partial_term_dates_unknown'].includes(dependent.coverage_kind) || dependent.effective_from && dependent.effective_from >= date) throw new Error('Dependent history needs individual review: unresolved dates, pending correction or a later placement cannot be silently changed.')
  }
  const steps: HistoryStep[] = [], retired = new Map<string,string>(), restored = new Map<string,string>()
  const provenance = { source_type: request.source, source_reference: request.reference, reason: request.reason }
  function add(a: HistoryAxis, input: Record<string, unknown>): string {
    const key = `step${steps.length + 1}`
    steps.push(stageHistoryInput(a,input,key)); return `draft:${key}`
  }
  function prefix(r: HistoryRow) {
    const base = correctionInput(r)
    if (!r.effective_to || r.effective_to > date) {
      base.effective_to = date; base.end_precision = 'exact_date'; base.coverage_kind = 'dated_segment'
    }
    return { ...base, ...provenance, evidence_state: 'confirmed' }
  }
  for (const dependent of [...subjects,...classes]) retired.set(dependent.id, add('subject_id' in dependent ? 'subject' : 'class', { ...correctionInput(dependent), ...provenance, evidence_state: 'voided' }))
  const root = add(axis,prefix(row))
  for (const c of classes) restored.set(c.id,add('class', { ...prefix(c), supersedes_id: retired.get(c.id), school_history_id: root }))
  for (const s of subjects) add('subject', { ...prefix(s), supersedes_id: retired.get(s.id), class_history_id: axis === 'class' ? root : restored.get('class_history_id' in s ? s.class_history_id : '') })
  const after = { ...correctionInput(row), ...provenance, start_precision: 'exact_date', effective_from: date, coverage_kind: 'dated_segment', evidence_state: 'confirmed' }
  delete (after as Record<string, unknown>).supersedes_id
  if (axis === 'school' && 'school_state' in row) add('school', { ...after, school_state: row.school_state === 'enrolled' ? 'not_enrolled' : 'enrolled', entry_kind: row.school_state === 'enrolled' ? 'unknown' : 'return' })
  if (axis === 'class') {
    const placement = add('class', { ...after, class_id: request.nextClass, subject_scope_complete: Boolean(request.completeSubjects) })
    for (const subject of [...new Set(request.subjects ?? [])]) add('subject', {
      term_id: row.term_id, coverage_kind: 'dated_segment', start_precision: 'exact_date', effective_from: date,
      end_precision: row.end_precision, effective_to: row.effective_to, ...provenance, evidence_state: 'confirmed',
      class_history_id: placement, subject_id: subject, subject_state: 'enrolled',
    })
  }
  if (axis === 'subject') {
    add('subject', { ...after, subject_state: 'not_taken' })
    if (request.nextSubject) add('subject', { ...after, subject_id: request.nextSubject, subject_state: 'enrolled' })
  }
  return steps
}
