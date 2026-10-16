import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createChapter,
  createChapterDeputy,
  createMember,
  createProject,
  createQuickTask,
  createTask,
} from '@/test/factories'
import { clientAs } from '@/test/rpc'

/**
 * A chapter's staff hold admin powers over their own chapter's work and people, and over
 * nothing else: another chapter's, and the holding pool's, are not found (or refused).
 */
async function setup() {
  const [home, away] = [await createChapter(), await createChapter()]
  const deputy = await createChapterDeputy(home)
  const proposer = await createMember(home)
  const outsider = await createMember(away)
  const proposal = (chapterId: number | null) =>
    createProject({
      nationalChapterId: chapterId,
      status: 'pending_review',
      creatorId: proposer.id,
    })
  return {
    home,
    away,
    deputy,
    proposer,
    outsider,
    c: clientAs(deputy),
    ours: await proposal(home.id),
    theirs: await proposal(away.id),
    pooled: await proposal(null),
  }
}

const notFound = { code: 'NOT_FOUND' }

describe("a chapter's staff", () => {
  it("review and run their own chapter's projects, and nobody else's", async () => {
    const { c, ours, theirs, pooled } = await setup()

    expect((await c.projects.getById({ id: ours.id })).viewerCanAdmin).toBe(true)
    await expect(c.projects.getById({ id: theirs.id })).rejects.toMatchObject(notFound)

    const triage = (await c.admin.triage.list()).map((p) => p.id)
    expect(triage).toContain(ours.id)
    for (const p of [theirs, pooled]) expect(triage).not.toContain(p.id)
    const listed = (await c.projects.list({ status: 'pending_review' })).projects.map((p) => p.id)
    expect(listed).toContain(ours.id)
    expect(listed).not.toContain(theirs.id)

    await c.admin.projects.review({ id: ours.id, status: 'approved' })
    expect((await prisma.workItem.findUniqueOrThrow({ where: { id: ours.id } })).status).toBe(
      'ready',
    )
    for (const p of [theirs, pooled]) {
      await expect(c.admin.projects.review({ id: p.id, status: 'approved' })).rejects.toMatchObject(
        notFound,
      )
      await expect(
        c.admin.projects.setOutcome({ id: p.id, outcome: 'successful' }),
      ).rejects.toMatchObject(notFound)
    }

    // An admin-only status change, on a project they neither own nor proposed.
    await createTask(ours.id)
    await c.projects.update({ id: ours.id, status: 'archived' })
    expect((await prisma.workItem.findUniqueOrThrow({ where: { id: ours.id } })).status).toBe(
      'archived',
    )
    await expect(c.projects.delete({ id: theirs.id })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await c.projects.delete({ id: ours.id })).toMatchObject({
      message: expect.stringContaining('deleted'),
    })
  })

  it('create org projects in their chapter, without review', async () => {
    const { c, home } = await setup()
    const made = await c.admin.projects.create({
      title: 'Leafleting',
      description: 'd',
      projectType: null,
      estimatedDuration: null,
      timeCommitmentHoursPerWeek: null,
      urgency: 'medium',
      collaborationLink: null,
      isSeekingHelp: true,
      tasks: [{ title: 'Print' }],
    })
    expect(await prisma.workItem.findUniqueOrThrow({ where: { id: made.id } })).toMatchObject({
      nationalChapterId: home.id,
      status: 'ready',
      isOrgProposed: true,
    })
  })

  it("moderate comments, link tasks and export plans on their chapter's projects", async () => {
    const { c, ours, theirs, proposer } = await setup()
    for (const project of [ours, theirs]) {
      await prisma.workItem.update({ where: { id: project.id }, data: { status: 'ready' } })
    }
    const comment = await prisma.workItemComment.create({
      data: { workItemId: ours.id, authorId: proposer.id, content: 'mine' },
    })
    const elsewhere = await prisma.workItemComment.create({
      data: { workItemId: theirs.id, authorId: proposer.id, content: 'theirs' },
    })
    expect(await c.workItemComments.delete({ id: comment.id })).toMatchObject({
      message: expect.any(String),
    })
    await expect(c.workItemComments.delete({ id: elsewhere.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })

    const [a, b] = [await createTask(ours.id), await createTask(ours.id)]
    expect(await c.dependencies.add({ predecessorId: a.id, successorId: b.id })).toMatchObject({
      predecessorId: a.id,
    })
    const [x, y] = [await createTask(theirs.id), await createTask(theirs.id)]
    await expect(
      c.dependencies.add({ predecessorId: x.id, successorId: y.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    expect(await c.projects.exportPlan({ projectId: ours.id })).toMatchObject({
      project: expect.any(Object),
    })
    await expect(c.projects.exportPlan({ projectId: theirs.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it("see their chapter's numbers, interests and people, and keep notes on them", async () => {
    const { c, deputy, ours, theirs, proposer, outsider, home } = await setup()
    await createMember(home, { approvalStatus: 'pending' })
    const counts = await c.admin.overview.counts()
    expect(counts).toMatchObject({ pendingTriage: 1, pendingApplications: 1, openBugReports: 0 })
    expect((await c.admin.stats.get()).projects.total).toBe(1)

    const interest = (workItemId: number, volunteerId: number) =>
      prisma.workItemInterest.create({
        data: { workItemId, volunteerId, interestType: 'want_to_contribute' },
      })
    const mine = await interest(ours.id, proposer.id)
    const notMine = await interest(theirs.id, outsider.id)
    const interests = (await c.admin.interests.list({})).map((i) => i.id)
    expect(interests).toContain(mine.id)
    expect(interests).not.toContain(notMine.id)

    expect((await c.admin.volunteers.getById({ id: proposer.id })).id).toBe(proposer.id)
    await expect(c.admin.volunteers.getById({ id: outsider.id })).rejects.toMatchObject(notFound)
    await expect(
      c.admin.volunteers.listEndorsements({ volunteerId: outsider.id }),
    ).rejects.toMatchObject(notFound)
    const { id: noteId } = await c.admin.notes.create({ volunteerId: proposer.id, content: 'Keen' })
    expect((await c.admin.notes.listForVolunteer({ volunteerId: proposer.id }))[0]).toMatchObject({
      content: 'Keen',
      authorId: deputy.id,
    })
    await expect(
      c.admin.notes.create({ volunteerId: outsider.id, content: 'Nosy' }),
    ).rejects.toMatchObject(notFound)
    const theirNote = await prisma.adminNote.create({
      data: { volunteerId: outsider.id, authorId: outsider.id, content: 'x' },
    })
    await expect(c.admin.notes.update({ id: theirNote.id, content: 'y' })).rejects.toMatchObject(
      notFound,
    )
    await expect(c.admin.notes.delete({ id: theirNote.id })).rejects.toMatchObject(notFound)
    expect(await c.admin.notes.delete({ id: noteId })).toEqual({ message: 'Note deleted' })
  })

  it('review the quick tasks nobody set in their chapter, from Home', async () => {
    const { c, home, away, proposer } = await setup()
    const submitted = { status: 'under_review', assigneeId: proposer.id, creatorId: null }
    const ours = await createQuickTask({ ...submitted, nationalChapterId: home.id })
    const theirs = await createQuickTask({ ...submitted, nationalChapterId: away.id })
    const attention = (await c.dashboard.get()).attention.map((a) => a.title)
    expect(attention).toEqual(expect.arrayContaining([expect.stringContaining(ours.title)]))
    expect(attention.join(' ')).not.toContain(theirs.title)
    expect((await c.quickTasks.get({ id: ours.id })).viewerCanAdmin).toBe(true)
  })

  it('keep the admin-only kinds of notification out of their own inbox', async () => {
    const { c, deputy } = await setup()
    await prisma.notification.createMany({
      data: [
        { volunteerId: deputy.id, type: 'new_project_proposal', title: 'For the admin page' },
        { volunteerId: deputy.id, type: 'interest_accepted', title: 'For me' },
      ],
    })
    const titles = (await c.notifications.list({})).notifications.map((n) => n.title)
    expect(titles).toContain('For me')
    expect(titles).not.toContain('For the admin page')
    expect((await c.admin.notifications.list()).map((n) => n.title)).toContain('For the admin page')
  })
})
