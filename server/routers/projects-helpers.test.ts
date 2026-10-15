import { describe, it, expect, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createAdmin, createProject, createTask, createVolunteer } from '@/test/factories'
import { clientAs } from '@/test/rpc'
import { REOPEN_PROJECT_TO_CHANGE, REOPEN_TASK_TO_CHANGE } from '@/lib/work-item-lock'

const HELP = 'want_to_help_task' as const

/** An in-progress project with an owner, `members` accepted onto it. */
async function projectWith(members: { id: number }[], overrides = {}) {
  const owner = await createVolunteer({ name: 'Olive Owner' })
  const project = await createProject({ assigneeId: owner.id, status: 'in_progress', ...overrides })
  for (const m of members) {
    await prisma.workItemInterest.create({
      data: {
        workItemId: project.id,
        volunteerId: m.id,
        interestType: 'want_to_contribute',
        status: 'accepted',
      },
    })
  }
  return { owner, project }
}

const row = (volunteerId: number, workItemId: number) =>
  prisma.workItemInterest.findUnique({
    where: { volunteerId_workItemId: { volunteerId, workItemId } },
  })
const notes = (volunteerId: number, type: string) =>
  prisma.notification.findMany({ where: { volunteerId, type }, orderBy: { id: 'asc' } })
/** Notifications are written after the response, so wait for the `count`th to land. */
const noted = (volunteerId: number, type: string, count = 1) =>
  vi.waitFor(async () => {
    const rows = await notes(volunteerId, type)
    expect(rows.length).toBeGreaterThanOrEqual(count)
    return rows
  })
const join = (who: { id: number }, projectId: number, taskId: number) =>
  clientAs(who as never).projects.expressInterest({ projectId, taskId, interestType: HELP })

describe('task helpers: joining', () => {
  it('lets members join until the task has as many as it wants, telling the lead', async () => {
    const lead = await createVolunteer({ name: 'Lee Lead' })
    const ann = await createVolunteer({ name: 'Ann' })
    const bob = await createVolunteer({ name: 'Bob' })
    const cat = await createVolunteer({ name: 'Cat' })
    const { project } = await projectWith([lead, ann, bob, cat])
    const task = await createTask(project.id, {
      title: 'Flyer the station',
      assigneeId: lead.id,
      helpersWanted: 2,
    })

    expect(await join(ann, project.id, task.id)).toEqual({
      message: "You're helping on this task",
    })
    expect(await row(ann.id, task.id)).toMatchObject({
      status: 'accepted',
      interestType: HELP,
      origin: 'applied',
    })
    expect((await noted(lead.id, 'task_helpers_changed'))[0].title).toBe(
      "Ann joined 'Flyer the station' as a helper",
    )
    await expect(join(ann, project.id, task.id)).rejects.toMatchObject({
      message: 'You are already helping on this task',
    })

    // Cat sees the way in while there is room, and not once it is full.
    expect(
      await clientAs(cat).projects.getTask({ projectId: project.id, taskId: task.id }),
    ).toMatchObject({ canJoinAsHelper: true, isHelper: false, canRemoveHelpers: false })
    await join(bob, project.id, task.id)
    const full = await clientAs(cat).projects.getTask({ projectId: project.id, taskId: task.id })
    expect(full).toMatchObject({ canJoinAsHelper: false, helpersWanted: 2 })
    expect(full.helpers.map((h) => h.name)).toEqual(['Ann', 'Bob'])
    await expect(join(cat, project.id, task.id)).rejects.toMatchObject({
      message: 'This task has all the helpers it wants',
    })

    // The Discussion says who joined.
    const feed = await clientAs(lead).workItemComments.list({ workItemId: task.id })
    expect(feed.feed.map((f) => ('text' in f ? f.text : null))).toEqual(
      expect.arrayContaining(['Ann joined as a helper', 'Bob joined as a helper']),
    )
  })

  it('tells the project owner when the task has no lead', async () => {
    const ann = await createVolunteer({ name: 'Ann' })
    const { owner, project } = await projectWith([ann])
    const task = await createTask(project.id, { title: 'Stall', helpersWanted: 1 })
    await join(ann, project.id, task.id)
    expect((await noted(owner.id, 'task_helpers_changed'))[0].title).toBe(
      "Ann joined 'Stall' as a helper",
    )
    // The owner joining their own project's task tells nobody.
    const other = await createTask(project.id, { title: 'Banner', helpersWanted: 1 })
    await join(owner, project.id, other.id)
    expect(await notes(owner.id, 'task_helpers_changed')).toHaveLength(1)
  })

  it('refuses whoever cannot join, and tasks that take no helpers', async () => {
    const lead = await createVolunteer()
    const member = await createVolunteer()
    const stranger = await createVolunteer()
    const { project } = await projectWith([lead, member])
    const task = await createTask(project.id, { assigneeId: lead.id, helpersWanted: 3 })

    await expect(join(lead, project.id, task.id)).rejects.toMatchObject({
      message: 'You already lead this task',
    })
    await expect(join(stranger, project.id, task.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Join the project to help on its tasks',
    })
    expect(
      await clientAs(stranger).projects.getTask({ projectId: project.id, taskId: task.id }),
    ).toMatchObject({ canJoinAsHelper: false })

    const solo = await createTask(project.id, { helpersWanted: null })
    await expect(join(member, project.id, solo.id)).rejects.toMatchObject({
      message: 'This task is not looking for helpers',
    })
    const handedIn = await createTask(project.id, { status: 'under_review', helpersWanted: 2 })
    await expect(join(member, project.id, handedIn.id)).rejects.toMatchObject({
      message: 'This task has been handed in',
    })
    const done = await createTask(project.id, { status: 'completed', helpersWanted: 2 })
    await expect(join(member, project.id, done.id)).rejects.toMatchObject({
      message: REOPEN_TASK_TO_CHANGE,
    })
    await expect(join(member, project.id, 999_999)).rejects.toMatchObject({ code: 'NOT_FOUND' })

    // A task helper is asked for on a task, and a project's interest on a project.
    await expect(
      clientAs(member).projects.expressInterest({
        projectId: project.id,
        taskId: task.id,
        interestType: 'want_to_contribute',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(
      clientAs(member).projects.expressInterest({ projectId: project.id, interestType: HELP }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('refuses joining, leaving and removing on a completed project', async () => {
    const lead = await createVolunteer()
    const ann = await createVolunteer()
    const { owner, project } = await projectWith([lead, ann])
    const task = await createTask(project.id, { assigneeId: lead.id, helpersWanted: 2 })
    await join(ann, project.id, task.id)
    await prisma.workItem.update({ where: { id: project.id }, data: { status: 'completed' } })

    const late = await createVolunteer()
    await expect(join(late, project.id, task.id)).rejects.toMatchObject({
      message: REOPEN_PROJECT_TO_CHANGE,
    })
    await expect(
      clientAs(ann).projects.withdrawInterest({ projectId: project.id, taskId: task.id }),
    ).rejects.toMatchObject({ message: REOPEN_PROJECT_TO_CHANGE })
    const helper = (await row(ann.id, task.id))!
    await expect(
      clientAs(owner).projects.respondToInterest({
        projectId: project.id,
        taskId: task.id,
        interestId: helper.id,
        status: 'declined',
      }),
    ).rejects.toMatchObject({ message: REOPEN_PROJECT_TO_CHANGE })
    expect(
      await clientAs(ann).projects.getTask({ projectId: project.id, taskId: task.id }),
    ).toMatchObject({ isHelper: true, canLeaveAsHelper: false })
  })
})

describe('task helpers: adding directly', () => {
  const add = (who: { id: number }, projectId: number, taskId: number, volunteerId: number) =>
    clientAs(who as never).projects.addTaskHelper({ projectId, taskId, volunteerId })

  it('lets the owner put a member on the task as a helper, who is told and sees it on getTask', async () => {
    const lead = await createVolunteer({ name: 'Lee' })
    const ann = await createVolunteer({ name: 'Ann' })
    const { owner, project } = await projectWith([lead, ann])
    const task = await createTask(project.id, {
      title: 'Leaflets',
      assigneeId: lead.id,
      helpersWanted: 1,
    })

    expect(
      await clientAs(owner).projects.getTask({ projectId: project.id, taskId: task.id }),
    ).toMatchObject({ canAddHelpers: true, eligibleHelpers: [{ id: ann.id, name: 'Ann' }] })

    expect(await add(owner, project.id, task.id, ann.id)).toEqual({
      message: 'Ann is now helping on this task',
    })
    expect(await row(ann.id, task.id)).toMatchObject({
      status: 'accepted',
      interestType: HELP,
      origin: 'added',
      invitedById: owner.id,
    })
    expect((await noted(ann.id, 'helper_added'))[0]).toMatchObject({
      title: "Added: you're helping on 'Leaflets'",
      body: 'Olive Owner added you as a helper',
    })
    const feed = await clientAs(lead).workItemComments.list({ workItemId: task.id })
    expect(feed.feed.map((f) => ('text' in f ? f.text : null))).toContain(
      'Olive Owner added Ann as a helper',
    )

    // Full now, and Ann no longer shows as eligible.
    expect(
      await clientAs(owner).projects.getTask({ projectId: project.id, taskId: task.id }),
    ).toMatchObject({ canAddHelpers: false, eligibleHelpers: [] })
  })

  it('refuses whoever cannot manage the task, and invalid targets', async () => {
    const lead = await createVolunteer({ name: 'Lee' })
    const ann = await createVolunteer({ name: 'Ann' })
    const stranger = await createVolunteer()
    const { owner, project } = await projectWith([lead, ann])
    const task = await createTask(project.id, { assigneeId: lead.id, helpersWanted: 1 })

    await expect(add(lead, project.id, task.id, ann.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Only the project owner or a deputy can add a helper',
    })
    const outsider = await projectWith([])
    await expect(add(outsider.owner, project.id, task.id, ann.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })

    await expect(add(owner, project.id, task.id, lead.id)).rejects.toMatchObject({
      message: 'They already lead this task',
    })
    await expect(add(owner, project.id, task.id, stranger.id)).rejects.toMatchObject({
      message: 'They need to join the project first',
    })

    const solo = await createTask(project.id, { helpersWanted: null })
    await expect(add(owner, project.id, solo.id, ann.id)).rejects.toMatchObject({
      message: 'This task is not looking for helpers',
    })
  })

  it('refuses adding a member whose account was deleted after they joined', async () => {
    const ann = await createVolunteer({ name: 'Ann' })
    const { owner, project } = await projectWith([ann])
    const task = await createTask(project.id, { helpersWanted: 1 })
    await prisma.volunteer.update({ where: { id: ann.id }, data: { deletedAt: new Date() } })

    await expect(add(owner, project.id, task.id, ann.id)).rejects.toMatchObject({
      message: 'Volunteer not found',
    })
  })

  it('refuses adding someone already helping, and once the task is full', async () => {
    const ann = await createVolunteer({ name: 'Ann' })
    const bob = await createVolunteer({ name: 'Bob' })
    const { owner, project } = await projectWith([ann, bob])
    const task = await createTask(project.id, { helpersWanted: 1 })

    await add(owner, project.id, task.id, ann.id)
    await expect(add(owner, project.id, task.id, ann.id)).rejects.toMatchObject({
      message: 'They are already helping on this task',
    })
    await expect(add(owner, project.id, task.id, bob.id)).rejects.toMatchObject({
      message: 'This task has all the helpers it wants',
    })
  })

  it('lets someone taken off be added back', async () => {
    const ann = await createVolunteer({ name: 'Ann' })
    const { owner, project } = await projectWith([ann])
    const task = await createTask(project.id, { helpersWanted: 1 })
    await add(owner, project.id, task.id, ann.id)
    const annRow = (await row(ann.id, task.id))!
    await clientAs(owner).projects.respondToInterest({
      projectId: project.id,
      taskId: task.id,
      interestId: annRow.id,
      status: 'declined',
    })
    expect((await row(ann.id, task.id))?.status).toBe('removed')

    expect(await add(owner, project.id, task.id, ann.id)).toEqual({
      message: 'Ann is now helping on this task',
    })
    expect((await row(ann.id, task.id))?.status).toBe('accepted')
  })

  it('refuses adding a helper on a completed project', async () => {
    const ann = await createVolunteer({ name: 'Ann' })
    const { owner, project } = await projectWith([ann])
    const task = await createTask(project.id, { helpersWanted: 1 })
    await prisma.workItem.update({ where: { id: project.id }, data: { status: 'completed' } })

    await expect(add(owner, project.id, task.id, ann.id)).rejects.toMatchObject({
      message: REOPEN_PROJECT_TO_CHANGE,
    })
  })
})

describe('task helpers: leaving and removing', () => {
  it('lets a helper leave and come back, telling the lead', async () => {
    const lead = await createVolunteer()
    const ann = await createVolunteer({ name: 'Ann' })
    const { project } = await projectWith([lead, ann])
    const task = await createTask(project.id, {
      title: 'Stall',
      assigneeId: lead.id,
      helpersWanted: 1,
    })
    await expect(
      clientAs(ann).projects.withdrawInterest({ projectId: project.id, taskId: task.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'You are not helping on this task' })

    await join(ann, project.id, task.id)
    expect(
      await clientAs(ann).projects.getTask({ projectId: project.id, taskId: task.id }),
    ).toMatchObject({ isHelper: true, canLeaveAsHelper: true, canJoinAsHelper: false })
    expect(
      await clientAs(ann).projects.withdrawInterest({ projectId: project.id, taskId: task.id }),
    ).toEqual({ message: 'You are no longer helping on this task' })
    expect((await row(ann.id, task.id))?.status).toBe('withdrawn')
    expect((await noted(lead.id, 'task_helpers_changed', 2)).map((n) => n.title)).toContain(
      "Ann stopped helping on 'Stall'",
    )
    // Leaving a task is not leaving the project.
    expect((await row(ann.id, project.id))?.status).toBe('accepted')

    await join(ann, project.id, task.id)
    expect((await row(ann.id, task.id))?.status).toBe('accepted')
  })

  it('lets the lead or a manager remove a helper, who is told and cannot rejoin', async () => {
    const lead = await createVolunteer({ name: 'Lee' })
    const ann = await createVolunteer({ name: 'Ann' })
    const bob = await createVolunteer({ name: 'Bob' })
    const { owner, project } = await projectWith([lead, ann, bob])
    const task = await createTask(project.id, {
      title: 'Leaflets',
      assigneeId: lead.id,
      helpersWanted: 2,
    })
    await join(ann, project.id, task.id)
    await join(bob, project.id, task.id)
    const annRow = (await row(ann.id, task.id))!
    const bobRow = (await row(bob.id, task.id))!
    const remove = (who: { id: number }, interestId: number, status = 'declined' as const) =>
      clientAs(who as never).projects.respondToInterest({
        projectId: project.id,
        taskId: task.id,
        interestId,
        status,
      })

    expect(
      await clientAs(lead).projects.getTask({ projectId: project.id, taskId: task.id }),
    ).toMatchObject({ canRemoveHelpers: true })
    await expect(remove(bob, annRow.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      clientAs(lead).projects.respondToInterest({
        projectId: project.id,
        taskId: task.id,
        interestId: annRow.id,
        status: 'accepted',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(remove(lead, 999_999)).rejects.toMatchObject({ message: 'Helper not found' })

    expect(
      await clientAs(lead).projects.respondToInterest({
        projectId: project.id,
        taskId: task.id,
        interestId: annRow.id,
        status: 'declined',
        responseMessage: 'We have enough',
      }),
    ).toEqual({ message: 'Helper removed' })
    expect((await row(ann.id, task.id))?.status).toBe('removed')
    expect((await noted(ann.id, 'helper_removed'))[0]).toMatchObject({
      title: "Removed: you're no longer helping on 'Leaflets'",
      body: 'We have enough',
    })
    await expect(join(ann, project.id, task.id)).rejects.toMatchObject({
      message: 'You were taken off this task',
    })
    expect(
      await clientAs(ann).projects.getTask({ projectId: project.id, taskId: task.id }),
    ).toMatchObject({ canJoinAsHelper: false })

    // The project's owner removes one too; the Discussion says who was taken off.
    await remove(owner, bobRow.id)
    expect((await row(bob.id, task.id))?.status).toBe('removed')
    const feed = await clientAs(lead).workItemComments.list({ workItemId: task.id })
    expect(feed.feed.map((f) => ('text' in f ? f.text : null))).toEqual(
      expect.arrayContaining([
        'Lee took Ann off the helpers',
        'Olive Owner took Bob off the helpers',
      ]),
    )
    // Removing someone from a task does not touch their place on the project.
    expect((await row(ann.id, project.id))?.status).toBe('accepted')
  })

  it('ends helping on unfinished tasks when someone leaves or is taken off the project', async () => {
    const ann = await createVolunteer()
    const bob = await createVolunteer()
    const { owner, project } = await projectWith([ann, bob])
    const open = await createTask(project.id, { helpersWanted: 3 })
    const done = await createTask(project.id, { helpersWanted: 3 })
    for (const who of [ann, bob]) {
      await join(who, project.id, open.id)
      await join(who, project.id, done.id)
    }
    await prisma.workItem.update({ where: { id: done.id }, data: { status: 'completed' } })

    await clientAs(ann).projects.withdrawInterest({ projectId: project.id })
    expect((await row(ann.id, open.id))?.status).toBe('withdrawn')
    expect((await row(ann.id, done.id))?.status).toBe('accepted')

    const bobOnProject = (await row(bob.id, project.id))!
    await clientAs(owner).projects.respondToInterest({
      projectId: project.id,
      interestId: bobOnProject.id,
      status: 'declined',
    })
    expect((await row(bob.id, open.id))?.status).toBe('removed')
    expect((await row(bob.id, done.id))?.status).toBe('accepted')
  })

  it('stops someone helping once they become the lead', async () => {
    const ann = await createVolunteer()
    const bob = await createVolunteer()
    const { owner, project } = await projectWith([ann, bob])
    const claimed = await createTask(project.id, { helpersWanted: 2 })
    await join(ann, project.id, claimed.id)
    await clientAs(ann).projects.updateTask({
      projectId: project.id,
      taskId: claimed.id,
      data: { assigneeId: ann.id },
    })
    expect((await row(ann.id, claimed.id))?.status).toBe('withdrawn')

    const assigned = await createTask(project.id, { assigneeId: ann.id, helpersWanted: 2 })
    await join(bob, project.id, assigned.id)
    await clientAs(owner).projects.assignTask({
      projectId: project.id,
      taskId: assigned.id,
      assigneeId: bob.id,
    })
    expect((await row(bob.id, assigned.id))?.status).toBe('withdrawn')
  })
})

describe('task helpers: what they see and hear', () => {
  it('counts helpers on the task list, the timeline and the cards that name the task', async () => {
    const ann = await createVolunteer()
    const { owner, project } = await projectWith([ann])
    const first = await createTask(project.id, { helpersWanted: 2 })
    const then = await createTask(project.id)
    await prisma.workItemDependency.create({
      data: { predecessorId: first.id, successorId: then.id },
    })
    await join(ann, project.id, first.id)
    const c = clientAs(owner)

    const byId = await c.projects.getById({ id: project.id })
    expect(byId.tasks.find((t) => t.id === first.id)).toMatchObject({
      helperCount: 1,
      helpersWanted: 2,
    })
    // A task's own helper rows are not the project's helpers.
    expect(byId.helpers.map((h) => h.volunteerId)).toEqual([ann.id])
    const list = await c.projects.listTasks({ projectId: project.id })
    expect(list.tasks.find((t) => t.id === first.id)).toMatchObject({ helperCount: 1 })
    const page = await c.projects.getTask({ projectId: project.id, taskId: then.id })
    expect(page.waitsOn[0]).toMatchObject({ helperCount: 1, helpersWanted: 2 })
  })

  it('puts the task on a helper’s Home as Helper and in their task list', async () => {
    const lead = await createVolunteer()
    const ann = await createVolunteer()
    const { project } = await projectWith([lead, ann])
    const task = await createTask(project.id, {
      title: 'Hand out flyers',
      assigneeId: lead.id,
      helpersWanted: 2,
    })
    await join(ann, project.id, task.id)

    const home = await clientAs(ann).dashboard.get()
    const rowFor = (who: typeof home) => who.work.find((w) => w.key === `task-${task.id}`)
    expect(rowFor(home)).toMatchObject({ role: 'Helper', title: 'Hand out flyers' })
    expect(rowFor(await clientAs(lead).dashboard.get())).toMatchObject({ role: 'Task' })

    expect(await clientAs(ann).my.projectTasks()).toEqual([
      expect.objectContaining({ id: task.id, role: 'Helper' }),
    ])
    expect(await clientAs(lead).my.projectTasks()).toEqual([
      expect.objectContaining({ id: task.id, role: 'Lead' }),
    ])
  })

  it('tells helpers about comments, replans, reopening and the work being done', async () => {
    const lead = await createVolunteer({ name: 'Lee' })
    const ann = await createVolunteer()
    const { owner, project } = await projectWith([lead, ann], { autoAcceptTasks: true })
    const task = await createTask(project.id, {
      title: 'Leaflets',
      assigneeId: lead.id,
      status: 'in_progress',
      helpersWanted: 1,
      startDate: new Date('2026-10-01T00:00:00Z'),
      deadline: new Date('2026-10-05T00:00:00Z'),
    })
    await join(ann, project.id, task.id)

    await clientAs(lead).workItemComments.add({ workItemId: task.id, content: 'Meet at 9' })
    expect((await noted(ann.id, 'work_item_comment'))[0].body).toBe('Meet at 9')

    await clientAs(owner).projects.replanTask({
      projectId: project.id,
      taskId: task.id,
      newEnd: new Date('2026-12-01T00:00:00Z'),
      reason: 'Printer is late',
    })
    expect((await noted(ann.id, 'task_replanned'))[0].body).toBe('Printer is late')

    await clientAs(lead).projects.submitTask({
      projectId: project.id,
      taskId: task.id,
      note: '500 handed out',
    })
    expect((await noted(ann.id, 'task_done'))[0].title).toBe("Done: 'Leaflets'")

    await clientAs(owner).projects.reopenTask({ projectId: project.id, taskId: task.id })
    expect((await noted(ann.id, 'task_reopened'))[0].body).toBe('Olive Owner reopened it.')

    // An owner who reviews is the one who accepts it.
    await prisma.workItem.update({
      where: { id: project.id },
      data: { autoAcceptTasks: false },
    })
    await clientAs(lead).projects.submitTask({
      projectId: project.id,
      taskId: task.id,
      note: 'Another 200',
    })
    await clientAs(owner).projects.acceptTask({ projectId: project.id, taskId: task.id })
    expect(await noted(ann.id, 'task_done', 2)).toHaveLength(2)

    // Only the lead hands the work in.
    await clientAs(owner).projects.reopenTask({ projectId: project.id, taskId: task.id })
    await expect(
      clientAs(ann).projects.submitTask({
        projectId: project.id,
        taskId: task.id,
        note: 'mine',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('lets whoever edits a task set how many helpers it seeks', async () => {
    const admin = await createAdmin()
    const { owner, project } = await projectWith([])
    const { id } = await clientAs(owner).projects.createTask({
      projectId: project.id,
      title: 'Doors',
      helpersWanted: 4,
    })
    expect((await prisma.workItem.findUniqueOrThrow({ where: { id } })).helpersWanted).toBe(4)
    await clientAs(admin).projects.updateTask({
      projectId: project.id,
      taskId: id,
      data: { helpersWanted: null },
    })
    expect((await prisma.workItem.findUniqueOrThrow({ where: { id } })).helpersWanted).toBeNull()

    // Claiming cannot carry it along.
    const ann = await createVolunteer()
    await expect(
      clientAs(ann).projects.updateTask({
        projectId: project.id,
        taskId: id,
        data: { assigneeId: ann.id, helpersWanted: 9 },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect((await prisma.workItem.findUniqueOrThrow({ where: { id } })).helpersWanted).toBeNull()
  })
})
