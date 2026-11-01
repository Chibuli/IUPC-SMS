import {useEffect,useMemo,useRef,useState} from 'react'
import type {School,Student} from '../data/types'
import {BroadsheetHeader} from './BroadsheetHeader'
import {formatDate} from '../lib/format'
import {paginateClassList,type ClassListPageRange} from '../lib/class-list-pagination'

interface Props {
  school: School
  classLabel: string
  termLabel?: string
  students: Student[]
  requestId?: number
  onReady?: () => void
}

export function RosterTable({students,start=0}:{students:Student[];start?:number}) {
  return <table className="classlist-table"><colgroup><col style={{width:'6%'}}/><col style={{width:'18%'}}/><col style={{width:'34%'}}/><col style={{width:'10.4%'}}/><col style={{width:'60mm'}}/></colgroup>
    <thead><tr>{['NO.','ADM NO.','STUDENT NAME','GENDER',''].map(h=><th key={h} scope="col">{h}</th>)}</tr></thead>
    <tbody>{students.map((s,i)=><tr key={s._id} data-student-id={s._id}><td>{start+i+1}</td><td>{s.admission_number}</td><td>{s.full_name}</td><td>{s.gender}</td><td></td></tr>)}</tbody>
  </table>
}
function Signatures(){return <div className="classlist-signatures"><div>Class teacher — signature &amp; date</div><div>Head teacher — signature &amp; date</div></div>}
function Footer({page,total}:{page:number;total:number}){return <footer className="classlist-footer"><span>Class register</span><span>Page {page} of {total}</span></footer>}

/** Explicit A4 pages are measured with the same fonts, widths and row styles used in print. */
export function ClassListPrint({school,classLabel,termLabel,students,requestId=0,onReady}:Props){
  const measure=useRef<HTMLDivElement>(null)
  const callback=useRef(onReady),printed=useRef<number|null>(null)
  const date=useMemo(()=>formatDate(new Date().toISOString()),[requestId])
  const [layout,setLayout]=useState<{pages:ClassListPageRange[];ticket:number}|null>(null)
  const [error,setError]=useState('')
  useEffect(()=>{callback.current=onReady},[onReady])
  useEffect(()=>{
    let cancelled=false
    setLayout(null);setError('')
    const run=async()=>{
      await document.fonts.ready
      const container=measure.current;if(!container)return
      await Promise.all([...container.querySelectorAll('img')].map(img=>img.decode().catch(()=>{})))
      await new Promise<void>(r=>requestAnimationFrame(()=>r()))
      if(cancelled)return
      const height=(selector:string)=>{const e=container.querySelector<HTMLElement>(selector)!;return e.getBoundingClientRect().height+(parseFloat(getComputedStyle(e).marginTop)||0)+(parseFloat(getComputedStyle(e).marginBottom)||0)}
      const pageHeight=container.querySelector('.classlist-page-ruler')!.getBoundingClientRect().height
      try{
        const pages=paginateClassList({rowHeights:[...container.querySelectorAll('tbody tr')].map(row=>row.getBoundingClientRect().height),pageHeight,
          headerHeight:height('.classlist-page-header'),tableHeaderHeight:height('thead')+1,footerHeight:height('.classlist-footer'),signatureHeight:height('.classlist-signatures')})
        setLayout({pages,ticket:requestId})
      }catch(e){setError(e instanceof Error?e.message:'Unable to prepare class list.')}
    }
    void run();return()=>{cancelled=true}
  },[school,classLabel,termLabel,students,requestId])
  useEffect(()=>{
    if(!layout||layout.ticket!==requestId)return
    let cancelled=false
    const frame=requestAnimationFrame(()=>{
      if(cancelled)return
      if(requestId>0&&printed.current!==requestId){printed.current=requestId;callback.current?.()}
    })
    return()=>{cancelled=true;cancelAnimationFrame(frame)}
  },[layout,requestId])
  const header=<div className="classlist-page-header"><BroadsheetHeader school={school} title={`Class list — ${classLabel}`} detail={[termLabel,`${students.length} students`,`Printed ${date}`].filter(Boolean).join(' · ')} /></div>
  return <>
    <div className="classlist-measure no-print" ref={measure} aria-hidden="true">
      <div className="classlist-page-ruler" />{header}<RosterTable students={students}/><Signatures/><Footer page={1} total={1}/>
    </div>
    <div className="classlist-output print-only" data-classlist-ready={Boolean(layout)} data-print-ticket={layout?.ticket}>
      {layout?.pages.map((page,i)=><section className="sheet sheet-classlist classlist-page print-page" key={i} data-classlist-page={i+1}>
        {header}<RosterTable students={students.slice(page.start,page.end)} start={page.start}/>{page.signatures?<Signatures/>:null}<Footer page={i+1} total={layout.pages.length}/>
      </section>)}
    </div>
    {error?<p role="alert" className="no-print">Class list could not be printed: {error}</p>:null}
  </>
}
