import { describe, it, expect, vi, afterEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createVolunteer, createAdmin, createStaffInvite } from '@/test/factories'
import {
  hashPassword,
  verifyPassword,
  generateAuthToken,
  authTokenExpiry,
  extractToken,
  hashToken,
  createSession,
  deleteSession,
  deleteAllSessions,
  deleteOtherSessions,
  getCurrentVolunteer,
  redactVolunteer,
  isSuperAdmin,
  checkAdminBootstrap,
  acceptPendingInvite,
  isEntitledToAdmin,
  revokeCredentials,
  AUTH_TOKEN_TTL_MS,
} from './auth'

afterEach(() => vi.restoreAllMocks())

describe('passwords and tokens', () => {
  it('hashes and verifies passwords, rejecting garbage hashes', () => {
    const hash = hashPassword('pw')
    expect(verifyPassword('pw', hash)).toBe(true)
    expect(verifyPassword('other', hash)).toBe(false)
    expect(verifyPassword('pw', 'not-base64-of-64-bytes')).toBe(false)
  })

  it('generates url-safe tokens with a 30-day expiry', () => {
    expect(generateAuthToken()).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(authTokenExpiry().getTime() - Date.now()).toBeCloseTo(AUTH_TOKEN_TTL_MS, -3)
    expect(hashToken('a')).toHaveLength(64)
  })

  it('extracts bearer or raw tokens', () => {
    expect(extractToken(null)).toBeNull()
    expect(extractToken('Bearer abc')).toBe('abc')
    expect(extractToken('abc')).toBe('abc')
  })
})

describe('sessions', () => {
  it('creates, resolves and deletes sessions', async () => {
    const vol = await createVolunteer()
    const token = await createSession(vol.id)
    expect((await getCurrentVolunteer(`Bearer ${token}`))?.id).toBe(vol.id)
    expect(await getCurrentVolunteer(null)).toBeNull()
    expect(await getCurrentVolunteer('Bearer nope')).toBeNull()

    const other = await createSession(vol.id)
    await deleteOtherSessions(vol.id, token)
    expect(await getCurrentVolunteer(other)).toBeNull()
    expect((await getCurrentVolunteer(token))?.id).toBe(vol.id)

    await deleteSession(token)
    expect(await getCurrentVolunteer(token)).toBeNull()

    const t3 = await createSession(vol.id)
    await deleteAllSessions(vol.id)
    expect(await getCurrentVolunteer(t3)).toBeNull()
  })

  it('ignores sessions of deleted volunteers and swallows a failed lastUsedAt touch', async () => {
    const vol = await createVolunteer({ deletedAt: new Date() })
    const token = await createSession(vol.id)
    expect(await getCurrentVolunteer(token)).toBeNull()

    const live = await createVolunteer()
    const liveToken = await createSession(live.id)
    const update = vi.spyOn(prisma.session, 'update').mockReturnValue({
      catch: (fn: (e: unknown) => void) => fn(new Error('db')),
    } as never)
    expect((await getCurrentVolunteer(liveToken))?.id).toBe(live.id)
    expect(update).toHaveBeenCalled()
  })

  it('promotes a legacy single-token session into a Session row', async () => {
    const expires = new Date(Date.now() + 60_000)
    const vol = await createVolunteer({ authToken: 'legacy-token', authTokenExpiresAt: expires })
    expect((await getCurrentVolunteer('legacy-token'))?.id).toBe(vol.id)
    const session = await prisma.session.findFirstOrThrow({ where: { volunteerId: vol.id } })
    expect(session.tokenHash).toBe(hashToken('legacy-token'))
    // Second call now hits the Session row.
    expect((await getCurrentVolunteer('legacy-token'))?.id).toBe(vol.id)

    // An expired legacy token is not honoured.
    await createVolunteer({ authToken: 'expired', authTokenExpiresAt: new Date(Date.now() - 1) })
    expect(await getCurrentVolunteer('expired')).toBeNull()
  })

  it('still returns the legacy volunteer when the promotion insert fails', async () => {
    const vol = await createVolunteer({
      authToken: 'legacy-2',
      authTokenExpiresAt: new Date(Date.now() + 60_000),
    })
    vi.spyOn(prisma.session, 'create').mockReturnValue({
      catch: (fn: (e: unknown) => void) => fn(new Error('db')),
    } as never)
    expect((await getCurrentVolunteer('legacy-2'))?.id).toBe(vol.id)
  })
})

describe('getCurrentVolunteer and the global admin flag', () => {
  const flagOf = async (id: number) =>
    (await prisma.volunteer.findUniqueOrThrow({ where: { id } })).isAdmin

  it('keeps isAdmin in step with ADMIN_EMAILS, whatever the stored flag says', async () => {
    const listed = await createVolunteer({ email: 'admin15@example.com', isAdmin: false })
    const signedIn = await getCurrentVolunteer(await createSession(listed.id))
    expect(signedIn?.isAdmin).toBe(true)
    expect(await flagOf(listed.id)).toBe(true)

    const stale = await createVolunteer({ isAdmin: true })
    expect((await getCurrentVolunteer(await createSession(stale.id)))?.isAdmin).toBe(false)
    expect(await flagOf(stale.id)).toBe(false)

    const plain = await createVolunteer()
    expect((await getCurrentVolunteer(await createSession(plain.id)))?.isAdmin).toBe(false)
  })
})

describe('redactVolunteer', () => {
  it('hides contact fields unless showContact, and reports super-admin status', async () => {
    const vol = {
      ...(await createVolunteer({ email: 'admin@example.com', discordHandle: 'd' })),
      group: { name: 'Leeds' },
    }
    const hidden = redactVolunteer(vol)
    expect(hidden.localGroup).toBe('Leeds')
    expect(hidden.email).toBeUndefined()
    expect(hidden.discordHandle).toBeUndefined()
    expect(hidden.isSuperAdmin).toBe(true)
    expect(hidden.hasPassword).toBe(true)
    expect(hidden.cookieConsentAnalytics).toBeNull()
    const shown = redactVolunteer(vol, { showContact: true, skills: [], endorsements: [] })
    expect(shown.email).toBe('admin@example.com')
    expect(shown.discordHandle).toBe('d')
    expect(shown.skills).toEqual([])
  })
})

describe('isSuperAdmin', () => {
  it('refuses an admin whose listed address is unconfirmed', async () => {
    const squatter = await createAdmin({ email: 'admin18@example.com', emailConfirmed: false })
    expect(redactVolunteer({ ...squatter, group: null }).isSuperAdmin).toBe(false)
  })

  it('isSuperAdmin is case-insensitive, false for empty and false until confirmed', () => {
    expect(isSuperAdmin({ email: 'ADMIN@example.com', emailConfirmed: true })).toBe(true)
    expect(isSuperAdmin({ email: 'admin@example.com', emailConfirmed: false })).toBe(false)
    expect(isSuperAdmin({ email: null, emailConfirmed: true })).toBe(false)
    expect(isSuperAdmin(null)).toBe(false)
    expect(isSuperAdmin({ email: 'x@example.com', emailConfirmed: true })).toBe(false)
  })
})

describe('isEntitledToAdmin', () => {
  it('is true for a confirmed listed address or a confirmed pending invite', async () => {
    const inviter = await createAdmin()
    await createStaffInvite({
      email: 'entitled@example.com',
      inviteToken: 'entitled-tok',
      invitedById: inviter.id,
      expiresAt: new Date(Date.now() + 60_000),
    })
    const invited = { email: 'Entitled@example.com', emailConfirmed: true }
    expect(await isEntitledToAdmin(invited)).toBe(true)
    expect(await isEntitledToAdmin({ ...invited, emailConfirmed: false })).toBe(false)
    expect(await isEntitledToAdmin({ email: 'admin@example.com', emailConfirmed: true })).toBe(true)
    expect(await isEntitledToAdmin({ email: 'x@example.com', emailConfirmed: true })).toBe(false)
  })
})

describe('revokeCredentials', () => {
  it('clears the password, the legacy token and every session', async () => {
    const vol = await createVolunteer()
    await prisma.volunteer.update({
      where: { id: vol.id },
      data: { authToken: 'legacy-revoke', authTokenExpiresAt: new Date(Date.now() + 60_000) },
    })
    const token = await createSession(vol.id)
    await revokeCredentials(vol.id)
    expect(await getCurrentVolunteer(token)).toBeNull()
    expect(await getCurrentVolunteer('legacy-revoke')).toBeNull()
    expect(await prisma.volunteer.findUniqueOrThrow({ where: { id: vol.id } })).toMatchObject({
      passwordHash: null,
      authToken: null,
    })
  })
})

describe('checkAdminBootstrap', () => {
  it('promotes listed emails only, and only once confirmed', async () => {
    const vol = await createVolunteer({
      email: 'admin19@example.com',
      approvalStatus: 'pending',
      emailConfirmed: false,
    })
    expect(await checkAdminBootstrap({ ...vol, email: 'nobody@example.com' })).toBe(false)
    expect(await checkAdminBootstrap(vol)).toBe(false)
    expect(await checkAdminBootstrap({ ...vol, email: null, emailConfirmed: true })).toBe(false)
    expect(await prisma.volunteer.findUniqueOrThrow({ where: { id: vol.id } })).toMatchObject({
      isAdmin: false,
      approvalStatus: 'pending',
      emailConfirmed: false,
    })
    expect(
      await checkAdminBootstrap({ ...vol, email: 'ADMIN19@example.com', emailConfirmed: true }),
    ).toBe(true)
    expect(await prisma.volunteer.findUniqueOrThrow({ where: { id: vol.id } })).toMatchObject({
      isAdmin: true,
      approvalStatus: 'approved',
    })
  })

  it('is a no-op when no admin emails are configured', async () => {
    vi.stubEnv('ADMIN_EMAILS', '')
    expect(
      await checkAdminBootstrap({ id: 1, email: 'admin@example.com', emailConfirmed: true }),
    ).toBe(false)
    vi.unstubAllEnvs()
  })
})

describe('acceptPendingInvite', () => {
  it('accepts a matching pending invite once the email is confirmed', async () => {
    const inviter = await createAdmin()
    const vol = await createVolunteer({ email: 'invitee@example.com', approvalStatus: 'pending' })
    expect(await acceptPendingInvite(vol)).toBe(false)
    const invite = await createStaffInvite({
      email: 'Invitee@Example.com',
      inviteToken: 'tok',
      invitedById: inviter.id,
      expiresAt: new Date(Date.now() + 60_000),
    })
    expect(await acceptPendingInvite({ ...vol, emailConfirmed: false })).toBe(false)
    expect(await acceptPendingInvite({ ...vol, email: null })).toBe(false)
    expect(await prisma.adminInvite.findUniqueOrThrow({ where: { id: invite.id } })).toMatchObject({
      status: 'pending',
    })
    expect(await acceptPendingInvite(vol)).toBe(true)
    const after = await prisma.adminInvite.findUniqueOrThrow({ where: { id: invite.id } })
    expect(after).toMatchObject({ status: 'accepted', acceptedById: vol.id })
    expect(await prisma.volunteer.findUniqueOrThrow({ where: { id: vol.id } })).toMatchObject({
      nationalChapterId: invite.nationalChapterId,
      approvalStatus: 'approved',
    })
    expect(await prisma.chapterDeputy.findUnique({ where: { volunteerId: vol.id } })).not.toBeNull()
  })
})
