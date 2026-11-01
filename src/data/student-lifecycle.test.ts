import { describe, expect, it } from 'vitest'
import { isOperationalStudent } from './student-lifecycle'

describe('student lifecycle', () => {
  it('keeps only active, non-archived students in operational workflows', () => {
    expect(isOperationalStudent({ status: 'Active', archived: false })).toBe(true)
    expect(isOperationalStudent({ status: 'Active', archived: true })).toBe(false)
    expect(isOperationalStudent({ status: 'Alumni', archived: false })).toBe(false)
    expect(isOperationalStudent({ status: 'Alumni', archived: true })).toBe(false)
  })

  it('treats legacy rows without an archive flag as unarchived without changing Alumni status', () => {
    expect(isOperationalStudent({ status: 'Active' })).toBe(true)
    expect(isOperationalStudent({ status: 'Alumni' })).toBe(false)
  })
})
