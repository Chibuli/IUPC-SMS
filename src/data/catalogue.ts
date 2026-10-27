import type { SubjectLevel } from './types'

/**
 * The Cambridge International subject catalogue, transcribed from the official
 * subject lists at cambridgeinternational.org (retrieved 27 October 2026):
 *
 *   Lower Secondary  …/cambridge-lower-secondary/curriculum/
 *   IGCSE            …/cambridge-upper-secondary/cambridge-igcse/subjects/
 *   O Level          …/cambridge-upper-secondary/cambridge-o-level/subjects/
 *   AS & A Level     …/cambridge-advanced/cambridge-international-as-and-a-levels/subjects/
 *
 * Codes are Cambridge's own syllabus codes, exactly as published — never
 * invented, and never re-prefixed. Every row was diffed against the codes on
 * those four pages after transcription: no invented code, no missing syllabus
 * and no name disagreeing with Cambridge's own.
 *
 * A subject that exists at more than one level
 * (Mathematics ships at 0862, 0580, 4024 and 9709) is one entry per level,
 * because each is a separate syllabus with its own code and grading.
 *
 * `category` is the school's own faculty grouping used throughout the app; it is
 * not a Cambridge field. Cambridge's published subject groups
 * (Languages, Mathematics, Sciences, Humanities and social sciences, Creative
 * and professional) are mapped onto the faculties this campus already uses.
 */
export interface CatalogueEntry {
  name: string
  code: string
  level: SubjectLevel
  category: string
}

export const SCHOOL_FACULTIES = ['Arts', 'General', 'Humanities', 'Languages', 'Mathematics', 'Sciences', 'Technical'] as const

/** Slides on the Analysis deck and the Subjects page read left to right in this order. */
export const LEVEL_ORDER: SubjectLevel[] = ['Lower Secondary', 'IGCSE', 'O Level', 'AS & A Level', 'Custom']

export const LEVEL_LABELS: Record<SubjectLevel, string> = {
  'Lower Secondary': 'Cambridge Lower Secondary',
  IGCSE: 'Cambridge IGCSE',
  'O Level': 'Cambridge O Level',
  'AS & A Level': 'Cambridge International AS & A Level',
  Custom: 'School subjects',
}

/** Compact form for chips and table cells. */
export const LEVEL_SHORT: Record<SubjectLevel, string> = {
  'Lower Secondary': 'Lower Sec',
  IGCSE: 'IGCSE',
  'O Level': 'O Level',
  'AS & A Level': 'AS & A',
  Custom: 'School',
}

export const CAMBRIDGE_CATALOGUE: CatalogueEntry[] = [
  /* ── Cambridge Lower Secondary ──────────────────────────────────────── */
  { name: 'Art & Design', code: '0073', level: 'Lower Secondary', category: 'Arts' },
  { name: 'Computing', code: '0860', level: 'Lower Secondary', category: 'Technical' },
  { name: 'Digital Literacy', code: '0082', level: 'Lower Secondary', category: 'Technical' },
  { name: 'English', code: '0861', level: 'Lower Secondary', category: 'Languages' },
  { name: 'English as a Second Language', code: '0876', level: 'Lower Secondary', category: 'Languages' },
  { name: 'Global Perspectives', code: '1129', level: 'Lower Secondary', category: 'Humanities' },
  { name: 'Humanities', code: '0839', level: 'Lower Secondary', category: 'Humanities' },
  { name: 'Mathematics', code: '0862', level: 'Lower Secondary', category: 'Mathematics' },
  { name: 'Modern Foreign Language', code: '0771', level: 'Lower Secondary', category: 'Languages' },
  { name: 'Music', code: '0078', level: 'Lower Secondary', category: 'Arts' },
  { name: 'Physical Education', code: '0081', level: 'Lower Secondary', category: 'Arts' },
  { name: 'Science', code: '0893', level: 'Lower Secondary', category: 'Sciences' },
  { name: 'Wellbeing', code: '0859', level: 'Lower Secondary', category: 'General' },

  /* ── Cambridge IGCSE ────────────────────────────────────────────────── */
  { name: 'Accounting', code: '0452', level: 'IGCSE', category: 'General' },
  { name: 'Accounting (9-1)', code: '0985', level: 'IGCSE', category: 'General' },
  { name: 'Afrikaans - Second Language', code: '0548', level: 'IGCSE', category: 'Languages' },
  { name: 'Agriculture', code: '0600', level: 'IGCSE', category: 'Sciences' },
  { name: 'Arabic - First Language', code: '0508', level: 'IGCSE', category: 'Languages' },
  { name: 'Arabic - First Language (9-1)', code: '7184', level: 'IGCSE', category: 'Languages' },
  { name: 'Arabic - Foreign Language', code: '0544', level: 'IGCSE', category: 'Languages' },
  { name: 'Arabic (9-1)', code: '7180', level: 'IGCSE', category: 'Languages' },
  { name: 'Art & Design', code: '0400', level: 'IGCSE', category: 'Arts' },
  { name: 'Art & Design (9-1)', code: '0989', level: 'IGCSE', category: 'Arts' },
  { name: 'Bahasa Indonesia', code: '0538', level: 'IGCSE', category: 'Languages' },
  { name: 'Biology', code: '0610', level: 'IGCSE', category: 'Sciences' },
  { name: 'Biology (9-1)', code: '0970', level: 'IGCSE', category: 'Sciences' },
  { name: 'Business', code: '0264', level: 'IGCSE', category: 'General' },
  { name: 'Business (9-1)', code: '0774', level: 'IGCSE', category: 'General' },
  { name: 'Business Studies', code: '0450', level: 'IGCSE', category: 'General' },
  { name: 'Business Studies (9-1)', code: '0986', level: 'IGCSE', category: 'General' },
  { name: 'Chemistry', code: '0620', level: 'IGCSE', category: 'Sciences' },
  { name: 'Chemistry (9-1)', code: '0971', level: 'IGCSE', category: 'Sciences' },
  { name: 'Chinese - First Language', code: '0509', level: 'IGCSE', category: 'Languages' },
  { name: 'Chinese - Second Language', code: '0523', level: 'IGCSE', category: 'Languages' },
  { name: 'Chinese (Mandarin) - Foreign Language', code: '0547', level: 'IGCSE', category: 'Languages' },
  { name: 'Commerce', code: '0715', level: 'IGCSE', category: 'General' },
  { name: 'Computer Science', code: '0265', level: 'IGCSE', category: 'Technical' },
  { name: 'Computer Science', code: '0478', level: 'IGCSE', category: 'Technical' },
  { name: 'Computer Science (9-1)', code: '0984', level: 'IGCSE', category: 'Technical' },
  { name: 'Design & Technology', code: '0445', level: 'IGCSE', category: 'Technical' },
  { name: 'Design & Technology (9-1)', code: '0979', level: 'IGCSE', category: 'Technical' },
  { name: 'Drama', code: '0411', level: 'IGCSE', category: 'Arts' },
  { name: 'Drama (9-1)', code: '0994', level: 'IGCSE', category: 'Arts' },
  { name: 'Economics', code: '0455', level: 'IGCSE', category: 'General' },
  { name: 'Economics (9-1)', code: '0987', level: 'IGCSE', category: 'General' },
  { name: 'English - First Language', code: '0500', level: 'IGCSE', category: 'Languages' },
  { name: 'English - First Language (9-1)', code: '0990', level: 'IGCSE', category: 'Languages' },
  { name: 'English - First Language (US)', code: '0524', level: 'IGCSE', category: 'Languages' },
  { name: 'English - Literature in English', code: '0475', level: 'IGCSE', category: 'Languages' },
  { name: 'English - Literature in English (9-1)', code: '0992', level: 'IGCSE', category: 'Languages' },
  { name: 'English (as an Additional Language)', code: '0472', level: 'IGCSE', category: 'Languages' },
  { name: 'English (as an Additional Language) (9-1)', code: '0772', level: 'IGCSE', category: 'Languages' },
  { name: 'English (Core) as a Second Language (Egypt)', code: '0465', level: 'IGCSE', category: 'Languages' },
  { name: 'English as a Second Language (Count-in Speaking) (9-1)', code: '0991', level: 'IGCSE', category: 'Languages' },
  { name: 'English as a Second Language (Count-in speaking)', code: '0511', level: 'IGCSE', category: 'Languages' },
  { name: 'English as a Second Language (Speaking endorsement)', code: '0510', level: 'IGCSE', category: 'Languages' },
  { name: 'English as a Second Language (Speaking Endorsement) (9-1)', code: '0993', level: 'IGCSE', category: 'Languages' },
  { name: 'Enterprise', code: '0454', level: 'IGCSE', category: 'General' },
  { name: 'Environmental Management', code: '0680', level: 'IGCSE', category: 'Sciences' },
  { name: 'Food & Nutrition', code: '0648', level: 'IGCSE', category: 'Arts' },
  { name: 'French - First Language', code: '0501', level: 'IGCSE', category: 'Languages' },
  { name: 'French - Foreign Language', code: '0520', level: 'IGCSE', category: 'Languages' },
  { name: 'French (9-1)', code: '7156', level: 'IGCSE', category: 'Languages' },
  { name: 'Geography', code: '0460', level: 'IGCSE', category: 'Humanities' },
  { name: 'Geography (9-1)', code: '0976', level: 'IGCSE', category: 'Humanities' },
  { name: 'German - First Language', code: '0505', level: 'IGCSE', category: 'Languages' },
  { name: 'German - Foreign Language', code: '0525', level: 'IGCSE', category: 'Languages' },
  { name: 'German (9-1)', code: '7159', level: 'IGCSE', category: 'Languages' },
  { name: 'Global Perspectives', code: '0457', level: 'IGCSE', category: 'Humanities' },
  { name: 'Hindi as a Second Language', code: '0549', level: 'IGCSE', category: 'Languages' },
  { name: 'History', code: '0470', level: 'IGCSE', category: 'Humanities' },
  { name: 'History - American (US)', code: '0409', level: 'IGCSE', category: 'Humanities' },
  { name: 'History (9-1)', code: '0977', level: 'IGCSE', category: 'Humanities' },
  { name: 'Information and Communication Technology', code: '0417', level: 'IGCSE', category: 'Technical' },
  { name: 'Information and Communication Technology (9-1)', code: '0983', level: 'IGCSE', category: 'Technical' },
  { name: 'IsiZulu as a Second Language', code: '0531', level: 'IGCSE', category: 'Languages' },
  { name: 'Islamiyat', code: '0493', level: 'IGCSE', category: 'Humanities' },
  { name: 'Italian - Foreign Language', code: '0535', level: 'IGCSE', category: 'Languages' },
  { name: 'Italian (9-1)', code: '7164', level: 'IGCSE', category: 'Languages' },
  { name: 'Japanese - Foreign Language', code: '0716', level: 'IGCSE', category: 'Languages' },
  { name: 'Latin', code: '0480', level: 'IGCSE', category: 'Languages' },
  { name: 'Malay - First Language', code: '0696', level: 'IGCSE', category: 'Languages' },
  { name: 'Malay - Foreign Language', code: '0546', level: 'IGCSE', category: 'Languages' },
  { name: 'Marine Science', code: '0697', level: 'IGCSE', category: 'Sciences' },
  { name: 'Mathematics', code: '0580', level: 'IGCSE', category: 'Mathematics' },
  { name: 'Mathematics - Additional', code: '0606', level: 'IGCSE', category: 'Mathematics' },
  { name: 'Mathematics - International', code: '0607', level: 'IGCSE', category: 'Mathematics' },
  { name: 'Mathematics (9-1)', code: '0980', level: 'IGCSE', category: 'Mathematics' },
  { name: 'Mathematics (US)', code: '0444', level: 'IGCSE', category: 'Mathematics' },
  { name: 'Music', code: '0410', level: 'IGCSE', category: 'Arts' },
  { name: 'Music (9-1)', code: '0978', level: 'IGCSE', category: 'Arts' },
  { name: 'Pakistan Studies', code: '0448', level: 'IGCSE', category: 'Humanities' },
  { name: 'Physical Education', code: '0413', level: 'IGCSE', category: 'Arts' },
  { name: 'Physical Education (9-1)', code: '0995', level: 'IGCSE', category: 'Arts' },
  { name: 'Physical Science', code: '0652', level: 'IGCSE', category: 'Sciences' },
  { name: 'Physics', code: '0625', level: 'IGCSE', category: 'Sciences' },
  { name: 'Physics (9-1)', code: '0972', level: 'IGCSE', category: 'Sciences' },
  { name: 'Portuguese - First Language', code: '0504', level: 'IGCSE', category: 'Languages' },
  { name: 'Psychology', code: '0266', level: 'IGCSE', category: 'Humanities' },
  { name: 'Religious Studies', code: '0490', level: 'IGCSE', category: 'Humanities' },
  { name: 'Sanskrit', code: '0499', level: 'IGCSE', category: 'Languages' },
  { name: 'Science - Combined', code: '0653', level: 'IGCSE', category: 'Sciences' },
  { name: 'Sciences - Co-ordinated (9-1)', code: '0973', level: 'IGCSE', category: 'Sciences' },
  { name: 'Sciences - Co-ordinated (Double)', code: '0654', level: 'IGCSE', category: 'Sciences' },
  { name: 'Setswana - First Language', code: '0698', level: 'IGCSE', category: 'Languages' },
  { name: 'Sociology', code: '0495', level: 'IGCSE', category: 'Humanities' },
  { name: 'Spanish - First Language', code: '0502', level: 'IGCSE', category: 'Languages' },
  { name: 'Spanish - Foreign Language', code: '0530', level: 'IGCSE', category: 'Languages' },
  { name: 'Spanish - Literature in Spanish', code: '0474', level: 'IGCSE', category: 'Languages' },
  { name: 'Spanish (9-1)', code: '7160', level: 'IGCSE', category: 'Languages' },
  { name: 'Statistics', code: '0479', level: 'IGCSE', category: 'Mathematics' },
  { name: 'Swahili', code: '0262', level: 'IGCSE', category: 'Languages' },
  { name: 'Thai - First Language', code: '0518', level: 'IGCSE', category: 'Languages' },
  { name: 'Travel & Tourism', code: '0471', level: 'IGCSE', category: 'General' },
  { name: 'Turkish - First Language', code: '0513', level: 'IGCSE', category: 'Languages' },
  { name: 'Urdu as a Second Language', code: '0539', level: 'IGCSE', category: 'Languages' },
  { name: 'Vietnamese - First Language', code: '0695', level: 'IGCSE', category: 'Languages' },
  { name: 'World Literature', code: '0408', level: 'IGCSE', category: 'Languages' },

  /* ── Cambridge O Level ──────────────────────────────────────────────── */
  { name: 'Accounting', code: '7707', level: 'O Level', category: 'General' },
  { name: 'Arabic', code: '3180', level: 'O Level', category: 'Languages' },
  { name: 'Art & Design', code: '6090', level: 'O Level', category: 'Arts' },
  { name: 'Bangladesh Studies', code: '7094', level: 'O Level', category: 'Humanities' },
  { name: 'Bengali', code: '3204', level: 'O Level', category: 'Languages' },
  { name: 'Biblical Studies', code: '2035', level: 'O Level', category: 'Humanities' },
  { name: 'Biology', code: '5090', level: 'O Level', category: 'Sciences' },
  { name: 'Business', code: '7081', level: 'O Level', category: 'General' },
  { name: 'Business Studies', code: '7115', level: 'O Level', category: 'General' },
  { name: 'Chemistry', code: '5070', level: 'O Level', category: 'Sciences' },
  { name: 'Commerce', code: '7100', level: 'O Level', category: 'General' },
  { name: 'Computer Science', code: '2210', level: 'O Level', category: 'Technical' },
  { name: 'Economics', code: '2281', level: 'O Level', category: 'General' },
  { name: 'English Language', code: '1123', level: 'O Level', category: 'Languages' },
  { name: 'Environmental Management', code: '5014', level: 'O Level', category: 'Sciences' },
  { name: 'Fashion & Textiles', code: '6130', level: 'O Level', category: 'Arts' },
  { name: 'Food & Nutrition', code: '6065', level: 'O Level', category: 'Arts' },
  { name: 'Geography', code: '2217', level: 'O Level', category: 'Humanities' },
  { name: 'Global Perspectives', code: '2069', level: 'O Level', category: 'Humanities' },
  { name: 'History', code: '2147', level: 'O Level', category: 'Humanities' },
  { name: 'Islamic Studies', code: '2068', level: 'O Level', category: 'Humanities' },
  { name: 'Islamiyat', code: '2058', level: 'O Level', category: 'Humanities' },
  { name: 'Literature in English', code: '2010', level: 'O Level', category: 'Languages' },
  { name: 'Mathematics - Additional', code: '4037', level: 'O Level', category: 'Mathematics' },
  { name: 'Mathematics (Syllabus D)', code: '4024', level: 'O Level', category: 'Mathematics' },
  { name: 'Pakistan Studies', code: '2059', level: 'O Level', category: 'Humanities' },
  { name: 'Physics', code: '5054', level: 'O Level', category: 'Sciences' },
  { name: 'Sanskrit', code: '3216', level: 'O Level', category: 'Languages' },
  { name: 'Science - Combined', code: '5129', level: 'O Level', category: 'Sciences' },
  { name: 'Sinhala', code: '3205', level: 'O Level', category: 'Languages' },
  { name: 'Sociology', code: '2251', level: 'O Level', category: 'Humanities' },
  { name: 'Statistics', code: '4040', level: 'O Level', category: 'Mathematics' },
  { name: 'Tamil', code: '3226', level: 'O Level', category: 'Languages' },
  { name: 'Urdu - First Language', code: '3247', level: 'O Level', category: 'Languages' },
  { name: 'Urdu - Second Language', code: '3248', level: 'O Level', category: 'Languages' },

  /* ── Cambridge International AS & A Level ───────────────────────────── */
  { name: 'Accounting', code: '9706', level: 'AS & A Level', category: 'General' },
  { name: 'Afrikaans - Language (AS Level only)', code: '8679', level: 'AS & A Level', category: 'Languages' },
  { name: 'Arabic', code: '9680', level: 'AS & A Level', category: 'Languages' },
  { name: 'Arabic', code: '9865', level: 'AS & A Level', category: 'Languages' },
  { name: 'Arabic - Language (AS Level only)', code: '8680', level: 'AS & A Level', category: 'Languages' },
  { name: 'Art & Design', code: '9479', level: 'AS & A Level', category: 'Arts' },
  { name: 'Biblical Studies', code: '9484', level: 'AS & A Level', category: 'Humanities' },
  { name: 'Biology', code: '9700', level: 'AS & A Level', category: 'Sciences' },
  { name: 'Business', code: '9609', level: 'AS & A Level', category: 'General' },
  { name: 'Chemistry', code: '9701', level: 'AS & A Level', category: 'Sciences' },
  { name: 'Chinese - Language & Literature (A Level only)', code: '9868', level: 'AS & A Level', category: 'Languages' },
  { name: 'Chinese Language (AS Level only)', code: '8238', level: 'AS & A Level', category: 'Languages' },
  { name: 'Classical Studies', code: '9274', level: 'AS & A Level', category: 'Humanities' },
  { name: 'Computer Science', code: '9618', level: 'AS & A Level', category: 'Technical' },
  { name: 'Design & Technology', code: '9705', level: 'AS & A Level', category: 'Technical' },
  { name: 'Digital Media & Design', code: '9481', level: 'AS & A Level', category: 'Arts' },
  { name: 'Drama', code: '9482', level: 'AS & A Level', category: 'Arts' },
  { name: 'Economics', code: '9708', level: 'AS & A Level', category: 'General' },
  { name: 'English - Language and Literature (AS Level only)', code: '8695', level: 'AS & A Level', category: 'Languages' },
  { name: 'English - Literature', code: '9695', level: 'AS & A Level', category: 'Languages' },
  { name: 'English General Paper (AS Level only)', code: '8021', level: 'AS & A Level', category: 'Languages' },
  { name: 'English Language', code: '9093', level: 'AS & A Level', category: 'Languages' },
  { name: 'Environmental Management (AS only)', code: '8291', level: 'AS & A Level', category: 'Sciences' },
  { name: 'European History', code: '9981', level: 'AS & A Level', category: 'Humanities' },
  { name: 'French Language & Literature', code: '9898', level: 'AS & A Level', category: 'Languages' },
  { name: 'French Language (AS Level only)', code: '8028', level: 'AS & A Level', category: 'Languages' },
  { name: 'Geography', code: '9696', level: 'AS & A Level', category: 'Humanities' },
  { name: 'German - Language (AS Level only)', code: '8027', level: 'AS & A Level', category: 'Languages' },
  { name: 'German Language & Literature (A Level only)', code: '9897', level: 'AS & A Level', category: 'Languages' },
  { name: 'Global Perspectives & Research', code: '9239', level: 'AS & A Level', category: 'Humanities' },
  { name: 'Hinduism', code: '9487', level: 'AS & A Level', category: 'Humanities' },
  { name: 'History', code: '9489', level: 'AS & A Level', category: 'Humanities' },
  { name: 'Information Technology', code: '9626', level: 'AS & A Level', category: 'Technical' },
  { name: 'International History', code: '9982', level: 'AS & A Level', category: 'Humanities' },
  { name: 'Islamic Studies', code: '9488', level: 'AS & A Level', category: 'Humanities' },
  { name: 'Law', code: '9084', level: 'AS & A Level', category: 'Humanities' },
  { name: 'Marine Science', code: '9693', level: 'AS & A Level', category: 'Sciences' },
  { name: 'Mathematics', code: '9709', level: 'AS & A Level', category: 'Mathematics' },
  { name: 'Mathematics - Further', code: '9231', level: 'AS & A Level', category: 'Mathematics' },
  { name: 'Media Studies', code: '9607', level: 'AS & A Level', category: 'Arts' },
  { name: 'Music', code: '9483', level: 'AS & A Level', category: 'Arts' },
  { name: 'Physics', code: '9702', level: 'AS & A Level', category: 'Sciences' },
  { name: 'Portuguese - Language (AS Level only)', code: '8684', level: 'AS & A Level', category: 'Languages' },
  { name: 'Portuguese (A Level only)', code: '9718', level: 'AS & A Level', category: 'Languages' },
  { name: 'Psychology', code: '9990', level: 'AS & A Level', category: 'Humanities' },
  { name: 'Sociology', code: '9699', level: 'AS & A Level', category: 'Humanities' },
  { name: 'Spanish - Language & Literature (A Level only)', code: '9844', level: 'AS & A Level', category: 'Languages' },
  { name: 'Spanish Language (AS Level only)', code: '8022', level: 'AS & A Level', category: 'Languages' },
  { name: 'Sport & Physical Education (AS Level only)', code: '8386', level: 'AS & A Level', category: 'Arts' },
  { name: 'Tamil', code: '9689', level: 'AS & A Level', category: 'Languages' },
  { name: 'Tamil - Language', code: '8689', level: 'AS & A Level', category: 'Languages' },
  { name: 'Thinking Skills', code: '9694', level: 'AS & A Level', category: 'General' },
  { name: 'Travel & Tourism', code: '9395', level: 'AS & A Level', category: 'General' },
  { name: 'Urdu - Language (AS Level only)', code: '8686', level: 'AS & A Level', category: 'Languages' },
  { name: 'Urdu - Pakistan only (A Level only)', code: '9686', level: 'AS & A Level', category: 'Languages' },
  { name: 'Urdu Language & Literature', code: '9866', level: 'AS & A Level', category: 'Languages' },
  { name: 'US Government & Politics', code: '8293', level: 'AS & A Level', category: 'Humanities' },
  { name: 'US History since 1877', code: '8102', level: 'AS & A Level', category: 'Humanities' },
  { name: 'US History to 1877', code: '8101', level: 'AS & A Level', category: 'Humanities' },
]

/** Stable id for a catalogue row, derived from its level and Cambridge code. */
export function catalogueId(entry: CatalogueEntry): string {
  const level = entry.level.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return `sub-${level}-${entry.code}`
}

export function catalogueCountByLevel(): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const entry of CAMBRIDGE_CATALOGUE) {
    counts[entry.level] = (counts[entry.level] ?? 0) + 1
  }
  return counts
}
