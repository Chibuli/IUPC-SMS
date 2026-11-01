export type StaffAccountStatus = 'invitation_pending' | 'email_verified' | 'requires_attention'
export type StaffInvitationResult = { accepted: true; status: StaffAccountStatus; invitation: 'accepted' | 'existing' }
export function isStaffAccountStatus(value: unknown): value is StaffAccountStatus {
  return value === 'invitation_pending' || value === 'email_verified' || value === 'requires_attention'
}
/** Registration must never be undone or repeated because SMTP failed. */
export async function registerTeacherWithInvitation<T extends { _id: string; email: string }>(save: () => Promise<T>, invite: ((email: string, id: string) => Promise<StaffInvitationResult>) | null) {
  const teacher = await save()
  if (!invite) return { teacher, invitation: null, invitationError: false }
  try { return { teacher, invitation: await invite(teacher.email, teacher._id), invitationError: false } }
  catch { return { teacher, invitation: null, invitationError: true } }
}
export function invitationMessage(result: StaffInvitationResult) {
  return result.invitation === 'accepted'
    ? 'Invitation accepted by the email service; delivery is not yet confirmed.'
    : result.status === 'email_verified'
      ? 'Existing account email is verified. Use ordinary sign-in or password recovery; no new invitation was sent.'
      : 'An invitation already exists. Check the inbox and spam folder; no duplicate email was sent. Contact the administrator if the link has expired.'
}
