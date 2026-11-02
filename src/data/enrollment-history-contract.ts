/**
 * Phase 2A storage contracts only. Not part of Database, cache, registration,
 * marking, report evidence, ranking or synchronization. Dates are ISO dates;
 * null means no exact date, never an inferred academic admission timestamp.
 */
export type HistoryEvidenceState = 'unverified' | 'confirmed' | 'conflict' | 'voided'
export type HistoryCoverage = 'whole_term' | 'dated_segment' | 'partial_term_dates_unknown' | 'unknown'
export type HistorySource = 'admission_register' | 'class_register' | 'subject_selection'
  | 'transfer_record' | 'departure_record' | 'return_record' | 'administrator_review' | 'legacy_observation'

export interface EnrollmentHistoryRevision {
  readonly id: string
  readonly school_id: string
  readonly student_id: string
  readonly term_id: string
  readonly fact_id: string
  readonly revision: number
  readonly supersedes_id: string | null
  readonly change_id: string
  readonly coverage_kind: HistoryCoverage
  readonly start_precision: 'term_start' | 'exact_date' | 'unknown'
  readonly end_precision: 'term_end' | 'exact_date' | 'unknown'
  readonly effective_from: string | null
  readonly effective_to: string | null
  readonly evidence_state: HistoryEvidenceState
  readonly source_type: HistorySource
  readonly source_reference: string
  readonly reason: string
  readonly recorded_by: string
  readonly recorded_at: string
  /** Immutable revision timestamp, equal to recorded_at; correction appends. */
  readonly updated_at: string
  readonly confirmed_by: string | null
  readonly confirmed_at: string | null
}

export interface SchoolEnrollmentHistory extends EnrollmentHistoryRevision {
  readonly school_state: 'enrolled' | 'pre_enrollment' | 'not_enrolled' | 'unknown'
  readonly entry_kind: 'admission' | 'return' | 'continuation' | 'unknown'
}
export interface ClassEnrollmentHistory extends EnrollmentHistoryRevision {
  readonly school_history_id: string
  readonly class_id: string
  readonly subject_scope_complete: boolean
}
export interface SubjectEnrollmentHistory extends EnrollmentHistoryRevision {
  readonly class_history_id: string
  readonly subject_id: string
  readonly subject_state: 'enrolled' | 'not_taken' | 'unknown'
}
