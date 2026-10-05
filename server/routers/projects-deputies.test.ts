import { describe, it, expect, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createVolunteer, createAdmin, createProject, createTask } from '@/test/factories'
import { clientAs } from '@/test/rpc'

/** An owner, a project, an accepted helper and (optionally) that helper made a deputy. */
async function setup({ deputy = true }: { deputy?: boolean } = {}) {
  const owner = await createVolunteer()
  const helper = await createVolunteer()
  const project = await createProject({ assigneeId: owner.id, status: 'in_progress' })
  await prisma.workItemInterest.create({
    data: {
      volunteerId: helper.id,
      workItemId: project.id,
      interestType: 'want_to_contribute',
      status: 'accepted',
    },
  })
  if (deputy) {
    await prisma.projectDeputy.create({
      data: { projectId: project.id, volunteerId: helper.id, appointedById: owner.id },
    })
  }
  return { owner, helper, project }
}

const notes = (volunteerId: number, type: string) =>
  prisma.notification.findMany({ where: { volunteerId, type } })

/** Some notices go out after the response, so wait for one to land. */
const notedFor = (volunteerId: number, type: string) =>
  vi.waitFor(async () => {
    const found = await notes(volunteerId, type)
    expect(found).toHaveLength(1)
    return found[0]
  })

describe('appointing and removing deputies', () => {
  it('lets the owner or an admin appoint an accepted helper, and tells them', async () => {
    const { owner, helper, project } = await setup({ deputy: false })
    await clientAs(owner).projects.appointDeputy({ projectId: project.id, volunteerId: helper.id })
    expect(
      await prisma.projectDeputy.findFirst({
        where: { projectId: project.id, volunteerId: helper.id },
      }),
    ).toMatchObject({ appointedById: owner.id })
    expect(await notedFor(helper.id, 'deputy_appointed')).toMatchObject({
      title: `${owner.name} made you a deputy on '${project.title}'`,
    })

    const other = await createVolunteer()
    await prisma.workItemInterest.create({
      data: {
        volunteerId: other.id,
        workItemId: project.id,
        interestType: 'want_to_contribute',
        status: 'accepted',
      },
    })
    const admin = await createAdmin()
    await clientAs(admin).projects.appointDeputy({ projectId: project.id, volunteerId: other.id })
    expect(await prisma.projectDeputy.count({ where: { projectId: project.id } })).toBe(2)
  })

  it('refuses everyone but the owner, and anyone who is not an accepted helper', async () => {
    const { owner, helper, project } = await setup({ deputy: false })
    const stranger = await createVolunteer()
    const applicant = await createVolunteer()
    await prisma.workItemInterest.create({
      data: {
        volunteerId: applicant.id,
        workItemId: project.id,
        interestType: 'want_to_contribute',
        status: 'pending',
      },
    })
    const args = { projectId: project.id, volunteerId: helper.id }
    await expect(clientAs(helper).projects.appointDeputy(args)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(
      clientAs(owner).projects.appointDeputy({ projectId: 999_999, volunteerId: helper.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    for (const volunteerId of [stranger.id, applicant.id, owner.id]) {
      await expect(
        clientAs(owner).projects.appointDeputy({ projectId: project.id, volunteerId }),
      ).rejects.toMatchObject({ message: 'Only an accepted helper can be a deputy' })
    }
    await clientAs(owner).projects.appointDeputy(args)
    await expect(clientAs(owner).projects.appointDeputy(args)).rejects.toMatchObject({
      message: 'They are already a deputy',
    })
  })

  it('lets the owner remove a deputy, and the deputy step down, each telling the other', async () => {
    const { owner, helper, project } = await setup()
    await expect(
      clientAs(helper).projects.removeDeputy({ projectId: project.id, volunteerId: helper.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await clientAs(owner).projects.removeDeputy({ projectId: project.id, volunteerId: helper.id })
    await notedFor(helper.id, 'deputy_removed')
    await expect(
      clientAs(owner).projects.removeDeputy({ projectId: project.id, volunteerId: helper.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })

    await expect(
      clientAs(helper).projects.stepDownAsDeputy({ projectId: project.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await prisma.projectDeputy.create({ data: { projectId: project.id, volunteerId: helper.id } })
    await clientAs(helper).projects.stepDownAsDeputy({ projectId: project.id })
    expect(await prisma.projectDeputy.count({ where: { projectId: project.id } })).toBe(0)
    expect(await notedFor(owner.id, 'deputy_removed')).toMatchObject({
      title: `${helper.name} stepped down as a deputy on '${project.title}'`,
    })

    const ownerless = await createProject({ status: 'ready' })
    await prisma.workItemInterest.create({
      data: {
        volunteerId: helper.id,
        workItemId: ownerless.id,
        interestType: 'want_to_contribute',
        status: 'accepted',
      },
    })
    await prisma.projectDeputy.create({
      data: { projectId: ownerless.id, volunteerId: helper.id },
    })
    await clientAs(helper).projects.stepDownAsDeputy({ projectId: ownerless.id })
    expect(await prisma.projectDeputy.count({ where: { projectId: ownerless.id } })).toBe(0)
  })

  it('ends the role when the helper leaves or is removed, and tells the owner', async () => {
    const left = await setup()
    await clientAs(left.helper).projects.withdrawInterest({ projectId: left.project.id })
    expect(await prisma.projectDeputy.count({ where: { projectId: left.project.id } })).toBe(0)
    expect(await notedFor(left.owner.id, 'deputy_removed')).toMatchObject({
      title: `${left.helper.name} is no longer a deputy on '${left.project.title}'`,
    })

    const removed = await setup()
    const interest = await prisma.workItemInterest.findFirstOrThrow({
      where: { workItemId: removed.project.id, volunteerId: removed.helper.id },
    })
    await clientAs(removed.owner).projects.respondToInterest({
      projectId: removed.project.id,
      interestId: interest.id,
      status: 'declined',
    })
    expect(await prisma.projectDeputy.count({ where: { projectId: removed.project.id } })).toBe(0)

    // Someone who was never a deputy leaves without a notice.
    const plain = await setup({ deputy: false })
    await clientAs(plain.helper).projects.withdrawInterest({ projectId: plain.project.id })
    expect(await notes(plain.owner.id, 'deputy_removed')).toHaveLength(0)
  })

  it('stops counting a deputy whose helper role is gone', async () => {
    const { helper, project } = await setup()
    const task = await createTask(project.id)
    await prisma.workItemInterest.updateMany({
      where: { workItemId: project.id, volunteerId: helper.id },
      data: { status: 'withdrawn' },
    })
    await expect(
      clientAs(helper).projects.deleteTask({ projectId: project.id, taskId: task.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('what a deputy can do', () => {
  it('manages tasks: edit, assign, reorder, delete, link and reschedule', async () => {
    const { owner, helper, project } = await setup()
    const deputy = clientAs(helper)
    const a = await createTask(project.id, { sortOrder: 1 })
    const b = await createTask(project.id, { sortOrder: 2 })
    const c = await createTask(project.id, { sortOrder: 3, creatorId: owner.id })

    await deputy.projects.updateTask({
      projectId: project.id,
      taskId: a.id,
      data: { title: 'Renamed', deadline: new Date('2030-01-01T00:00:00Z') },
    })
    expect(await prisma.workItem.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({
      title: 'Renamed',
    })

    const worker = await createVolunteer()
    await deputy.projects.assignTask({ projectId: project.id, taskId: a.id, assigneeId: worker.id })
    expect(await notedFor(worker.id, 'task_assigned')).toMatchObject({
      title: `Assigned by ${helper.name} (deputy): a task on '${project.title}'`,
    })

    await deputy.projects.reorderTasks({
      projectId: project.id,
      items: [
        { id: a.id, sortOrder: 3 },
        { id: b.id, sortOrder: 1 },
      ],
    })

    const dep = await deputy.dependencies.add({ predecessorId: a.id, successorId: b.id })
    await deputy.dependencies.remove({ dependencyId: dep.id })

    await deputy.schedule.rescheduleItems({
      items: [{ id: b.id, startDate: new Date('2030-02-01T00:00:00Z') }],
    })
    await expect(
      deputy.schedule.rescheduleItems({
        items: [{ id: project.id, startDate: new Date('2030-02-01T00:00:00Z') }],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    await deputy.projects.deleteTask({ projectId: project.id, taskId: c.id })
    expect(await prisma.workItem.count({ where: { id: c.id } })).toBe(0)

    expect((await deputy.projects.listTasks({ projectId: project.id })).canManageTasks).toBe(true)
    expect((await deputy.projects.getTask({ projectId: project.id, taskId: b.id })).canManage).toBe(
      true,
    )
  })

  it('leaves a plain helper unable to do the same', async () => {
    const { helper, project } = await setup({ deputy: false })
    const helperClient = clientAs(helper)
    const task = await createTask(project.id, { creatorId: null })
    await expect(
      helperClient.projects.updateTask({
        projectId: project.id,
        taskId: task.id,
        data: { title: 'x' },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      helperClient.projects.assignTask({
        projectId: project.id,
        taskId: task.id,
        assigneeId: helper.id,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      helperClient.projects.reorderTasks({ projectId: project.id, items: [] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      helperClient.projects.deleteTask({ projectId: project.id, taskId: task.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(
      (await helperClient.projects.getTask({ projectId: project.id, taskId: task.id })).canManage,
    ).toBe(false)
  })

  it('never manages the project itself, its people or its plan', async () => {
    const { owner, helper, project } = await setup()
    const deputy = clientAs(helper)
    const applicant = await createVolunteer()
    const interest = await prisma.workItemInterest.create({
      data: {
        volunteerId: applicant.id,
        workItemId: project.id,
        interestType: 'want_to_contribute',
        status: 'pending',
      },
    })
    const forbidden = { code: 'FORBIDDEN' }
    await expect(
      deputy.projects.update({ id: project.id, status: 'on_hold' }),
    ).rejects.toMatchObject(forbidden)
    await expect(
      deputy.projects.respondToInterest({
        projectId: project.id,
        interestId: interest.id,
        status: 'accepted',
      }),
    ).rejects.toMatchObject(forbidden)
    await expect(
      deputy.projects.invite({ projectId: project.id, volunteerId: applicant.id }),
    ).rejects.toMatchObject(forbidden)
    await expect(
      deputy.projects.assign({
        projectId: project.id,
        volunteerId: applicant.id,
        interestType: 'want_to_contribute',
      }),
    ).rejects.toMatchObject(forbidden)
    const task = await createTask(project.id)
    await expect(
      deputy.projects.updateTask({
        projectId: project.id,
        taskId: task.id,
        data: { isAnchor: true },
      }),
    ).rejects.toMatchObject({ message: 'Only the project owner can set the key date' })
    await clientAs(owner).projects.updateTask({
      projectId: project.id,
      taskId: task.id,
      data: { isAnchor: true },
    })
    await expect(deputy.projects.setBaseline({ projectId: project.id })).rejects.toMatchObject(
      forbidden,
    )
    await expect(
      deputy.projects.appointDeputy({ projectId: project.id, volunteerId: owner.id }),
    ).rejects.toMatchObject(forbidden)
  })

  it('shows deputies on the project and the viewer whether they are one', async () => {
    const { owner, helper, project } = await setup()
    const asDeputy = await clientAs(helper).projects.getById({ id: project.id })
    expect(asDeputy).toMatchObject({ isDeputy: true, canManageTasks: true })
    expect(asDeputy.helpers).toEqual([expect.objectContaining({ isDeputy: true })])
    const asOwner = await clientAs(owner).projects.getById({ id: project.id })
    expect(asOwner).toMatchObject({ isDeputy: false, canManageTasks: true })
    const stranger = await createVolunteer()
    expect(await clientAs(stranger).projects.getById({ id: project.id })).toMatchObject({
      isDeputy: false,
      canManageTasks: false,
    })
  })
})

describe('reviewing submitted work', () => {
  it('sends a submission to the owner and every deputy, and resolves it for all', async () => {
    const { owner, helper, project } = await setup()
    const worker = await createVolunteer()
    const task = await createTask(project.id, { assigneeId: worker.id, status: 'in_progress' })
    await prisma.workItem.update({ where: { id: project.id }, data: { autoAcceptTasks: false } })
    await clientAs(worker).projects.submitTask({
      projectId: project.id,
      taskId: task.id,
      note: 'Done it',
    })
    await notedFor(owner.id, 'task_submitted')
    await notedFor(helper.id, 'task_submitted')

    await clientAs(helper).projects.acceptTask({ projectId: project.id, taskId: task.id })
    expect(await notes(owner.id, 'task_submitted')).toHaveLength(0)
    expect(await notes(helper.id, 'task_submitted')).toHaveLength(0)
    expect(await notedFor(worker.id, 'task_accepted')).toMatchObject({
      body: `${helper.name} (deputy) accepted your work`,
    })
  })

  it('lets a deputy send work back, labelled, and the owner review it too', async () => {
    const { owner, helper, project } = await setup()
    const worker = await createVolunteer()
    await prisma.workItem.update({ where: { id: project.id }, data: { autoAcceptTasks: false } })
    const task = await createTask(project.id, { assigneeId: worker.id, status: 'under_review' })
    await expect(
      clientAs(worker).projects.acceptTask({ projectId: project.id, taskId: task.id }),
    ).rejects.toMatchObject({ message: 'Only the project owner or a deputy can review this task' })

    await clientAs(helper).projects.requestTaskChanges({
      projectId: project.id,
      taskId: task.id,
      message: 'Add the link',
    })
    expect(await notedFor(worker.id, 'task_changes_requested')).toMatchObject({
      title: `Changes requested by ${helper.name} (deputy): '${task.title}'`,
    })
    const view = await clientAs(worker).projects.getTask({
      projectId: project.id,
      taskId: task.id,
    })
    expect(view.changesRequested).toEqual({
      message: 'Add the link',
      byName: `${helper.name} (deputy)`,
    })

    // The owner asking for changes is not labelled.
    await prisma.workItem.update({ where: { id: task.id }, data: { status: 'under_review' } })
    await clientAs(owner).projects.requestTaskChanges({
      projectId: project.id,
      taskId: task.id,
      message: 'Again',
    })
    expect(
      (await clientAs(worker).projects.getTask({ projectId: project.id, taskId: task.id }))
        .changesRequested?.byName,
    ).toBe(owner.name)
  })

  it('lets a deputy submit their own task straight to done, telling the owner', async () => {
    const { owner, helper, project } = await setup()
    await prisma.workItem.update({ where: { id: project.id }, data: { autoAcceptTasks: false } })
    const task = await createTask(project.id, { assigneeId: helper.id, status: 'in_progress' })
    const res = await clientAs(helper).projects.submitTask({
      projectId: project.id,
      taskId: task.id,
      note: 'All mine',
    })
    expect(res.status).toBe('completed')
    await notedFor(owner.id, 'task_done')
  })

  it('does not tell a deputy about their own submission', async () => {
    const { helper, owner, project } = await setup()
    const other = await createVolunteer()
    await prisma.workItemInterest.create({
      data: {
        volunteerId: other.id,
        workItemId: project.id,
        interestType: 'want_to_contribute',
        status: 'accepted',
      },
    })
    await prisma.workItem.update({ where: { id: project.id }, data: { autoAcceptTasks: false } })
    const task = await createTask(project.id, { assigneeId: other.id, status: 'in_progress' })
    await clientAs(other).projects.submitTask({
      projectId: project.id,
      taskId: task.id,
      note: 'Please look',
    })
    await notedFor(helper.id, 'task_submitted')
    expect(await notes(other.id, 'task_submitted')).toHaveLength(0)
    await notedFor(owner.id, 'task_submitted')
  })

  it('sends a submission on an ownerless project to its deputies only', async () => {
    const { helper, project } = await setup()
    await prisma.workItem.update({
      where: { id: project.id },
      data: { assigneeId: null, autoAcceptTasks: false },
    })
    const worker = await createVolunteer()
    const task = await createTask(project.id, { assigneeId: worker.id, status: 'in_progress' })
    const res = await clientAs(worker).projects.submitTask({
      projectId: project.id,
      taskId: task.id,
      note: 'Hi',
    })
    expect(res.status).toBe('completed')
    expect(await notes(helper.id, 'task_submitted')).toHaveLength(0)
  })
})

describe('Home', () => {
  it('lists a deputy project as Deputy work and its submissions as work to review', async () => {
    const { helper, project } = await setup()
    const worker = await createVolunteer()
    await createTask(project.id, {
      assigneeId: worker.id,
      status: 'under_review',
      title: 'Needs a look',
    })
    const { work, attention } = await clientAs(helper).dashboard.get()
    expect(work.find((w) => w.title === project.title)).toMatchObject({ role: 'Deputy' })
    expect(attention.filter((a) => a.kind === 'submission').map((a) => a.title)).toEqual([
      '"Needs a look" is submitted for review',
    ])
  })
})
