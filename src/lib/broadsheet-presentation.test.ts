import { describe,it,expect } from 'vitest'
import { formatBroadsheetNumber as format, RESULTS_KEY } from './broadsheet-presentation'
import { buildCompactBroadsheet,toCompactCsv } from './compact-broadsheet'
import { broadsheetKeyFixture } from '../test/broadsheet-fixtures'
import { parseScoreInput } from './grading'

describe('broadsheet presentation and verified results key',()=>{
  it.each([[93,'93'],[88,'88'],[88.5,'88.5'],[727,'727'],[0,'0'],[1.25,'1.3'],[79.96,'80'],[null,'—']] as const)('formats %s as %s without changing the existing rounding precision',(value,expected)=>expect(format(value)).toBe(expected))
  it('retains existing two-decimal CSV average precision while suppressing zeros',()=>{expect(format(88.5,2)).toBe('88.5');expect(format(88.125,2)).toBe('88.13');expect(format(78,2)).toBe('78')})
  it('only X and Y are entered codes; zero is numeric, missing stays null and Z/INC are not input statuses',()=>{
    expect(parseScoreInput('0',100)).toEqual({ok:true,value:0});expect(parseScoreInput('',100)).toEqual({ok:true,value:null})
    for(const code of ['X','Y'])expect(parseScoreInput(code,100)).toEqual({ok:true,value:code})
    for(const code of ['Z','INC','=='])expect(parseScoreInput(code,100).ok).toBe(false)
    expect(RESULTS_KEY.find(([code])=>code==='X')?.[1]).toContain('missing marks')
  })
  it.each(['Midterm','Endterm','all'] as const)('verifies statuses, eligibility, grade points, cohort distribution and CSV in %s',async assessment=>{
    const d=broadsheetKeyFixture(),original=structuredClone(d)
    const sheet=buildCompactBroadsheet({students:d.students,exams:d.exams,marks:d.marks,assessment,bands:d.gradingScales[0].bands,assessmentTermId:'fixture-term',subjectCode:id=>d.subjects.find(s=>s._id===id)!.code})
    const row=(id:string)=>sheet.rows.find(r=>r.studentId===id)!
    expect(row('zero')).toMatchObject({mean:0,grade:'U',rank:2,completed:2,required:2})
    for(const code of ['X','Y','Z','INC']){expect(sheet.cellDetails[code]['subject:math'].state).toBe(code==='INC'?'incomplete':code);expect(row(code).rank).toBeNull();expect(row(code).completed).toBe(1)}
    expect(sheet.cellDetails['not-taken']['subject:science'].state).toBe('not-taken')
    expect(row('not-taken')).toMatchObject({mean:85,grade:'A',rank:1,completed:1,required:1})
    expect(row('unknown')).toMatchObject({mean:null,rank:null,completionKnown:false})
    expect(row('empty')).toMatchObject({mean:null,grade:'Z',rank:null,completed:0})
    expect(sheet.completedRows).toHaveLength(2);expect(sheet.incompleteRows).toHaveLength(6)
    expect(sheet.overall).toMatchObject({meanScore:42.5,meanPoints:4.5,meanGrade:'E'})
    expect(sheet.distribution.filter(x=>x.count).map(x=>[x.grade,x.count])).toEqual([['A',1],['U',1]])
    expect(sheet.distribution.reduce((s,x)=>s+x.count,0)).toBe(2)
    const rows=toCompactCsv(sheet).split('\r\n').slice(1).map(r=>r.split(',')),csvRow=(id:string)=>rows.find(r=>r[1]===`FIXTURE-${id}`)!
    for(const code of ['X','Y','Z','INC']){expect(csvRow(code)[10]).toBe(code);expect(csvRow(code)[0]).toBe('');expect(csvRow(code)[7]).toBe('Incomplete / provisional')}
    expect(csvRow('not-taken')[11]).toBe('==');expect(csvRow('zero')[10]).toBe('0');expect(csvRow('empty')[3]).toBe('Z')
    expect(csvRow('unknown').slice(3,6)).toEqual(['','','']);expect(csvRow('unknown')[7]).toBe('Unavailable / unverified')
    expect(d).toEqual(original)
    if(process.env.IUPC_WRITE_REPORT_FIXTURES){const fs=await import('node:fs/promises');await fs.mkdir('screenshots/broadsheet-comparison/status-fixtures',{recursive:true});await fs.writeFile(`screenshots/broadsheet-comparison/status-fixtures/${assessment}.csv`,toCompactCsv(sheet))}
  })
})
