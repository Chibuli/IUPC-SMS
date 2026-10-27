import type { GradeBand, GradingScale } from '../data/types'

export const DEFAULT_BANDS: GradeBand[] = [
  { grade: 'A*', min_score: 90, points: 9, remark: 'Excellent' },
  { grade: 'A', min_score: 80, points: 8, remark: 'Very Good' },
  { grade: 'B', min_score: 70, points: 7, remark: 'Good' },
  { grade: 'C', min_score: 60, points: 6, remark: 'Average' },
  { grade: 'D', min_score: 50, points: 5, remark: 'Below Average' },
  { grade: 'E', min_score: 40, points: 4, remark: 'Needs to Improve' },
  { grade: 'F', min_score: 30, points: 3, remark: 'Weak' },
  { grade: 'G', min_score: 20, points: 2, remark: 'Very Weak' },
  { grade: 'U', min_score: 0, points: 1, remark: 'Ungraded' },
]

export const DEFAULT_SCALE: GradingScale = {
  _id: 'gs-default',
  school_id: 'sch-iupc',
  name: 'IUPC Institutional Scale',
  pass_mark: 40,
  created_at: '2026-09-01T08:00:00.000Z',
  bands: DEFAULT_BANDS,
}

/** Newest custom scale wins; otherwise the institutional default applies. */
export function resolveScale(scales: GradingScale[]): GradingScale {
  if (!scales.length) return DEFAULT_SCALE
  const sorted = [...scales].sort((a, b) => b.created_at.localeCompare(a.created_at))
  return sorted[0]
}

export function bandFor(score: number, bands: GradeBand[]): GradeBand {
  const sorted = [...bands].sort((a, b) => b.min_score - a.min_score)
  return sorted.find((band) => score >= band.min_score) ?? sorted[sorted.length - 1]
}

export function gradeFor(score: number, bands: GradeBand[]): string {
  return bandFor(score, bands).grade
}

export function remarkFor(grade: string, bands: GradeBand[]): string {
  return bands.find((band) => band.grade === grade)?.remark ?? ''
}

/**
 * Bands are percentages, so a raw mark is graded through its paper total: 41 on
 * a paper out of 50 is 82% and earns an A, not the E that 41 would earn on a
 * paper out of 100.
 */
export function percentOf(score: number, maxScore: number): number {
  if (!(maxScore > 0)) return 0
  return (score / maxScore) * 100
}

export function gradeForMark(score: number, maxScore: number, bands: GradeBand[]): string {
  return gradeFor(percentOf(score, maxScore), bands)
}

export function pointsForMark(score: number, maxScore: number, bands: GradeBand[]): number {
  return bandFor(percentOf(score, maxScore), bands).points
}

export type GradeTone = 'gold' | 'ok' | 'slate' | 'warn' | 'danger' | 'neutral'

export function gradeTone(grade: string): GradeTone {
  if (grade === 'A*') return 'gold'
  if (grade === 'A' || grade === 'B') return 'ok'
  if (grade === 'C' || grade === 'D') return 'slate'
  if (grade === 'E' || grade === 'F') return 'warn'
  if (grade === 'G' || grade === 'U') return 'danger'
  if (grade === 'X') return 'warn'
  if (grade === 'Y') return 'danger'
  return 'neutral'
}

export type ScoreParse =
  | { ok: true; value: number | 'X' | 'Y' | null }
  | { ok: false; error: string }

/**
 * Accepts a number in 0…max, an empty value (clears the mark), or the X / Y codes.
 * Anything else is rejected with a message rather than being stored.
 */
export function parseScoreInput(raw: string, maxScore: number): ScoreParse {
  const trimmed = raw.trim()
  if (trimmed === '') return { ok: true, value: null }
  const upper = trimmed.toUpperCase()
  if (upper === 'X' || upper === 'Y') return { ok: true, value: upper }
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return { ok: false, error: 'Enter a score, or X for missing marks and Y for an irregularity.' }
  }
  const value = Number(trimmed)
  if (Number.isNaN(value) || value < 0 || value > maxScore) {
    return { ok: false, error: `Score must be between 0 and ${maxScore}.` }
  }
  return { ok: true, value }
}

export function displayScore(score: number | 'X' | 'Y' | null | undefined): string {
  if (score === null || score === undefined) return '—'
  return String(score)
}
