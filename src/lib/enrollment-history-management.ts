import type { ClassEnrollmentHistory, SchoolEnrollmentHistory, SubjectEnrollmentHistory } from '../data/enrollment-history-contract'

export type HistoryAxis = 'school' | 'class' | 'subject'
export type HistoryRow = SchoolEnrollmentHistory | ClassEnrollmentHistory | SubjectEnrollmentHistory
export interface HistorySnapshot {
  school: SchoolEnrollmentHistory[]
  class: ClassEnrollmentHistory[]
  subject: SubjectEnrollmentHistory[]
  version: string
  contract_version: number
  server_version_num: number
}
export interface HistoryStep {
  key: string
  axis: HistoryAxis
  input: Record<string, unknown>
  refs?: Record<string, string>
}

/** A proposed unverified revision does not displace confirmed evidence. */
export function effectiveHistory(rows: readonly HistoryRow[]): HistoryRow[] {
  return rows.filter(row => row.evidence_state === 'confirmed' && !rows.some(later =>
    later.fact_id === row.fact_id && later.revision > row.revision && later.evidence_state !== 'unverified'))
}
export function historyHeads(rows: readonly HistoryRow[]): HistoryRow[] {
  return rows.filter(row => !rows.some(later => later.fact_id === row.fact_id && later.revision > row.revision))
}
export function correctionInput(row: HistoryRow): Record<string, unknown> {
  const common = ['term_id','coverage_kind','start_precision','end_precision','effective_from','effective_to',
    'evidence_state','source_type','source_reference','reason','school_state','entry_kind','school_history_id',
    'class_id','subject_scope_complete','class_history_id','subject_id','subject_state']
  const input: Record<string, unknown> = { supersedes_id: row.id }
  for (const key of common) if (key in row) input[key] = (row as unknown as Record<string, unknown>)[key]
  return input
}
export function periodText(row: HistoryRow): string {
  if (row.coverage_kind === 'whole_term') return row.evidence_state === 'confirmed' ? 'Full term verified' : 'Full term claimed (not verified)'
  if (row.coverage_kind === 'unknown') return 'Effective dates unresolved'
  const date = (value:string) => new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T00:00:00Z'))
  return `From ${row.effective_from ? date(row.effective_from) : row.start_precision === 'term_start' ? 'term start' : 'an unresolved start'} to ${row.effective_to ? date(row.effective_to) : row.end_precision === 'term_end' ? 'term end' : 'an unresolved end'} (end excluded)`
}
export function periodExplanation(row: HistoryRow): string {
  if (row.coverage_kind === 'whole_term') return row.evidence_state === 'confirmed'
    ? 'Enrollment is verified for the entire selected term. Exact calendar dates have not been asserted.'
    : 'This claim covers the selected term. Exact calendar dates have not been asserted; verification is still required.'
  return 'The start date is included. The end date, when recorded, is excluded. Term boundaries do not assert exact calendar dates.'
}
export function validateHistoryInput(input: Record<string, unknown>): string | null {
  if (!input.term_id) return 'Select an academic term.'
  if (!String(input.reason ?? '').trim()) return 'A reason is required.'
  if (String(input.reason).length > 1000) return 'Keep the reason within 1,000 characters.'
  if (String(input.source_reference ?? '').length > 240) return 'Keep the evidence reference within 240 characters.'
  if (input.evidence_state !== 'unverified' && !String(input.source_reference ?? '').trim()) return 'Provide an evidence reference for this decision.'
  if (input.evidence_state === 'confirmed' && input.source_type === 'legacy_observation') return 'An observation alone cannot verify history.'
  if (input.start_precision === 'exact_date' && !input.effective_from || input.end_precision === 'exact_date' && !input.effective_to) return 'Enter each selected exact effective date.'
  if (input.effective_from && input.effective_to && String(input.effective_to) <= String(input.effective_from)) return 'The end date must be after the start date.'
  return null
}

/** References address earlier staged revisions, never client-generated row IDs. */
export function stageHistoryInput(axis: HistoryAxis, input: Record<string, unknown>, key: string): HistoryStep {
  const error = validateHistoryInput(input)
  if (error) throw new Error(error)
  const values = { ...input }, refs: Record<string, string> = {}
  for (const field of ['school_history_id','class_history_id','supersedes_id']) {
    const value = values[field]
    if (typeof value === 'string' && value.startsWith('draft:')) {
      refs[field] = value.slice(6)
      delete values[field]
    }
  }
  return { key, axis, input: values, ...(Object.keys(refs).length ? { refs } : {}) }
}
