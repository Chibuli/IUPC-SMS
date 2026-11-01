import { mean } from './analytics'
import { comparePerformance, type AcademicReport, type Result } from './academic-report'

export interface ReportGraphPoint {
  label: string
  value: number
  /** Original assessment/term order; retained even when missing points are omitted. */
  order: number
}
export interface ReportGraph {
  mode: 'assessment' | 'term'
  context: string
  points: ReportGraphPoint[]
  unavailable: string[]
  trend: string
}

const verifiedValue = (result: Result): result is Result & { value: number } =>
  result.status === 'Complete' && typeof result.value === 'number' && Number.isFinite(result.value) && result.value >= 0 && result.value <= 100

/** Graph-only mapping; never feeds averages, grades, eligibility or ranking back to the engine. */
export function buildReportGraph(report: AcademicReport): ReportGraph {
  const priorTerms = report.overall.slice(0, report.termNumber - 1)
  // A gap/unknown history is not evidence of late admission. N/A is engine-verified pre-enrollment.
  const assessmentMode = report.termNumber === 1 || (priorTerms.length > 0 && priorTerms.every(result => result.status === 'N/A'))
  let timeline: { label: string; value: number | null; order: number }[]
  if (assessmentMode) {
    const eligible = report.rows.filter(row => row.current.eligibility !== 'not-taken' && row.current.eligibility !== 'pre-enrollment')
    const scopeVerified = eligible.length > 0 && eligible.every(row => row.current.eligibility === 'enrolled')
    timeline = ['Midterm', 'End Term'].map((label, order) => {
      const components = eligible.map(row => row.current.components[order])
      // An overall assessment point needs every required subject, matching the engine's
      // completeness standard. Partial cohorts are not silently averaged around missing marks.
      const complete = scopeVerified && components.every(component => component && verifiedValue(component))
      return { label, order, value: complete ? mean(components.map(component => component.value!)) : null }
    })
  } else {
    timeline = report.overall.flatMap((result, order) => result.status === 'N/A' ? [] : [{
      label: `Term ${order + 1} Avg`, order, value: verifiedValue(result) ? result.value : null,
    }])
  }
  const points = timeline.filter((point): point is ReportGraphPoint => point.value !== null)
  const latest = points.at(-1), previous = points.at(-2)
  const consecutive = latest && previous && latest.order === previous.order + 1
  return {
    mode: assessmentMode ? 'assessment' : 'term',
    context: assessmentMode ? `Term ${report.termNumber} assessments` : 'Completed term averages',
    points,
    unavailable: timeline.filter(point => point.value === null).map(point => point.label),
    trend: consecutive ? comparePerformance(latest.value, previous.value) : '—',
  }
}
