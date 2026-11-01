import {describe,it,expect} from 'vitest'
import {achievementForBand,subjectRemark,SUBJECT_REMARK_POLICY,ACHIEVEMENT_CATEGORIES} from './subject-remarks'
import {DEFAULT_BANDS,bandFor} from './grading'
import type {GradeBand} from '../data/types'
const remark=(grade:string,trend='—',termNumber=3,status='Complete')=>subjectRemark({band:DEFAULT_BANDS.find(b=>b.grade===grade)!,bands:DEFAULT_BANDS,trend,termNumber,resultStatus:status,eligibilityKnown:true})
describe('deterministic subject remarks',()=>{
  it.each([
    ['A*','—','Outstanding achievement'],['B','—','Good work; aim higher'],['U','—','Needs focused support'],
    ['A*','Improving +5.0 pp','Excellent progress'],['A*','Dropped -5.0 pp','Strong; regain consistency'],
    ['C','Improving +5.0 pp','Encouraging progress'],['C','Dropped -5.0 pp','Focus on recovery'],
    ['A*','Stationary 0.0 pp','Consistently outstanding'],['U','Stationary 0.0 pp','Continued support needed'],
    ['B','No comparison','Good work; aim higher'],
  ])('%s with %s gives %s',(grade,trend,expected)=>expect(remark(grade,trend)).toBe(expected))
  it('does not mistake the Term 1 performance graph assessment movement for a prior-term subject trend',()=>expect(remark('B','Improving +10.0 pp',1)).toBe('Good work; aim higher'))
  it.each(['Provisional — 1 of 2 terms','Provisional — 1 of 3 terms','Provisional — 2 of 3 terms'])('allows a valid %s grade without claiming annual completion',status=>expect(remark('A*','—',3,status)).toBe('Outstanding achievement'))
  it.each(['INC','Pending','Irregularity','N/T','N/A','Unresolved'])('uses %s instead of ordinary praise even when a band was supplied',status=>expect(remark('A*','Improving +10.0 pp',3,status)).toBe(status))
  it('withholds praise when historical eligibility is unknown despite complete numerical marks',()=>expect(subjectRemark({band:DEFAULT_BANDS[0],bands:DEFAULT_BANDS,trend:'Improving +10.0 pp',termNumber:3,resultStatus:'Complete',eligibilityKnown:false})).toBe('Unresolved'))
  it('preserves the distinct incomplete, pending and irregular component states',()=>{
    const base={band:null,bands:DEFAULT_BANDS,trend:'—',termNumber:1,resultStatus:'INC',eligibilityKnown:true}
    expect(subjectRemark({...base,componentStatuses:['Pending','Complete']})).toBe('INC')
    expect(subjectRemark({...base,componentStatuses:['Pending','Pending']})).toBe('Pending')
    expect(subjectRemark({...base,componentStatuses:['Irregularity','Complete']})).toBe('Irregularity')
  })
  it('does not produce praise or a partial grade from a missing band',()=>expect(subjectRemark({band:null,bands:DEFAULT_BANDS,trend:'—',termNumber:3,resultStatus:'Complete',eligibilityKnown:true})).toBe('—'))
  it('maps nine configured bands by actual order even with unusual labels and point values',()=>{
    const bands=DEFAULT_BANDS.map((b,i)=>({...b,grade:`Level ${9-i}!`,points:100-i*3})).reverse()
    expect(achievementForBand(bands.at(-1)!,bands)).toBe('highest')
    expect(achievementForBand(bands[0],bands)).toBe('support')
    expect(achievementForBand(bands[6],bands)).toBe('strong')
  })
  it('supports short custom scales without assuming letter labels or score thresholds',()=>{
    const bands:GradeBand[]=[{grade:'Mastery',min_score:65,points:10,remark:'Custom'},{grade:'Secure',min_score:25,points:6,remark:'Custom'},{grade:'Developing',min_score:0,points:0,remark:'Custom'}]
    expect(bands.map(b=>achievementForBand(b,bands))).toEqual(['highest','satisfactory','support'])
    expect(subjectRemark({band:bands[1],bands,trend:'Stationary 0.0 pp',termNumber:3,resultStatus:'Complete',eligibilityKnown:true})).toBe('Steady; aim higher')
  })
  it('accepts an explicit presentation category override without modifying the grading configuration',()=>{
    const before=structuredClone(DEFAULT_BANDS)
    expect(achievementForBand(DEFAULT_BANDS[3],DEFAULT_BANDS,{...SUBJECT_REMARK_POLICY,gradeCategories:{C:'developing'}})).toBe('developing')
    expect(DEFAULT_BANDS).toEqual(before)
  })
  it.each([69.99,70,79.99,80,89.99,90])('uses the already-mapped band at boundary %s without recalculating a grade',score=>{
    const band=bandFor(score,DEFAULT_BANDS)
    const before=structuredClone(band)
    const output=subjectRemark({band,bands:DEFAULT_BANDS,trend:'—',termNumber:1,resultStatus:'Complete',eligibilityKnown:true})
    expect(output).toBe(SUBJECT_REMARK_POLICY.catalogue[achievementForBand(band,DEFAULT_BANDS)!].baseline);expect(band).toEqual(before)
  })
  it('uses neutral wording when a single band provides no achievement hierarchy',()=>{
    const bands=[{grade:'Recorded',min_score:0,points:0,remark:''}]
    expect(subjectRemark({band:bands[0],bands,trend:'Improving +3.0 pp',termNumber:3,resultStatus:'Complete',eligibilityKnown:true})).toBe('Result recorded')
  })
  it('keeps every generated catalogue phrase short and free of unsupported personal claims',()=>{
    for(const category of ACHIEVEMENT_CATEGORIES)for(const text of Object.values(SUBJECT_REMARK_POLICY.catalogue[category])){
      expect(text.length).toBeLessThanOrEqual(SUBJECT_REMARK_POLICY.maxCharacters)
      expect(text.split(/\s+/).length).toBeLessThanOrEqual(SUBJECT_REMARK_POLICY.maxWords)
      expect(text).not.toMatch(/homework|attendance|behaviour|careless|disciplined|hardworking|\ufffd/i)
    }
  })
  it('preserves existing legitimate accepted overrides without allowing invalid-result praise',()=>{
    const base={band:DEFAULT_BANDS[0],bands:DEFAULT_BANDS,trend:'—',termNumber:3,resultStatus:'Complete',eligibilityKnown:true,override:'Keep practising fractions'}
    expect(subjectRemark(base)).toBe(base.override)
    expect(subjectRemark({...base,resultStatus:'INC'})).toBe('INC')
  })
})
