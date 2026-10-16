import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createVolunteer,
  createAdmin,
  createSuperAdmin,
  createChapter,
  createChapterLead,
  createMember,
  createStaffInvite,
} from '@/test/factories'
import { clientAs } from '@/test/rpc'

describe('admin.admins', () => {
  it('lists the global admins and toggles the technical flag', async () => {
    const sa = await createSuperAdmin()
    const admin = await createAdmin({ name: 'Zed' })
    const gone = await createAdmin({ deletedAt: new Date() })
    const stale = await createVolunteer({ isAdmin: true })
    const c = clientAs(sa)
    const list = await c.admin.admins.list()
    const ids = list.map((a) => a.id)
    expect(ids).toEqual(expect.arrayContaining([sa.id, admin.id]))
    expect(ids).not.toContain(gone.id)
    expect(ids).not.toContain(stale.id)
    expect(list.map((a) => a.name)).toEqual([...list.map((a) => a.name)].sort())
    expect(list.find((a) => a.id === admin.id)?.isTechnicalAdmin).toBe(false)
    expect(
      await c.admin.admins.setTechnicalAdmin({ id: admin.id, isTechnicalAdmin: true }),
    ).toEqual({ message: 'Zed will now be notified of bug reports' })
    expect(
      await c.admin.admins.setTechnicalAdmin({ id: admin.id, isTechnicalAdmin: false }),
    ).toEqual({ message: 'Zed will no longer be notified of bug reports' })
    await expect(
      c.admin.admins.setTechnicalAdmin({ id: stale.id, isTechnicalAdmin: true }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('admin.admins.acceptInvite', () => {
  it('makes a proven invitee a deputy of the chapter, moving them into it', async () => {
    const chapter = await createChapter()
    const elsewhere = await createChapter()
    const inviter = await createChapterLead(chapter)
    const invite = await createStaffInvite({
      email: 'New@Example.com',
      invitedById: inviter.id,
      nationalChapterId: chapter.id,
    })
    const token = invite.inviteToken

    const wrongPerson = await createVolunteer()
    await expect(
      clientAs(wrongPerson).admin.admins.acceptInvite({ inviteToken: token }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      clientAs(wrongPerson).admin.admins.acceptInvite({ inviteToken: 'nope' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })

    // A forwarded link is not enough: the account must have proven the invited address.
    const invitee = await createMember(elsewhere, {
      email: 'new@example.com',
      emailConfirmed: false,
      approvalStatus: 'pending',
    })
    await expect(
      clientAs(invitee).admin.admins.acceptInvite({ inviteToken: token }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: expect.stringContaining('Confirm') })
    const proven = await prisma.volunteer.update({
      where: { id: invitee.id },
      data: { emailConfirmed: true },
    })
    expect(await clientAs(proven).admin.admins.acceptInvite({ inviteToken: token })).toEqual({
      message: `You are now a deputy lead of the ${chapter.name} chapter!`,
    })
    expect(await prisma.volunteer.findUniqueOrThrow({ where: { id: invitee.id } })).toMatchObject({
      nationalChapterId: chapter.id,
      country: chapter.country,
      approvalStatus: 'approved',
      isAdmin: false,
    })
    expect(
      await prisma.chapterDeputy.findUnique({ where: { volunteerId: invitee.id } }),
    ).toMatchObject({ nationalChapterId: chapter.id })
    await expect(
      clientAs(proven).admin.admins.acceptInvite({ inviteToken: token }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'This invite has already been used.' })
  })

  it('makes an invited lead the lead, and refuses withdrawn or expired invites', async () => {
    const chapter = await createChapter()
    const admin = await createAdmin()
    const lead = await createVolunteer({ email: 'lead@example.com' })
    const leadInvite = await createStaffInvite({
      email: 'lead@example.com',
      invitedById: admin.id,
      nationalChapterId: chapter.id,
      role: 'LEAD',
    })
    expect(
      await clientAs(lead).admin.admins.acceptInvite({ inviteToken: leadInvite.inviteToken }),
    ).toEqual({ message: `You are now the lead of the ${chapter.name} chapter!` })
    expect(
      (await prisma.nationalChapter.findUniqueOrThrow({ where: { id: chapter.id } })).leadId,
    ).toBe(lead.id)

    const who = await createVolunteer({ email: 'who@example.com' })
    const refusals: [Parameters<typeof createStaffInvite>[0], string][] = [
      [{ email: who.email!, invitedById: admin.id, status: 'revoked' }, 'withdrawn'],
      // An invite with no role, or from before chapters with no chapter either.
      [{ email: who.email!, invitedById: admin.id, role: null }, 'withdrawn'],
      [{ email: who.email!, invitedById: admin.id, nationalChapterId: null }, 'withdrawn'],
      [{ email: who.email!, invitedById: admin.id, expiresAt: new Date(0) }, 'expired'],
    ]
    for (const [data, message] of refusals) {
      const invite = await createStaffInvite(data)
      await expect(
        clientAs(who).admin.admins.acceptInvite({ inviteToken: invite.inviteToken }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining(message) })
    }
  })
})
