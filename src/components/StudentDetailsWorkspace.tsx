import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import './StudentDetailsWorkspace.css'

export type StudentDetailTab = 'overview' | 'history' | 'notes'
const tabs: { id: StudentDetailTab; label: string }[] = [{id:'overview',label:'Overview'},{id:'history',label:'Enrollment History'},{id:'notes',label:'Notes'}]
export function tabAfterKey(current: StudentDetailTab, key: string): StudentDetailTab | null {
  const i=tabs.findIndex(tab=>tab.id===current)
  return key==='Home' ? tabs[0].id : key==='End' ? tabs[2].id : key==='ArrowRight' ? tabs[(i+1)%3].id : key==='ArrowLeft' ? tabs[(i+2)%3].id : null
}
export const unsavedHistoryMessage='Enrollment history has unsaved changes or an unconfirmed save. Leave this student? Unsaved changes will be lost; retry an uncertain save before leaving.'

export default function StudentDetailsWorkspace({ identity, overview, notes, history, closeGuard }: {
  identity:ReactNode;overview:ReactNode;notes:ReactNode;
  history:(active:boolean,onDirtyChange:(dirty:boolean)=>void)=>ReactNode;
  closeGuard:RefObject<()=>boolean>
}) {
  const [tab,setTab]=useState<StudentDetailTab>('overview'),[visited,setVisited]=useState(false),[dirty,setDirty]=useState(false)
  const buttons=useRef<Partial<Record<StudentDetailTab,HTMLButtonElement|null>>>({})
  useEffect(()=>{
    closeGuard.current=()=>!dirty||window.confirm(unsavedHistoryMessage)
    const unload=(e:BeforeUnloadEvent)=>{if(dirty){e.preventDefault();e.returnValue=''}}
    // BrowserRouter has no data-router blocker. Protect browser Back/Forward
    // locally while this dialog owns a draft; no auth or router API is replaced.
    let restoring=false
    const previousState=window.history.state, previousUrl=window.location.href
    const index=previousState?.idx
    const pop=(e:PopStateEvent)=>{
      if(restoring){restoring=false;return}
      if(dirty&&!window.confirm(unsavedHistoryMessage)){
        e.stopImmediatePropagation()
        const target=e.state?.idx
        if(typeof index==='number'&&typeof target==='number'&&index!==target){restoring=true;window.history.go(index-target)}
        else window.history.replaceState(previousState,'',previousUrl)
      }
    }
    window.addEventListener('beforeunload',unload)
    window.addEventListener('popstate',pop,true)
    return()=>{closeGuard.current=()=>true;window.removeEventListener('beforeunload',unload);window.removeEventListener('popstate',pop,true)}
  },[dirty,closeGuard])
  function select(next:StudentDetailTab){setTab(next);if(next==='history')setVisited(true)}
  return <div className="student-detail-workspace">
    <div className="student-detail-identity">{identity}</div>
    <div role="tablist" aria-label="Student details" className="student-detail-tabs">
      {tabs.map(item=><button key={item.id} ref={el=>{buttons.current[item.id]=el}} type="button" role="tab" id={`student-tab-${item.id}`} aria-controls={`student-panel-${item.id}`} aria-selected={tab===item.id} tabIndex={tab===item.id?0:-1} onClick={()=>select(item.id)} onKeyDown={e=>{const next=tabAfterKey(item.id,e.key);if(next){e.preventDefault();select(next);buttons.current[next]?.focus()}}}>{item.label}{item.id==='history'&&dirty?<span className="student-detail-draft">Draft</span>:null}</button>)}
    </div>
    {tabs.map(item=><div key={item.id} role="tabpanel" id={`student-panel-${item.id}`} aria-labelledby={`student-tab-${item.id}`} hidden={tab!==item.id} tabIndex={0} className="student-detail-panel">
      {item.id==='overview'?overview:item.id==='notes'?notes:visited?history(tab==='history',setDirty):null}
    </div>)}
  </div>
}
