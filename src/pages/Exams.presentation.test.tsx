import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { academicFixture } from '../test/academic-report-fixtures'
import type { Database } from '../data/types'

const state = vi.hoisted(() => ({ db: null as unknown as Database, role: 'admin' as 'admin' | 'teacher' }))

vi.mock('../data/db', () => ({
  useDb: () => state.db,
  api: { exams: { create: vi.fn(), update: vi.fn() } },
}))
vi.mock('../session', () => ({ useSession: () => ({ session: { role: state.role }, teacher: null }) }))

import Exams from './Exams'

const render = () => renderToStaticMarkup(<Exams />)
const table = (html: string) => html.split('<tbody>')[1]?.split('</tbody>')[0] ?? ''

beforeEach(() => {
  state.db = academicFixture().db
  state.role = 'admin'
})

describe('Examinations page', () => {
  it('lists the active term papers with their status and register progress', () => {
    const html = render()
    expect(html).toContain('Examinations')
    expect(html).toContain('Mathematics')
    expect(html).toContain('Published')
    expect(html).toContain('1/1')
    expect(html).toContain('Complete')
  })

  it('does not show papers from another term', () => {
    const html = render()
    // The fixture holds three terms of two papers per subject; only the active
    // Term 3 (6 papers) is listed.
    expect(html).toContain('6 papers')
    expect(table(html)).not.toContain('data-exam="exam-1-')
    expect(table(html)).not.toContain('data-exam="exam-2-')
  })

  it('gives an administrator the create and manage controls', () => {
    const html = render()
    expect(html).toContain('New paper')
    expect(html).toContain('data-action="manage-paper"')
  })

  it('keeps a teacher read-only', () => {
    state.role = 'teacher'
    const html = render()
    expect(html).not.toContain('New paper')
    expect(html).not.toContain('data-action="manage-paper"')
    expect(html).toContain('Read-only')
  })

  it('renders without mutating the loaded records', () => {
    const before = structuredClone(state.db)
    render()
    expect(state.db).toEqual(before)
  })
})
