import type { Database } from './types'

/**
 * Local development starts with no school records. Operational data is loaded
 * only from the authenticated school database; curriculum reference data is
 * maintained separately in the shared catalogue.
 */
export const seedDatabase = (): Database => ({
  schools: [],
  classes: [],
  teachers: [],
  subjects: [],
  students: [],
  terms: [],
  exams: [],
  marks: [],
  gradingScales: [],
  reportCards: [],
  notes: [],
  timetableSlots: [],
  bellSchedules: [],
  markWindows: [],
})
