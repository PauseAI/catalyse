import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createAdmin,
  createChapter,
  createChapterDeputy,
  createChapterLead,
  createMember,
  createVolunteer,
} from '@/test/factories'
import { emails } from '@/test/fakes/email'
import { clientAs } from '@/test/rpc'

const forbidden = { code: 'FORBIDDEN' }
const notFound = { code: 'NOT_FOUND' }
const actions = async (chapterId: number) =>
  (
    await prisma.chapterAuditEvent.findMany({
      where: { nationalChapterId: chapterId },
      orderBy: { id: 'asc' },
    })
  ).map((e) => e.action)

describe('admin.chapters for a global admin', () => {
  it('opens a chapter for a listed country, placing the pool members who live there', async () => {
    const admin = clientAs(await createAdmin())
    const waiting = await createVolunteer({ country: 'Ghana' })
    const elsewhere = await createVolunteer({ country: 'Kenya' })
    const suggester = await createVolunteer()
    await prisma.localGroupSuggestion.create({
      data: { name: 'Accra', country: 'Ghana', suggestedById: suggester.id },
    })

    expect(await admin.admin.chapters.create({ country: 'Ghana' })).toMatchObject({
      name: 'Ghana',
      placedFromPool: 1,
    })
    const ghana = await prisma.nationalChapter.findUniqueOrThrow({ where: { country: 'Ghana' } })
    expect(
      (await prisma.volunteer.findUniqueOrThrow({ where: { id: waiting.id } })).nationalChapterId,
    ).toBe(ghana.id)
    expect(
      (await prisma.volunteer.findUniqueOrThrow({ where: { id: elsewhere.id } })).nationalChapterId,
    ).toBeNull()
    expect(
      (await prisma.localGroupSuggestion.findFirstOrThrow({ where: { name: 'Accra' } }))
        .nationalChapterId,
    ).toBe(ghana.id)
    expect(await actions(ghana.id)).toEqual(['CHAPTER_CREATED'])

    await expect(admin.admin.chapters.create({ country: 'Ghana' })).rejects.toMatchObject({
      message: 'That country already has a chapter',
    })
    await expect(admin.admin.chapters.create({ country: 'Atlantis' })).rejects.toMatchObject({
      message: 'Unknown country',
    })

    const list = await admin.admin.chapters.list()
    expect(list.chapters.find((c) => c.id === ghana.id)).toMatchObject({
      memberCount: 1,
      deputyCount: 0,
      lead: null,
    })
    expect(list.availableCountries.map((c) => c.value)).not.toContain('Ghana')
    expect(list.poolCount).toBeGreaterThanOrEqual(2)
    expect((await admin.admin.chapters.pool()).map((p) => p.id)).toContain(elsewhere.id)
  })

  it('appoints and replaces a lead from among the members', async () => {
    const admin = await createAdmin()
    const c = clientAs(admin)
    const chapter = await createChapter()
    const first = await createChapterDeputy(chapter, { name: 'First' })
    const second = await createMember(chapter, { name: 'Second' })
    const outsider = await createVolunteer({ name: 'Outsider' })

    expect(
      await c.admin.chapters.appointLead({ chapterId: chapter.id, volunteerId: first.id }),
    ).toEqual({ message: 'First now leads the chapter' })
    // A deputy made lead is no longer a deputy as well.
    expect(await prisma.chapterDeputy.findUnique({ where: { volunteerId: first.id } })).toBeNull()
    await c.admin.chapters.appointLead({ chapterId: chapter.id, volunteerId: first.id })
    await c.admin.chapters.appointLead({ chapterId: chapter.id, volunteerId: second.id })
    expect(
      (await prisma.nationalChapter.findUniqueOrThrow({ where: { id: chapter.id } })).leadId,
    ).toBe(second.id)
    await expect(
      c.admin.chapters.appointLead({ chapterId: chapter.id, volunteerId: outsider.id }),
    ).rejects.toMatchObject({ message: 'Outsider is not a member of this chapter' })
    await expect(
      c.admin.chapters.appointLead({ chapterId: chapter.id, volunteerId: 999_999 }),
    ).rejects.toMatchObject(notFound)

    expect(await c.admin.chapters.removeLead({ chapterId: chapter.id })).toEqual({
      message: 'The chapter has no lead now',
    })
    await expect(c.admin.chapters.removeLead({ chapterId: chapter.id })).rejects.toMatchObject({
      message: 'This chapter has no lead',
    })
    expect(await actions(chapter.id)).toEqual([
      'LEAD_APPOINTED',
      'LEAD_REMOVED',
      'LEAD_APPOINTED',
      'LEAD_REMOVED',
    ])
  })

  it('moves a member to another chapter or the pool, taking away their role there', async () => {
    const c = clientAs(await createAdmin())
    const [from, to] = [await createChapter(), await createChapter()]
    const lead = await createChapterLead(from)
    const group = await prisma.localGroup.create({
      data: { name: 'Group', country: from.country, nationalChapterId: from.id },
    })
    await prisma.volunteer.update({ where: { id: lead.id }, data: { localGroupId: group.id } })
    await prisma.chapterTransferRequest.create({
      data: { volunteerId: lead.id, fromChapterId: from.id, toCountry: 'Elsewhere' },
    })

    await c.admin.chapters.reassign({ volunteerId: lead.id, chapterId: to.id })
    expect(await prisma.volunteer.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({
      nationalChapterId: to.id,
      country: to.country,
      localGroupId: null,
    })
    expect(
      (await prisma.nationalChapter.findUniqueOrThrow({ where: { id: from.id } })).leadId,
    ).toBeNull()
    expect(
      (await prisma.chapterTransferRequest.findFirstOrThrow({ where: { volunteerId: lead.id } }))
        .status,
    ).toBe('cancelled')
    expect(await actions(from.id)).toEqual(['LEAD_REMOVED'])
    expect(await actions(to.id)).toEqual(['VOLUNTEER_REASSIGNED'])

    // Moving to where they already are changes nothing; the pool keeps the country they gave.
    await c.admin.chapters.reassign({ volunteerId: lead.id, chapterId: to.id })
    expect(await actions(to.id)).toEqual(['VOLUNTEER_REASSIGNED'])
    const deputy = await createChapterDeputy(to)
    await c.admin.chapters.reassign({ volunteerId: deputy.id, chapterId: null })
    expect(await prisma.volunteer.findUniqueOrThrow({ where: { id: deputy.id } })).toMatchObject({
      nationalChapterId: null,
      country: to.country,
    })
    expect(await prisma.chapterDeputy.findUnique({ where: { volunteerId: deputy.id } })).toBeNull()

    await expect(
      c.admin.chapters.reassign({ volunteerId: 999_999, chapterId: to.id }),
    ).rejects.toMatchObject(notFound)
    await expect(
      c.admin.chapters.reassign({ volunteerId: lead.id, chapterId: 999_999 }),
    ).rejects.toMatchObject(notFound)
  })
})

describe('admin.chapters for chapter staff', () => {
  it('lets a lead appoint and remove deputies in their own chapter only', async () => {
    const chapter = await createChapter()
    const other = await createChapter()
    const lead = await createChapterLead(chapter)
    const member = await createMember(chapter, { name: 'Mo' })
    const c = clientAs(lead)

    expect(
      await c.admin.chapters.appointDeputy({ chapterId: chapter.id, volunteerId: member.id }),
    ).toEqual({ message: 'Mo is now a deputy' })
    await expect(
      c.admin.chapters.appointDeputy({ chapterId: chapter.id, volunteerId: member.id }),
    ).rejects.toMatchObject({ message: 'Mo is already a deputy' })
    await expect(
      c.admin.chapters.appointDeputy({ chapterId: chapter.id, volunteerId: lead.id }),
    ).rejects.toMatchObject({ message: `${lead.name} already leads this chapter` })

    const page = await c.admin.chapters.get({ chapterId: chapter.id })
    expect(page).toMatchObject({ name: chapter.name, leadId: lead.id, canAppointDeputies: true })
    expect(page.members.map((m) => [m.id, m.role])).toEqual(
      expect.arrayContaining([
        [lead.id, 'LEAD'],
        [member.id, 'DEPUTY'],
      ]),
    )

    expect(
      await c.admin.chapters.removeDeputy({ chapterId: chapter.id, volunteerId: member.id }),
    ).toEqual({ message: 'Deputy removed' })
    await expect(
      c.admin.chapters.removeDeputy({ chapterId: chapter.id, volunteerId: member.id }),
    ).rejects.toMatchObject(notFound)

    // Another chapter is not theirs to see or run.
    await expect(c.admin.chapters.get({ chapterId: other.id })).rejects.toMatchObject(notFound)
    const theirs = await createMember(other)
    await expect(
      c.admin.chapters.appointDeputy({ chapterId: other.id, volunteerId: theirs.id }),
    ).rejects.toMatchObject(notFound)
    await expect(
      c.admin.chapters.appointLead({ chapterId: chapter.id, volunteerId: member.id }),
    ).rejects.toMatchObject(forbidden)
    expect(await actions(chapter.id)).toEqual(['DEPUTY_APPOINTED', 'DEPUTY_REMOVED'])
  })

  it('lets a deputy see the chapter but not change its staff', async () => {
    const chapter = await createChapter()
    const deputy = await createChapterDeputy(chapter)
    const member = await createMember(chapter)
    const c = clientAs(deputy)
    expect((await c.admin.chapters.get({ chapterId: chapter.id })).canAppointDeputies).toBe(false)
    await expect(
      c.admin.chapters.appointDeputy({ chapterId: chapter.id, volunteerId: member.id }),
    ).rejects.toMatchObject({ ...forbidden, message: 'Only the chapter lead appoints deputies' })
    await expect(
      c.admin.chapters.invite({ email: 'x@example.com', chapterId: chapter.id, role: 'DEPUTY' }),
    ).rejects.toMatchObject(forbidden)
    await expect(c.admin.chapters.list()).rejects.toMatchObject(forbidden)
    await expect(
      clientAs(member).admin.chapters.get({ chapterId: chapter.id }),
    ).rejects.toMatchObject(forbidden)
  })

  it('shows staff their own chapter’s history and a global admin anyone’s', async () => {
    const [mine, theirs] = [await createChapter(), await createChapter()]
    const lead = await createChapterLead(mine)
    const admin = clientAs(await createAdmin())
    await admin.admin.chapters.appointDeputy({
      chapterId: mine.id,
      volunteerId: (await createMember(mine, { name: 'Dee' })).id,
    })
    await admin.admin.chapters.appointLead({
      chapterId: theirs.id,
      volunteerId: (await createMember(theirs)).id,
    })

    const own = await clientAs(lead).admin.chapters.audit({ chapterId: theirs.id })
    expect(own).toEqual([
      expect.objectContaining({
        action: 'DEPUTY_APPOINTED',
        targetName: 'Dee',
        chapterName: mine.name,
      }),
    ])
    expect(
      (await admin.admin.chapters.audit({ chapterId: theirs.id })).map((e) => e.action),
    ).toEqual(['LEAD_APPOINTED'])
    expect((await admin.admin.chapters.audit({})).length).toBeGreaterThanOrEqual(2)
  })
})

describe('admin.chapters invites', () => {
  it('lets a lead invite deputies, and a global admin a lead', async () => {
    const chapter = await createChapter()
    const lead = await createChapterLead(chapter)
    const c = clientAs(lead)

    const sent = await c.admin.chapters.invite({
      email: 'New@Example.com',
      chapterId: chapter.id,
      role: 'DEPUTY',
    })
    expect(sent.message).toBe('Invite sent for new@example.com')
    expect(sent._dev_invite_url).toContain('/accept-invite?token=')
    expect(emails.lastTo('new@example.com')).toMatchObject({
      subject: `${lead.name} invited you to be a deputy lead of the ${chapter.name} chapter`,
    })
    await expect(
      c.admin.chapters.invite({ email: 'new@example.com', chapterId: chapter.id, role: 'DEPUTY' }),
    ).rejects.toMatchObject({ message: 'An invite is already pending for this email' })
    await expect(
      c.admin.chapters.invite({ email: 'lead@example.com', chapterId: chapter.id, role: 'LEAD' }),
    ).rejects.toMatchObject({ ...forbidden, message: 'Only a global admin appoints a lead' })

    const page = await c.admin.chapters.get({ chapterId: chapter.id })
    expect(page.invites).toEqual([
      expect.objectContaining({
        email: 'new@example.com',
        role: 'DEPUTY',
        invitedByName: lead.name,
      }),
    ])
    expect(page.invites[0]).not.toHaveProperty('inviteToken')

    const admin = clientAs(await createAdmin())
    await admin.admin.chapters.invite({
      email: 'boss@example.com',
      chapterId: chapter.id,
      role: 'LEAD',
    })
    expect(emails.lastTo('boss@example.com')!.html).toContain('Appoint deputies')
    expect(await actions(chapter.id)).toEqual(['ROLE_INVITE_SENT', 'ROLE_INVITE_SENT'])
  })

  it('lets the chapter’s lead or a global admin cancel a pending invite', async () => {
    const chapter = await createChapter()
    const lead = await createChapterLead(chapter)
    const otherLead = await createChapterLead(await createChapter())
    await clientAs(lead).admin.chapters.invite({
      email: 'cancel@example.com',
      chapterId: chapter.id,
      role: 'DEPUTY',
    })
    const [invite] = (await clientAs(lead).admin.chapters.get({ chapterId: chapter.id })).invites

    await expect(
      clientAs(otherLead).admin.chapters.revokeInvite({ id: invite.id }),
    ).rejects.toMatchObject(notFound)
    expect(await clientAs(lead).admin.chapters.revokeInvite({ id: invite.id })).toEqual({
      message: 'Invite revoked',
    })
    await expect(
      clientAs(lead).admin.chapters.revokeInvite({ id: invite.id }),
    ).rejects.toMatchObject(notFound)
  })
})
