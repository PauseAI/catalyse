import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createAdmin,
  createChapter,
  createChapterDeputy,
  createChapterLead,
  createLocalGroup,
  createMember,
  createProject,
  createSuperAdmin,
} from '@/test/factories'
import { clientAs } from '@/test/rpc'

describe('chapter transfers', () => {
  it("asks the destination chapter's staff, who approve the move", async () => {
    const [from, to] = [await createChapter(), await createChapter()]
    const group = await createLocalGroup({ country: from.country, nationalChapterId: from.id })
    const deputy = await createChapterDeputy(from)
    await prisma.volunteer.update({ where: { id: deputy.id }, data: { localGroupId: group.id } })
    const project = await createProject({ nationalChapterId: from.id, assigneeId: deputy.id })
    const destination = await createChapterLead(to)
    const c = clientAs(deputy)

    await expect(c.chapterTransfers.request({ country: from.country })).rejects.toMatchObject({
      message: 'That is already your country',
    })
    await expect(c.chapterTransfers.request({ country: 'Atlantis' })).rejects.toMatchObject({
      message: 'Choose your country from the list',
    })
    expect(await c.chapterTransfers.request({ country: to.country, reason: 'New job' })).toEqual({
      message: 'Request sent',
    })
    await expect(c.chapterTransfers.request({ country: to.country })).rejects.toMatchObject({
      message: 'You already asked to move; cancel that first',
    })
    expect(await c.chapterTransfers.mine()).toMatchObject({
      toCountry: to.country,
      reason: 'New job',
    })
    expect(
      await prisma.notification.count({
        where: { volunteerId: destination.id, type: 'chapter_transfer_request' },
      }),
    ).toBe(1)

    // The chapter they are leaving does not decide.
    const leaving = clientAs(await createChapterDeputy(from))
    expect(await leaving.chapterTransfers.list()).toEqual([])
    const lead = clientAs(destination)
    const [request] = await lead.chapterTransfers.list()
    expect(request).toMatchObject({
      volunteer: { id: deputy.id },
      fromChapterName: from.name,
      toChapterName: to.name,
    })
    await expect(
      leaving.chapterTransfers.decide({ id: request.id, approve: true }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })

    expect(await lead.chapterTransfers.decide({ id: request.id, approve: true })).toEqual({
      message: 'Moved',
    })
    expect(await prisma.volunteer.findUniqueOrThrow({ where: { id: deputy.id } })).toMatchObject({
      nationalChapterId: to.id,
      country: to.country,
      localGroupId: null,
    })
    // No longer staff where they were, but still on their project.
    expect(await prisma.chapterDeputy.findUnique({ where: { volunteerId: deputy.id } })).toBeNull()
    expect(
      (await prisma.workItem.findUniqueOrThrow({ where: { id: project.id } })).assigneeId,
    ).toBe(deputy.id)
    expect(
      await prisma.notification.findFirst({
        where: { volunteerId: deputy.id, type: 'chapter_transfer_decided' },
      }),
    ).toMatchObject({ title: `Moved: you're now in ${to.name}` })
    expect(
      (
        await prisma.chapterAuditEvent.findMany({
          where: { targetVolunteerId: deputy.id },
          orderBy: { id: 'asc' },
        })
      ).map((e) => e.action),
    ).toEqual(['DEPUTY_REMOVED', 'TRANSFER_APPROVED'])
    await expect(
      lead.chapterTransfers.decide({ id: request.id, approve: false }),
    ).rejects.toMatchObject({ message: 'This request has already been answered' })
  })

  it('sends a move to a country with no chapter to the global admins, and can be declined or cancelled', async () => {
    const from = await createChapter()
    const member = await createMember(from)
    const admin = await createSuperAdmin()
    const c = clientAs(member)
    await c.chapterTransfers.request({ country: 'Other' })
    expect(
      await prisma.notification.count({
        where: { volunteerId: admin.id, type: 'chapter_transfer_request' },
      }),
    ).toBe(1)
    const [request] = (await clientAs(admin).chapterTransfers.list({ chapter: 'pool' })).filter(
      (r) => r.volunteer.id === member.id,
    )
    expect(request).toMatchObject({ toChapterName: null })
    await clientAs(admin).chapterTransfers.decide({ id: request.id, approve: false, note: 'Sorry' })
    expect(
      await prisma.chapterTransferRequest.findUniqueOrThrow({ where: { id: request.id } }),
    ).toMatchObject({ status: 'declined', decisionNote: 'Sorry' })
    expect(
      (await prisma.volunteer.findUniqueOrThrow({ where: { id: member.id } })).nationalChapterId,
    ).toBe(from.id)

    await c.chapterTransfers.request({ country: 'Ghana' })
    expect(await c.chapterTransfers.cancel()).toEqual({ message: 'Request cancelled' })
    await expect(c.chapterTransfers.cancel()).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await c.chapterTransfers.mine()).toBeNull()

    // Approved into the pool, they keep the country they named.
    await c.chapterTransfers.request({ country: 'Ghana' })
    const [ghana] = (await clientAs(await createAdmin()).chapterTransfers.list({})).filter(
      (r) => r.volunteer.id === member.id,
    )
    await clientAs(admin).chapterTransfers.decide({ id: ghana.id, approve: true })
    expect(await prisma.volunteer.findUniqueOrThrow({ where: { id: member.id } })).toMatchObject({
      nationalChapterId: null,
      country: 'Ghana',
    })
    await expect(
      clientAs(admin).chapterTransfers.decide({ id: 999_999, approve: true }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
