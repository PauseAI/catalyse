import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createAdmin,
  createChapter,
  createChapterDeputy,
  createChapterLead,
  createMember,
  createProject,
  createTask,
  createVolunteer,
} from '@/test/factories'
import { clientAs } from '@/test/rpc'

type Caller = Parameters<typeof clientAs>[0]

const refused = { code: 'FORBIDDEN' }

/** A chapter's project with an owner, a proposer, a helper made a deputy, and a bystander. */
async function setup() {
  const chapter = await createChapter()
  const owner = await createMember(chapter)
  const proposer = await createMember(chapter)
  const helper = await createMember(chapter)
  const bystander = await createMember(chapter)
  const project = await createProject({
    title: 'Timeline toggle',
    status: 'in_progress',
    assigneeId: owner.id,
    creatorId: proposer.id,
    nationalChapterId: chapter.id,
  })
  await createTask(project.id, { startDate: new Date('2027-03-01T00:00:00Z') })
  await prisma.workItemInterest.create({
    data: {
      workItemId: project.id,
      volunteerId: helper.id,
      interestType: 'want_to_contribute',
      status: 'accepted',
    },
  })
  await prisma.projectDeputy.create({
    data: { projectId: project.id, volunteerId: helper.id, appointedById: owner.id },
  })
  return { chapter, owner, proposer, helper, bystander, project }
}

const shown = async (id: number) =>
  (await prisma.workItem.findUniqueOrThrow({ where: { id } })).showTimeline

describe("a project's Show timeline setting", () => {
  it('is off for a new project', async () => {
    const me = await createVolunteer()
    await clientAs(me).projects.create({
      title: 'Fresh proposal',
      description: 'desc',
      projectType: 'sprint',
      estimatedDuration: '1 week',
      timeCommitmentHoursPerWeek: 2,
      urgency: 'medium',
      collaborationLink: null,
      isSeekingHelp: true,
    })
    const made = await prisma.workItem.findFirstOrThrow({ where: { creatorId: me.id } })
    expect(made.showTimeline).toBe(false)
  })

  it("is changed by the owner, the chapter's lead and deputies and a global admin, and recorded", async () => {
    const { chapter, owner, project } = await setup()
    const toggle = (as: Caller, showTimeline: boolean) =>
      clientAs(as).projects.update({ id: project.id, showTimeline })

    expect((await clientAs(owner).projects.getById({ id: project.id })).showTimeline).toBe(false)
    await toggle(owner, true)
    expect(await shown(project.id)).toBe(true)
    expect((await clientAs(owner).projects.getById({ id: project.id })).showTimeline).toBe(true)
    await toggle(await createChapterLead(chapter), false)
    expect(await shown(project.id)).toBe(false)
    await toggle(await createChapterDeputy(chapter), true)
    expect(await shown(project.id)).toBe(true)
    await toggle(await createAdmin(), false)
    expect(await shown(project.id)).toBe(false)

    const events = await prisma.workItemEvent.findMany({
      where: { workItemId: project.id },
      orderBy: { id: 'asc' },
    })
    expect(events.map((e) => e.after)).toEqual([
      { showTimeline: true },
      { showTimeline: false },
      { showTimeline: true },
      { showTimeline: false },
    ])
  })

  it('is refused to the proposer, a deputy, a member and staff of another chapter', async () => {
    const { proposer, helper, bystander, project } = await setup()
    const toggle = (as: Caller) =>
      clientAs(as).projects.update({ id: project.id, showTimeline: true })

    await expect(toggle(proposer)).rejects.toMatchObject({
      ...refused,
      message: 'Only the project owner or an admin can show or hide the timeline',
    })
    await expect(toggle(helper)).rejects.toMatchObject(refused)
    await expect(toggle(bystander)).rejects.toMatchObject(refused)
    await expect(toggle(await createChapterLead(await createChapter()))).rejects.toMatchObject(
      refused,
    )
    expect(await shown(project.id)).toBe(false)

    // Sending the value it already has is no change, so the proposer's edit form may post it back.
    await clientAs(proposer).projects.update({ id: project.id, showTimeline: false })
  })
})

describe("a project's timeline", () => {
  it('is open to anyone who can see the project once shown, and to its planners while hidden', async () => {
    const { owner, helper, bystander, project } = await setup()
    const timeline = (as: Caller) => clientAs(as).projects.listTasks({ projectId: project.id })

    await expect(timeline(bystander)).rejects.toMatchObject({
      ...refused,
      message: "This project's timeline is hidden",
    })
    // The owner and a deputy plan the tasks, and replan one from its own page.
    expect((await timeline(owner)).canManageTasks).toBe(true)
    expect((await timeline(helper)).canManageTasks).toBe(true)

    await clientAs(owner).projects.update({ id: project.id, showTimeline: true })
    const seen = await timeline(bystander)
    expect(seen.tasks).toHaveLength(1)
    expect(seen.canManageTasks).toBe(false)
  })
})

describe('the all-projects timeline', () => {
  it("shows a chapter's lead and deputies their chapter, and refuses everyone else", async () => {
    const [chapter, other] = [await createChapter(), await createChapter()]
    const ours = await createProject({ durationDays: 2, nationalChapterId: chapter.id })
    const theirs = await createProject({ durationDays: 2, nationalChapterId: other.id })
    const seenBy = async (as: Caller) =>
      (await clientAs(as).projects.ganttOverview({})).projects.map((p) => p.id)

    for (const staff of [await createChapterLead(chapter), await createChapterDeputy(chapter)]) {
      const ids = await seenBy(staff)
      expect(ids).toContain(ours.id)
      expect(ids).not.toContain(theirs.id)
    }
    expect(await seenBy(await createAdmin())).toEqual(expect.arrayContaining([ours.id, theirs.id]))

    const owner = await createMember(chapter)
    await prisma.workItem.update({ where: { id: ours.id }, data: { assigneeId: owner.id } })
    for (const member of [await createMember(chapter), owner, await createVolunteer()]) {
      await expect(clientAs(member).projects.ganttOverview({})).rejects.toMatchObject(refused)
    }
  })
})
