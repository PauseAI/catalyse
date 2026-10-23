import { describe, it, expect, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createChapter,
  createChapterLead,
  createMember,
  createProject,
  createTask,
  createSkill,
  createVolunteer,
  createAdmin,
} from '@/test/factories'
import { clientAs } from '@/test/rpc'

vi.mock('@/lib/project-match-notify', () => ({ notifyMatchingVolunteers: vi.fn(async () => {}) }))

const notFound = { code: 'NOT_FOUND' }
const titles = (projects: { title: string }[]) => projects.map((p) => p.title)

async function setup() {
  const [sweden, uk] = [await createChapter(), await createChapter()]
  const skill = await createSkill()
  const withSkill = { skills: { create: [{ skillId: skill.id }] } }
  const owner = await createMember(sweden)
  const inUk = await createMember(uk, withSkill)
  const inSweden = await createMember(sweden, withSkill)
  const project = (title: string, extra: object = {}) =>
    createProject({
      title,
      nationalChapterId: sweden.id,
      assigneeId: owner.id,
      isSeekingHelp: true,
      showTimeline: true,
      skills: { create: [{ skillId: skill.id, isRequired: true }] },
      ...extra,
    })
  const swedish = await project('Scope Swedish')
  const remoteInSweden = await project('Scope remote in Sweden', { reach: 'REMOTE' })
  const pooled = await project('Scope pooled', { nationalChapterId: null })
  const task = await createTask(swedish.id, { title: 'Scope task' })
  return { sweden, uk, owner, inUk, inSweden, swedish, remoteInSweden, pooled, task }
}

describe('projects within a chapter', () => {
  it('are hidden from a volunteer in another chapter on every route, remote or not', async () => {
    const { uk: ukChapter, owner, inUk, swedish, remoteInSweden, pooled, task } = await setup()
    const uk = clientAs(inUk)

    expect(titles((await uk.projects.list({ search: 'Scope' })).projects)).toEqual([])
    const grouped = await uk.projects.listGrouped({ search: 'Scope' })
    expect(grouped.groups.flatMap((g) => titles(g.projects))).toEqual([])
    for (const p of [swedish, remoteInSweden, pooled]) {
      await expect(uk.projects.getById({ id: p.id })).rejects.toMatchObject(notFound)
    }
    await expect(uk.projects.listTasks({ projectId: swedish.id })).rejects.toMatchObject(notFound)
    await expect(
      uk.projects.getTask({ projectId: swedish.id, taskId: task.id }),
    ).rejects.toMatchObject(notFound)
    await expect(uk.workItemComments.list({ workItemId: swedish.id })).rejects.toMatchObject(
      notFound,
    )
    await expect(uk.workItemComments.list({ workItemId: task.id })).rejects.toMatchObject(notFound)
    const ukLead = clientAs(await createChapterLead(ukChapter))
    expect((await ukLead.projects.ganttOverview({})).projects.map((p) => p.id)).not.toContain(
      swedish.id,
    )
    await expect(
      uk.projects.expressInterest({ projectId: swedish.id, interestType: 'want_to_contribute' }),
    ).rejects.toMatchObject(notFound)
    await expect(
      uk.projects.updateTask({
        projectId: swedish.id,
        taskId: task.id,
        data: { assigneeId: inUk.id },
      }),
    ).rejects.toMatchObject(notFound)
    expect(titles((await uk.dashboard.get()).find?.matches.items ?? [])).not.toContain(
      'Scope Swedish',
    )
    // The owner's profile is out of sight too, so their projects never show.
    await expect(uk.volunteers.getById({ id: owner.id })).rejects.toMatchObject(notFound)
  })

  it('are shown to members of the chapter', async () => {
    const { inSweden, swedish, remoteInSweden } = await setup()
    const se = clientAs(inSweden)
    expect(titles((await se.projects.list({ search: 'Scope' })).projects)).toEqual(
      expect.arrayContaining(['Scope Swedish', 'Scope remote in Sweden']),
    )
    expect((await se.projects.getById({ id: remoteInSweden.id })).title).toBe(
      'Scope remote in Sweden',
    )
    expect(titles((await se.dashboard.get()).find?.matches.items ?? [])).toContain('Scope Swedish')
    void swedish
  })

  it('stay visible to someone already on them from before chapters, but take no newcomers', async () => {
    const { owner, inUk, swedish, task } = await setup()
    await expect(
      clientAs(owner).projects.invite({ projectId: swedish.id, volunteerId: inUk.id }),
    ).rejects.toMatchObject({ message: 'They are in another national chapter' })

    await prisma.workItemInterest.create({
      data: {
        workItemId: swedish.id,
        volunteerId: inUk.id,
        interestType: 'want_to_contribute',
        status: 'accepted',
      },
    })
    const uk = clientAs(inUk)
    expect((await uk.projects.getById({ id: swedish.id })).title).toBe('Scope Swedish')
    expect(titles((await uk.projects.list({ search: 'Scope' })).projects)).toContain(
      'Scope Swedish',
    )
    expect((await uk.projects.listTasks({ projectId: swedish.id })).tasks).toHaveLength(1)

    const tasked = await createVolunteer({ country: 'UK' })
    await prisma.workItem.update({ where: { id: task.id }, data: { assigneeId: tasked.id } })
    const t = clientAs(tasked)
    expect((await t.projects.getTask({ projectId: swedish.id, taskId: task.id })).title).toBe(
      'Scope task',
    )
  })
})

describe('a global admin across chapters', () => {
  it('narrows lists to a chapter or the pool, and moves a project with a record of it', async () => {
    const { sweden, uk, swedish, pooled, inUk } = await setup()
    const admin = await createAdmin()
    const c = clientAs(admin)
    const listed = async (chapter?: number | 'pool') =>
      (await c.projects.list({ search: 'Scope', chapter })).projects.map((p) => p.id)
    expect(await listed()).toEqual(expect.arrayContaining([swedish.id, pooled.id]))
    expect(await listed('pool')).toContain(pooled.id)
    expect(await listed('pool')).not.toContain(swedish.id)
    expect(await listed(uk.id)).not.toContain(swedish.id)
    const grouped = await c.projects.listGrouped({ search: 'Scope', chapter: sweden.id })
    const groupedIds = grouped.groups.flatMap((g) => g.projects.map((p) => p.id))
    expect(groupedIds).toContain(swedish.id)
    expect(groupedIds).not.toContain(pooled.id)
    const timeline = await c.projects.ganttOverview({ chapter: 'pool' })
    expect(timeline.projects.map((p) => p.id)).toContain(pooled.id)
    expect(timeline.projects.map((p) => p.id)).not.toContain(swedish.id)

    // A member asking for another chapter gets their own scope all the same.
    expect(
      (await clientAs(inUk).projects.list({ chapter: sweden.id })).projects.map((p) => p.id),
    ).not.toContain(swedish.id)

    await c.projects.update({ id: swedish.id, chapterId: uk.id })
    expect(await prisma.workItem.findUniqueOrThrow({ where: { id: swedish.id } })).toMatchObject({
      nationalChapterId: uk.id,
    })
    expect(
      await prisma.chapterAuditEvent.findFirst({
        where: { action: 'PROJECT_CHAPTER_CHANGED', workItemId: swedish.id },
      }),
    ).toMatchObject({ nationalChapterId: uk.id, actorId: admin.id })
  })

  it("keeps a project's owner in its chapter", async () => {
    const { owner, inUk, swedish } = await setup()
    await expect(
      clientAs(owner).projects.update({ id: swedish.id, assigneeId: inUk.id }),
    ).rejects.toMatchObject({ message: 'They are in another national chapter' })
    await expect(
      clientAs(owner).projects.update({ id: swedish.id, chapterId: null }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})
