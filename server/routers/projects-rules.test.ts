import { describe, it, expect } from 'vitest'
import {
  createVolunteer,
  createAdmin,
  createProject,
  createTask,
  createSkill,
} from '@/test/factories'
import { clientAs } from '@/test/rpc'
import { prisma } from '@/lib/prisma'

/**
 * Rules the project routers hold that no screen states outright: what a
 * project needs to be created, who may move a task, what leaving a project
 * does to the tasks left behind, and when an unreviewed proposal shows.
 */

const projectBody = (extra: Record<string, unknown> = {}) => ({
  title: 'A project',
  description: 'A description for the project',
  projectType: null,
  estimatedDuration: null,
  timeCommitmentHoursPerWeek: null,
  urgency: 'medium' as const,
  collaborationLink: null,
  country: null,
  localGroup: null,
  remoteEligibility: 'NONE' as const,
  isSeekingHelp: true,
  skillIds: [] as number[],
  skillRequiredMap: {} as Record<string, boolean>,
  tasks: [{ title: 'Initial task' }],
  ...extra,
})

describe('creating a project', () => {
  it('accepts a volunteer proposal with no tasks', async () => {
    const created = await clientAs(await createVolunteer()).projects.create(
      projectBody({ tasks: [] }),
    )
    expect(created.id).toEqual(expect.any(Number))
  })

  it('refuses an org project with no tasks', async () => {
    await expect(
      clientAs(await createAdmin()).admin.projects.create(
        projectBody({ isSeekingHelp: false, tasks: [] }),
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining('At least one task is required') })
  })
})

describe('a volunteer who does not manage the project', () => {
  it('cannot reorder its tasks', async () => {
    const project = await createProject()
    const task = await createTask(project.id)
    await expect(
      clientAs(await createVolunteer()).projects.reorderTasks({
        projectId: project.id,
        items: [{ id: task.id, sortOrder: 0 }],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('cannot assign one of its tasks to someone', async () => {
    const project = await createProject()
    const task = await createTask(project.id)
    const other = await createVolunteer()
    await expect(
      clientAs(await createVolunteer()).projects.assignTask({
        projectId: project.id,
        taskId: task.id,
        assigneeId: other.id,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('an accepted helper', () => {
  const accepted = async (projectId: number, message?: string) => {
    const v = await createVolunteer()
    await prisma.workItemInterest.create({
      data: {
        workItemId: projectId,
        volunteerId: v.id,
        interestType: 'want_to_contribute',
        status: 'accepted',
        message,
      },
    })
    return v
  }

  it('can add a task, where an outsider cannot', async () => {
    const project = await createProject({ isSeekingHelp: true })
    await expect(
      clientAs(await createVolunteer()).projects.createTask({
        projectId: project.id,
        title: 'Should be rejected',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const member = await accepted(project.id)
    expect(
      (await clientAs(member).projects.createTask({ projectId: project.id, title: 'Added' }))
        .message,
    ).toBe('Task created')
  })

  it('can delete their own task but not another helper’s', async () => {
    const project = await createProject({ isSeekingHelp: true })
    const a = await accepted(project.id)
    const b = await accepted(project.id)
    const task = await clientAs(a).projects.createTask({ projectId: project.id, title: 'Mine' })
    await expect(
      clientAs(b).projects.deleteTask({ projectId: project.id, taskId: task.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(
      await clientAs(a).projects.deleteTask({ projectId: project.id, taskId: task.id }),
    ).toEqual({ message: 'Task deleted' })
  })

  it('sees the helper roster without anyone’s private application message', async () => {
    const project = await createProject({ isSeekingHelp: true })
    const a = await accepted(project.id, 'a private message')
    const b = await accepted(project.id, 'b private message')
    const applicant = await createVolunteer()
    await clientAs(applicant).projects.expressInterest({
      projectId: project.id,
      interestType: 'want_to_contribute',
      message: 'pending private message',
    })
    const view = (await clientAs(a).projects.getById({ id: project.id })) as {
      helpers: { volunteerId: number; message?: string }[]
      interests: unknown
    }
    expect(view.helpers.map((h) => h.volunteerId).sort()).toEqual([a.id, b.id].sort())
    expect(view.helpers.every((h) => h.message === undefined)).toBe(true)
    expect(view.interests).toBeUndefined()
  })
})

describe('withdrawing from a project', () => {
  it('releases the tasks the volunteer held, and they cannot take them back', async () => {
    const project = await createProject({ isSeekingHelp: true })
    const task = await createTask(project.id)
    const me = await createVolunteer()
    const c = clientAs(me)
    await c.projects.updateTask({
      projectId: project.id,
      taskId: task.id,
      data: { assigneeId: me.id },
    })
    await c.projects.withdrawInterest({ projectId: project.id })

    const after = (await clientAs(await createAdmin()).projects.getTask({
      projectId: project.id,
      taskId: task.id,
    })) as { status: string; assignedToId: number | null }
    expect(after.status).toBe('not_started')
    expect(after.assignedToId).toBeNull()
    await expect(
      c.projects.updateTask({
        projectId: project.id,
        taskId: task.id,
        data: { assigneeId: me.id },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('ownership', () => {
  it('starts an org project with no owner as ready and seeking one', async () => {
    const admin = await createAdmin()
    const created = await clientAs(admin).admin.projects.create(
      projectBody({ isSeekingHelp: false }),
    )
    const project = (await clientAs(admin).projects.getById({ id: created.id })) as {
      status: string
      ownerId: number | null
      isSeekingOwner: boolean
    }
    expect(project).toMatchObject({ status: 'ready', ownerId: null, isSeekingOwner: true })
  })

  it('assigning an owner sets them and starts the project', async () => {
    const admin = await createAdmin()
    const created = await clientAs(admin).admin.projects.create(
      projectBody({ isSeekingHelp: false }),
    )
    const owner = await createVolunteer()
    await clientAs(admin).projects.assign({
      projectId: created.id,
      volunteerId: owner.id,
      interestType: 'want_to_own',
    })
    const project = (await clientAs(admin).projects.getById({ id: created.id })) as {
      status: string
      ownerId: number | null
      isSeekingOwner: boolean
    }
    expect(project).toMatchObject({
      status: 'in_progress',
      ownerId: owner.id,
      isSeekingOwner: false,
    })
  })
})

describe('suggestions', () => {
  it('keeps a proposal awaiting review out of matching volunteers’ suggestions until approved', async () => {
    const skill = await createSkill()
    const proposer = await createVolunteer()
    const proposed = await clientAs(proposer).projects.create(
      projectBody({ skillIds: [skill.id], skillRequiredMap: { [skill.id]: true } }),
    )
    const matcher = await createVolunteer()
    await clientAs(matcher).volunteers.updateMe({ skillIds: [skill.id] })

    const suggested = async () =>
      (
        (await clientAs(matcher).dashboard.get()) as {
          find: { matches: { items: { id: number }[] } }
        }
      ).find.matches.items.map((p) => p.id)
    expect(await suggested()).not.toContain(proposed.id)

    await clientAs(await createAdmin()).admin.projects.review({
      id: proposed.id,
      status: 'approved',
    })
    expect(await suggested()).toContain(proposed.id)
  })
})
