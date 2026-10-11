import { describe, it, expect } from 'vitest'
import {
  createVolunteer,
  createAdmin,
  createProject,
  createTask,
  createQuickTask,
} from '@/test/factories'
import { clientAs } from '@/test/rpc'

/**
 * What a volunteer whose application is still pending may not do, and what
 * nobody may do on their behalf: every door the approval gate keeps shut.
 */

const pending = () => createVolunteer({ approvalStatus: 'pending' })

describe('a pending volunteer', () => {
  it('cannot propose a project', async () => {
    await expect(
      clientAs(await pending()).projects.create({
        title: 'Blocked',
        description: 'Should be blocked',
        projectType: null,
        estimatedDuration: null,
        timeCommitmentHoursPerWeek: null,
        urgency: 'medium',
        collaborationLink: null,
        country: null,
        localGroup: null,
        remoteEligibility: 'NONE',
        isSeekingHelp: true,
        skillIds: [],
        skillRequiredMap: {},
        tasks: [{ title: 'Initial task' }],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('cannot express interest in a project', async () => {
    const project = await createProject({ isSeekingHelp: true })
    await expect(
      clientAs(await pending()).projects.expressInterest({
        projectId: project.id,
        interestType: 'want_to_contribute',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('cannot claim an open task', async () => {
    const project = await createProject({ isSeekingHelp: true })
    const task = await createTask(project.id)
    const me = await pending()
    await expect(
      clientAs(me).projects.updateTask({
        projectId: project.id,
        taskId: task.id,
        data: { status: 'in_progress', assigneeId: me.id },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('cannot claim a quick task', async () => {
    const qt = await createQuickTask()
    await expect(clientAs(await pending()).quickTasks.claim({ id: qt.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('cannot browse or view an open quick task, nor read its comments', async () => {
    const qt = await createQuickTask()
    const c = clientAs(await pending())
    await expect(c.quickTasks.available()).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(c.quickTasks.get({ id: qt.id })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    // The comment thread is a public procedure; the open-and-unclaimed carve-out
    // in canViewWorkItem is what keeps it from leaking.
    await expect(c.workItemComments.list({ workItemId: qt.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('cannot send a message', async () => {
    const recipient = await createVolunteer()
    await expect(
      clientAs(await pending()).messages.send({
        recipientId: recipient.id,
        subject: 'Hello',
        message: 'Should be blocked',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('cannot suggest a local group', async () => {
    await expect(
      clientAs(await pending()).localGroupSuggestions.create({
        name: 'Somewhere',
        country: 'Canada',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('is not listed in the volunteer directory', async () => {
    const me = await pending()
    const admin = await createAdmin()
    const result = (await clientAs(admin).volunteers.list({ limit: 100 })) as {
      volunteers: { id: number }[]
    }
    expect(result.volunteers.map((v) => v.id)).not.toContain(me.id)
  })
})

describe('an admin, on a pending volunteer', () => {
  it('cannot assign them a project', async () => {
    const project = await createProject()
    const me = await pending()
    await expect(
      clientAs(await createAdmin()).projects.assign({ projectId: project.id, volunteerId: me.id }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('cannot assign them a task', async () => {
    const project = await createProject()
    const task = await createTask(project.id)
    const me = await pending()
    await expect(
      clientAs(await createAdmin()).projects.assignTask({
        projectId: project.id,
        taskId: task.id,
        assigneeId: me.id,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('cannot assign them a quick task', async () => {
    const qt = await createQuickTask()
    const me = await pending()
    await expect(
      clientAs(await createAdmin()).quickTasks.assign({ id: qt.id, volunteerId: me.id }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})
