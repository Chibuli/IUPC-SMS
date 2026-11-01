import { expect,it,vi } from 'vitest'
import {renderToStaticMarkup} from 'react-dom/server'
import {MemoryRouter} from 'react-router-dom'
import {academicFixture} from '../test/academic-report-fixtures'
const state=vi.hoisted(()=>({db:null as unknown as import('../data/types').Database}))
vi.mock('../data/db',()=>({useDb:()=>state.db,api:{}}))
vi.mock('../session',()=>({useSession:()=>({session:{role:'admin'},subjectScope:null})}))
import Students from './Students'
it('starts admission blank when admitting directly from a class, retaining existing numbers',()=>{
  state.db=academicFixture().db
  const before=structuredClone(state.db.students)
  const html=renderToStaticMarkup(<MemoryRouter initialEntries={[{pathname:'/dashboard/students',state:{admitInto:'fictional-class'}}]}><Students/></MemoryRouter>)
  expect(html).toMatch(/name="admission_number"[^>]*value=""/)
  expect(html).toContain('Enter the school&#x27;s admission number manually.')
  expect(state.db.students).toEqual(before)
})
