import type { Database, Student } from '../data/types'
import type { ReportEvidence } from '../lib/academic-report'
import { DEFAULT_SCALE } from '../lib/grading'
/** Explicitly fictional fixtures; never written into any school database. */
export function academicFixture(subjectCount=3) {
  const student: Student = {_id:'fictional-ada',school_id:'fictional-school',admission_number:'FIX/001',full_name:'Amina Fictional Mwangi',gender:'Female',date_of_birth:'2012-02-14',class_id:'fictional-class',guardian_name:'Fictional guardian',guardian_phone:'',status:'Active',archived:false,archived_at:null,subject_ids:Array.from({length:subjectCount},(_,i)=>`subject-${i}`),enrollment_certainty:'verified_enrolled',enrollment_term_id:'term-3'}
  const db:Database={schools:[{_id:'fictional-school',name:'IUPC Academy',code:'FIX',address:'Mombasa, Kenya',postal:'Fictional report inspection',city:'Mombasa',contact_email:'',phone_number:'',logo_url:null,motto:'We make sure that everyone blossoms.'}],classes:[{_id:'fictional-class',school_id:'fictional-school',class_name:'Year 9',stream_name:'Fixture'}],students:[student],subjects:[],teachers:[{_id:'teacher',school_id:'fictional-school',full_name:'Collins Fictional Sammy',email:'fictional@example.invalid',employee_id:'FIX-T',assigned_subject_ids:[],permissions:[],initials:'C.F.S.'}],terms:[],exams:[],marks:[],gradingScales:[DEFAULT_SCALE],reportCards:[],notes:[],timetableSlots:[],bellSchedules:[],markWindows:[]}
  const evidence:ReportEvidence[]=[]
  for(let t=1;t<=3;t++) {
    db.terms.push({_id:`term-${t}`,school_id:student.school_id,name:`Term ${t}`,academic_year:'2025',start_date:`2025-0${t*3-2}-06`,is_active:t===3})
    evidence.push({studentId:student._id,termId:`term-${t}`,classId:student.class_id,subjectIds:student.subject_ids!,eligibility:'enrolled'})
    for(let s=0;s<subjectCount;s++) {
      if(t===1)db.subjects.push({_id:`subject-${s}`,school_id:student.school_id,name:['Mathematics','English language and literature','Integrated science'][s]??`Fictional subject ${s+1}`,code:`FIX${s}`,level:'Custom',category:'Core',offered:true})
      db.timetableSlots.push({_id:`slot-${t}-${s}`,school_id:student.school_id,term_id:`term-${t}`,class_id:student.class_id,subject_id:`subject-${s}`,teacher_id:'teacher',day:1,period:s+1,room:'',week:null})
      for(const [i,type] of ['Midterm','Endterm'].entries()) {
        const id=`exam-${t}-${s}-${i}`
        db.exams.push({_id:id,term_id:`term-${t}`,class_id:student.class_id,subject_id:`subject-${s}`,exam_name:type,exam_type:type,max_score:100,exam_date:`2025-0${t*3}-01`,editing_deadline:null,status:'published'})
        db.marks.push({_id:`mark-${id}`,exam_id:id,student_id:student._id,score:60+t*10+i*10,remarks:'',updated_at:'2025-09-01'})
      }
    }
  }
  return {db,student,evidence}
}
export function lateFixture(joinTerm:number) {
  const f=academicFixture()
  for(const e of f.evidence)if(Number(e.termId.slice(-1))<joinTerm){e.eligibility='pre-enrollment';e.subjectIds=[];f.db.marks=f.db.marks.filter(m=>!m.exam_id.startsWith(`exam-${e.termId.slice(-1)}-`))}
  return f
}
