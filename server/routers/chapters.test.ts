import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createChapter, createChapterLead, createMember, createVolunteer } from '@/test/factories'
import { clientAs } from '@/test/rpc'
import { ApprovalStatus, ChapterAuditAction } from '@/generated/prisma/enums'

describe('chapters.join', () => {
  it('puts an approved volunteer from the holding pool in the chapter they choose', async () => {
    const chapter = await createChapter()
    const lead = await createChapterLead(chapter)
    const vol = await createVolunteer({ name: 'Bruna', country: 'Brazil' })
    expect(await clientAs(vol).requiredActions.list()).toContainEqual({
      kind: 'choose_chapter',
      id: 'choose_chapter',
    })

    expect(await clientAs(vol).chapters.join({ chapterId: chapter.id })).toEqual({
      message: `You joined ${chapter.name}`,
    })
    expect(await prisma.volunteer.findUniqueOrThrow({ where: { id: vol.id } })).toMatchObject({
      nationalChapterId: chapter.id,
      country: chapter.country,
    })
    expect(
      await prisma.chapterAuditEvent.findFirst({
        where: { nationalChapterId: chapter.id, action: ChapterAuditAction.JOINED_FROM_POOL },
      }),
    ).toMatchObject({ actorId: vol.id, targetVolunteerId: vol.id })
    expect(
      await prisma.notification.findFirst({
        where: { volunteerId: lead.id, type: 'chapter_joined' },
      }),
    ).toMatchObject({
      title: `Bruna joined ${chapter.name} from the holding pool`,
      body: 'They gave their country as Brazil.',
      link: `/admin/volunteers/${vol.id}`,
    })
    const joined = await prisma.volunteer.findUniqueOrThrow({ where: { id: vol.id } })
    expect(await clientAs(joined).requiredActions.list()).not.toContainEqual(
      expect.objectContaining({ kind: 'choose_chapter' }),
    )
  })

  it('tells the chapter when someone gave no country', async () => {
    const chapter = await createChapter()
    const lead = await createChapterLead(chapter)
    const vol = await createVolunteer()
    await clientAs(vol).chapters.join({ chapterId: chapter.id })
    expect(
      await prisma.notification.findFirst({
        where: { volunteerId: lead.id, type: 'chapter_joined' },
      }),
    ).toMatchObject({ body: 'They gave no country.' })
  })

  it('refuses a member of a chapter, a pending applicant, and a chapter that does not exist', async () => {
    const chapter = await createChapter()
    const member = await createMember(chapter)
    await expect(clientAs(member).chapters.join({ chapterId: chapter.id })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })

    const pending = await createVolunteer({ approvalStatus: ApprovalStatus.pending })
    expect(await clientAs(pending).requiredActions.list()).not.toContainEqual(
      expect.objectContaining({ kind: 'choose_chapter' }),
    )
    await expect(clientAs(pending).chapters.join({ chapterId: chapter.id })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })

    await expect(
      clientAs(await createVolunteer()).chapters.join({ chapterId: -1 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
