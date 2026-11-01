import {expect,it} from 'vitest'
import {renderToStaticMarkup} from 'react-dom/server'
import {BroadsheetHeader} from './BroadsheetHeader'
import {broadsheetKeyFixture} from '../test/broadsheet-fixtures'

const school=()=>({...broadsheetKeyFixture().schools[0],name:'IUPC Academy',address:'',city:'Mombasa, Kenya'})
it('omits blank, null, undefined and placeholder contact values and avoids a leading location separator',()=>{
  for(const value of ['', '   ',null,undefined,'null','undefined']){
    const html=renderToStaticMarkup(<BroadsheetHeader school={{...school(),phone_number:value,contact_email:value,postal:value} as unknown as import('../data/types').School} title="Combined results" detail="TERM 1 · 2026/2027" />)
    expect(html).not.toContain('Tel:');expect(html).not.toContain('Email:');expect(html).not.toContain('· Mombasa');expect(html).not.toContain('undefined');expect(html).not.toContain('null')
    expect(html).toContain('Mombasa, Kenya')
  }
})
it('uses configured contacts verbatim without adding school claims or a fictional warning',()=>{
  const html=renderToStaticMarkup(<BroadsheetHeader school={{...school(),phone_number:'configured-office-number',contact_email:'office@school.example'}} title="End Term" detail="Year 7" />)
  expect(html).toContain('Tel: configured-office-number');expect(html).toContain('Email: office@school.example');expect(html).not.toContain('FICTIONAL');expect(html).not.toContain('unverified')
})
it('preserves a configured fictional-data warning and labels test contacts as unverified',()=>{
  const s={...school(),address:'FICTIONAL LOCAL TEST DATA — NOT SCHOOL RECORDS',contact_email:'office@iupc-test.invalid'}
  const html=renderToStaticMarkup(<BroadsheetHeader school={s} title="Midterm" detail="Year 7" />)
  expect(html).toContain(s.address);expect(html).toContain('Test email (unverified): office@iupc-test.invalid');expect(html).not.toContain('Tel:')
})
it('labels reserved test-domain emails without hardcoding a school warning',()=>{
  const html=renderToStaticMarkup(<BroadsheetHeader school={{...school(),contact_email:'preview@example.invalid'}} title="Midterm" detail="Year 7" />)
  expect(html).toContain('Test email (unverified)');expect(html).not.toContain('NOT SCHOOL RECORDS')
})
it('keeps full long names and titles and can export a presentation-only fixture',async()=>{
  const s={...school(),name:'IUPC Academy International Advanced Secondary and Cambridge Examination Centre — Long Name Fixture',address:'PRESENTATION FIXTURE — NOT SCHOOL RECORDS',contact_email:'preview@example.invalid'}
  const title='Combined examination results — Year 13 Advanced Secondary cohort, full academic term and assessment information with an intentionally long examination title — TERM 1, 2026/2027'
  if(process.env.IUPC_WRITE_HEADER_FIXTURES){const fs=await import('node:fs/promises');s.logo_url='data:image/png;base64,'+(await fs.readFile('public/iupc-wordmark.png')).toString('base64')}
  const html=renderToStaticMarkup(<><article className="sheet sheet-broadsheet print-page page-break"><BroadsheetHeader school={s} title={title} detail="Student Results · Temporary presentation fixture" /></article><article className="sheet sheet-broadsheet print-page"><BroadsheetHeader school={s} title={'Subject Analysis — '+title} detail="Combined · Temporary presentation fixture" /></article></>)
  expect(html).toContain(s.name);expect(html).toContain(title);expect(html.match(/class="broadsheet-letterhead"/g)).toHaveLength(2)
  if(process.env.IUPC_WRITE_HEADER_FIXTURES){const fs=await import('node:fs/promises');const cssName=(await fs.readdir('dist/assets')).find(f=>f.endsWith('.css'))!;const css=await fs.readFile('dist/assets/'+cssName,'utf8');await fs.mkdir('.local-migration/report-inspection/header-fixtures',{recursive:true});await fs.writeFile('.local-migration/report-inspection/header-fixtures/long-header.html',`<!doctype html><html><meta charset="utf-8"><style>${css}</style><body data-page="broadsheet">${html}</body></html>`)}
})
