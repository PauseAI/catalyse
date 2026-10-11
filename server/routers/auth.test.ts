import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createVolunteer,
  createAdmin,
  createSuperAdmin,
  createProject,
  createQuickTask,
  createSkill,
  TEST_PASSWORD,
} from '@/test/factories'
import { clientAs, anon } from '@/test/rpc'
import { rateLimit } from '@/test/fakes/rate-limit'
import { hashToken } from '@/lib/auth'

const denyNext = () => rateLimit.denyNext()

import { emails, linkParam } from '@/test/fakes/email'
import { google } from '@/test/fakes/google'

const subjects = {
  confirm: 'Welcome to Catalyse: please confirm your email',
  welcome: 'Welcome to Catalyse!',
  reset: 'Reset your Catalyse password',
  received: 'Your Catalyse application has been received',
  approved: 'Your Catalyse application has been approved',
}
const sentSubjects = () => emails.sent.map((e) => e.subject)

beforeEach(() => vi.clearAllMocks())

const signupInput = (email: string, extra: Record<string, unknown> = {}) => ({
  name: 'New Person',
  email,
  password: 'a-long-password',
  bio: 'A biography that is comfortably over twenty characters',
  country: 'UK',
  availabilityHoursPerWeek: 4,
  applicationMessage: 'An application message that is long enough to pass',
  ...extra,
})

describe('auth.login', () => {
  it('issues a session for valid credentials and rejects everything else', async () => {
    const vol = await createVolunteer({ email: 'ann@example.com' })
    const res = await anon().auth.login({ email: '  ANN@example.com ', password: TEST_PASSWORD })
    expect(res).toMatchObject({ wasPromoted: false, message: 'Login successful' })
    expect(
      await prisma.session.findFirst({ where: { tokenHash: hashToken(res.token) } }),
    ).toMatchObject({ volunteerId: vol.id })

    await expect(anon().auth.login({ email: '', password: 'x' })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    })
    await expect(
      anon().auth.login({ email: 'nobody@example.com', password: 'x' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    await expect(
      anon().auth.login({ email: 'ann@example.com', password: 'wrong' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    const noPw = await createVolunteer({ passwordHash: null })
    await expect(anon().auth.login({ email: noPw.email!, password: 'x' })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    })
    denyNext()
    await expect(
      anon().auth.login({ email: 'ann@example.com', password: TEST_PASSWORD }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' })
  })

  it('promotes on login via ADMIN_EMAILS bootstrap or a pending invite', async () => {
    const boot = await createVolunteer({ email: 'admin5@example.com', isAdmin: false })
    expect(
      (await anon().auth.login({ email: boot.email!, password: TEST_PASSWORD })).wasPromoted,
    ).toBe(true)
    const inviter = await createAdmin()
    const invited = await createVolunteer({ email: 'invited@example.com' })
    await prisma.adminInvite.create({
      data: {
        email: 'invited@example.com',
        inviteToken: 't1',
        invitedById: inviter.id,
        expiresAt: new Date(Date.now() + 60_000),
      },
    })
    const res = await anon().auth.login({ email: 'invited@example.com', password: TEST_PASSWORD })
    expect(res.message).toContain('granted admin access')
    expect((await prisma.volunteer.findUniqueOrThrow({ where: { id: invited.id } })).isAdmin).toBe(
      true,
    )
  })
  it('does not promote an account whose email is unconfirmed', async () => {
    // A pending applicant repoints their account at an invited address (or an
    // ADMIN_EMAILS address) without ever confirming it, then logs back in.
    const inviter = await createAdmin()
    await prisma.adminInvite.create({
      data: {
        email: 'ceo@example.com',
        inviteToken: 't-unconfirmed',
        invitedById: inviter.id,
        expiresAt: new Date(Date.now() + 60_000),
      },
    })
    for (const target of ['ceo@example.com', 'admin12@example.com']) {
      const applicant = await createVolunteer({ approvalStatus: 'pending', emailConfirmed: false })
      await clientAs(applicant).auth.changeEmail({ newEmail: target, password: TEST_PASSWORD })
      const res = await anon().auth.login({ email: target, password: TEST_PASSWORD })
      expect(res.wasPromoted).toBe(false)
      expect(
        await prisma.volunteer.findUniqueOrThrow({ where: { id: applicant.id } }),
      ).toMatchObject({ isAdmin: false, approvalStatus: 'pending', emailConfirmed: false })
    }
    expect(
      await prisma.adminInvite.findUniqueOrThrow({ where: { inviteToken: 't-unconfirmed' } }),
    ).toMatchObject({ status: 'pending', acceptedById: null })
  })
})

describe('auth.signup', () => {
  it('creates a pending applicant, sends a confirmation, and alerts admins', async () => {
    const admin = await createAdmin()
    const skill = await createSkill()
    const res = await anon().auth.signup(
      signupInput('New@Example.com', { skillIds: [skill.id, skill.id], discordHandle: 'd' }),
    )
    expect(res.pending).toBe(true)
    expect(res.emailVerificationToken).toBeTruthy()
    const row = await prisma.volunteer.findUniqueOrThrow({
      where: { id: res.id },
      include: { skills: true },
    })
    expect(row).toMatchObject({
      email: 'new@example.com',
      approvalStatus: 'pending',
      emailConfirmed: false,
      discordHandle: 'd',
      consentMakeProfileVisibleInDirectory: true,
    })
    expect(row.skills).toHaveLength(1)
    const confirm = emails.lastTo('new@example.com')
    expect(confirm.subject).toBe(subjects.confirm)
    expect(linkParam(confirm, 'token')).toBe(res.emailVerificationToken)
    // Written before signup returns, so an approval that follows at once has
    // a row to clear rather than racing the insert.
    expect(
      await prisma.notification.count({
        where: { volunteerId: admin.id, type: 'new_volunteer_signup', entityId: res.id },
      }),
    ).toBe(1)
    expect(await prisma.session.count({ where: { tokenHash: hashToken(res.token) } })).toBe(1)
  })

  it('refuses duplicate, deleted and rejected-without-reapply emails, and rate limits', async () => {
    await createVolunteer({ email: 'taken@example.com' })
    await expect(anon().auth.signup(signupInput('taken@example.com'))).rejects.toMatchObject({
      message: 'Email already registered',
    })
    await createVolunteer({ email: 'gone@example.com', deletedAt: new Date() })
    await expect(anon().auth.signup(signupInput('gone@example.com'))).rejects.toMatchObject({
      message: expect.stringContaining('previously registered'),
    })
    const { createHash } = await import('node:crypto')
    await prisma.anonymisedEmail.create({
      data: { emailHash: createHash('sha256').update('rejected@example.com').digest('hex') },
    })
    await expect(anon().auth.signup(signupInput('rejected@example.com'))).rejects.toMatchObject({
      message: expect.stringContaining('previously rejected'),
    })
    await prisma.anonymisedEmail.create({
      data: {
        emailHash: createHash('sha256').update('allowed@example.com').digest('hex'),
        reapplyAllowedAt: new Date(),
      },
    })
    expect((await anon().auth.signup(signupInput('allowed@example.com'))).pending).toBe(true)
    denyNext()
    await expect(anon().auth.signup(signupInput('x@example.com'))).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
    })
  })

  it('promotes bootstrapped admins and invitees only once they confirm their email', async () => {
    const inviter = await createAdmin()
    const invite = await prisma.adminInvite.create({
      data: {
        email: 'inv@example.com',
        inviteToken: 't2',
        invitedById: inviter.id,
        expiresAt: new Date(Date.now() + 60_000),
      },
    })
    for (const address of ['admin6@example.com', 'inv@example.com']) {
      // Signing up with a listed address proves nothing: the account waits like any other.
      const res = await anon().auth.signup(signupInput(address))
      expect(res.pending).toBe(true)
      expect(res.emailVerificationToken).toBeTruthy()
      expect(emails.lastTo(address).subject).toBe(subjects.confirm)
      expect(await prisma.volunteer.findUniqueOrThrow({ where: { id: res.id } })).toMatchObject({
        isAdmin: false,
        approvalStatus: 'pending',
        emailConfirmed: false,
      })
      // Opened signed out, so the link proves the mailbox but not who signed up.
      expect(await anon().auth.verifyEmail({ token: res.emailVerificationToken! })).toEqual({
        success: true,
        requiresPasswordReset: true,
      })
      expect(await prisma.volunteer.findUniqueOrThrow({ where: { id: res.id } })).toMatchObject({
        isAdmin: true,
        approvalStatus: 'approved',
        emailConfirmed: true,
      })
      await vi.waitFor(() => expect(emails.lastTo(address).subject).toBe(subjects.welcome))
      expect(emails.lastTo(address).html).toContain('New Person')
    }
    expect(sentSubjects()).not.toContain(subjects.received)
    expect(await prisma.adminInvite.findUniqueOrThrow({ where: { id: invite.id } })).toMatchObject({
      status: 'accepted',
    })

    await prisma.platformSettings.update({
      where: { id: 1 },
      data: { requireApplicationApproval: false },
    })
    const open = await anon().auth.signup(signupInput('open@example.com'))
    expect(open.pending).toBe(false)
    expect(
      (await prisma.volunteer.findUniqueOrThrow({ where: { id: open.id } })).approvalStatus,
    ).toBe('approved')
    expect(emails.last).toMatchObject({ to: 'open@example.com', subject: subjects.confirm })
    await prisma.platformSettings.update({
      where: { id: 1 },
      data: { requireApplicationApproval: true },
    })
  })

  it('survives failures in the best-effort steps', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(prisma.platformSettings, 'upsert').mockRejectedValueOnce(
      new Error('settings') as never,
    )
    emails.failNext()
    vi.spyOn(prisma.volunteer, 'findMany').mockRejectedValueOnce(new Error('admins') as never)
    const res = await anon().auth.signup(signupInput('admin7@example.com'))
    expect(res.pending).toBe(true)
    await vi.waitFor(() => {
      expect(error).toHaveBeenCalledWith('[SIGNUP]', expect.any(Error))
      expect(error).toHaveBeenCalledWith('[SIGNUP NOTIFY]', expect.any(Error))
    })
    vi.restoreAllMocks()
  })
})

describe('sessions: logout, logoutOtherSessions, me', () => {
  it('logs out the current session, or all the others', async () => {
    const vol = await createVolunteer()
    const t1 = (await anon().auth.login({ email: vol.email!, password: TEST_PASSWORD })).token
    const t2 = (await anon().auth.login({ email: vol.email!, password: TEST_PASSWORD })).token
    expect(await clientAs(vol, { token: t1 }).auth.logoutOtherSessions()).toEqual({
      message: 'Signed out of all other sessions',
    })
    expect(await prisma.session.count({ where: { volunteerId: vol.id } })).toBe(1)
    expect(await prisma.session.count({ where: { tokenHash: hashToken(t2) } })).toBe(0)
    await expect(clientAs(vol, { token: null }).auth.logoutOtherSessions()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    })
    expect(await clientAs(vol, { token: null }).auth.logout()).toEqual({ message: 'Logged out' })
    expect(await clientAs(vol, { token: t1 }).auth.logout()).toEqual({ message: 'Logged out' })
    expect(await prisma.session.count({ where: { volunteerId: vol.id } })).toBe(0)
  })

  it('me returns the redacted profile with skills and endorsements', async () => {
    const skill = await createSkill()
    const endorser = await createVolunteer()
    const vol = await createVolunteer({ skills: { create: [{ skillId: skill.id }] } })
    await prisma.skillEndorsement.create({
      data: { volunteerId: vol.id, skillId: skill.id, endorsedById: endorser.id },
    })
    const me = await clientAs(vol).auth.me()
    expect(me.email).toBe(vol.email)
    expect(me.skills?.[0].id).toBe(skill.id)
    expect(me.endorsements?.[0].skillName).toBe(skill.name)
    await prisma.volunteer.delete({ where: { id: vol.id } })
    await expect(clientAs(vol).auth.me()).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('changePassword / changeEmail', () => {
  it('changes the password, invalidating other sessions', async () => {
    const vol = await createVolunteer()
    const old = (await anon().auth.login({ email: vol.email!, password: TEST_PASSWORD })).token
    const c = clientAs(vol)
    await expect(
      c.auth.changePassword({ currentPassword: 'wrong', newPassword: 'another-long-one' }),
    ).rejects.toMatchObject({ message: 'Current password is incorrect' })
    denyNext()
    await expect(
      c.auth.changePassword({ currentPassword: TEST_PASSWORD, newPassword: 'another-long-one' }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' })
    const res = await c.auth.changePassword({
      currentPassword: TEST_PASSWORD,
      newPassword: 'another-long-one',
    })
    expect(res.message).toBe('Password changed successfully')
    expect(await prisma.session.count({ where: { tokenHash: hashToken(old) } })).toBe(0)
    expect(await prisma.session.count({ where: { tokenHash: hashToken(res.token) } })).toBe(1)
    expect(
      (await anon().auth.login({ email: vol.email!, password: 'another-long-one' })).token,
    ).toBeTruthy()
    const noPw = await createVolunteer({ passwordHash: null })
    await expect(
      clientAs(noPw).auth.changePassword({ currentPassword: 'x', newPassword: 'another-long-one' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('changes the email after re-verifying it', async () => {
    const vol = await createVolunteer()
    await createVolunteer({ email: 'taken2@example.com' })
    const c = clientAs(vol)
    await expect(
      c.auth.changeEmail({ newEmail: 'x@example.com', password: 'wrong' }),
    ).rejects.toMatchObject({ message: 'Password is incorrect' })
    await expect(
      c.auth.changeEmail({ newEmail: 'Taken2@example.com', password: TEST_PASSWORD }),
    ).rejects.toMatchObject({ message: expect.stringContaining('already registered') })
    const res = await c.auth.changeEmail({
      newEmail: ' Fresh@Example.com ',
      password: TEST_PASSWORD,
    })
    expect(res.emailVerificationToken).toBeTruthy()
    expect(await prisma.volunteer.findUniqueOrThrow({ where: { id: vol.id } })).toMatchObject({
      email: 'fresh@example.com',
      emailConfirmed: false,
    })
    expect(emails.last).toMatchObject({ to: 'fresh@example.com', subject: subjects.confirm })
    const noPw = await createVolunteer({ passwordHash: null })
    await expect(
      clientAs(noPw).auth.changeEmail({ newEmail: 'y@example.com', password: 'x' }),
    ).rejects.toMatchObject({ message: expect.stringContaining('without a password') })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    emails.failNext()
    await c.auth.changeEmail({ newEmail: 'again@example.com', password: TEST_PASSWORD })
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith('[CHANGE_EMAIL]', expect.any(Error)))
  })

  it('rations email changes to three a day per account, and refuses a malformed address', async () => {
    const vol = await createVolunteer()
    const c = clientAs(vol)
    await expect(
      c.auth.changeEmail({ newEmail: 'not an address', password: TEST_PASSWORD }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    // Refused attempts cost nothing.
    await expect(
      c.auth.changeEmail({ newEmail: 'r0@example.com', password: 'wrong' }),
    ).rejects.toMatchObject({ message: 'Password is incorrect' })

    for (const n of [1, 2, 3]) {
      await c.auth.changeEmail({ newEmail: `r${n}@example.com`, password: TEST_PASSWORD })
    }
    const sent = emails.sent.length
    await expect(
      c.auth.changeEmail({ newEmail: 'r4@example.com', password: TEST_PASSWORD }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS', message: expect.stringContaining('3') })
    expect(emails.sent).toHaveLength(sent)
    expect((await prisma.volunteer.findUniqueOrThrow({ where: { id: vol.id } })).email).toBe(
      'r3@example.com',
    )

    // A day on, the window starts again.
    await prisma.volunteer.update({
      where: { id: vol.id },
      data: { emailChangeWindowStart: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    })
    await c.auth.changeEmail({ newEmail: 'r5@example.com', password: TEST_PASSWORD })
    expect(await prisma.volunteer.findUniqueOrThrow({ where: { id: vol.id } })).toMatchObject({
      email: 'r5@example.com',
      emailChangeCount: 1,
    })

    denyNext()
    await expect(
      c.auth.changeEmail({ newEmail: 'r6@example.com', password: TEST_PASSWORD }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' })
  })
})

describe('forgotPassword / resetPassword', () => {
  it('issues a reset token only for live accounts and resets with it once', async () => {
    const vol = await createVolunteer()
    const okMsg = "If an account exists with this email, you'll receive a reset link."
    expect(await anon().auth.forgotPassword({ email: 'nobody@example.com' })).toEqual({
      message: okMsg,
    })
    const res = await anon().auth.forgotPassword({ email: vol.email!.toUpperCase() })
    expect(res._devResetToken).toBeTruthy()
    expect(emails.last).toMatchObject({ to: vol.email, subject: subjects.reset })
    // A second request supersedes the first token.
    const res2 = await anon().auth.forgotPassword({ email: vol.email! })
    await expect(
      anon().auth.resetPassword({
        token: res._devResetToken as string,
        newPassword: 'brand-new-pass',
      }),
    ).rejects.toMatchObject({ message: 'Invalid or expired reset token' })
    const session = (await anon().auth.login({ email: vol.email!, password: TEST_PASSWORD })).token
    expect(
      await anon().auth.resetPassword({
        token: res2._devResetToken as string,
        newPassword: 'brand-new-pass',
      }),
    ).toMatchObject({ message: expect.stringContaining('Password reset successful') })
    expect(await prisma.session.count({ where: { tokenHash: hashToken(session) } })).toBe(0)
    expect(
      (await anon().auth.login({ email: vol.email!, password: 'brand-new-pass' })).token,
    ).toBeTruthy()
    await expect(
      anon().auth.resetPassword({
        token: res2._devResetToken as string,
        newPassword: 'brand-new-pass',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    denyNext()
    await expect(anon().auth.forgotPassword({ email: vol.email! })).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
    })
    denyNext()
    await expect(
      anon().auth.resetPassword({ token: 'x', newPassword: 'brand-new-pass' }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' })
  })
})

describe('verifyEmail / resendVerification', () => {
  const tokenFor = async (volunteerId: number, over: Record<string, unknown> = {}) =>
    prisma.emailVerificationToken.create({
      data: {
        volunteerId,
        token: `tok-${volunteerId}-${Math.random()}`,
        expiresAt: new Date(Date.now() + 60_000),
        ...over,
      },
    })

  it('confirms the email and sends the right follow-up', async () => {
    await expect(anon().auth.verifyEmail({ token: 'nope' })).rejects.toMatchObject({
      message: 'Invalid or expired confirmation link',
    })
    const pending = await createVolunteer({ approvalStatus: 'pending', emailConfirmed: false })
    const used = await tokenFor(pending.id, { usedAt: new Date() })
    await expect(anon().auth.verifyEmail({ token: used.token })).rejects.toMatchObject({
      message: expect.stringContaining('already been used'),
    })
    const expired = await tokenFor(pending.id, { expiresAt: new Date(Date.now() - 1) })
    await expect(anon().auth.verifyEmail({ token: expired.token })).rejects.toMatchObject({
      message: expect.stringContaining('expired'),
    })

    const t = await tokenFor(pending.id)
    expect(await anon().auth.verifyEmail({ token: t.token })).toEqual({
      success: true,
      requiresPasswordReset: false,
    })
    expect(
      (await prisma.volunteer.findUniqueOrThrow({ where: { id: pending.id } })).emailConfirmed,
    ).toBe(true)
    expect(emails.last).toMatchObject({ to: pending.email, subject: subjects.received })
    expect(emails.last.html).toContain(pending.name)

    const approved = await createVolunteer({ emailConfirmed: false })
    await anon().auth.verifyEmail({ token: (await tokenFor(approved.id)).token })
    expect(emails.last).toMatchObject({ to: approved.email, subject: subjects.approved })
    expect(emails.last.html).toContain(approved.name)

    await prisma.platformSettings.update({
      where: { id: 1 },
      data: { requireApplicationApproval: false },
    })
    const open = await createVolunteer({ emailConfirmed: false })
    await anon().auth.verifyEmail({ token: (await tokenFor(open.id)).token })
    expect(emails.last).toMatchObject({ to: open.email, subject: subjects.welcome })
    await prisma.platformSettings.update({
      where: { id: 1 },
      data: { requireApplicationApproval: true },
    })

    // Already confirmed, or a status that gets no email: nothing more is sent.
    const already = await createVolunteer({ emailConfirmed: true })
    await anon().auth.verifyEmail({ token: (await tokenFor(already.id)).token })
    const rejected = await createVolunteer({ emailConfirmed: false, approvalStatus: 'rejected' })
    await anon().auth.verifyEmail({ token: (await tokenFor(rejected.id)).token })
    expect(sentSubjects().filter((x) => x === subjects.received)).toHaveLength(1)
  })

  it('locks out whoever pre-registered a listed address when its owner confirms it', async () => {
    // Anyone can sign up with an address they do not own. The owner, expecting mail
    // from Catalyse, clicks the link from their own browser, signed out.
    const squatted = await createVolunteer({
      email: 'admin14@example.com',
      approvalStatus: 'pending',
      emailConfirmed: false,
    })
    const attacker = await anon().auth.login({
      email: 'admin14@example.com',
      password: TEST_PASSWORD,
    })
    const t = await tokenFor(squatted.id)
    expect(await anon().auth.verifyEmail({ token: t.token })).toEqual({
      success: true,
      requiresPasswordReset: true,
    })
    expect(await prisma.volunteer.findUniqueOrThrow({ where: { id: squatted.id } })).toMatchObject({
      isAdmin: true,
      passwordHash: null,
    })
    expect(await prisma.session.count({ where: { volunteerId: squatted.id } })).toBe(0)
    expect(attacker.token).toBeTruthy()
    await expect(
      anon().auth.login({ email: 'admin14@example.com', password: TEST_PASSWORD }),
    ).rejects.toBeDefined()
  })

  it('keeps the password when the link is opened while signed in to the account', async () => {
    const invitee = await createVolunteer({
      email: 'admin15@example.com',
      approvalStatus: 'pending',
      emailConfirmed: false,
    })
    const t = await tokenFor(invitee.id)
    expect(await clientAs(invitee).auth.verifyEmail({ token: t.token })).toEqual({
      success: true,
      requiresPasswordReset: false,
    })
    const res = await anon().auth.login({ email: 'admin15@example.com', password: TEST_PASSWORD })
    expect(res.token).toBeTruthy()
    expect(await prisma.volunteer.findUniqueOrThrow({ where: { id: invitee.id } })).toMatchObject({
      isAdmin: true,
    })
  })

  it('does not confirm an address that was changed while the link was being verified', async () => {
    // The applicant owns the inbox for their own signup address and so holds a valid
    // token; they fire the confirmation and a changeEmail to an invited address at
    // once. Whatever the interleaving, the invited address must stay unconfirmed.
    const inviter = await createAdmin()
    await prisma.adminInvite.create({
      data: {
        email: 'target@example.com',
        inviteToken: 't-race',
        invitedById: inviter.id,
        expiresAt: new Date(Date.now() + 60_000),
      },
    })
    const vol = await createVolunteer({ approvalStatus: 'pending', emailConfirmed: false })
    const t = await tokenFor(vol.id)
    const realTx = prisma.$transaction.bind(prisma) as (fn: unknown) => Promise<unknown>
    vi.spyOn(prisma, '$transaction').mockImplementationOnce(async (fn: unknown) => {
      await clientAs(vol).auth.changeEmail({
        newEmail: 'target@example.com',
        password: TEST_PASSWORD,
      })
      return realTx(fn)
    })
    await expect(anon().auth.verifyEmail({ token: t.token })).rejects.toMatchObject({
      message: expect.stringContaining('already been used'),
    })
    vi.restoreAllMocks()
    expect(await prisma.volunteer.findUniqueOrThrow({ where: { id: vol.id } })).toMatchObject({
      email: 'target@example.com',
      emailConfirmed: false,
      isAdmin: false,
    })
    const res = await anon().auth.login({ email: 'target@example.com', password: TEST_PASSWORD })
    expect(res.wasPromoted).toBe(false)
  })

  it('logs email failures and settings lookup failures on verify', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const v1 = await createVolunteer({ emailConfirmed: false })
    vi.spyOn(prisma.platformSettings, 'upsert').mockRejectedValueOnce(new Error('db') as never)
    emails.failNext()
    await anon().auth.verifyEmail({ token: (await tokenFor(v1.id)).token })
    const v2 = await createVolunteer({ emailConfirmed: false, approvalStatus: 'pending' })
    emails.failNext()
    await anon().auth.verifyEmail({ token: (await tokenFor(v2.id)).token })
    const promoted = await createVolunteer({ email: 'admin11@example.com', emailConfirmed: false })
    emails.failNext()
    await anon().auth.verifyEmail({ token: (await tokenFor(promoted.id)).token })
    await prisma.platformSettings.update({
      where: { id: 1 },
      data: { requireApplicationApproval: false },
    })
    const v3 = await createVolunteer({ emailConfirmed: false })
    emails.failNext()
    await anon().auth.verifyEmail({ token: (await tokenFor(v3.id)).token })
    await prisma.platformSettings.update({
      where: { id: 1 },
      data: { requireApplicationApproval: true },
    })
    await vi.waitFor(() =>
      expect(error.mock.calls.filter((c) => c[0] === '[VERIFY_EMAIL]')).toHaveLength(4),
    )
    vi.restoreAllMocks()
  })

  it('resends a confirmation for unconfirmed accounts only', async () => {
    const okMsg = 'If that email is registered and unconfirmed, a new link has been sent.'
    expect(await anon().auth.resendVerification({})).toEqual({ message: okMsg })
    expect(await anon().auth.resendVerification({ email: 'nobody@example.com' })).toEqual({
      message: okMsg,
    })
    const confirmed = await createVolunteer()
    expect(await anon().auth.resendVerification({ email: confirmed.email! })).toEqual({
      message: okMsg,
    })
    const unconfirmed = await createVolunteer({ emailConfirmed: false })
    const res = await clientAs(unconfirmed).auth.resendVerification({})
    expect(res.emailVerificationToken).toBeTruthy()
    expect(emails.last).toMatchObject({ to: unconfirmed.email, subject: subjects.confirm })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    emails.failNext()
    await anon().auth.resendVerification({ email: unconfirmed.email! })
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith('[RESEND_VERIFICATION]', expect.any(Error)),
    )
    denyNext()
    await expect(anon().auth.resendVerification({})).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
    })
  })

  it('a resend retires the old token and the new one confirms', async () => {
    const signup = await anon().auth.signup(signupInput('resend@example.com'))
    const oldToken = signup.emailVerificationToken!
    const me = await prisma.volunteer.findUniqueOrThrow({ where: { id: signup.id } })
    const resent = await clientAs(me).auth.resendVerification({})
    expect(resent.emailVerificationToken).toBeTruthy()
    await expect(anon().auth.verifyEmail({ token: oldToken })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
    await expect(
      anon().auth.verifyEmail({ token: resent.emailVerificationToken! }),
    ).resolves.toBeTruthy()
  })

  it('confirms an email whose account an admin approved first', async () => {
    const signup = await anon().auth.signup(signupInput('early@example.com'))
    await prisma.volunteer.update({
      where: { id: signup.id },
      data: { approvalStatus: 'approved' },
    })
    await expect(
      anon().auth.verifyEmail({ token: signup.emailVerificationToken! }),
    ).resolves.toBeTruthy()
  })
})

describe('deleteAccount', () => {
  it('requires the password when one is set, scrubs the account, and warns affected owners and admins', async () => {
    const me = await createVolunteer({ name: 'Leaver' })
    const owner = await createVolunteer()
    const noEmailOwner = await createVolunteer({ email: null })
    const admin = await createAdmin()
    const p1 = await createProject({ assigneeId: owner.id, status: 'in_progress' })
    const p2 = await createProject({ assigneeId: noEmailOwner.id, status: 'in_progress' })
    await createQuickTask({ contextProjectId: p1.id, assigneeId: me.id, status: 'in_progress' })
    await createQuickTask({ contextProjectId: p1.id, assigneeId: me.id, status: 'in_progress' })
    await createQuickTask({ contextProjectId: p2.id, assigneeId: me.id, status: 'in_progress' })
    await createQuickTask({ contextProjectId: p1.id, assigneeId: me.id, status: 'completed' })
    const mine = await createProject({ assigneeId: me.id, status: 'in_progress' })
    await createProject({ assigneeId: me.id, status: 'completed' })

    const c = clientAs(me)
    await expect(c.auth.deleteAccount({})).rejects.toMatchObject({
      message: 'Password is incorrect',
    })
    await expect(c.auth.deleteAccount({ password: 'wrong' })).rejects.toMatchObject({
      message: 'Password is incorrect',
    })
    expect((await c.auth.deleteAccount({ password: TEST_PASSWORD })).message).toContain('deleted')

    const row = await prisma.volunteer.findUniqueOrThrow({ where: { id: me.id } })
    expect(row).toMatchObject({ name: '[Deleted User]', email: null, passwordHash: null })
    expect(row.deletedAt).not.toBeNull()
    expect(await prisma.deletionRequest.count({ where: { volunteerId: me.id } })).toBe(1)
    expect(await prisma.session.count({ where: { volunteerId: me.id } })).toBe(0)

    const ownerNotes = await prisma.notification.findMany({
      where: { volunteerId: owner.id, type: 'account_deleted_impact' },
    })
    expect(ownerNotes.map((n) => n.body)).toEqual([
      `2 tasks in '${p1.title}' assigned to Leaver need a new assignee.`,
    ])
    expect(
      await prisma.notification.count({
        where: { volunteerId: noEmailOwner.id, type: 'account_deleted_impact' },
      }),
    ).toBe(1)
    expect(
      await prisma.notification.findFirst({
        where: { volunteerId: admin.id, type: 'account_deleted_impact' },
      }),
    ).toMatchObject({ body: `'${mine.title}' needs a new owner.` })
    const sent = emails.sent.map((e) => e.to)
    expect(sent).toEqual(expect.arrayContaining([owner.email, admin.email]))
    expect(sent).not.toContain(null)
  })

  it('deletes a passwordless account without a password, and one with nothing to notify', async () => {
    const me = await createVolunteer({ passwordHash: null })
    expect((await clientAs(me).auth.deleteAccount({})).message).toContain('deleted')
    expect(emails.sent).toEqual([])
  })

  it('logs notification failures during deletion', async () => {
    const me = await createVolunteer({ passwordHash: null })
    const owner = await createVolunteer()
    const p = await createProject({ assigneeId: owner.id })
    await createQuickTask({ contextProjectId: p.id, assigneeId: me.id })
    await createProject({ assigneeId: me.id })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(prisma.notification, 'create').mockRejectedValue(new Error('db') as never)
    emails.failAll()
    await clientAs(me).auth.deleteAccount({})
    expect(error).toHaveBeenCalledWith('[NOTIFY ERROR]', expect.any(Error))
    expect(error).toHaveBeenCalledWith('[NOTIFY ERROR] email failed:', expect.any(Error))
    vi.restoreAllMocks()
  })
})

describe('google sign-in (stubbed)', () => {
  it('reports the stub client config', async () => {
    expect(await anon().auth.googleClientId()).toEqual({
      clientId: 'test-google-client',
      stub: true,
    })
  })

  it('signs in existing accounts, and hands new ones to the signup form', async () => {
    const existing = await createVolunteer({ email: 'g@example.com', emailConfirmed: false })
    const earlier = await anon().auth.login({ email: 'g@example.com', password: TEST_PASSWORD })
    const res = await anon().auth.google({ stub: true, email: 'g@example.com', name: 'Ignored' })
    // Whoever set the password on the unconfirmed account is not known to be this person.
    expect(await prisma.volunteer.findUniqueOrThrow({ where: { id: existing.id } })).toMatchObject({
      emailConfirmed: true,
      passwordHash: null,
    })
    expect(await prisma.session.count({ where: { tokenHash: hashToken(earlier.token) } })).toBe(0)

    const confirmed = await createVolunteer({ email: 'g2@example.com' })
    await anon().auth.google({ stub: true, email: 'g2@example.com' })
    expect(
      (await prisma.volunteer.findUniqueOrThrow({ where: { id: confirmed.id } })).passwordHash,
    ).toBeTruthy()
    expect(res).toMatchObject({
      isNewUser: false,
      isPending: false,
      name: existing.name,
      wasPromoted: false,
    })
    expect(res.token).toBeTruthy()
    const fresh = await anon().auth.google({ stub: true })
    expect(fresh).toEqual({
      token: null,
      wasPromoted: false,
      isNewUser: true,
      isPending: true,
      name: 'Stub User',
      email: 'stub@example.com',
    })
    // Promotion on Google login via invite.
    const inviter = await createSuperAdmin()
    await prisma.adminInvite.create({
      data: {
        email: 'g@example.com',
        inviteToken: 'g1',
        invitedById: inviter.id,
        expiresAt: new Date(Date.now() + 60_000),
      },
    })
    expect((await anon().auth.google({ stub: true, email: 'g@example.com' })).wasPromoted).toBe(
      true,
    )
    // A real credential path goes through the verifier.
    await expect(anon().auth.google({ credential: 'bad' })).rejects.toMatchObject({
      message: 'Invalid Google token',
    })
    google.accept('good', { email: 'real@example.com', name: 'Real' })
    expect((await anon().auth.google({ credential: 'good' })).isNewUser).toBe(true)
    denyNext()
    await expect(anon().auth.google({ stub: true })).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
    })
  })

  it('completes a Google signup into a pending application (or straight to admin)', async () => {
    const { email: _e, password: _p, name: _n, ...form } = signupInput('unused@example.com')
    const res = await anon().auth.completeGoogleSignup({
      ...form,
      stub: true,
      skillIds: [(await createSkill()).id],
    })
    expect(res).toMatchObject({ pending: true, wasPromoted: false, name: 'Stub User' })
    const row = await prisma.volunteer.findFirstOrThrow({ where: { email: 'stub@example.com' } })
    expect(row).toMatchObject({
      emailConfirmed: true,
      approvalStatus: 'pending',
      passwordHash: null,
    })
    expect(emails.last).toMatchObject({ to: 'stub@example.com', subject: subjects.received })
    expect(emails.last.html).toContain('Stub User')
    await expect(anon().auth.completeGoogleSignup({ ...form, stub: true })).rejects.toMatchObject({
      message: 'Email already registered',
    })
    await prisma.volunteer.update({ where: { id: row.id }, data: { deletedAt: new Date() } })
    await expect(anon().auth.completeGoogleSignup({ ...form, stub: true })).rejects.toMatchObject({
      message: expect.stringContaining('previously registered'),
    })

    await expect(
      anon().auth.completeGoogleSignup({ ...form, credential: 'bad' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    google.accept('good', { email: 'admin8@example.com', name: 'Boot' })
    const boot = await anon().auth.completeGoogleSignup({ ...form, credential: 'good' })
    expect(boot).toMatchObject({ pending: false, wasPromoted: true })
    expect(emails.last).toMatchObject({ to: 'admin8@example.com', subject: subjects.welcome })
    expect(emails.last.html).toContain('Boot')
    denyNext()
    await expect(anon().auth.completeGoogleSignup({ ...form, stub: true })).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
    })
  })

  it('logs email failures and tolerates bootstrap failures on Google signup', async () => {
    const { email: _e, password: _p, name: _n, ...form } = signupInput('unused@example.com')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    // A listed admin email whose bootstrap fails lands as pending.
    google.accept('good', { email: 'admin9@example.com', name: 'F' })
    emails.failNext()
    vi.spyOn(prisma.volunteer, 'updateMany').mockRejectedValueOnce(new Error('boot') as never)
    expect((await anon().auth.completeGoogleSignup({ ...form, credential: 'good' })).pending).toBe(
      true,
    )
    google.accept('good', { email: 'admin10@example.com', name: 'F' })
    emails.failNext()
    await anon().auth.completeGoogleSignup({ ...form, credential: 'good' })
    await vi.waitFor(() =>
      expect(error.mock.calls.filter((c) => c[0] === '[GOOGLE_SIGNUP]')).toHaveLength(2),
    )
    vi.restoreAllMocks()
  })
})
