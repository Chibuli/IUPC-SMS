import { describe, expect, it } from 'vitest'
import { correctionInput, effectiveHistory, historyHeads, periodText, periodExplanation, stageHistoryInput, validateHistoryInput, type HistorySnapshot, type HistoryRow } from './enrollment-history-management'
import { planHistoryTransition } from './enrollment-history-transitions'

const common = { id:'s1',school_id:'school',student_id:'student',term_id:'term',fact_id:'school-fact',revision:1,supersedes_id:null,change_id:'change',coverage_kind:'whole_term',start_precision:'term_start',end_precision:'term_end',effective_from:null,effective_to:null,evidence_state:'confirmed',source_type:'class_register',source_reference:'FICTIONAL REGISTER',reason:'Fictional verification',recorded_by:'admin',recorded_at:'2099-01-01T12:00:00Z',updated_at:'2099-01-01T12:00:00Z',confirmed_by:'admin',confirmed_at:'2099-01-01T12:00:00Z' } as const
function fixture(): HistorySnapshot {
  return { school:[{...common,school_state:'enrolled',entry_kind:'admission'}],
    class:[{...common,id:'c1',fact_id:'class-fact',school_history_id:'s1',class_id:'class-a',subject_scope_complete:true}],
    subject:[{...common,id:'u1',fact_id:'subject-fact',class_history_id:'c1',subject_id:'math',subject_state:'enrolled'}],
    version:'fictional-version',contract_version:1,server_version_num:150019 }
}
const transition = { date:'2099-02-01',source:'transfer_record',reference:'FICTIONAL TRANSFER',reason:'Fictional verified transfer' }
describe('historical evidence presentation and immutable inputs', () => {
  it('keeps an effective confirmation behind an unverified proposal', () => {
    const row=fixture().school[0], draft={...row,id:'s2',revision:2,evidence_state:'unverified' as const}
    expect(effectiveHistory([row,draft])).toEqual([row]);expect(historyHeads([row,draft])).toEqual([draft])
  })
  for(const state of ['voided','conflict','confirmed'] as const) it(`${state} replaces the previous effective confirmation`, () => {
    const row=fixture().school[0], revised={...row,id:'s2',revision:2,evidence_state:state}
    expect(effectiveHistory([row,revised])).toEqual(state==='confirmed' ? [revised] : [])
  })
  it('does not expose actor or timestamps as editable inputs', () => {
    const input=correctionInput(fixture().school[0]);expect(input.supersedes_id).toBe('s1')
    for(const key of ['id','fact_id','revision','recorded_by','recorded_at','confirmed_by','confirmed_at','updated_at','school_id','student_id','change_id'])expect(input).not.toHaveProperty(key)
  })
  it('labels symbolic term scope without invented dates', () => {expect(periodText(fixture().school[0])).toBe('Full term verified');expect(periodExplanation(fixture().school[0])).toContain('Exact calendar dates have not been asserted')})
  it('labels unknown effective dates as unresolved', () => {expect(periodText({...fixture().school[0],coverage_kind:'unknown'})).toBe('Effective dates unresolved')})
  it('requires term, reason and verification evidence', () => {
    expect(validateHistoryInput({})).toContain('academic term')
    expect(validateHistoryInput({term_id:'t'})).toContain('reason')
    expect(validateHistoryInput({term_id:'t',reason:'r',evidence_state:'confirmed'})).toContain('evidence reference')
  })
  it('unknown evidence can remain unresolved with no fabricated dates', () => {expect(validateHistoryInput({term_id:'t',reason:'Historical evidence unavailable',evidence_state:'unverified',coverage_kind:'unknown'})).toBeNull()})
  it('does not treat a legacy observation as verified evidence', () => {expect(validateHistoryInput({...correctionInput(fixture().school[0]),source_type:'legacy_observation'})).toContain('cannot verify')})
  it('allows an exact start and symbolic term end', () => {expect(validateHistoryInput({...correctionInput(fixture().school[0]),coverage_kind:'dated_segment',start_precision:'exact_date',effective_from:'2099-02-01'})).toBeNull()})
  it('rejects reversed, equal and missing exact dates', () => {
    const input={...correctionInput(fixture().school[0]),start_precision:'exact_date',end_precision:'exact_date',effective_from:'2099-02-01',effective_to:'2099-01-01'}
    expect(validateHistoryInput(input)).toContain('after');expect(validateHistoryInput({...input,effective_to:'2099-02-01'})).toContain('after');expect(validateHistoryInput({...input,effective_to:null})).toContain('exact effective date')
  })
  it('resolves staged relationships without client-generated database IDs', () => {
    const step=stageHistoryInput('class',{...correctionInput(fixture().class[0]),school_history_id:'draft:step1',supersedes_id:'draft:step2'},'step3')
    expect(step.refs).toEqual({school_history_id:'step1',supersedes_id:'step2'});expect(step.input).not.toHaveProperty('school_history_id')
  })
  it('bounds evidence and reason lengths',()=>{const input=correctionInput(fixture().school[0]);expect(validateHistoryInput({...input,source_reference:'x'.repeat(241)})).toContain('240');expect(validateHistoryInput({...input,reason:'x'.repeat(1001)})).toContain('1,000')})
})
describe('guided atomic factual transitions', () => {
  it('withdrawal retires children leaf-first and restores compatible prefixes', () => {
    const snap=fixture(), before=JSON.stringify(snap)
    const steps=planHistoryTransition(snap,{...transition,axis:'school',row:snap.school[0]})
    expect(steps.map(s=>[s.axis,s.input.evidence_state])).toEqual([['subject','voided'],['class','voided'],['school','confirmed'],['class','confirmed'],['subject','confirmed'],['school','confirmed']])
    expect(steps[3].refs).toEqual({school_history_id:'step3',supersedes_id:'step2'})
    expect(steps[4].refs).toEqual({class_history_id:'step4',supersedes_id:'step1'})
    expect(steps.at(-1)?.input).toMatchObject({school_state:'not_enrolled',effective_from:transition.date,end_precision:'term_end',entry_kind:'unknown'})
    expect(JSON.stringify(snap)).toBe(before)
  })
  it('return records enrolled coverage without assuming a first admission',()=>{
    const snap=fixture();snap.class=[];snap.subject=[];snap.school[0]={...snap.school[0],school_state:'not_enrolled',entry_kind:'unknown'}
    const steps=planHistoryTransition(snap,{...transition,axis:'school',row:snap.school[0]})
    expect(steps.at(-1)?.input).toMatchObject({school_state:'enrolled',entry_kind:'return'})
  })
  it('class transfer retains historical subjects and records explicitly selected new subjects', () => {
    const snap=fixture(), steps=planHistoryTransition(snap,{...transition,axis:'class',row:snap.class[0],nextClass:'class-b',subjects:['english'],completeSubjects:true})
    expect(steps).toHaveLength(5);expect(steps[2].refs).toEqual({class_history_id:'step2',supersedes_id:'step1'})
    expect(steps[3].input).toMatchObject({class_id:'class-b',subject_scope_complete:true,effective_from:transition.date})
    expect(steps[4].input.subject_id).toBe('english');expect(steps[4].refs).toEqual({class_history_id:'step4'})
  })
  it('does not copy current subject choices to a new class',()=>{const snap=fixture(),steps=planHistoryTransition(snap,{...transition,axis:'class',row:snap.class[0],nextClass:'class-b'});expect(steps).toHaveLength(4);expect(steps[3].input.subject_scope_complete).toBe(false)})
  it('subject discontinuation retains earlier enrollment and records verified not-taken coverage',()=>{const snap=fixture(),steps=planHistoryTransition(snap,{...transition,axis:'subject',row:snap.subject[0]});expect(steps.map(s=>s.input.subject_state)).toEqual(['enrolled','not_taken']);expect(steps[0].input.effective_to).toBe(steps[1].input.effective_from)})
  it('subject change uses a new fact identity for the new offering',()=>{const snap=fixture(),steps=planHistoryTransition(snap,{...transition,axis:'subject',row:snap.subject[0],nextSubject:'english'});expect(steps[2].input).toMatchObject({subject_id:'english',subject_state:'enrolled'});expect(steps[2].input).not.toHaveProperty('supersedes_id')})
  for(const date of ['','2099-02-30','nonsense'])it(`rejects invalid transition date ${date}`,()=>{const snap=fixture();expect(()=>planHistoryTransition(snap,{...transition,date,axis:'school',row:snap.school[0]})).toThrow('valid verified transition date')})
  it('rejects a boundary outside the existing exact interval',()=>{const snap=fixture(),row={...snap.school[0],effective_from:'2099-02-01',effective_to:'2099-03-01'};snap.school=[row];expect(()=>planHistoryTransition(snap,{...transition,axis:'school',row})).toThrow('inside')})
  it('requires review of unknown dependent dates',()=>{const snap=fixture();snap.subject[0]={...snap.subject[0],coverage_kind:'unknown'};expect(()=>planHistoryTransition(snap,{...transition,axis:'school',row:snap.school[0]})).toThrow('individual review')})
  it('does not silently retire a later documented placement',()=>{const snap=fixture();snap.subject[0]={...snap.subject[0],effective_from:'2099-03-01'};expect(()=>planHistoryTransition(snap,{...transition,axis:'class',row:snap.class[0],nextClass:'class-b'})).toThrow('individual review')})
  it('refuses a pending correction chain',()=>{const snap=fixture();snap.class.push({...snap.class[0],id:'c2',revision:2,evidence_state:'unverified'});expect(()=>planHistoryTransition(snap,{...transition,axis:'class',row:snap.class[0],nextClass:'class-b'})).toThrow('unresolved correction')})
  it('leaves fully earlier child bounds intact on a new parent revision',()=>{const snap=fixture();snap.subject[0]={...snap.subject[0],coverage_kind:'dated_segment',end_precision:'exact_date',effective_to:'2099-01-20'};const steps=planHistoryTransition(snap,{...transition,axis:'class',row:snap.class[0],nextClass:'class-b'});expect(steps[2].input.effective_to).toBe('2099-01-20')})
  it('rejects same-class and same-subject transitions',()=>{const snap=fixture();expect(()=>planHistoryTransition(snap,{...transition,axis:'class',row:snap.class[0],nextClass:'class-a'})).toThrow('different destination');expect(()=>planHistoryTransition(snap,{...transition,axis:'subject',row:snap.subject[0],nextSubject:'math'})).toThrow('different new subject')})
})
