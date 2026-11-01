import { round } from './format'

/** Preserve the existing rounding precision; remove only insignificant trailing zeros. */
export function formatBroadsheetNumber(value: number | null, digits = 1): string {
  const text = round(value, digits)
  const compact = text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text
  return compact === '-0' ? '0' : compact
}

// These describe actual rendering/adapter behavior, not additional mark-entry statuses.
export const RESULTS_KEY = [
  ['X', 'Recorded missing marks; may include absence or an incomplete assessment.'],
  ['Y', 'Recorded examination irregularity; not a valid numeric result.'],
  ['Z', 'No numeric grade available, or an invalid/ungradable result.'],
  ['==', 'Verified subject not taken.'],
  ['INC', 'Required score/paper missing, or assessment configuration ambiguous.'],
  ['* / P', 'Provisional grade / average for an incomplete student; no final rank.'],
  ['—', 'Value unavailable, no numeric result, or no final rank.'],
  ['MG', 'Mean grade: the configured grade of the student’s average score.'],
  ['COMP', 'Valid completed subjects / required subjects.'],
  ['TOTAL / AVG', 'Sum / mean of valid subject percentages; provisional if incomplete.'],
  ['SD', 'Population standard deviation of valid subject percentages; needs two results.'],
] as const
