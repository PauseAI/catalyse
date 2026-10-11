import { describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createProject,
  createQuickTask,
  createTask,
  createTeam,
  createVolunteer,
} from '@/test/factories'
import { loadWorkItemSummaries, toWorkItemSummary } from './work-item-summary'

const depend = (predecessorId: number, successorId: number) =>
  prisma.workItemDependency.create({ data: { predecessorId, successorId } })

describe('toWorkItemSummary', () => {
  const row = {
    id: 7,
    parentId: 3,
    title: 'Book the venue',
    status: 'not_started',
    deadline: new Date('2026-10-14T00:00:00Z'),
    completedAt: null,
    assignee: { name: 'Sam' },
  }

  it('links a task under its project', () => {
    expect(toWorkItemSummary({ ...row, type: 'TASK' }, 'ready')).toEqual({
      id: 7,
      projectId: 3,
      title: 'Book the venue',
      type: 'TASK',
      displayStatus: 'ready',
      assigneeName: 'Sam',
      deadline: row.deadline,
      completedAt: null,
      href: '/projects/3/tasks/7',
    })
  })

  it('links a Quick Task on its own, with no project and no assignee', () => {
    expect(
      toWorkItemSummary({ ...row, type: 'QUICK_TASK', parentId: null, assignee: null }, 'open'),
    ).toMatchObject({
      projectId: null,
      type: 'QUICK_TASK',
      assigneeName: null,
      href: '/quick-tasks/7',
    })
  })
})

describe('loadWorkItemSummaries', () => {
  it("gives a task its shown status, from what it waits on, and its assignee's name", async () => {
    const viewer = await createVolunteer()
    const assignee = await createVolunteer({ name: 'Sam Doe' })
    const project = await createProject()
    const first = await createTask(project.id, { title: 'Emergency thing' })
    const then = await createTask(project.id, { assigneeId: assignee.id })
    await depend(first.id, then.id)

    const blocked = await loadWorkItemSummaries([first.id, then.id], viewer)
    expect(blocked.get(first.id)).toMatchObject({ displayStatus: 'ready', assigneeName: null })
    expect(blocked.get(then.id)).toMatchObject({
      displayStatus: 'blocked',
      assigneeName: 'Sam Doe',
      projectId: project.id,
      href: `/projects/${project.id}/tasks/${then.id}`,
    })

    await prisma.workItem.update({ where: { id: first.id }, data: { status: 'completed' } })
    const ready = await loadWorkItemSummaries([then.id], viewer)
    expect(ready.get(then.id)?.displayStatus).toBe('ready')
  })

  it('gives a Quick Task its stored status', async () => {
    const viewer = await createVolunteer()
    const quick = await createQuickTask()
    const summaries = await loadWorkItemSummaries([quick.id], viewer)
    expect(summaries.get(quick.id)).toMatchObject({ displayStatus: 'open', projectId: null })
  })

  it('leaves out what the viewer cannot see, and anything that is not a task', async () => {
    const outsider = await createVolunteer()
    const member = await createVolunteer()
    const team = await createTeam()
    await prisma.teamMembership.create({ data: { teamId: team.id, volunteerId: member.id } })
    const teamProject = await createProject({ teamId: team.id })
    const teamTask = await createTask(teamProject.id)
    const someoneElses = await createQuickTask({ status: 'in_progress', assigneeId: member.id })
    const ids = [teamTask.id, someoneElses.id, teamProject.id, 999_999]

    expect([...(await loadWorkItemSummaries(ids, outsider)).keys()]).toEqual([])
    expect([...(await loadWorkItemSummaries(ids, member)).keys()].sort()).toEqual(
      [teamTask.id, someoneElses.id].sort(),
    )
  })

  it('shows a task with no project to admins only', async () => {
    const admin = await createVolunteer({ isAdmin: true })
    const other = await createVolunteer()
    const orphan = await prisma.workItem.create({
      data: { type: 'TASK', status: 'not_started', title: 'Orphan' },
    })
    expect((await loadWorkItemSummaries([orphan.id], admin)).has(orphan.id)).toBe(true)
    expect((await loadWorkItemSummaries([orphan.id], other)).has(orphan.id)).toBe(false)
  })
})
