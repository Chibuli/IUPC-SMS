import type { Database, Mark, Student } from '../data/types'
import { DEFAULT_SCALE } from '../lib/grading'

/** In-memory regression records only; never submitted to a database or synchronization queue. */
export function broadsheetKeyFixture(): Database {
  const students = ['zero','not-taken','X','Y','Z','INC','unknown','empty'].map((id): Student => ({
    _id:id,school_id:'fixture-school',class_id:'fixture-class',admission_number:`FIXTURE-${id}`,full_name:`Key Verification ${id}`,
    gender:'Female',date_of_birth:'',subject_ids:id==='not-taken'?['math']:['math','science'],
    enrollment_certainty:id==='unknown'?'unknown':'verified_enrolled',enrollment_term_id:'fixture-term',
    guardian_name:'',guardian_phone:'',status:'Active',archived:false,archived_at:null,
  }))
  const exams = ['math','science'].flatMap(subject=>['Midterm','Endterm'].map(period=>({
    _id:`${subject}-${period}`,subject_id:subject,class_id:'fixture-class',term_id:'fixture-term',exam_type:period,exam_name:period,
    exam_date:'2026-10-15',max_score:100,editing_deadline:null,status:'published' as const,
  })))
  const scores: Record<string, Mark['score'][]> = {zero:[0,0,0,0],'not-taken':[85,85,null,null],X:['X','X',80,80],Y:['Y','Y',70,70],Z:[-1,-1,60,60],INC:[null,null,50,50],unknown:[80,80,80,80],empty:[null,null,null,null]}
  const marks = students.flatMap(s=>exams.map((e,i): Mark=>({_id:`${s._id}-${e._id}`,student_id:s._id,exam_id:e._id,score:scores[s._id][i],remarks:'',updated_at:''})))
  return {schools:[{_id:'fixture-school',name:'IUPC Academy — KEY VERIFICATION FIXTURE',code:'FIXTURE',address:'IN-MEMORY TEST FIXTURE — NOT ACCEPTED SCHOOL MARKS',postal:'',city:'Mombasa',contact_email:'',phone_number:'',logo_url:null,motto:''}],
    classes:[{_id:'fixture-class',school_id:'fixture-school',class_name:'Year 7',stream_name:'Fixture'}],
    terms:[{_id:'fixture-term',school_id:'fixture-school',name:'TERM 1',academic_year:'2026/2027',is_active:true,start_date:'2026-09-01'}],
    subjects:[{_id:'math',code:'0862',name:'Mathematics',category:'STEM',level:'Lower Secondary',offered:true,school_id:'fixture-school'},{_id:'science',code:'0893',name:'Science',category:'STEM',level:'Lower Secondary',offered:true,school_id:'fixture-school'}],
    students,exams,marks,gradingScales:[structuredClone(DEFAULT_SCALE)],teachers:[],reportCards:[],notes:[],timetableSlots:[],bellSchedules:[],markWindows:[]}
}
