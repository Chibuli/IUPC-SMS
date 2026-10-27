import { LEVEL_LABELS, LEVEL_ORDER, LEVEL_SHORT } from '../data/catalogue'
import type { Subject, SubjectLevel } from '../data/types'

export { LEVEL_ORDER, LEVEL_LABELS, LEVEL_SHORT }

export interface SubjectGroup {
  level: SubjectLevel
  label: string
  subjects: Subject[]
}

/** The subjects this campus teaches, in catalogue order. */
export function offeredSubjects(subjects: Subject[]): Subject[] {
  return subjects.filter((subject) => subject.offered)
}

export function levelRank(level: SubjectLevel | undefined): number {
  const index = LEVEL_ORDER.indexOf(level ?? 'Custom')
  return index < 0 ? LEVEL_ORDER.length : index
}

export function levelLabel(level: SubjectLevel | undefined): string {
  return LEVEL_LABELS[level ?? 'Custom'] ?? LEVEL_LABELS.Custom
}

export function levelShort(level: SubjectLevel | undefined): string {
  return LEVEL_SHORT[level ?? 'Custom'] ?? LEVEL_SHORT.Custom
}

export interface SubjectFilter {
  /** Free text matched against the subject name and the syllabus code. */
  query?: string
  level?: SubjectLevel | 'all'
  offered?: 'all' | 'offered' | 'catalogue'
}

export function filterSubjects(subjects: Subject[], filter: SubjectFilter): Subject[] {
  const needle = (filter.query ?? '').trim().toLowerCase()
  return subjects.filter((subject) => {
    if (filter.level && filter.level !== 'all' && subject.level !== filter.level) return false
    if (filter.offered === 'offered' && !subject.offered) return false
    if (filter.offered === 'catalogue' && subject.offered) return false
    if (!needle) return true
    return `${subject.name} ${subject.code} ${subject.category}`.toLowerCase().includes(needle)
  })
}

/** Offered first, then level order, then name — the order a registrar scans in. */
export function sortSubjects(subjects: Subject[]): Subject[] {
  return [...subjects].sort(
    (a, b) =>
      Number(b.offered) - Number(a.offered) ||
      levelRank(a.level) - levelRank(b.level) ||
      a.name.localeCompare(b.name) ||
      a.code.localeCompare(b.code),
  )
}

/** Grouped by level for the catalogue page, levels in curriculum order. */
export function groupByLevel(subjects: Subject[]): SubjectGroup[] {
  const groups = new Map<SubjectLevel, Subject[]>()
  for (const subject of sortSubjects(subjects)) {
    const level = subject.level ?? 'Custom'
    groups.set(level, [...(groups.get(level) ?? []), subject])
  }
  return [...groups.entries()]
    .sort((a, b) => levelRank(a[0]) - levelRank(b[0]))
    .map(([level, rows]) => ({ level, label: levelLabel(level), subjects: rows }))
}

export function countByLevel(subjects: Subject[]): { level: SubjectLevel; label: string; total: number; offered: number }[] {
  return LEVEL_ORDER.map((level) => {
    const rows = subjects.filter((subject) => (subject.level ?? 'Custom') === level)
    return { level, label: levelLabel(level), total: rows.length, offered: rows.filter((row) => row.offered).length }
  }).filter((entry) => entry.total > 0)
}
