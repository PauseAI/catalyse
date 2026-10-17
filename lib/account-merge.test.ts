import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  chapterFor,
  createChapter,
  createChapterDeputy,
  createLocalGroup,
  createProject,
  createSkill,
  createTask,
  createTeam,
  createVolunteer,
} from '@/test/factories'
import {
  MERGE_REFERENCES,
  mergeAccounts,
  mergeProfiles,
  volunteerReferences,
} from './account-merge'

const DAY = 24 * 60 * 60 * 1000

describe('MERGE_REFERENCES', () => {
  it('names every column that references a volunteer, and nothing else', async () => {
    const columns = (await volunteerReferences()).map((r) => `${r.table}.${r.column}`)
    expect(Object.keys(MERGE_REFERENCES).sort()).toEqual(columns.sort())
  })
})

describe('mergeAccounts', () => {
  it('moves everything to the kept account and deletes the merged one', async () => {
    const actor = await createVolunteer()
    const kept = await createVolunteer({
      name: 'Sam Example',
      bio: 'Kept bio',
      discordHandle: null,
      approvalStatus: 'pending',
      consentContactableByProjectOwners: true,
      createdAt: new Date(Date.now() - DAY),
    })
    const merged = await createVolunteer({
      name: 'Sam Example',
      bio: 'Merged bio',
      discordHandle: 'merged#1',
      consentContactableByProjectOwners: false,
      createdAt: new Date(Date.now() - 10 * DAY),
      lastActiveAt: new Date(),
      duplicateOfId: kept.id,
    })
    const third = await createVolunteer({ duplicateOfId: merged.id })
    const stranger = await createVolunteer()

    const [shared, only] = [await createTeam(), await createTeam()]
    await prisma.teamMembership.createMany({
      data: [
        { teamId: shared.id, volunteerId: kept.id },
        { teamId: shared.id, volunteerId: merged.id },
        { teamId: only.id, volunteerId: merged.id },
      ],
    })
    const skill = await createSkill()
    await prisma.volunteerSkill.createMany({
      data: [
        { volunteerId: kept.id, skillId: skill.id },
        { volunteerId: merged.id, skillId: skill.id },
      ],
    })
    const project = await createProject({ creatorId: merged.id })
    const task = await createTask(project.id, { assigneeId: merged.id })
    await prisma.notification.create({
      data: { volunteerId: merged.id, type: 'mention', title: 'Hi' },
    })
    await prisma.session.create({
      data: { volunteerId: merged.id, tokenHash: 'merged-session', expiresAt: new Date() },
    })
    await prisma.distinctAccountPair.create({
      data: { volunteerAId: merged.id, volunteerBId: stranger.id, dismissedById: merged.id },
    })

    const { merge } = await mergeAccounts(kept.id, merged.id, actor.id)

    expect(
      await prisma.teamMembership.findMany({
        where: { volunteerId: kept.id },
        select: { teamId: true },
        orderBy: { teamId: 'asc' },
      }),
    ).toEqual([{ teamId: shared.id }, { teamId: only.id }])
    expect(await prisma.volunteerSkill.count({ where: { volunteerId: kept.id } })).toBe(1)
    expect(await prisma.workItem.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({
      assigneeId: kept.id,
    })
    expect(await prisma.workItem.findUniqueOrThrow({ where: { id: project.id } })).toMatchObject({
      creatorId: kept.id,
    })
    expect(await prisma.notification.count({ where: { volunteerId: kept.id } })).toBe(1)
    expect(await prisma.session.count({ where: { volunteerId: merged.id } })).toBe(0)
    expect(
      (await prisma.volunteer.findUniqueOrThrow({ where: { id: third.id } })).duplicateOfId,
    ).toBe(kept.id)
    expect(
      await prisma.distinctAccountPair.findMany({
        where: { OR: [{ volunteerAId: stranger.id }, { volunteerBId: stranger.id }] },
      }),
    ).toEqual([
      expect.objectContaining({
        volunteerAId: Math.min(kept.id, stranger.id),
        volunteerBId: Math.max(kept.id, stranger.id),
        dismissedById: kept.id,
      }),
    ])

    const after = await prisma.volunteer.findUniqueOrThrow({ where: { id: kept.id } })
    expect(after).toMatchObject({
      bio: 'Kept bio',
      discordHandle: 'merged#1',
      consentContactableByProjectOwners: false,
      approvalStatus: 'approved',
      createdAt: merged.createdAt,
      lastActiveAt: merged.lastActiveAt,
    })
    expect(merge.conflicts).toEqual([
      { field: 'bio', kept: 'Kept bio', merged: 'Merged bio' },
      { field: 'consentContactableByProjectOwners', kept: true, merged: false },
    ])
    expect(await prisma.volunteer.findUniqueOrThrow({ where: { id: merged.id } })).toMatchObject({
      mergedIntoId: kept.id,
      duplicateOfId: null,
      passwordHash: null,
      deletedAt: expect.any(Date),
      email: merged.email,
    })
    expect(
      await prisma.adminNote.findMany({
        where: { authorId: actor.id },
        select: { volunteerId: true, content: true },
        orderBy: { id: 'asc' },
      }),
    ).toEqual([
      {
        volunteerId: kept.id,
        content: `Merged ${merged.name} (${merged.email}) into this account.`,
      },
      { volunteerId: merged.id, content: `Merged into ${kept.name} (${kept.email}).` },
    ])
  })

  it('clears a mark that pointed the kept account at the merged one', async () => {
    const merged = await createVolunteer()
    const kept = await createVolunteer({ duplicateOfId: merged.id })
    await mergeAccounts(kept.id, merged.id, kept.id)
    expect(
      (await prisma.volunteer.findUniqueOrThrow({ where: { id: kept.id } })).duplicateOfId,
    ).toBe(null)
  })

  it("cancels the merged account's transfer request when the kept one has its own", async () => {
    const [kept, merged] = [await createVolunteer(), await createVolunteer()]
    const a = await prisma.chapterTransferRequest.create({
      data: { volunteerId: kept.id, toCountry: 'FR' },
    })
    const b = await prisma.chapterTransferRequest.create({
      data: { volunteerId: merged.id, toCountry: 'FR' },
    })
    await mergeAccounts(kept.id, merged.id, kept.id)
    expect(
      await prisma.chapterTransferRequest.findMany({
        where: { id: { in: [a.id, b.id] } },
        select: { id: true, status: true, volunteerId: true },
        orderBy: { id: 'asc' },
      }),
    ).toEqual([
      { id: a.id, status: 'pending', volunteerId: kept.id },
      { id: b.id, status: 'cancelled', volunteerId: kept.id },
    ])
  })

  it('refuses an account merged into itself, a missing account, and a chapter role', async () => {
    const kept = await createVolunteer()
    await expect(mergeAccounts(kept.id, kept.id, kept.id)).rejects.toMatchObject({
      message: 'An account cannot be merged into itself',
    })
    const gone = await createVolunteer({ deletedAt: new Date() })
    await expect(mergeAccounts(kept.id, gone.id, kept.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    const deputy = await createChapterDeputy(await createChapter())
    await expect(mergeAccounts(kept.id, deputy.id, kept.id)).rejects.toMatchObject({
      message: expect.stringContaining('holds a chapter role'),
    })
    expect((await prisma.volunteer.findUniqueOrThrow({ where: { id: deputy.id } })).deletedAt).toBe(
      null,
    )
  })

  it('refuses every merge while a reference has no policy', async () => {
    const [kept, merged] = [await createVolunteer(), await createVolunteer()]
    await prisma.$executeRawUnsafe(
      'CREATE TABLE unlisted_refs (volunteer_id int REFERENCES volunteers(id))',
    )
    try {
      await expect(mergeAccounts(kept.id, merged.id, kept.id)).rejects.toThrow(
        'No merge policy for unlisted_refs.volunteer_id',
      )
    } finally {
      await prisma.$executeRawUnsafe('DROP TABLE unlisted_refs')
    }
  })
})

describe('mergeProfiles', () => {
  const base = {
    id: 1,
    name: 'Sam',
    email: 'sam@example.com',
    deletedAt: null,
    country: null,
    nationalChapterId: null,
    localGroupId: null,
    locationConfirmedAt: null,
    approvalStatus: 'approved' as const,
    createdAt: null,
    lastActiveAt: null,
    bio: null,
    location: null,
    discordHandle: null,
    signalNumber: null,
    whatsappNumber: null,
    contactPreference: null,
    contactNotes: null,
    availabilityHoursPerWeek: null,
    otherSkills: null,
    consentMakeProfileVisibleInDirectory: null,
    consentContactableByProjectOwners: null,
    consentShareContactInfoWithProjectOwner: null,
  }

  it("takes the merged account's chapter when the kept one has none", async () => {
    const chapter = await chapterFor('FR')
    const group = await createLocalGroup({ country: 'FR' })
    const confirmed = new Date()
    const merged = {
      ...base,
      country: 'FR',
      nationalChapterId: chapter.id,
      localGroupId: group.id,
      locationConfirmedAt: confirmed,
    }
    expect(mergeProfiles(base, merged).update).toMatchObject({
      country: 'FR',
      chapter: { connect: { id: chapter.id } },
      group: { connect: { id: group.id } },
      locationConfirmedAt: confirmed,
    })
    expect(mergeProfiles(base, { ...base, country: 'XX' }).update).toMatchObject({
      country: 'XX',
      chapter: undefined,
      group: undefined,
    })
  })

  it('fills a local group and a confirmed location within the same country', () => {
    const confirmed = new Date()
    const kept = { ...base, country: 'UK', nationalChapterId: 1 }
    const merged = { ...kept, localGroupId: 7, locationConfirmedAt: confirmed }
    expect(mergeProfiles(kept, merged).update).toEqual({
      group: { connect: { id: 7 } },
      locationConfirmedAt: confirmed,
    })
    expect(mergeProfiles(merged, { ...kept, country: 'FR' }).update).toEqual({})
  })
})
