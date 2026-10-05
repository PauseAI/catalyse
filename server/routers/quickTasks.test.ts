import { describe, it, expect, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createVolunteer,
  createAdmin,
  createProject,
  createTask,
  createQuickTask,
  createSkill,
} from '@/test/factories'
import { clientAs } from '@/test/rpc'

const notified = (volunteerId: number, type: string, expected: object = {}) =>
  vi.waitFor(async () =>
    expect(await prisma.notification.findFirst({ where: { volunteerId, type } })).toMatchObject(
      expected,
    ),
  )

describe('quickTasks admin listing', () => {
  it('lists with filters and denormalised names; lists featured project tasks', async () => {
    const admin = await createAdmin()
    const c = clientAs(admin)
    const skill = await createSkill()
    const project = await createProject()
    const vol = await createVolunteer()
    const t1 = await createQuickTask({
      skillId: skill.id,
      contextProjectId: project.id,
      assigneeId: vol.id,
      status: 'under_review',
    })
    await createQuickTask({ reviewedById: admin.id, status: 'completed' })
    const all = await c.quickTasks.list({})
    expect(all).toHaveLength(2)
    expect(all.find((t) => t.id === t1.id)).toMatchObject({
      skillName: skill.name,
      skillCategory: expect.any(String),
      projectTitle: project.title,
      assignedToName: vol.name,
      reviewedByName: null,
    })
    expect(await c.quickTasks.list({ status: 'completed' })).toHaveLength(1)
    expect(await c.quickTasks.list({ skillId: skill.id })).toHaveLength(1)

    const featured = await createTask(project.id, { featuredAsQuickTask: true, assigneeId: vol.id })
    await createTask(project.id)
    await prisma.workItem.create({
      data: { type: 'TASK', status: 'open', title: 'orphan', featuredAsQuickTask: true },
    })
    const fp = await c.quickTasks.featuredProjectTasks()
    expect(fp).toEqual([
      expect.objectContaining({
        id: featured.id,
        projectTitle: project.title,
        assignedToName: vol.name,
      }),
    ])
  })
})

describe('quickTasks.available / get', () => {
  it('pools open quick tasks and featured project tasks, excluding blocked projects', async () => {
    const me = await createVolunteer()
    const skill = await createSkill()
    const p = await createProject()
    const blocked = await createProject()
    await prisma.workItemInterest.create({
      data: {
        workItemId: blocked.id,
        volunteerId: me.id,
        interestType: 'want_to_contribute',
        status: 'declined',
      },
    })
    const q = await createQuickTask({ skillId: skill.id, contextProjectId: p.id })
    await createQuickTask({ status: 'in_progress', assigneeId: me.id })
    const ft = await createTask(p.id, { featuredAsQuickTask: true })
    await createTask(blocked.id, { featuredAsQuickTask: true })
    await createTask(p.id)
    const list = await clientAs(me).quickTasks.available()
    expect(list.map((t) => [t.kind, t.id]).sort()).toEqual(
      [
        ['project_task', ft.id],
        ['quick', q.id],
      ].sort(),
    )
    expect(list.find((t) => t.kind === 'quick')).toMatchObject({
      skillName: skill.name,
      skillCategory: expect.any(String),
    })
    expect(list.find((t) => t.kind === 'project_task')).toMatchObject({
      projectId: p.id,
      projectTitle: p.title,
    })
  })

  it('get is open to the assignee, admins, or anyone while unclaimed', async () => {
    const me = await createVolunteer()
    const other = await createVolunteer()
    const skill = await createSkill()
    const p = await createProject()
    const q = await createQuickTask({ skillId: skill.id, contextProjectId: p.id })
    expect(await clientAs(other).quickTasks.get({ id: q.id })).toMatchObject({
      skillName: skill.name,
      projectTitle: p.title,
    })
    await expect(clientAs(other).quickTasks.get({ id: 999_999 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await prisma.workItem.update({
      where: { id: q.id },
      data: { assigneeId: me.id, status: 'in_progress' },
    })
    await expect(clientAs(other).quickTasks.get({ id: q.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect((await clientAs(me).quickTasks.get({ id: q.id })).assignedToId).toBe(me.id)
    expect((await clientAs(await createAdmin()).quickTasks.get({ id: q.id })).id).toBe(q.id)
    const bare = await createQuickTask()
    expect(await clientAs(other).quickTasks.get({ id: bare.id })).toMatchObject({
      skillName: null,
      projectTitle: null,
    })
  })
})

describe('quickTasks admin mutations', () => {
  it('creates, updates and deletes (removing derived endorsements)', async () => {
    const admin = await createAdmin()
    const c = clientAs(admin)
    const skill = await createSkill()
    const { id } = await c.quickTasks.create({ title: 'T', description: 'D' })
    expect(await prisma.workItem.findUniqueOrThrow({ where: { id } })).toMatchObject({
      type: 'QUICK_TASK',
      status: 'open',
      skillId: null,
    })
    const full = await c.quickTasks.create({
      title: 'T2',
      description: 'D',
      skillId: skill.id,
      estimatedHours: 2,
      contextProjectId: null,
    })
    expect(
      (await prisma.workItem.findUniqueOrThrow({ where: { id: full.id } })).estimatedHours,
    ).toBe(2)

    await expect(c.quickTasks.update({ id: 999_999 })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(
      await c.quickTasks.update({
        id,
        title: ' New ',
        description: ' Desc ',
        skillId: skill.id,
        estimatedHours: 3,
      }),
    ).toEqual({ id, message: 'Task updated' })
    await c.quickTasks.update({ id })
    expect(await prisma.workItem.findUniqueOrThrow({ where: { id } })).toMatchObject({
      title: 'New',
      description: 'Desc',
      skillId: skill.id,
      estimatedHours: 3,
    })

    const vol = await createVolunteer()
    await prisma.skillEndorsement.create({
      data: {
        volunteerId: vol.id,
        skillId: skill.id,
        endorsedById: admin.id,
        source: 'quick_task',
        sourceId: id,
      },
    })
    await expect(c.quickTasks.delete({ id: 999_999 })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await c.quickTasks.delete({ id })).toEqual({ message: 'Task deleted' })
    expect(await prisma.skillEndorsement.count({ where: { sourceId: id } })).toBe(0)
  })

  it('assigns and unassigns, tracking the actual start once', async () => {
    const admin = await createAdmin()
    const c = clientAs(admin)
    const vol = await createVolunteer()
    const q = await createQuickTask({ description: null })
    await expect(c.quickTasks.assign({ id: 999_999, volunteerId: vol.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await expect(c.quickTasks.assign({ id: q.id, volunteerId: 999_999 })).rejects.toMatchObject({
      message: 'Volunteer not found',
    })
    const pending = await createVolunteer({ approvalStatus: 'pending' })
    await expect(c.quickTasks.assign({ id: q.id, volunteerId: pending.id })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
    expect(await c.quickTasks.assign({ id: q.id, volunteerId: vol.id })).toEqual({
      message: 'Task assigned',
    })
    const first = await prisma.workItem.findUniqueOrThrow({ where: { id: q.id } })
    expect(first).toMatchObject({ assigneeId: vol.id, creatorId: admin.id, status: 'in_progress' })
    expect(first.startedAt).not.toBeNull()
    await notified(vol.id, 'quick_task_assigned', {
      title: `Assigned: Quick Task '${q.title}'`,
      link: `/quick-tasks/${q.id}`,
    })
    const vol2 = await createVolunteer()
    await c.quickTasks.assign({ id: q.id, volunteerId: vol2.id })
    expect((await prisma.workItem.findUniqueOrThrow({ where: { id: q.id } })).startedAt).toEqual(
      first.startedAt,
    )
    await expect(c.quickTasks.unassign({ id: 999_999 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect(await c.quickTasks.unassign({ id: q.id })).toEqual({ message: 'Task unassigned' })
    expect(await prisma.workItem.findUniqueOrThrow({ where: { id: q.id } })).toMatchObject({
      assigneeId: null,
      status: 'open',
      startedAt: null,
    })
  })
})

describe('quickTasks claim / submit / review', () => {
  it('claims atomically, submits to the assigner, and reviews with endorsements', async () => {
    const admin = await createAdmin()
    const vol = await createVolunteer()
    const other = await createVolunteer()
    const skill = await createSkill()
    const project = await createProject()
    const q = await createQuickTask({ skillId: skill.id, contextProjectId: project.id })

    await expect(clientAs(vol).quickTasks.claim({ id: 999_999 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect(await clientAs(vol).quickTasks.claim({ id: q.id })).toEqual({ message: 'Task claimed' })
    await expect(clientAs(other).quickTasks.claim({ id: q.id })).rejects.toMatchObject({
      message: 'This task has already been claimed',
    })

    await expect(clientAs(other).quickTasks.submit({ id: q.id, note: 'x' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await expect(
      clientAs(admin).quickTasks.review({ id: q.id, reviewRating: 'good' }),
    ).rejects.toMatchObject({ message: 'Task is not awaiting review' })
    await expect(clientAs(vol).quickTasks.submit({ id: q.id })).rejects.toMatchObject({
      message: 'Say what you did or add a link to it',
    })
    // No creator (self-claimed) → every admin is told.
    expect(await clientAs(vol).quickTasks.submit({ id: q.id, note: 'Translated it' })).toEqual({
      message: 'Task submitted for review',
    })
    expect(await prisma.workItem.findUniqueOrThrow({ where: { id: q.id } })).toMatchObject({
      status: 'under_review',
      submissionNote: 'Translated it',
    })
    await notified(admin.id, 'quick_task_submitted', {
      title: `Submitted for review: '${q.title}'`,
      body: `${vol.name}: Translated it`,
      entityId: q.id,
    })
    await expect(
      clientAs(vol).quickTasks.submit({ id: q.id, note: 'again' }),
    ).rejects.toMatchObject({ message: 'Only a task in progress can be submitted' })

    await expect(
      clientAs(admin).quickTasks.review({ id: 999_999, reviewRating: 'good' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(
      await clientAs(admin).quickTasks.review({
        id: q.id,
        reviewRating: 'excellent',
        reviewNotes: 'superb',
        comment: ' well done ',
      }),
    ).toEqual({ message: 'Task reviewed' })
    expect(await prisma.workItem.findUniqueOrThrow({ where: { id: q.id } })).toMatchObject({
      status: 'completed',
      reviewRating: 'excellent',
      reviewedById: admin.id,
    })
    expect(await prisma.workItemComment.findFirst({ where: { workItemId: q.id } })).toMatchObject({
      content: 'well done',
    })
    expect(await prisma.adminNote.findFirst({ where: { volunteerId: vol.id } })).toMatchObject({
      category: 'skill_feedback',
      content: `Quick Task '${q.title}': excellent - superb`,
      relatedWorkItemId: project.id,
    })
    expect(
      await prisma.skillEndorsement.findFirst({
        where: { volunteerId: vol.id, skillId: skill.id },
      }),
    ).toMatchObject({ rating: 'strong', sourceId: q.id })
    await notified(vol.id, 'quick_task_reviewed', {
      title: `Reviewed: your Quick Task '${q.title}'`,
      link: `/quick-tasks/${q.id}`,
    })

    // Assigned by an admin → submit notifies the assigner; 'good' → verified endorsement (upsert path).
    const q2 = await createQuickTask({ skillId: skill.id })
    await clientAs(admin).quickTasks.assign({ id: q2.id, volunteerId: vol.id })
    await clientAs(vol).quickTasks.submit({ id: q2.id, url: 'https://example.org/done' })
    await notified(admin.id, 'quick_task_submitted', { entityId: q2.id })
    await clientAs(admin).quickTasks.review({ id: q2.id, reviewRating: 'good' })
    expect(
      await prisma.skillEndorsement.findFirst({
        where: { volunteerId: vol.id, skillId: skill.id },
      }),
    ).toMatchObject({ rating: 'verified', sourceId: q2.id })
    expect(
      await prisma.notification.count({ where: { type: 'quick_task_submitted', entityId: q2.id } }),
    ).toBe(0)

    // needs_improvement, no skill, no comment → note only; and a task with no assignee.
    const q3 = await createQuickTask({ assigneeId: vol.id, status: 'under_review' })
    await clientAs(admin).quickTasks.review({
      id: q3.id,
      reviewRating: 'needs_improvement',
      comment: '  ',
    })
    expect(await prisma.adminNote.count({ where: { volunteerId: vol.id } })).toBe(3)
    const q4 = await createQuickTask({ status: 'under_review' })
    expect(await clientAs(admin).quickTasks.review({ id: q4.id, reviewRating: 'good' })).toEqual({
      message: 'Task reviewed',
    })
  })
})

describe('quickTasks.requestChanges', () => {
  it('sends a submission back to the assignee with the message, until they submit again', async () => {
    const admin = await createAdmin()
    const vol = await createVolunteer()
    const q = await createQuickTask({ assigneeId: vol.id, status: 'in_progress' })
    const c = clientAs(admin)

    await expect(c.quickTasks.requestChanges({ id: 999_999, message: 'x' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await expect(c.quickTasks.requestChanges({ id: q.id, message: 'x' })).rejects.toMatchObject({
      message: 'Task is not awaiting review',
    })
    await expect(
      clientAs(vol).quickTasks.requestChanges({ id: q.id, message: 'x' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    await clientAs(vol).quickTasks.submit({ id: q.id, note: 'Draft' })
    expect(await c.quickTasks.requestChanges({ id: q.id, message: 'Cite sources' })).toEqual({
      message: 'Changes requested',
    })
    expect(await prisma.workItem.findUniqueOrThrow({ where: { id: q.id } })).toMatchObject({
      status: 'in_progress',
      changesRequestedNote: 'Cite sources',
      reviewedById: admin.id,
    })
    expect(
      await prisma.notification.count({ where: { type: 'quick_task_submitted', entityId: q.id } }),
    ).toBe(0)
    await notified(vol.id, 'task_changes_requested', {
      title: `Changes requested: '${q.title}'`,
      body: 'Cite sources',
      link: `/quick-tasks/${q.id}`,
    })
    expect(await clientAs(vol).quickTasks.get({ id: q.id })).toMatchObject({
      changesRequested: 'Cite sources',
      reviewedByName: admin.name,
      submission: { note: 'Draft', url: null },
    })

    await clientAs(vol).quickTasks.submit({ id: q.id, note: 'With sources' })
    expect(
      await prisma.notification.count({
        where: { type: 'task_changes_requested', entityId: q.id },
      }),
    ).toBe(0)
    await c.quickTasks.review({ id: q.id, reviewRating: 'good' })
    expect(await prisma.workItem.findUniqueOrThrow({ where: { id: q.id } })).toMatchObject({
      status: 'completed',
      changesRequestedNote: null,
      submissionNote: 'With sources',
    })

    // Sending back a task nobody holds any more notifies no one.
    const orphan = await createQuickTask({ status: 'under_review' })
    await c.quickTasks.requestChanges({ id: orphan.id, message: 'Redo' })
    expect((await prisma.workItem.findUniqueOrThrow({ where: { id: orphan.id } })).status).toBe(
      'in_progress',
    )
  })

  it('forgets the submission when an admin unassigns the task', async () => {
    const admin = await createAdmin()
    const vol = await createVolunteer()
    const q = await createQuickTask({
      assigneeId: vol.id,
      status: 'in_progress',
      submissionNote: 'Half',
      submittedAt: new Date(),
      changesRequestedNote: 'More',
    })
    await clientAs(admin).quickTasks.unassign({ id: q.id })
    expect(await prisma.workItem.findUniqueOrThrow({ where: { id: q.id } })).toMatchObject({
      status: 'open',
      submissionNote: null,
      submittedAt: null,
      changesRequestedNote: null,
    })
  })
})
