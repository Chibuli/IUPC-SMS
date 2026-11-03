import { describe, expect, it } from 'vitest'
import {
  assignableClasses,
  classAssignmentLabel,
  classSelectionToSave,
  classesArgument,
  scopedClassIds,
  toggleClassAssignment,
} from './teacher-classes'
import type { ClassRow } from '../data/types'

const cls = (id: string, schoolId: string, name = 'Form 1', stream = 'A'): ClassRow => ({
  _id: id,
  school_id: schoolId,
  class_name: name,
  stream_name: stream,
  class_teacher_id: null,
})

const classes = [cls('c1', 'school-a'), cls('c2', 'school-a', 'Form 2', 'B'), cls('c9', 'school-b')]

describe('saving a teacher’s classes', () => {
  it('creates an assignment from an empty form', () => {
    expect(classSelectionToSave(undefined, undefined)).toEqual([])
    expect(classesArgument({ mode: 'replace', classIds: [] })).toEqual([])
  })

  it('preserves stored assignments when the edit does not touch classes', () => {
    expect(classSelectionToSave(['c1', 'c2'], undefined)).toEqual(['c1', 'c2'])
    expect(classesArgument({ mode: 'preserve' })).toBeNull()
  })

  it('clears only when the administrator empties the selection explicitly', () => {
    expect(classSelectionToSave(['c1', 'c2'], [])).toEqual([])
    // An explicit empty array is sent as `{}`, never as null.
    expect(classesArgument({ mode: 'replace', classIds: [] })).toEqual([])
  })

  it('stores a repeated id once', () => {
    expect(classSelectionToSave(undefined, ['c1', 'c1', 'c2'])).toEqual(['c1', 'c2'])
    expect(classesArgument({ mode: 'replace', classIds: ['c1', 'c1'] })).toEqual(['c1'])
  })

  it('returns a copy so a form edit cannot mutate loaded staff data', () => {
    const stored = ['c1']
    const next = classSelectionToSave(stored, undefined)
    next.push('c2')
    expect(stored).toEqual(['c1'])
  })
})

describe('class assignment scope', () => {
  it('offers only the streams of the teacher’s own school', () => {
    expect(assignableClasses(classes, 'school-a').map((row) => row._id)).toEqual(['c1', 'c2'])
  })

  it('reports a class from another school instead of dropping it silently', () => {
    expect(scopedClassIds(['c1', 'c9'], classes, 'school-a')).toEqual({ accepted: ['c1'], rejected: ['c9'] })
    expect(scopedClassIds(['c9'], classes, 'school-a')).toEqual({ accepted: [], rejected: ['c9'] })
  })

  it('toggles one stream without disturbing the others', () => {
    expect(toggleClassAssignment(['c1'], 'c2')).toEqual(['c1', 'c2'])
    expect(toggleClassAssignment(['c1', 'c2'], 'c1')).toEqual(['c2'])
  })

  it('describes an empty assignment as timetable-based access', () => {
    expect(classAssignmentLabel([])).toContain('timetable')
    expect(classAssignmentLabel([cls('c1', 'school-a'), cls('c2', 'school-a', 'Form 2', 'B')])).toBe(
      'Form 1 A · Form 2 B',
    )
  })
})
