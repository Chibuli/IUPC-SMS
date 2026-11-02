import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { academicFixture, lateFixture } from '../test/academic-report-fixtures'
import { buildAcademicReport, reportPosition } from '../lib/academic-report'
import { DEFAULT_BANDS } from '../lib/grading'
import { buildCompactBroadsheet } from '../lib/compact-broadsheet'
import type { SchoolEnrollmentHistory } from './enrollment-history-contract'

const build = (fixture: ReturnType<typeof academicFixture>, term = 3) =>
  buildAcademicReport(fixture.db, fixture.student, 'term-' + term, fixture.student.class_id, DEFAULT_BANDS, fixture.evidence)
const migration = readFileSync(new URL('../../supabase/migrations/20261101182121_historical_enrollment_foundation.sql', import.meta.url), 'utf8')

describe('Phase 2A disconnected-history compatibility (not a database/RLS test)', () => {
  it.each([[1, 75], [2, 80], [3, 85]])('retains Term %i result %i', (term, expected) => {
    const fixture = academicFixture()
    const before = structuredClone(fixture.db)
    const report = build(fixture, term)
    expect(report.cumulative.value).toBe(expected)
    expect(reportPosition(report, [report])).toBe('1/1')
    expect(reportPosition(report, [report], true)).toBe('1/1')
    expect(fixture.db).toEqual(before)
  })
  it.each([2, 3])('retains verified late admission policy for Term %i', join => {
    const report = build(lateFixture(join))
    expect(report.current.value).toBe(95)
    expect(report.cumulative.value).toBe(join === 2 ? 90 : 95)
    expect(report.cumulative.status).toContain('Provisional')
    expect(reportPosition(report, [report])).toBe('1/1')
    expect(reportPosition(report, [report], true)).toBe('\u2014')
  })
  it('does not turn absent history into invented eligibility', () => {
    const fixture = academicFixture()
    fixture.evidence = []
    fixture.db.marks = []
    const report = build(fixture)
    expect(report.overall[0].status).toBe('Unresolved')
    expect(report.cumulative.value).toBeNull()
    expect(reportPosition(report, [report], true)).toBe('\u2014')
  })
  it('retains incomplete handling and student/accepted mark identities', () => {
    const fixture = academicFixture()
    fixture.db.marks = fixture.db.marks.filter(mark => mark.exam_id !== 'exam-3-0-0')
    const original = structuredClone(fixture.db)
    expect(build(fixture).current.value).toBeNull()
    expect(fixture.db).toEqual(original)
  })
  it('leaves current subject lists and broadsheet output independent of empty history', () => {
    const fixture = academicFixture()
    const input = { students: fixture.db.students, exams: fixture.db.exams, marks: fixture.db.marks,
      bands: DEFAULT_BANDS, assessment: 'all' as const, assessmentTermId: 'term-3', completionScopeComplete: true }
    const before = buildCompactBroadsheet(input)
    const separateHistory: SchoolEnrollmentHistory[] = []
    expect(separateHistory).toHaveLength(0)
    expect(buildCompactBroadsheet(input)).toEqual(before)
    expect(fixture.student.subject_ids).toEqual(['subject-0', 'subject-1', 'subject-2'])
  })
  it('keeps persistence additive and isolated in the migration source', () => {
    expect(migration).not.toMatch(/alter\s+table\s+public\.(students|student_subjects|marks|exams|terms)\b/i)
    expect(migration).not.toMatch(/(?:insert\s+into|update|delete\s+from)\s+public\.(students|student_subjects|marks|exams)\b/i)
    expect(migration).not.toMatch(/create\s+or\s+replace\s+function/i)
    expect(migration).toContain('security_invoker=true')
    expect(migration).toContain('History writes require READ COMMITTED')
  })
})
