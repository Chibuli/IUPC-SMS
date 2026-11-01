export function validateAdmissionNumber(value: string, existing: { admission_number: string }[]): string | null {
  const number = value.trim()
  if (!number || number.length > 48) return 'Enter an admission number between 1 and 48 characters.'
  if (existing.some(s=>s.admission_number.trim().toLowerCase()===number.toLowerCase())) return `${number} is already on roll — check the register first.`
  return null
}
