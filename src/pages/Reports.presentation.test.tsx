import { it,expect,vi } from 'vitest'
import {renderToStaticMarkup} from 'react-dom/server'
import {broadsheetKeyFixture} from '../test/broadsheet-fixtures'
const state=vi.hoisted(()=>({db:null as unknown as import('../data/types').Database}))
vi.mock('../data/db',()=>({useDb:()=>state.db}))
vi.mock('../session',()=>({useSession:()=>({session:null,subjectScope:null})}))
import Reports from './Reports'

it('renders the actual results template with precise key meanings, provisional flags and eligible-only statistics',async()=>{
  state.db=broadsheetKeyFixture()
  if(process.env.IUPC_WRITE_REPORT_FIXTURES){const fs=await import('node:fs/promises');state.db.schools[0].logo_url='data:image/png;base64,'+(await fs.readFile('public/iupc-wordmark.png')).toString('base64')}
  const html=renderToStaticMarkup(<Reports />)
  for(const text of ['ADM NO.','Results key','Subject codes','Mathematics','Science','Class performance','Sum of subject averages','Grade distribution','Pass threshold: 40%','1 of 2 completed students','(50%)','No numeric grade available','Recorded missing marks','A*','P 80','0/2'])expect(html).toContain(text)
  expect(html).not.toContain('Tot avg:');expect(html).not.toContain('X absent');expect(html).not.toContain('88.0')
  expect(html).toContain('data-stat="mean-score">42.5%');expect(html).toContain('data-stat="mean-point">4.5');expect(html).toContain('data-stat="mean-grade">E')
  expect(html.match(/data-student-id=/g)).toHaveLength(8)
  if(process.env.IUPC_WRITE_REPORT_FIXTURES){const fs=await import('node:fs/promises');const cssName=(await fs.readdir('dist/assets')).find(f=>f.endsWith('.css'))!;const css=await fs.readFile('dist/assets/'+cssName,'utf8');await fs.mkdir('.local-migration/report-inspection/presentation-fixtures',{recursive:true});await fs.writeFile('.local-migration/report-inspection/presentation-fixtures/key-fixture.html',`<!doctype html><html><meta charset="utf-8"><style>${css}</style><body data-page="broadsheet">${html}</body></html>`)}
})
