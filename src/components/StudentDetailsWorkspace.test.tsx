import {describe,expect,it} from 'vitest'
import {renderToStaticMarkup} from 'react-dom/server'
import StudentDetailsWorkspace,{tabAfterKey,unsavedHistoryMessage} from './StudentDetailsWorkspace'
import {periodText,periodExplanation} from '../lib/enrollment-history-management'
import type {SchoolEnrollmentHistory} from '../data/enrollment-history-contract'
describe('student detail tab contract',()=>{
 const render=()=>renderToStaticMarkup(<StudentDetailsWorkspace identity={<p>Fictional Student</p>} overview={<p>Current subjects and archive permission</p>} notes={<p>Existing authorized notes</p>} history={()=>{throw Error('History must not mount before the tab is visited')}} closeGuard={{current:()=>true}} />)
 it('keeps identity visible and declares three accessible tabs',()=>{const html=render();expect(html).toContain('Fictional Student');expect((html.match(/role="tab"/g)??[])).toHaveLength(3);expect(html).toContain('aria-controls="student-panel-history"')})
 it('starts with Overview and hides unrelated panels without deleting them',()=>{const html=render();expect(html).toContain('id="student-tab-overview" aria-controls="student-panel-overview" aria-selected="true"');expect(html).toContain('id="student-panel-notes" aria-labelledby="student-tab-notes" hidden=""');expect(html).toContain('Existing authorized notes')})
 it('does not load historical data before the history tab is used',()=>{expect(render).not.toThrow()})
 it.each([['overview','ArrowRight','history'],['history','ArrowRight','notes'],['notes','ArrowRight','overview'],['overview','ArrowLeft','notes'],['notes','Home','overview'],['overview','End','notes']] as const)('keyboard %s %s selects %s',(tab,key,next)=>{expect(tabAfterKey(tab,key)).toBe(next)})
 it('leaves ordinary typing and Tab navigation alone',()=>{expect(tabAfterKey('history','Tab')).toBeNull();expect(tabAfterKey('history','x')).toBeNull()})
 it('warns specifically about unsaved history and uncertain receipt state',()=>{expect(unsavedHistoryMessage).toContain('unconfirmed save');expect(unsavedHistoryMessage).toContain('Unsaved changes will be lost')})
})
describe('human-readable historical period precision',()=>{
 const row={coverage_kind:'whole_term',evidence_state:'confirmed',effective_from:null,effective_to:null,start_precision:'term_start',end_precision:'term_end'} as SchoolEnrollmentHistory
 it('uses a clear verified label without inventing dates',()=>{expect(periodText(row)).toBe('Full term verified');expect(periodExplanation(row)).toContain('Exact calendar dates have not been asserted')})
 it('does not call an unverified full-term claim verified',()=>{expect(periodText({...row,evidence_state:'unverified'})).toBe('Full term claimed (not verified)')})
 it('renders exact dates and the excluded end accurately',()=>{expect(periodText({...row,coverage_kind:'dated_segment',start_precision:'exact_date',effective_from:'2026-09-14',end_precision:'exact_date',effective_to:'2026-10-01'})).toBe('From 14 September 2026 to 1 October 2026 (end excluded)')})
})
