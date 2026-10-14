import { describe, it, expect, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { REOPEN_PROJECT_TO_CHANGE } from '@/lib/work-item-lock'
import { createVolunteer, createAdmin, createProject, createTask } from '@/test/factories'
import { clientAs } from '@/test/rpc'

const COMPLETED_ON = new Date('2026-09-30T12:00:00Z')

/**
 * A completed project with everyone a lock has to stop: its owner, an accepted helper holding a
 * task, a deputy, someone waiting for an answer and someone invited; tasks in every state, and a
 * link between two of them.
 */
async function lockedProject(status: 'completed' | 'archived' = 'completed') {
  const [owner, helper, deputy, applicant, invitee, stranger, admin] = await Promise.all([
    createVolunteer(),
    createVolunteer(),
    createVolunteer(),
    createVolunteer(),
    createVolunteer(),
    createVolunteer(),
    createAdmin(),
  ])
  const project = await createProject({
    assigneeId: owner.id,
    status,
    completedAt: COMPLETED_ON,
    isSeekingHelp: true,
  })
  const interest = (volunteerId: number, state: 'accepted' | 'pending' | 'invited') =>
    prisma.workItemInterest.create({
      data: {
        volunteerId,
        workItemId: project.id,
        interestType: 'want_to_contribute',
        status: state,
        ...(state === 'invited' ? { origin: 'invited', invitedById: owner.id } : {}),
      },
    })
  await interest(helper.id, 'accepted')
  await interest(deputy.id, 'accepted')
  const applied = await interest(applicant.id, 'pending')
  const invited = await interest(invitee.id, 'invited')
  await prisma.projectDeputy.create({
    data: { projectId: project.id, volunteerId: deputy.id, appointedById: owner.id },
  })
  const open = await createTask(project.id, { startDate: new Date('2026-09-01') })
  const held = await createTask(project.id, { assigneeId: helper.id })
  const working = await createTask(project.id, { assigneeId: helper.id, status: 'in_progress' })
  const handedIn = await createTask(project.id, {
    assigneeId: helper.id,
    status: 'under_review',
    submissionNote: 'Done it',
  })
  const done = await createTask(project.id, { assigneeId: helper.id, status: 'completed' })
  const link = await prisma.workItemDependency.create({
    data: { predecessorId: open.id, successorId: held.id },
  })
  return {
    owner,
    helper,
    deputy,
    applicant,
    invitee,
    stranger,
    admin,
    project,
    applied,
    invited,
    tasks: { open, held, working, handedIn, done },
    link,
  }
}

type Locked = Awaited<ReturnType<typeof lockedProject>>

/**
 * Every procedure that changes a project, its tasks, links, people or schedule, each called by
 * someone it would otherwise allow.
 */
const GUARDED: [string, (l: Locked) => Promise<unknown>][] = [
  [
    'projects.update (an edit)',
    (l) => clientAs(l.owner).projects.update({ id: l.project.id, title: 'Renamed' }),
  ],
  [
    'projects.expressInterest (apply)',
    (l) =>
      clientAs(l.stranger).projects.expressInterest({
        projectId: l.project.id,
        interestType: 'want_to_contribute',
      }),
  ],
  [
    'projects.withdrawInterest (leave)',
    (l) => clientAs(l.helper).projects.withdrawInterest({ projectId: l.project.id }),
  ],
  [
    'projects.withdrawInterest (withdraw a request)',
    (l) => clientAs(l.applicant).projects.withdrawInterest({ projectId: l.project.id }),
  ],
  [
    'projects.respondToInterest (accept)',
    (l) =>
      clientAs(l.owner).projects.respondToInterest({
        projectId: l.project.id,
        interestId: l.applied.id,
        status: 'accepted',
      }),
  ],
  [
    'projects.respondToInterest (remove)',
    async (l) => {
      const helperRow = await prisma.workItemInterest.findFirstOrThrow({
        where: { workItemId: l.project.id, volunteerId: l.helper.id },
      })
      return clientAs(l.owner).projects.respondToInterest({
        projectId: l.project.id,
        interestId: helperRow.id,
        status: 'declined',
      })
    },
  ],
  [
    'projects.invite',
    (l) =>
      clientAs(l.owner).projects.invite({ projectId: l.project.id, volunteerId: l.stranger.id }),
  ],
  [
    'projects.respondToInvite',
    (l) => clientAs(l.invitee).projects.respondToInvite({ projectId: l.project.id, accept: true }),
  ],
  [
    'projects.cancelInvite',
    (l) =>
      clientAs(l.owner).projects.cancelInvite({
        projectId: l.project.id,
        interestId: l.invited.id,
      }),
  ],
  [
    'projects.assign',
    (l) =>
      clientAs(l.admin).projects.assign({ projectId: l.project.id, volunteerId: l.stranger.id }),
  ],
  [
    'projects.createTask',
    (l) => clientAs(l.owner).projects.createTask({ projectId: l.project.id, title: 'One more' }),
  ],
  [
    'projects.reorderTasks',
    (l) =>
      clientAs(l.owner).projects.reorderTasks({
        projectId: l.project.id,
        items: [{ id: l.tasks.open.id, sortOrder: 9 }],
      }),
  ],
  [
    'projects.setBaseline',
    (l) => clientAs(l.owner).projects.setBaseline({ projectId: l.project.id }),
  ],
  [
    'projects.updateTask (edit)',
    (l) =>
      clientAs(l.owner).projects.updateTask({
        projectId: l.project.id,
        taskId: l.tasks.open.id,
        data: { title: 'Renamed' },
      }),
  ],
  [
    'projects.updateTask (claim)',
    (l) =>
      clientAs(l.helper).projects.updateTask({
        projectId: l.project.id,
        taskId: l.tasks.open.id,
        data: { assigneeId: l.helper.id },
      }),
  ],
  [
    'projects.updateTask (release)',
    (l) =>
      clientAs(l.owner).projects.updateTask({
        projectId: l.project.id,
        taskId: l.tasks.working.id,
        data: { status: 'not_started' },
      }),
  ],
  [
    'projects.startTask',
    (l) =>
      clientAs(l.helper).projects.startTask({ projectId: l.project.id, taskId: l.tasks.held.id }),
  ],
  [
    'projects.submitTask',
    (l) =>
      clientAs(l.helper).projects.submitTask({
        projectId: l.project.id,
        taskId: l.tasks.working.id,
        note: 'All done',
      }),
  ],
  [
    'projects.acceptTask',
    (l) =>
      clientAs(l.owner).projects.acceptTask({
        projectId: l.project.id,
        taskId: l.tasks.handedIn.id,
      }),
  ],
  [
    'projects.requestTaskChanges',
    (l) =>
      clientAs(l.owner).projects.requestTaskChanges({
        projectId: l.project.id,
        taskId: l.tasks.handedIn.id,
        message: 'One more pass',
      }),
  ],
  [
    'projects.reopenTask',
    (l) =>
      clientAs(l.owner).projects.reopenTask({ projectId: l.project.id, taskId: l.tasks.done.id }),
  ],
  [
    'projects.assignTask',
    (l) =>
      clientAs(l.deputy).projects.assignTask({
        projectId: l.project.id,
        taskId: l.tasks.open.id,
        assigneeId: l.helper.id,
      }),
  ],
  [
    'projects.replanTask',
    (l) =>
      clientAs(l.owner).projects.replanTask({
        projectId: l.project.id,
        taskId: l.tasks.open.id,
        newEnd: new Date('2026-12-01'),
        reason: 'Slipped',
      }),
  ],
  [
    'projects.deleteTask',
    (l) =>
      clientAs(l.owner).projects.deleteTask({ projectId: l.project.id, taskId: l.tasks.open.id }),
  ],
  [
    'projects.appointDeputy',
    (l) =>
      clientAs(l.owner).projects.appointDeputy({
        projectId: l.project.id,
        volunteerId: l.helper.id,
      }),
  ],
  [
    'projects.removeDeputy',
    (l) =>
      clientAs(l.owner).projects.removeDeputy({
        projectId: l.project.id,
        volunteerId: l.deputy.id,
      }),
  ],
  [
    'projects.stepDownAsDeputy',
    (l) => clientAs(l.deputy).projects.stepDownAsDeputy({ projectId: l.project.id }),
  ],
  [
    'dependencies.add',
    (l) =>
      clientAs(l.owner).dependencies.add({
        predecessorId: l.tasks.open.id,
        successorId: l.tasks.working.id,
        lagDays: 0,
      }),
  ],
  [
    'dependencies.updateLag',
    (l) => clientAs(l.owner).dependencies.updateLag({ dependencyId: l.link.id, lagDays: 2 }),
  ],
  [
    'dependencies.remove',
    (l) => clientAs(l.owner).dependencies.remove({ dependencyId: l.link.id }),
  ],
  [
    'schedule.rescheduleItems (a task)',
    (l) =>
      clientAs(l.owner).schedule.rescheduleItems({
        items: [{ id: l.tasks.open.id, startDate: new Date('2026-10-20') }],
      }),
  ],
  [
    'schedule.rescheduleItems (the project)',
    (l) =>
      clientAs(l.owner).schedule.rescheduleItems({
        items: [{ id: l.project.id, startDate: new Date('2026-10-20') }],
      }),
  ],
  [
    'projects.applyImport',
    (l) =>
      clientAs(l.owner).projects.applyImport({
        projectId: l.project.id,
        file: '{}',
        expectedHash: 'any',
      }),
  ],
]

describe('a completed project is locked', () => {
  it.each(GUARDED)('%s refuses', async (_name, call) => {
    const l = await lockedProject()
    await expect(call(l)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: REOPEN_PROJECT_TO_CHANGE,
    })
  })

  it('an archived project is locked the same way', async () => {
    const l = await lockedProject('archived')
    await expect(
      clientAs(l.helper).projects.withdrawInterest({ projectId: l.project.id }),
    ).rejects.toMatchObject({ message: REOPEN_PROJECT_TO_CHANGE })
  })

  it('a helper stays on it and its tasks stay as they were', async () => {
    const l = await lockedProject()
    await expect(
      clientAs(l.helper).projects.withdrawInterest({ projectId: l.project.id }),
    ).rejects.toThrow()
    await expect(
      clientAs(l.helper).projects.updateTask({
        projectId: l.project.id,
        taskId: l.tasks.open.id,
        data: { assigneeId: l.helper.id },
      }),
    ).rejects.toThrow()
    expect(
      await prisma.workItemInterest.findFirst({
        where: { workItemId: l.project.id, volunteerId: l.helper.id },
      }),
    ).toMatchObject({ status: 'accepted' })
    expect(await prisma.workItem.findUnique({ where: { id: l.tasks.open.id } })).toMatchObject({
      assigneeId: null,
    })
    expect(await prisma.workItem.findUnique({ where: { id: l.tasks.working.id } })).toMatchObject({
      assigneeId: l.helper.id,
    })
  })

  it('a link into another project from a locked one stays editable', async () => {
    const l = await lockedProject()
    const next = await createProject({ assigneeId: l.owner.id, status: 'in_progress' })
    const added = await clientAs(l.owner).dependencies.add({
      predecessorId: l.project.id,
      successorId: next.id,
      lagDays: 0,
    })
    await expect(
      clientAs(l.owner).dependencies.add({
        predecessorId: next.id,
        successorId: l.project.id,
        lagDays: 0,
      }),
    ).rejects.toMatchObject({ message: REOPEN_PROJECT_TO_CHANGE })
    await clientAs(l.owner).dependencies.remove({ dependencyId: added.id })
  })

  it('its Discussion stays open to members', async () => {
    const l = await lockedProject()
    await clientAs(l.helper).workItemComments.add({
      workItemId: l.project.id,
      content: 'Thanks, everyone',
    })
    await clientAs(l.helper).workItemComments.add({
      workItemId: l.tasks.done.id,
      content: 'The write-up is in the doc',
    })
    expect(
      await prisma.workItemComment.count({
        where: { workItemId: { in: [l.project.id, l.tasks.done.id] }, authorId: l.helper.id },
      }),
    ).toBe(2)
  })

  it('an admin still records its outcome', async () => {
    const l = await lockedProject()
    await clientAs(l.admin).admin.projects.setOutcome({ id: l.project.id, outcome: 'successful' })
    expect(await prisma.workItem.findUnique({ where: { id: l.project.id } })).toMatchObject({
      outcome: 'successful',
    })
  })

  it('offers nothing to claim, create or manage', async () => {
    const l = await lockedProject()
    const project = await clientAs(l.owner).projects.getById({ id: l.project.id })
    expect(project).toMatchObject({
      canClaimTasks: false,
      canCreateTasks: false,
      canManageTasks: false,
    })
    const list = await clientAs(l.owner).projects.listTasks({ projectId: l.project.id })
    expect(list).toMatchObject({
      canManageTasks: false,
      canCreateTasks: false,
      canSetKeyDate: false,
    })
    const task = await clientAs(l.owner).projects.getTask({
      projectId: l.project.id,
      taskId: l.tasks.open.id,
    })
    expect(task).toMatchObject({
      canClaim: false,
      canManage: false,
      canSetKeyDate: false,
      projectStatus: 'completed',
      projectCompletedAt: COMPLETED_ON,
    })
  })

  it('keeps a request for changes visible to the owner', async () => {
    const l = await lockedProject()
    await prisma.workItem.update({
      where: { id: l.tasks.working.id },
      data: { changesRequestedNote: 'Add the sources', reviewedById: l.owner.id },
    })
    const task = await clientAs(l.owner).projects.getTask({
      projectId: l.project.id,
      taskId: l.tasks.working.id,
    })
    expect(task.changesRequested).toMatchObject({ message: 'Add the sources' })
  })

  it('stops advertising its featured tasks on Quick Tasks', async () => {
    const l = await lockedProject()
    const live = await createProject({ status: 'in_progress' })
    const liveTask = await createTask(live.id, { featuredAsQuickTask: true })
    await prisma.workItem.update({
      where: { id: l.tasks.open.id },
      data: { featuredAsQuickTask: true },
    })
    const ids = (await clientAs(l.stranger).quickTasks.available()).map((t) => t.id)
    expect(ids).toContain(liveTask.id)
    expect(ids).not.toContain(l.tasks.open.id)
  })
})

describe('reopening a project', () => {
  it('the owner reopens it: In progress, a note in its Discussion, members told', async () => {
    const l = await lockedProject()
    await clientAs(l.owner).projects.update({ id: l.project.id, status: 'in_progress' })

    expect(await prisma.workItem.findUnique({ where: { id: l.project.id } })).toMatchObject({
      status: 'in_progress',
      completedAt: null,
    })
    expect(
      await prisma.workItemEvent.findMany({ where: { workItemId: l.project.id } }),
    ).toMatchObject([
      {
        actorId: l.owner.id,
        kind: 'reopened',
        after: { status: 'in_progress', completedAt: null },
      },
    ])
    await vi.waitFor(async () => {
      expect(
        await prisma.notification.findFirst({
          where: { volunteerId: l.helper.id, type: 'project_status_changed' },
        }),
      ).toMatchObject({ title: `'${l.project.title}' is now In progress` })
    })
  })

  it('after reopening, everything works again', async () => {
    const l = await lockedProject()
    await clientAs(l.owner).projects.update({ id: l.project.id, status: 'in_progress' })

    await clientAs(l.owner).projects.updateTask({
      projectId: l.project.id,
      taskId: l.tasks.working.id,
      data: { title: 'Renamed' },
    })
    await clientAs(l.helper).projects.updateTask({
      projectId: l.project.id,
      taskId: l.tasks.open.id,
      data: { assigneeId: l.helper.id },
    })
    await clientAs(l.owner).projects.reopenTask({
      projectId: l.project.id,
      taskId: l.tasks.done.id,
    })
    await clientAs(l.helper).projects.withdrawInterest({ projectId: l.project.id })
    expect(
      await prisma.workItemInterest.findFirst({
        where: { workItemId: l.project.id, volunteerId: l.helper.id },
      }),
    ).toMatchObject({ status: 'withdrawn' })
  })

  it('reopens even when every task is done', async () => {
    const owner = await createVolunteer()
    const project = await createProject({ assigneeId: owner.id, status: 'completed' })
    await createTask(project.id, { status: 'completed' })
    await clientAs(owner).projects.update({ id: project.id, status: 'in_progress' })
    expect(await prisma.workItem.findUnique({ where: { id: project.id } })).toMatchObject({
      status: 'in_progress',
    })
  })

  it('an admin can reopen it, or archive it, which keeps it locked', async () => {
    const l = await lockedProject()
    await clientAs(l.admin).projects.update({ id: l.project.id, status: 'archived' })
    expect(await prisma.workItem.findUnique({ where: { id: l.project.id } })).toMatchObject({
      status: 'archived',
      completedAt: COMPLETED_ON,
    })
    expect(await prisma.workItemComment.count({ where: { workItemId: l.project.id } })).toBe(0)

    await clientAs(l.admin).projects.update({ id: l.project.id, status: 'on_hold' })
    expect(await prisma.workItem.findUnique({ where: { id: l.project.id } })).toMatchObject({
      status: 'on_hold',
      completedAt: null,
    })
  })

  it('a deputy, a helper or the proposer cannot', async () => {
    const l = await lockedProject()
    await prisma.workItem.update({
      where: { id: l.project.id },
      data: { creatorId: l.stranger.id },
    })
    for (const who of [l.deputy, l.helper]) {
      await expect(
        clientAs(who).projects.update({ id: l.project.id, status: 'in_progress' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'Not authorized to edit this project' })
    }
    await expect(
      clientAs(l.stranger).projects.update({ id: l.project.id, status: 'in_progress' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: REOPEN_PROJECT_TO_CHANGE })
    expect(await prisma.workItem.findUnique({ where: { id: l.project.id } })).toMatchObject({
      status: 'completed',
    })
  })

  it('the owner cannot archive it, nor resend its status', async () => {
    const l = await lockedProject()
    for (const status of ['archived', 'completed'] as const) {
      await expect(
        clientAs(l.owner).projects.update({ id: l.project.id, status }),
      ).rejects.toMatchObject({ message: REOPEN_PROJECT_TO_CHANGE })
    }
  })

  it('reopening takes the status alone, not edits sent with it', async () => {
    const l = await lockedProject()
    await clientAs(l.owner).projects.update({
      id: l.project.id,
      status: 'in_progress',
      title: 'Sneaked in',
    })
    expect(await prisma.workItem.findUnique({ where: { id: l.project.id } })).toMatchObject({
      status: 'in_progress',
      title: l.project.title,
    })
  })

  it('completing a project records when', async () => {
    const owner = await createVolunteer()
    const project = await createProject({ assigneeId: owner.id, status: 'in_progress' })
    await clientAs(owner).projects.update({ id: project.id, status: 'completed' })
    const completed = await prisma.workItem.findUniqueOrThrow({ where: { id: project.id } })
    expect(completed.completedAt).toBeInstanceOf(Date)
  })
})
