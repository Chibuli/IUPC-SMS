import { getAccountScope } from './backend'
import { supabase } from './supabase'
import type { HistorySnapshot, HistoryStep } from '../lib/enrollment-history-management'

export class HistoryError extends Error {
  constructor(message: string, readonly kind: 'setup' | 'offline' | 'permission' | 'stale' | 'validation' | 'uncertain' | 'backend') { super(message) }
}
export function historyError(error: { code?: string; message?: string }, writing = false): HistoryError {
  if (['PGRST202','42P01','42883'].includes(error.code ?? '')) return new HistoryError('Enrollment history is not installed. Ask the system administrator to review the Phase 2A and 2B migrations.', 'setup')
  if (['42501','PGRST301','PGRST303'].includes(error.code ?? '')) return new HistoryError('Active school administrator access is required. Sign in again if your membership changed.', 'permission')
  if (['40001','PT409'].includes(error.code ?? '')) return new HistoryError('History changed while you were editing. Reload and review your staged changes before retrying.', 'stale')
  if (['23514','23503','23505','22023','22007','22008','22P02'].includes(error.code ?? '')) return new HistoryError(
    error.code === '23514' ? 'This change conflicts with enrollment evidence, dependent history, or accepted assessments. Review the complete change; no part of this transaction was saved.' :
    error.code === '23503' ? 'A selected relationship is unavailable or belongs to another school. Reload the history.' : 'The change is invalid or its request identity was already used. Review the staged records.', 'validation')
  return new HistoryError(writing ? 'Save confirmation was not received. Keep this change open and retry the same request to check its receipt.' : 'Enrollment history could not be loaded. Check your connection and retry.', writing ? 'uncertain' : 'backend')
}

async function context() {
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new HistoryError('Enrollment history requires an online connection. Changes are never queued offline.', 'offline')
  const scope = getAccountScope()
  if (!supabase) throw new HistoryError('The online backend is not configured. No local history store is used.', 'setup')
  if (!scope?.verified) throw new HistoryError('Verified school administrator access is required.', 'permission')
  const { data, error } = await supabase.auth.getSession()
  if (error || data.session?.user.id !== scope.userId || (data.session.expires_at ?? 0) * 1000 <= Date.now() || getAccountScope() !== scope) throw new HistoryError('Your session changed or expired. Sign in again.', 'permission')
  return { client: supabase, scope }
}
export async function readEnrollmentHistory(studentId: string): Promise<HistorySnapshot> {
  const { client, scope } = await context()
  const { data, error } = await client.rpc('read_enrollment_history', { target_school: scope.schoolId, target_student: studentId })
  if (getAccountScope() !== scope) throw new HistoryError('Your account changed. Reopen this student.', 'permission')
  if (error) throw historyError(error)
  if (data?.contract_version !== 1 || !Array.isArray(data.school) || !Array.isArray(data.class) || !Array.isArray(data.subject) || typeof data.version !== 'string') throw new HistoryError('History contract unavailable. Ask the system administrator to review setup.', 'setup')
  return data as HistorySnapshot
}
export interface HistoryChange { id: string; version: string; steps: HistoryStep[] }
export async function saveEnrollmentHistory(studentId: string, change: HistoryChange): Promise<void> {
  const { client, scope } = await context()
  const { data, error } = await client.rpc('apply_enrollment_history_change', {
    target_school: scope.schoolId, target_student: studentId, request_id: change.id,
    expected_version: change.version, steps: change.steps,
  })
  if (getAccountScope() !== scope) throw new HistoryError('Your account changed. Reopen this student to check the recorded history.', 'permission')
  if (error) throw historyError(error, true)
  if (data?.applied !== true || data.change_id !== change.id) throw new HistoryError('Save confirmation was not received. Retry this same request.', 'uncertain')
}
