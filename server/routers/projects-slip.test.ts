import { describe, it, expect } from 'vitest'
import { createVolunteer, createProject, createTask } from '@/test/factories'
import { clientAs } from '@/test/rpc'
import { prisma } from '@/lib/prisma'

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

/**
 * A project whose deadline is 30 Sept: one task runs 20 Sept to 1 Oct and a one-day task follows
 * it, so the plan finishes on 2 Oct, two days late.
 */
async function lateProject(owner: { id: number }, title: string) {
  const project = await createProject({
    title,
    status: 'in_progress',
    assigneeId: owner.id,
    startDate: day('2026-09-20'),
    deadline: day('2026-09-30'),
  })
  const first = await createTask(project.id, { startDate: day('2026-09-20'), durationDays: 12 })
  const follower = await createTask(project.id)
  await prisma.workItemDependency.create({
    data: { predecessorId: first.id, successorId: follower.id },
  })
  // Never placed on the timeline, so it does not count as finishing on the first day.
  await createTask(project.id)
  return project
}

describe('projects running past their deadline', () => {
  it('marks late projects in the project lists and leaves the rest alone', async () => {
    const owner = await createVolunteer()
    const late = await lateProject(owner, 'Slip late')
    const onTime = await createProject({
      title: 'Slip on time',
      status: 'in_progress',
      assigneeId: owner.id,
      startDate: day('2026-09-20'),
      deadline: day('2026-10-30'),
    })
    await createTask(onTime.id, { durationDays: 3 })
    const undated = await createProject({
      title: 'Slip undated',
      status: 'in_progress',
      assigneeId: owner.id,
      deadline: day('2026-01-01'),
    })
    await createTask(undated.id)
    const finished = await createProject({
      title: 'Slip finished',
      status: 'completed',
      assigneeId: owner.id,
      startDate: day('2026-09-20'),
      deadline: day('2026-09-01'),
    })
    await createTask(finished.id, { durationDays: 5 })

    const client = clientAs(owner)
    const listed = (await client.projects.list({ search: 'Slip' })).projects
    const daysLate = Object.fromEntries(listed.map((p) => [p.title, p.daysLate]))
    expect(daysLate).toMatchObject({
      'Slip late': 2,
      'Slip on time': null,
      'Slip undated': null,
    })

    const grouped = (await client.projects.listGrouped({ search: 'Slip' })).groups
    const inProgress = grouped.find((g) => g.key === 'in_progress')!.projects
    expect(inProgress.find((p) => p.id === late.id)?.daysLate).toBe(2)
    expect(grouped.find((g) => g.key === 'completed')!.projects[0]).toMatchObject({
      id: finished.id,
      daysLate: null,
    })
  })

  it('shows the late chip on Home and the project deadline on the timeline', async () => {
    const owner = await createVolunteer()
    const late = await lateProject(owner, 'Home slip')
    const onTime = await createProject({ status: 'in_progress', assigneeId: owner.id })

    const client = clientAs(owner)
    const work = (await client.dashboard.get()).work
    expect(work.find((w) => w.key === `project-${late.id}`)?.daysLate).toBe(2)
    expect(work.find((w) => w.key === `project-${onTime.id}`)?.daysLate).toBeUndefined()

    const timeline = await client.projects.listTasks({ projectId: late.id })
    expect(timeline.projectDeadline).toEqual(day('2026-09-30'))
  })
})

describe('the project deadline and the key date', () => {
  it('lets the owner or an admin set the project deadline, not a proposer who never owned it', async () => {
    const owner = await createVolunteer()
    const proposer = await createVolunteer()
    const project = await createProject({
      status: 'in_progress',
      assigneeId: owner.id,
      creatorId: proposer.id,
    })
    await clientAs(owner).projects.update({ id: project.id, deadline: day('2026-10-30') })
    expect((await clientAs(owner).projects.getById({ id: project.id })).deadline).toEqual(
      day('2026-10-30'),
    )
    await expect(
      clientAs(proposer).projects.update({ id: project.id, deadline: day('2026-11-30') }),
    ).rejects.toMatchObject({
      message: 'Only the project owner or an admin can set the project deadline',
    })
    // The edit form posts every field back; an unchanged deadline is not a change.
    await clientAs(proposer).projects.update({ id: project.id, deadline: day('2026-10-30') })
    await clientAs(owner).projects.update({ id: project.id, deadline: null })
    expect((await clientAs(owner).projects.getById({ id: project.id })).deadline).toBeNull()
  })

  it('labels each task with its side of the key date', async () => {
    const owner = await createVolunteer()
    const project = await createProject({ status: 'in_progress', assigneeId: owner.id })
    const prep = await createTask(project.id, { title: 'Prep' })
    const event = await createTask(project.id, { title: 'Event', isAnchor: true })
    const press = await createTask(project.id, { title: 'Press' })
    const loose = await createTask(project.id, { title: 'Loose' })
    await prisma.workItemDependency.createMany({
      data: [
        { predecessorId: prep.id, successorId: event.id },
        { predecessorId: event.id, successorId: press.id },
      ],
    })
    const tasks = (await clientAs(owner).projects.getById({ id: project.id })).tasks
    const side = (id: number) => tasks.find((t) => t.id === id)?.keyDateSide
    expect([side(prep.id), side(event.id), side(press.id), side(loose.id)]).toEqual([
      'before',
      'key',
      'after',
      'other',
    ])

    // Without a key date there are no sides at all.
    const plain = await createProject({ status: 'in_progress', assigneeId: owner.id })
    const only = await createTask(plain.id)
    const plainTasks = (await clientAs(owner).projects.getById({ id: plain.id })).tasks
    expect(plainTasks.find((t) => t.id === only.id)?.keyDateSide).toBeNull()
  })
})
