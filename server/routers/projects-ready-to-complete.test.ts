import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { categoryOf } from '@/lib/notification-categories'
import { createVolunteer, createAdmin, createProject, createTask } from '@/test/factories'
import { clientAs } from '@/test/rpc'

const READY = 'project_ready_to_complete'

/** A running project with an accepted helper holding its one open task, beside a done one. */
async function nearlyDone(overrides: Parameters<typeof createProject>[0] = {}) {
  const [owner, helper, admin] = await Promise.all([
    createVolunteer(),
    createVolunteer(),
    createAdmin(),
  ])
  const project = await createProject({ assigneeId: owner.id, status: 'in_progress', ...overrides })
  await prisma.workItemInterest.create({
    data: {
      workItemId: project.id,
      volunteerId: helper.id,
      interestType: 'want_to_contribute',
      status: 'accepted',
    },
  })
  const done = await createTask(project.id, {
    status: 'completed',
    completedAt: new Date('2026-09-01T12:00:00Z'),
    isAnchor: true,
  })
  const last = await createTask(project.id, { assigneeId: helper.id, status: 'in_progress' })
  return { owner, helper, admin, project, done, last }
}

const asks = (projectId: number) =>
  prisma.notification.findMany({ where: { type: READY, entityId: projectId } })

describe('ready to complete', () => {
  it('asks the owner once when the last task is marked done', async () => {
    const { owner, project, done, last } = await nearlyDone({ title: 'Leaflets' })
    expect(categoryOf(READY)).toBe('needs_action')

    await clientAs(owner).projects.updateTask({
      projectId: project.id,
      taskId: last.id,
      data: { status: 'completed' },
    })
    expect(await asks(project.id)).toEqual([
      expect.objectContaining({
        volunteerId: owner.id,
        title: "Every task on 'Leaflets' is done",
        body: 'Ready to complete the project?',
        link: `/projects/${project.id}`,
        readAt: null,
      }),
    ])

    const shown = (await clientAs(owner).projects.getById({ id: project.id })).allTasksDone
    expect(shown).toEqual({
      count: 2,
      includesKeyDate: true,
      lastDoneAt: (await prisma.workItem.findUniqueOrThrow({ where: { id: last.id } })).completedAt,
    })
    expect(shown?.lastDoneAt.getTime()).toBeGreaterThan(done.completedAt!.getTime())
  })

  it('does not ask again while the owner already has the ask', async () => {
    const { owner, project, last } = await nearlyDone()
    await prisma.notification.create({
      data: { volunteerId: owner.id, type: READY, title: 'Earlier', entityId: project.id },
    })
    await clientAs(owner).projects.updateTask({
      projectId: project.id,
      taskId: last.id,
      data: { status: 'completed' },
    })
    expect((await asks(project.id)).map((n) => n.title)).toEqual(['Earlier'])
  })

  it('asks when the last task is handed in and accepted, or done straight away', async () => {
    const reviewed = await nearlyDone({ autoAcceptTasks: false })
    await clientAs(reviewed.helper).projects.submitTask({
      projectId: reviewed.project.id,
      taskId: reviewed.last.id,
      note: 'Posted',
    })
    expect(await asks(reviewed.project.id)).toEqual([])
    await clientAs(reviewed.owner).projects.acceptTask({
      projectId: reviewed.project.id,
      taskId: reviewed.last.id,
    })
    expect(await asks(reviewed.project.id)).toHaveLength(1)

    const auto = await nearlyDone()
    await clientAs(auto.helper).projects.submitTask({
      projectId: auto.project.id,
      taskId: auto.last.id,
      note: 'Posted',
    })
    expect(await asks(auto.project.id)).toEqual([
      expect.objectContaining({ volunteerId: auto.owner.id }),
    ])
  })

  it('does not ask while a task is open, for a project not running, or with no owner', async () => {
    const twoOpen = await nearlyDone()
    const other = await createTask(twoOpen.project.id, { status: 'in_progress' })
    await clientAs(twoOpen.owner).projects.updateTask({
      projectId: twoOpen.project.id,
      taskId: other.id,
      data: { status: 'completed' },
    })
    expect(await asks(twoOpen.project.id)).toEqual([])

    const held = await nearlyDone({ status: 'on_hold' })
    await clientAs(held.owner).projects.updateTask({
      projectId: held.project.id,
      taskId: held.last.id,
      data: { status: 'completed' },
    })
    expect(await asks(held.project.id)).toEqual([])
    expect(
      (await clientAs(held.owner).projects.getById({ id: held.project.id })).allTasksDone,
    ).toBe(null)

    const ownerless = await nearlyDone({ assigneeId: null })
    await clientAs(ownerless.admin).projects.updateTask({
      projectId: ownerless.project.id,
      taskId: ownerless.last.id,
      data: { status: 'completed' },
    })
    expect(await asks(ownerless.project.id)).toEqual([])
  })

  it('shows the owner and admins, not helpers, and never a project with no tasks', async () => {
    const { owner, helper, admin, project, last } = await nearlyDone()
    await prisma.workItem.update({ where: { id: last.id }, data: { status: 'completed' } })
    const allTasksDone = async (v: Parameters<typeof clientAs>[0]) =>
      (await clientAs(v).projects.getById({ id: project.id })).allTasksDone
    expect(await allTasksDone(owner)).toMatchObject({ count: 2 })
    expect(await allTasksDone(admin)).toMatchObject({ count: 2 })
    expect(await allTasksDone(helper)).toBe(null)

    const empty = await createProject({ assigneeId: owner.id, status: 'in_progress' })
    expect((await clientAs(owner).projects.getById({ id: empty.id })).allTasksDone).toBe(null)
  })

  it('takes the ask back when a task reopens or is added', async () => {
    const { owner, project, done, last } = await nearlyDone()
    const markLastDone = () =>
      clientAs(owner).projects.updateTask({
        projectId: project.id,
        taskId: last.id,
        data: { status: 'completed' },
      })
    await markLastDone()
    await clientAs(owner).projects.reopenTask({ projectId: project.id, taskId: done.id })
    expect(await asks(project.id)).toEqual([])
    expect((await clientAs(owner).projects.getById({ id: project.id })).allTasksDone).toBe(null)

    // Done again: asked again, then a new task takes it back.
    await clientAs(owner).projects.updateTask({
      projectId: project.id,
      taskId: done.id,
      data: { status: 'completed' },
    })
    expect(await asks(project.id)).toHaveLength(1)
    await clientAs(owner).projects.createTask({ projectId: project.id, title: 'One more' })
    expect(await asks(project.id)).toEqual([])
  })

  it('completing the project takes the ask back and locks it', async () => {
    const { owner, project, last } = await nearlyDone()
    await clientAs(owner).projects.updateTask({
      projectId: project.id,
      taskId: last.id,
      data: { status: 'completed' },
    })
    await clientAs(owner).projects.update({ id: project.id, status: 'completed' })
    expect(await asks(project.id)).toEqual([])
    const after = await clientAs(owner).projects.getById({ id: project.id })
    expect(after.status).toBe('completed')
    expect(after.allTasksDone).toBe(null)
  })
})
