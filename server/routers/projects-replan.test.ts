import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createVolunteer, createAdmin, createProject, createTask } from '@/test/factories'
import { clientAs } from '@/test/rpc'
import { addDays, startOfUtcDay } from '@/lib/schedule'

const today = startOfUtcDay(new Date())

/**
 * An owner's live project with a task that ended three days ago and is still in progress, a
 * task that follows it, and a deputy. The follower has its own assignee, so it can be told
 * when it moves.
 */
async function setup() {
  const owner = await createVolunteer({ name: 'Olive Owner' })
  const sam = await createVolunteer({ name: 'Sam' })
  const pat = await createVolunteer({ name: 'Pat' })
  const deputy = await createVolunteer({ name: 'Dee' })
  const project = await createProject({ status: 'in_progress', assigneeId: owner.id })
  await prisma.workItemInterest.create({
    data: {
      volunteerId: deputy.id,
      workItemId: project.id,
      interestType: 'want_to_contribute',
      status: 'accepted',
    },
  })
  await prisma.projectDeputy.create({ data: { projectId: project.id, volunteerId: deputy.id } })
  const late = await createTask(project.id, {
    title: 'Book venue',
    status: 'in_progress',
    assigneeId: sam.id,
    startDate: addDays(today, -7),
    durationDays: 5,
  })
  const next = await createTask(project.id, {
    title: 'Print flyers',
    status: 'in_progress',
    assigneeId: pat.id,
    durationDays: 2,
  })
  await prisma.workItemDependency.create({
    data: { predecessorId: late.id, successorId: next.id },
  })
  return { owner, sam, pat, deputy, project, late, next }
}

const notes = (volunteerId: number, type: string) =>
  prisma.notification.findMany({ where: { volunteerId, type } })

describe('a task past its plan', () => {
  it('shows the days past plan on the task, the task list and Home', async () => {
    const { owner, sam, project, late, next } = await setup()
    await prisma.workItemComment.create({
      data: { workItemId: late.id, authorId: sam.id, content: 'On it' },
    })
    const task = await clientAs(sam).projects.getTask({ projectId: project.id, taskId: late.id })
    expect(task.pastPlanDays).toBe(3)
    const tasks = (await clientAs(owner).projects.getById({ id: project.id })).tasks
    expect(tasks.find((t) => t.id === late.id)?.pastPlanDays).toBe(3)
    // The follower's plan has not ended yet.
    expect(tasks.find((t) => t.id === next.id)?.pastPlanDays).toBeNull()

    const home = await clientAs(owner).dashboard.get()
    expect(home.attention[0]).toMatchObject({
      kind: 'past_plan',
      title: '"Book venue" is 3 days past plan',
      detail: 'Assignee: Sam, last update 0 days ago. Replan, reassign or release.',
      href: `/projects/${project.id}/tasks/${late.id}`,
    })
    const mine = (await clientAs(sam).dashboard.get()).work
    expect(mine.find((w) => w.key === `task-${late.id}`)?.pastPlanDays).toBe(3)
  })

  it('lets the owner or a deputy replan it, telling the people whose work moves', async () => {
    const { owner, sam, pat, deputy, project, late, next } = await setup()
    await prisma.notification.create({
      data: {
        volunteerId: owner.id,
        type: 'task_needs_decision',
        title: 'Decide',
        entityId: late.id,
      },
    })
    const newEnd = addDays(today, 2)
    await expect(
      clientAs(sam).projects.replanTask({
        projectId: project.id,
        taskId: late.id,
        newEnd,
        reason: 'mine',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      clientAs(owner).projects.replanTask({
        projectId: project.id,
        taskId: late.id,
        newEnd: addDays(today, -30),
        reason: 'too early',
      }),
    ).rejects.toMatchObject({ message: 'The new end is before the task starts' })
    await expect(
      clientAs(owner).projects.replanTask({
        projectId: project.id,
        taskId: 999_999,
        newEnd,
        reason: 'gone',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(
      clientAs(owner).projects.replanTask({
        projectId: 999_999,
        taskId: late.id,
        newEnd,
        reason: 'x',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })

    const result = await clientAs(deputy).projects.replanTask({
      projectId: project.id,
      taskId: late.id,
      newEnd,
      reason: 'waiting on the venue',
    })
    expect(result).toEqual({ message: 'Task replanned', moved: 1 })
    expect(await prisma.workItem.findUniqueOrThrow({ where: { id: late.id } })).toMatchObject({
      startDate: addDays(today, -7),
      durationDays: 10,
      deadline: null,
    })
    const comment = await prisma.workItemComment.findFirstOrThrow({
      where: { workItemId: late.id },
    })
    expect(comment.content).toBe('Replanned by Dee (deputy): waiting on the venue')
    expect(await notes(owner.id, 'task_needs_decision')).toHaveLength(0)
    expect((await notes(sam.id, 'task_replanned'))[0]).toMatchObject({
      body: 'waiting on the venue',
    })
    expect((await notes(pat.id, 'plan_moved'))[0].title).toMatch(
      /^'Print flyers' now starts .* because 'Book venue' was replanned$/,
    )
    expect(
      (await clientAs(sam).projects.getTask({ projectId: project.id, taskId: late.id }))
        .pastPlanDays,
    ).toBeNull()
    void next
  })

  it('tells nobody about their own replan, and starts an undated task today', async () => {
    const owner = await createVolunteer()
    const project = await createProject({ status: 'in_progress', assigneeId: owner.id })
    const loose = await createTask(project.id, { title: 'Loose', assigneeId: owner.id })
    await clientAs(owner).projects.replanTask({
      projectId: project.id,
      taskId: loose.id,
      newEnd: addDays(today, 3),
      reason: 'giving it a date',
    })
    expect(await prisma.workItem.findUniqueOrThrow({ where: { id: loose.id } })).toMatchObject({
      startDate: today,
      durationDays: 4,
    })
    expect(await notes(owner.id, 'task_replanned')).toHaveLength(0)

    // A task that only follows another keeps following and just lengthens.
    const after = await createTask(project.id, { title: 'After' })
    await prisma.workItemDependency.create({
      data: { predecessorId: loose.id, successorId: after.id },
    })
    await clientAs(owner).projects.replanTask({
      projectId: project.id,
      taskId: after.id,
      newEnd: addDays(today, 6),
      reason: 'longer',
    })
    expect(await prisma.workItem.findUniqueOrThrow({ where: { id: after.id } })).toMatchObject({
      startDate: null,
      durationDays: 3,
    })
  })

  it('tells the previous assignee when the task is handed on or opened up again', async () => {
    const { owner, sam, pat, project, late } = await setup()
    const admin = await createAdmin()
    await clientAs(owner).projects.assignTask({
      projectId: project.id,
      taskId: late.id,
      assigneeId: pat.id,
    })
    expect((await notes(sam.id, 'task_reassigned'))[0].title).toBe(
      "'Book venue' has been handed to someone else",
    )
    // Assigning to whoever already has it tells nobody.
    await clientAs(owner).projects.assignTask({
      projectId: project.id,
      taskId: late.id,
      assigneeId: pat.id,
    })
    expect(await notes(pat.id, 'task_reassigned')).toHaveLength(0)

    await clientAs(admin).projects.updateTask({
      projectId: project.id,
      taskId: late.id,
      data: { status: 'open' },
    })
    expect((await notes(pat.id, 'task_released'))[0].title).toBe("'Book venue' is open again")
  })
})
