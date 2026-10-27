import puppeteer from 'puppeteer-core'
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const p = await b.newPage()
const errs = []
p.on('pageerror', (e) => errs.push(e.message))
await p.goto('http://127.0.0.1:5176/', { waitUntil: 'networkidle0' })
// Simulate a returning browser: the old demo campus (Form 1–3, one kept
// student, no seed-version marker) plus a subject the registrar added by hand.
// A seed bump must replace the demo rows and keep the hand-added subject.
await p.evaluate(() => {
  const old = {
    schools: [{ _id: 'sch-iupc', name: 'IUPC Academy', code: 'IUPC-01', address: 'Kenya Institute of Professional Counselling', postal: 'P.O. Box 14180', city: 'Nairobi 00100', contact_email: 'registrar@iupc.academy', phone_number: '+254 700 118 004', logo_url: null, motto: 'x' }],
    classes: [{ _id: 'c-f1a', school_id: 'sch-iupc', class_name: 'Form 1', stream_name: 'A' }],
    students: [{ _id: 'keep-me', school_id: 'sch-iupc', admission_number: 'KEEP/1', full_name: 'Kept Student', gender: 'Female', date_of_birth: '2012-01-01', class_id: 'c-f1a', guardian_name: 'G', guardian_phone: '0', status: 'Active' }],
    subjects: [{ _id: 'sub-school-life-skills', school_id: 'sch-iupc', name: 'Life Skills', code: 'LIFE', category: 'General', level: 'Custom', offered: true }],
    marks: [{ _id: 'keep-mark', exam_id: 'ex-1', student_id: 'keep-me', score: 55, remarks: '', updated_at: '2026-10-01T00:00:00.000Z', entered_by: 'admin' }],
    teachers: [], terms: [], exams: [], gradingScales: [], reportCards: [], notes: [], timetableSlots: [],
  }
  localStorage.setItem('iupc.db.v1', JSON.stringify(old))
  localStorage.removeItem('iupc.seedVersion')
})
await p.goto('http://127.0.0.1:5176/dashboard', { waitUntil: 'networkidle0' })
const out = await p.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('iupc.db.v1'))
  return {
    school: db.schools[0],
    classes: db.classes.map((c) => c.class_name),
    students: db.students.length,
    oldClassGone: !db.classes.some((c) => c._id === 'c-f1a'),
    keptSubject: db.subjects.some((s) => s._id === 'sub-school-life-skills'),
    version: localStorage.getItem('iupc.seedVersion'),
  }
})
console.log(JSON.stringify({
  address: out.school.address,
  postal: out.school.postal,
  city: out.school.city,
  email: out.school.contact_email,
  phone: out.school.phone_number,
  logo: out.school.logo_url,
  classes: out.classes.join(', '),
  students: out.students,
  oldClassGone: out.oldClassGone,
  keptSubject: out.keptSubject,
  version: out.version,
}, null, 2))
console.log('errors:', errs.length ? errs.join(' | ') : 'none')
await b.close()
const ok =
  out.school.contact_email === 'info@iupceducation.com' &&
  out.version === '3' &&
  out.classes.length === 7 &&
  out.classes[0] === 'Year 7' &&
  out.classes.at(-1) === 'Year 13' &&
  out.students === 84 &&
  out.oldClassGone &&
  out.keptSubject &&
  !errs.length
process.exit(ok ? 0 : 1)
