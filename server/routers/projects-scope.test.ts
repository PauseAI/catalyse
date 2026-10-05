import { describe, it, expect, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createVolunteer, createProject, createTask, createSkill } from '@/test/factories'
import { clientAs } from '@/test/rpc'

vi.mock('@/lib/project-match-notify', () => ({ notifyMatchingVolunteers: vi.fn(async () => {}) }))

const notFound = { code: 'NOT_FOUND' }
const titles = (projects: { title: string }[]) => projects.map((p) => p.title)

async function setup() {
  const skill = await createSkill()
  const withSkill = { skills: { create: [{ skillId: skill.id }] } }
  const owner = await createVolunteer({ country: 'SE' })
  const inUk = await createVolunteer({ country: 'UK', ...withSkill })
  const inSweden = await createVolunteer({ country: 'SE', ...withSkill })
  const project = (title: string, extra: object = {}) =>
    createProject({
      title,
      country: 'SE',
      assigneeId: owner.id,
      isSeekingHelp: true,
      skills: { create: [{ skillId: skill.id, isRequired: true }] },
      ...extra,
    })
  const swedish = await project('Scope Swedish')
  const remoteInSweden = await project('Scope remote in Sweden', { remoteEligibility: 'COUNTRY' })
  const anywhere = await project('Scope anywhere', { remoteEligibility: 'GLOBAL' })
  const task = await createTask(swedish.id, { title: 'Scope task' })
  return { owner, inUk, inSweden, swedish, remoteInSweden, anywhere, task }
}

describe('country-scoped projects', () => {
  it('are hidden from a volunteer in another country on every route', async () => {
    const { owner, inUk, swedish, remoteInSweden, anywhere, task } = await setup()
    const uk = clientAs(inUk)

    expect(titles((await uk.projects.list({ search: 'Scope' })).projects)).toEqual([
      'Scope anywhere',
    ])
    const grouped = await uk.projects.listGrouped({ search: 'Scope' })
    expect(new Set(grouped.groups.flatMap((g) => titles(g.projects)))).toEqual(
      new Set(['Scope anywhere']),
    )
    await expect(uk.projects.getById({ id: swedish.id })).rejects.toMatchObject(notFound)
    await expect(uk.projects.getById({ id: remoteInSweden.id })).rejects.toMatchObject(notFound)
    expect((await uk.projects.getById({ id: anywhere.id })).title).toBe('Scope anywhere')
    await expect(uk.projects.listTasks({ projectId: swedish.id })).rejects.toMatchObject(notFound)
    await expect(
      uk.projects.getTask({ projectId: swedish.id, taskId: task.id }),
    ).rejects.toMatchObject(notFound)
    await expect(uk.workItemComments.list({ workItemId: swedish.id })).rejects.toMatchObject(
      notFound,
    )
    await expect(uk.workItemComments.list({ workItemId: task.id })).rejects.toMatchObject(notFound)
    const timeline = (await uk.projects.ganttOverview({})).projects.map((p) => p.id)
    expect(timeline).toContain(anywhere.id)
    expect(timeline).not.toContain(swedish.id)
    await expect(
      uk.projects.expressInterest({ projectId: swedish.id, interestType: 'want_to_contribute' }),
    ).rejects.toMatchObject(notFound)
    await expect(
      uk.projects.updateTask({
        projectId: swedish.id,
        taskId: task.id,
        data: { assigneeId: inUk.id, status: 'in_progress' },
      }),
    ).rejects.toMatchObject(notFound)
    const suggested = titles((await uk.dashboard.get()).find?.matches.items ?? [])
    expect(suggested).toContain('Scope anywhere')
    expect(suggested).not.toContain('Scope Swedish')
    expect(titles((await uk.volunteers.getById({ id: owner.id })).projects)).toEqual([
      'Scope anywhere',
    ])
  })

  it('are shown to volunteers in the country', async () => {
    const { inSweden, swedish } = await setup()
    const se = clientAs(inSweden)
    expect(titles((await se.projects.list({ search: 'Scope' })).projects)).toContain(
      'Scope Swedish',
    )
    expect((await se.projects.getById({ id: swedish.id })).title).toBe('Scope Swedish')
    expect(titles((await se.dashboard.get()).find?.matches.items ?? [])).toContain('Scope Swedish')
  })

  it('stay visible to someone the owner added, or who holds one of its tasks', async () => {
    const { owner, inUk, swedish, task } = await setup()
    await clientAs(owner).projects.invite({ projectId: swedish.id, volunteerId: inUk.id })
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
    const timeline = (await t.projects.ganttOverview({})).projects.map((p) => p.id)
    expect(timeline).toContain(swedish.id)
  })
})
