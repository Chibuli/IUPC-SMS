import {expect,it} from 'vitest'
import {paginateClassList} from './class-list-pagination'
const dimensions={pageHeight:1000,headerHeight:100,tableHeaderHeight:30,footerHeight:30,signatureHeight:80}
it.each([[10,1],[35,2],[50,2],[75,3],[100,4]])('paginates %s measured student rows into %s pages with continuous ranges',(count,total)=>{
  const pages=paginateClassList({...dimensions,rowHeights:Array(count).fill(30)})
  expect(pages).toHaveLength(total)
  expect(pages.flatMap(p=>Array.from({length:p.end-p.start},(_,i)=>p.start+i))).toEqual(Array.from({length:count},(_,i)=>i))
  expect(pages.filter(p=>p.signatures)).toHaveLength(1);expect(pages.at(-1)?.signatures).toBe(true)
  for(const p of pages)expect(100+30+30+(p.end-p.start)*30+(p.signatures?80:0)).toBeLessThanOrEqual(998)
})
it('moves signatures together onto a final continuation page when rows consume the last page',()=>{
  expect(paginateClassList({...dimensions,rowHeights:Array(27).fill(30)})).toEqual([{start:0,end:27,signatures:false},{start:27,end:27,signatures:true}])
})
it('uses variable row heights rather than a fixed student count',()=>{
  expect(paginateClassList({...dimensions,rowHeights:[300,300,300,100]})).toEqual([{start:0,end:2,signatures:false},{start:2,end:4,signatures:true}])
})
it('accounts for taller letterheads and preserves row order',()=>{
  const pages=paginateClassList({...dimensions,headerHeight:300,rowHeights:Array(35).fill(30)})
  expect(pages.map(p=>p.end-p.start)).toEqual([21,14]);expect(pages[1].start).toBe(21)
})
it('rejects a row that cannot fit unbroken rather than clipping or silently dropping it',()=>{
  expect(()=>paginateClassList({...dimensions,rowHeights:[900]})).toThrow('row or letterhead')
  expect(()=>paginateClassList({...dimensions,rowHeights:[NaN]})).toThrow()
})
