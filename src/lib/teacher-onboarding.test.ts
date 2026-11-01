import { describe, expect, it, vi } from 'vitest'
import { invitationMessage, registerTeacherWithInvitation } from './teacher-onboarding'
import { readAuthCallbackIntent } from './auth-callback'
const teacher = { _id: 'teacher', email: 'teacher@example.invalid' }
describe('teacher registration and activation', () => {
  it('saves before inviting and keeps the invitation result distinct', async () => {
    const save = vi.fn(async () => teacher)
    const invite = vi.fn(async () => { expect(save).toHaveBeenCalledOnce(); return { accepted: true as const, status: 'invitation_pending' as const, invitation: 'accepted' as const } })
    expect(await registerTeacherWithInvitation(save, invite)).toMatchObject({ teacher, invitationError: false, invitation: { invitation: 'accepted' } })
    expect(invite).toHaveBeenCalledWith(teacher.email, teacher._id)
  })
  it('retains successful registration on email failure; retry uses the saved identity, not another registration', async () => {
    const save = vi.fn(async () => teacher), invite = vi.fn().mockRejectedValueOnce(Error('SMTP unavailable')).mockResolvedValueOnce({ accepted: true, status: 'invitation_pending', invitation: 'accepted' })
    const result = await registerTeacherWithInvitation(save, invite)
    expect(result).toEqual({ teacher, invitation: null, invitationError: true })
    await invite(result.teacher.email, result.teacher._id)
    expect(save).toHaveBeenCalledOnce(); expect(invite).toHaveBeenCalledTimes(2)
  })
  it('does not invite when registration fails or the backend is unavailable', async () => {
    const invite = vi.fn()
    await expect(registerTeacherWithInvitation(async () => { throw Error('Save failed') }, invite)).rejects.toThrow('Save failed')
    expect(invite).not.toHaveBeenCalled()
    expect(await registerTeacherWithInvitation(async () => teacher, null)).toMatchObject({ invitation: null, invitationError: false })
  })
  it('does not claim delivery or activation from invitation acceptance', () => {
    expect(invitationMessage({ accepted: true, status: 'invitation_pending', invitation: 'accepted' })).toContain('delivery is not yet confirmed')
    expect(invitationMessage({ accepted: true, status: 'invitation_pending', invitation: 'existing' })).toContain('no duplicate email')
  })
  it('does not select password setup from an email or setup flag alone', () => {
    expect(readAuthCallbackIntent('?setup=1&email=teacher@example.invalid', '').setup).toBe(false)
    expect(readAuthCallbackIntent('?setup=1', '#type=invite').setup).toBe(false)
  })
  it('recognizes complete invitation and recovery callbacks but rejects error/expired links', () => {
    expect(readAuthCallbackIntent('?setup=1', '#type=invite&access_token=fictional&refresh_token=fictional').setup).toBe(true)
    expect(readAuthCallbackIntent('?setup=1&code=fictional', '').setup).toBe(true)
    expect(readAuthCallbackIntent('?setup=1&code=fictional&error=otp_expired', '').setup).toBe(false)
  })
})
