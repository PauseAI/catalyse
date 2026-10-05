import { describe, it, expect, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createVolunteer,
  createAdmin,
  createProject,
  createTask,
  createTeam,
} from '@/test/factories'
import { clientAs } from '@/test/rpc'
import { emails } from '@/test/fakes/email'

const task = (id: number) => prisma.workItem.findUniqueOrThrow({ where: { id } })

describe('projects.listTasks / getTask', () => {
  it('lists tasks with schedule, dependencies and manage rights, gated on project visibility', async () => {
    const owner = await createVolunteer()
    const me = await createVolunteer()
    const project = await createProject({
      assigneeId: owner.id,
      status: 'in_progress',
      startDate: new Date('2026-04-01T00:00:00Z'),
    })
    const a = await createTask(project.id, {
      sortOrder: 1,
      durationDays: 2,
      assigneeId: me.id,
      creatorId: owner.id,
    })
    const b = await createTask(project.id, { sortOrder: 2 })
    const done = await createTask(project.id, { sortOrder: 0, status: 'completed' })
    // Same sortOrder as `b`, created later → listed first within that order.
    const tie = await createTask(project.id, {
      sortOrder: 2,
      createdAt: new Date(Date.now() + 60_000),
    })
    await prisma.workItemDependency.create({
      data: { predecessorId: a.id, successorId: b.id, lagDays: 1 },
    })
    await expect(clientAs(me).projects.listTasks({ projectId: 999_999 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    const res = await clientAs(me).projects.listTasks({ projectId: project.id })
    expect(res.tasks.map((t) => t.id)).toEqual([a.id, tie.id, b.id, done.id])
    expect(res.tasks[0]).toMatchObject({ assignedToName: me.name, createdByName: owner.name })
    expect(res.dependencies).toEqual([
      expect.objectContaining({ predecessorId: a.id, successorId: b.id, lagDays: 1 }),
    ])
    expect(res.scheduled.find((s) => s.id === b.id)?.start).toEqual(
      new Date('2026-04-04T00:00:00Z'),
    )
    expect(res.scopeOrigin).toEqual(new Date('2026-04-01T00:00:00Z'))
    expect(res.canManageTasks).toBe(false)
    expect(
      (await clientAs(owner).projects.listTasks({ projectId: project.id })).canManageTasks,
    ).toBe(true)

    // A task pinned before the origin extends the scope backwards.
    await prisma.workItem.update({
      where: { id: a.id },
      data: { startDate: new Date('2026-03-01T00:00:00Z') },
    })
    expect((await clientAs(me).projects.listTasks({ projectId: project.id })).scopeStart).toEqual(
      new Date('2026-03-01T00:00:00Z'),
    )

    const hidden = await createProject({ status: 'pending_review' })
    await expect(clientAs(me).projects.listTasks({ projectId: hidden.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('getTask returns detail with predecessors, siblings and claim/manage flags', async () => {
    const owner = await createVolunteer()
    const me = await createVolunteer()
    const project = await createProject({ assigneeId: owner.id, status: 'in_progress' })
    const a = await createTask(project.id, { sortOrder: 1 })
    const b = await createTask(project.id, { sortOrder: 2, featuredAsQuickTask: true })
    await prisma.workItemDependency.create({ data: { predecessorId: a.id, successorId: b.id } })
    await expect(
      clientAs(me).projects.getTask({ projectId: 999_999, taskId: b.id }),
    ).rejects.toMatchObject({ message: 'Project not found' })
    await expect(
      clientAs(me).projects.getTask({ projectId: project.id, taskId: 999_999 }),
    ).rejects.toMatchObject({ message: 'Task not found' })
    const view = await clientAs(me).projects.getTask({ projectId: project.id, taskId: b.id })
    expect(view).toMatchObject({
      projectTitle: project.title,
      projectOwnerId: owner.id,
      canClaim: true,
      canManage: false,
      featuredAsQuickTask: true,
      assignedToName: null,
      createdByName: null,
      assigneeHasPosted: false,
    })
    // Only the assignee's own comments count as an update.
    await prisma.workItem.update({ where: { id: b.id }, data: { assigneeId: me.id } })
    await prisma.workItemComment.create({
      data: { workItemId: b.id, authorId: owner.id, content: 'How is it going?' },
    })
    expect(
      (await clientAs(me).projects.getTask({ projectId: project.id, taskId: b.id }))
        .assigneeHasPosted,
    ).toBe(false)
    await prisma.workItemComment.create({
      data: { workItemId: b.id, authorId: me.id, content: 'Started on it' },
    })
    expect(
      (await clientAs(me).projects.getTask({ projectId: project.id, taskId: b.id }))
        .assigneeHasPosted,
    ).toBe(true)
    expect(view.predecessors).toEqual([
      expect.objectContaining({ predecessorId: a.id, predecessorTitle: a.title, lagDays: 0 }),
    ])
    expect(view.siblingTasks).toEqual([{ id: a.id, title: a.title }])
    expect(
      (await clientAs(owner).projects.getTask({ projectId: project.id, taskId: b.id })).canManage,
    ).toBe(true)

    const team = await createTeam()
    const teamP = await createProject({ teamId: team.id })
    const t = await createTask(teamP.id)
    await expect(
      clientAs(me).projects.getTask({ projectId: teamP.id, taskId: t.id }),
    ).rejects.toMatchObject({ message: 'Task not found' })
  })
})

describe('projects.createTask / reorderTasks / deleteTask', () => {
  it('manages the backlog as owner, draft creator or admin', async () => {
    const owner = await createVolunteer()
    const other = await createVolunteer()
    const project = await createProject({ assigneeId: owner.id, status: 'in_progress' })
    const c = clientAs(owner)
    await expect(c.projects.createTask({ projectId: 999_999, title: 'x' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await expect(
      clientAs(other).projects.createTask({ projectId: project.id, title: 'x' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const t1 = await c.projects.createTask({ projectId: project.id, title: 'First' })
    const t2 = await c.projects.createTask({
      projectId: project.id,
      title: 'Second',
      description: 'd',
      estimatedHours: 2,
      deadline: new Date('2026-09-01T00:00:00Z'),
      featuredAsQuickTask: true,
      startDate: new Date('2026-08-01T00:00:00Z'),
      durationDays: 3,
    })
    expect((await task(t1.id)).sortOrder).toBe(1)
    expect(await task(t2.id)).toMatchObject({
      sortOrder: 2,
      estimatedHours: 2,
      featuredAsQuickTask: true,
      durationDays: 3,
    })

    await expect(
      clientAs(other).projects.reorderTasks({ projectId: project.id, items: [] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(c.projects.reorderTasks({ projectId: 999_999, items: [] })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect(
      await c.projects.reorderTasks({
        projectId: project.id,
        items: [
          { id: t1.id, sortOrder: 5 },
          { id: t2.id, sortOrder: 4 },
        ],
      }),
    ).toEqual({ success: true })
    expect((await task(t1.id)).sortOrder).toBe(5)

    await expect(
      clientAs(other).projects.deleteTask({ projectId: project.id, taskId: t1.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      c.projects.deleteTask({ projectId: 999_999, taskId: t1.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(
      c.projects.deleteTask({ projectId: project.id, taskId: 999_999 }),
    ).rejects.toMatchObject({ message: 'Task not found' })
    // The task can vanish between the permission check and the delete.
    vi.spyOn(prisma.workItem, 'deleteMany').mockResolvedValueOnce({ count: 0 })
    await expect(
      c.projects.deleteTask({ projectId: project.id, taskId: t1.id }),
    ).rejects.toMatchObject({ message: 'Task not found' })
    expect(await c.projects.deleteTask({ projectId: project.id, taskId: t1.id })).toEqual({
      message: 'Task deleted',
    })

    const draft = await createProject({ status: 'draft', creatorId: other.id })
    expect(
      (await clientAs(other).projects.createTask({ projectId: draft.id, title: 'Draft task' }))
        .message,
    ).toBe('Task created')
  })
})

describe('projects.setBaseline', () => {
  it('copies the current schedule onto the baseline for scheduled items', async () => {
    const owner = await createVolunteer()
    const other = await createVolunteer()
    const project = await createProject({
      assigneeId: owner.id,
      startDate: new Date('2026-01-01T00:00:00Z'),
      durationDays: 10,
    })
    const scheduled = await createTask(project.id, { durationDays: 2 })
    const unscheduled = await createTask(project.id)
    await expect(
      clientAs(other).projects.setBaseline({ projectId: project.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      clientAs(owner).projects.setBaseline({ projectId: 999_999 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await clientAs(owner).projects.setBaseline({ projectId: project.id })).toEqual({
      message: 'Baseline updated',
    })
    expect(await task(project.id)).toMatchObject({
      baselineStartDate: new Date('2026-01-01T00:00:00Z'),
      baselineDurationDays: 10,
    })
    expect((await task(scheduled.id)).baselineDurationDays).toBe(2)
    expect((await task(unscheduled.id)).baselineSetAt).toBeNull()
    await prisma.workItem.update({ where: { id: scheduled.id }, data: { durationDays: 5 } })
    await clientAs(owner).projects.setBaseline({ projectId: project.id, includeTasks: false })
    expect((await task(scheduled.id)).baselineDurationDays).toBe(2)
  })
})

describe('projects.ganttOverview', () => {
  it('places visible projects with their edges and task counts', async () => {
    const me = await createVolunteer()
    const team = await createTeam()
    const a = await createProject({
      title: 'gantt a',
      durationDays: 3,
      country: 'UK',
      localGroup: 'L',
    })
    const b = await createProject({ title: 'gantt b', status: 'in_progress', assigneeId: me.id })
    await createTask(b.id)
    await createTask(b.id)
    const hidden = await createProject({ teamId: team.id })
    const done = await createProject({ status: 'completed' })
    await prisma.workItemDependency.createMany({
      data: [
        { predecessorId: a.id, successorId: b.id },
        { predecessorId: hidden.id, successorId: b.id },
      ],
    })

    const res = await clientAs(me).projects.ganttOverview({})
    const idsSeen = res.projects.map((p) => p.id)
    expect(idsSeen).toEqual(expect.arrayContaining([a.id, b.id]))
    expect(idsSeen).not.toContain(hidden.id)
    expect(idsSeen).not.toContain(done.id)
    expect(res.projects.find((p) => p.id === b.id)).toMatchObject({ taskCount: 2 })
    expect(res.projects.find((p) => p.id === a.id)!.placement).not.toBeNull()
    expect(res.dependencies).toEqual([
      expect.objectContaining({ predecessorId: a.id, successorId: b.id }),
    ])

    expect(
      (await clientAs(me).projects.ganttOverview({ statuses: ['completed'] })).projects.map(
        (p) => p.id,
      ),
    ).toEqual([done.id])
    expect(
      (await clientAs(me).projects.ganttOverview({ country: 'UK', localGroup: 'L' })).projects.map(
        (p) => p.id,
      ),
    ).toEqual([a.id])
    await prisma.teamMembership.create({ data: { teamId: team.id, volunteerId: me.id } })
    expect(
      (await clientAs(me).projects.ganttOverview({ teamId: team.id })).projects.map((p) => p.id),
    ).toEqual([hidden.id])
    expect(
      (await clientAs(await createAdmin()).projects.ganttOverview({ teamId: team.id })).projects,
    ).toHaveLength(1)
  })
})

describe('projects.updateTask', () => {
  it('lets the owner edit any field and tracks actual start/finish', async () => {
    const owner = await createVolunteer()
    const helper = await createVolunteer()
    const project = await createProject({ assigneeId: owner.id, status: 'in_progress' })
    const t = await createTask(project.id)
    const c = clientAs(owner)
    await expect(
      c.projects.updateTask({ projectId: project.id, taskId: 999_999, data: {} }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await c.projects.updateTask({
      projectId: project.id,
      taskId: t.id,
      data: {
        title: 'T2',
        description: 'd',
        estimatedHours: 1,
        deadline: new Date('2026-10-01T00:00:00Z'),
        featuredAsQuickTask: true,
        isAnchor: true,
        startDate: new Date('2026-09-01T00:00:00Z'),
        durationDays: 2,
        assigneeId: helper.id,
        status: 'in_progress',
      },
    })
    const after = await task(t.id)
    expect(after).toMatchObject({
      title: 'T2',
      assigneeId: helper.id,
      status: 'in_progress',
      isAnchor: true,
      durationDays: 2,
    })
    expect(after.startedAt).not.toBeNull()
    const started = after.startedAt
    await c.projects.updateTask({
      projectId: project.id,
      taskId: t.id,
      data: { status: 'in_progress' },
    })
    expect((await task(t.id)).startedAt).toEqual(started)
    await c.projects.updateTask({
      projectId: project.id,
      taskId: t.id,
      data: { status: 'completed' },
    })
    expect((await task(t.id)).completedAt).not.toBeNull()
    await prisma.workItem.update({
      where: { id: t.id },
      data: { submissionNote: 'Did it', submittedAt: new Date(), changesRequestedNote: 'More' },
    })
    await c.projects.updateTask({ projectId: project.id, taskId: t.id, data: { status: 'open' } })
    expect(await task(t.id)).toMatchObject({
      assigneeId: null,
      completedAt: null,
      startedAt: null,
      submissionNote: null,
      submittedAt: null,
      changesRequestedNote: null,
    })
  })

  it('allows self-claim, but nothing more, for members who are not owners', async () => {
    const owner = await createVolunteer()
    const me = await createVolunteer()
    const rival = await createVolunteer()
    // A member of the project's team is on the project, so claiming is immediate.
    const crew = await createTeam()
    await prisma.teamMembership.create({ data: { teamId: crew.id, volunteerId: me.id } })
    const project = await createProject({
      assigneeId: owner.id,
      status: 'in_progress',
      teamId: crew.id,
    })
    const t = await createTask(project.id)
    const c = clientAs(me)
    await expect(
      c.projects.updateTask({ projectId: project.id, taskId: t.id, data: { title: 'x' } }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      c.projects.updateTask({
        projectId: project.id,
        taskId: t.id,
        data: { status: 'in_progress', assigneeId: me.id, title: 'sneaky' },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(
      await c.projects.updateTask({
        projectId: project.id,
        taskId: t.id,
        data: { status: 'in_progress', assigneeId: me.id },
      }),
    ).toEqual({ message: 'Task updated', requested: false })
    expect(await task(t.id)).toMatchObject({ assigneeId: me.id, status: 'in_progress' })
    expect(
      await prisma.workItemInterest.findFirst({
        where: { workItemId: project.id, volunteerId: me.id },
      }),
    ).toMatchObject({ status: 'accepted', message: `${me.name} has claimed '${t.title}' task` })
    // Rival cannot claim an already-claimed task (status is no longer open → not a self-claim).
    await expect(
      clientAs(rival).projects.updateTask({
        projectId: project.id,
        taskId: t.id,
        data: { status: 'in_progress', assigneeId: rival.id },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    // The assignee finishes by submitting their work (projects.submitTask), not by setting it.
    await expect(
      c.projects.updateTask({ projectId: project.id, taskId: t.id, data: { status: 'completed' } }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    // A second self-claim on another task reuses the existing interest row.
    const t2 = await createTask(project.id)
    await c.projects.updateTask({
      projectId: project.id,
      taskId: t2.id,
      data: { status: 'in_progress', assigneeId: me.id },
    })
    expect(
      await prisma.workItemInterest.count({
        where: { workItemId: project.id, volunteerId: me.id },
      }),
    ).toBe(1)

    // Declined volunteers cannot claim; team outsiders cannot reach the project.
    await prisma.workItemInterest.update({
      where: { volunteerId_workItemId: { volunteerId: me.id, workItemId: project.id } },
      data: { status: 'declined' },
    })
    const t3 = await createTask(project.id)
    await expect(
      c.projects.updateTask({
        projectId: project.id,
        taskId: t3.id,
        data: { status: 'in_progress', assigneeId: me.id },
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('no longer contributing') })
    const team = await createTeam()
    const teamP = await createProject({
      teamId: team.id,
      status: 'in_progress',
      assigneeId: owner.id,
    })
    const tt = await createTask(teamP.id)
    await expect(
      clientAs(rival).projects.updateTask({
        projectId: teamP.id,
        taskId: tt.id,
        data: { status: 'in_progress', assigneeId: rival.id },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })

    // Claim race: the guarded hold finds the task already taken.
    const open = await createProject({ assigneeId: owner.id, status: 'in_progress' })
    const t4 = await createTask(open.id)
    const spy = vi.spyOn(prisma.workItem, 'updateMany').mockResolvedValueOnce({ count: 0 })
    await expect(
      clientAs(rival).projects.updateTask({
        projectId: open.id,
        taskId: t4.id,
        data: { status: 'in_progress', assigneeId: rival.id },
      }),
    ).rejects.toMatchObject({ message: 'This task has already been claimed' })
    spy.mockRestore()

    // The creator of a draft may edit its tasks.
    const draft = await createProject({ status: 'draft', creatorId: me.id })
    const dt = await createTask(draft.id)
    await c.projects.updateTask({ projectId: draft.id, taskId: dt.id, data: { title: 'edited' } })
    expect((await task(dt.id)).title).toBe('edited')
  })
})

describe('projects.assignTask', () => {
  it('assigns an approved volunteer to an unfinished task and notifies them', async () => {
    const owner = await createVolunteer()
    const other = await createVolunteer()
    const vol = await createVolunteer()
    const project = await createProject({ assigneeId: owner.id, status: 'in_progress' })
    const t = await createTask(project.id)
    const c = clientAs(owner)
    await expect(
      c.projects.assignTask({ projectId: project.id, taskId: 999_999, assigneeId: vol.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(
      clientAs(other).projects.assignTask({
        projectId: project.id,
        taskId: t.id,
        assigneeId: vol.id,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      c.projects.assignTask({ projectId: project.id, taskId: t.id, assigneeId: 999_999 }),
    ).rejects.toMatchObject({ message: 'Volunteer not found' })
    const pending = await createVolunteer({ approvalStatus: 'pending' })
    await expect(
      c.projects.assignTask({ projectId: project.id, taskId: t.id, assigneeId: pending.id }),
    ).rejects.toMatchObject({ message: expect.stringContaining('not yet approved') })
    expect(
      await c.projects.assignTask({ projectId: project.id, taskId: t.id, assigneeId: vol.id }),
    ).toEqual({ message: 'Task assigned' })
    const first = await task(t.id)
    expect(first).toMatchObject({ assigneeId: vol.id, status: 'in_progress' })
    await vi.waitFor(async () =>
      expect(
        await prisma.notification.findMany({
          where: { volunteerId: vol.id, type: 'task_assigned' },
        }),
      ).toEqual([
        expect.objectContaining({
          title: `Assigned: a task on '${project.title}'`,
          link: `/projects/${project.id}`,
        }),
      ]),
    )
    await c.projects.assignTask({ projectId: project.id, taskId: t.id, assigneeId: other.id })
    expect((await task(t.id)).startedAt).toEqual(first.startedAt)
    await prisma.workItem.update({ where: { id: t.id }, data: { status: 'completed' } })
    await expect(
      c.projects.assignTask({ projectId: project.id, taskId: t.id, assigneeId: vol.id }),
    ).rejects.toMatchObject({ message: 'Cannot assign a completed task' })
  })
})

describe('projects.submitTask / acceptTask / requestTaskChanges', () => {
  const notices = (volunteerId: number, type: string) =>
    prisma.notification.findMany({ where: { volunteerId, type } })

  it('finishes a task on an auto-accepting project and tells the owner what was done', async () => {
    const owner = await createVolunteer()
    const me = await createVolunteer()
    const project = await createProject({ assigneeId: owner.id, status: 'in_progress' })
    const t = await createTask(project.id, { assigneeId: me.id, status: 'in_progress' })
    const c = clientAs(me)

    await expect(
      c.projects.submitTask({ projectId: project.id, taskId: 999_999, note: 'x' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(
      clientAs(owner).projects.submitTask({ projectId: project.id, taskId: t.id, note: 'x' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      c.projects.submitTask({ projectId: project.id, taskId: t.id, note: ' ', url: '' }),
    ).rejects.toMatchObject({ message: 'Say what you did or add a link to it' })
    await expect(
      c.projects.submitTask({ projectId: project.id, taskId: t.id, url: 'javascript:alert(1)' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })

    expect(
      await c.projects.submitTask({
        projectId: project.id,
        taskId: t.id,
        note: 'Wrote the leaflet',
        url: 'https://example.org/leaflet',
      }),
    ).toEqual({ message: 'Task done', status: 'completed' })
    const after = await task(t.id)
    expect(after).toMatchObject({
      status: 'completed',
      submissionNote: 'Wrote the leaflet',
      submissionUrl: 'https://example.org/leaflet',
    })
    expect(after.completedAt).toEqual(after.submittedAt)
    await vi.waitFor(async () =>
      expect(await notices(owner.id, 'task_done')).toEqual([
        expect.objectContaining({
          title: `Done: '${t.title}'`,
          body: `${me.name}: Wrote the leaflet`,
          link: `/projects/${project.id}/tasks/${t.id}`,
        }),
      ]),
    )

    await expect(
      c.projects.submitTask({ projectId: project.id, taskId: t.id, note: 'again' }),
    ).rejects.toMatchObject({ message: 'Only a task in progress can be submitted' })

    // The owner finishing their own task, or a task on a project with no owner, is not queued.
    const own = await createTask(project.id, { assigneeId: owner.id, status: 'in_progress' })
    await prisma.workItem.update({ where: { id: project.id }, data: { autoAcceptTasks: false } })
    expect(
      await clientAs(owner).projects.submitTask({
        projectId: project.id,
        taskId: own.id,
        note: 'ok',
      }),
    ).toMatchObject({ status: 'completed' })
    const orphan = await createProject({ status: 'ready', autoAcceptTasks: false })
    const ot = await createTask(orphan.id, { assigneeId: me.id, status: 'in_progress' })
    expect(
      await c.projects.submitTask({ projectId: orphan.id, taskId: ot.id, url: 'https://x.org' }),
    ).toMatchObject({ status: 'completed' })
  })

  it('queues work for the owner, who accepts it or asks for changes', async () => {
    const owner = await createVolunteer()
    const me = await createVolunteer()
    const other = await createVolunteer()
    const project = await createProject({
      assigneeId: owner.id,
      status: 'in_progress',
      autoAcceptTasks: false,
    })
    const t = await createTask(project.id, { assigneeId: me.id, status: 'in_progress' })
    const c = clientAs(me)
    const o = clientAs(owner)
    const ids = { projectId: project.id, taskId: t.id }

    await expect(o.projects.acceptTask(ids)).rejects.toMatchObject({
      message: 'This task is not waiting for review',
    })
    expect(await c.projects.submitTask({ ...ids, note: 'First go' })).toEqual({
      message: 'Task submitted for review',
      status: 'under_review',
    })
    expect(await task(t.id)).toMatchObject({ status: 'under_review', completedAt: null })
    const [submitted] = await notices(owner.id, 'task_submitted')
    expect(submitted).toMatchObject({
      title: `Submitted for review: '${t.title}'`,
      body: `${me.name}: First go`,
      entityId: t.id,
    })
    await vi.waitFor(() =>
      expect(emails.lastTo(owner.email!)?.html).toContain('submitted the task'),
    )

    await expect(
      clientAs(other).projects.requestTaskChanges({ ...ids, message: 'no' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(o.projects.requestTaskChanges({ ...ids, message: ' ' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
    expect(await o.projects.requestTaskChanges({ ...ids, message: 'Add the sources' })).toEqual({
      message: 'Changes requested',
    })
    expect(await task(t.id)).toMatchObject({
      status: 'in_progress',
      changesRequestedNote: 'Add the sources',
      reviewedById: owner.id,
    })
    expect(await notices(owner.id, 'task_submitted')).toEqual([])
    await vi.waitFor(async () =>
      expect(await notices(me.id, 'task_changes_requested')).toEqual([
        expect.objectContaining({ body: 'Add the sources', entityId: t.id }),
      ]),
    )

    // The assignee sees the request; someone else on the project does not.
    expect((await c.projects.getTask(ids)).changesRequested).toEqual({
      message: 'Add the sources',
      byName: owner.name,
    })
    expect((await clientAs(other).projects.getTask(ids)).changesRequested).toBeNull()

    await c.projects.submitTask({ ...ids, url: 'https://example.org/v2' })
    expect(await task(t.id)).toMatchObject({
      status: 'under_review',
      submissionNote: null,
      changesRequestedNote: null,
    })
    // Handing the work back in deals with the request, so it leaves the Inbox.
    expect(await notices(me.id, 'task_changes_requested')).toEqual([])
    expect((await c.projects.getTask(ids)).submission).toMatchObject({
      note: null,
      url: 'https://example.org/v2',
    })
    expect(await o.projects.acceptTask(ids)).toEqual({ message: 'Task accepted' })
    const done = await task(t.id)
    expect(done).toMatchObject({ status: 'completed', reviewedById: owner.id })
    expect(done.completedAt).not.toBeNull()
    await vi.waitFor(async () =>
      expect(await notices(me.id, 'task_accepted')).toEqual([
        expect.objectContaining({ title: `Accepted: '${t.title}'` }),
      ]),
    )
  })

  it('reviews a task whose assignee has since gone without notifying anyone', async () => {
    const owner = await createVolunteer()
    const admin = await createAdmin()
    const project = await createProject({ assigneeId: owner.id, status: 'in_progress' })
    const a = await createTask(project.id, { status: 'under_review' })
    const b = await createTask(project.id, { status: 'under_review' })
    await clientAs(admin).projects.acceptTask({ projectId: project.id, taskId: a.id })
    await clientAs(admin).projects.requestTaskChanges({
      projectId: project.id,
      taskId: b.id,
      message: 'Redo',
    })
    expect((await task(a.id)).status).toBe('completed')
    expect((await task(b.id)).status).toBe('in_progress')
  })

  it('lets the owner switch auto-accept off, but not a proposer who does not run the project', async () => {
    const owner = await createVolunteer()
    const proposer = await createVolunteer()
    const project = await createProject({
      creatorId: proposer.id,
      assigneeId: owner.id,
      status: 'in_progress',
    })
    expect(project.autoAcceptTasks).toBe(true)
    await expect(
      clientAs(proposer).projects.update({ id: project.id, autoAcceptTasks: false }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    // Posting the current value back, as the edit form does, is not a change.
    await clientAs(proposer).projects.update({ id: project.id, autoAcceptTasks: true })
    expect((await task(project.id)).autoAcceptTasks).toBe(true)
    await clientAs(owner).projects.update({ id: project.id, autoAcceptTasks: false })
    expect((await task(project.id)).autoAcceptTasks).toBe(false)
    expect((await clientAs(owner).projects.getById({ id: project.id })).autoAcceptTasks).toBe(false)
  })

  it('releases a submission with the task when its assignee leaves the project', async () => {
    const owner = await createVolunteer()
    const me = await createVolunteer()
    const project = await createProject({
      assigneeId: owner.id,
      status: 'in_progress',
      autoAcceptTasks: false,
    })
    await prisma.workItemInterest.create({
      data: {
        workItemId: project.id,
        volunteerId: me.id,
        status: 'accepted',
        interestType: 'want_to_contribute',
      },
    })
    const t = await createTask(project.id, { assigneeId: me.id, status: 'in_progress' })
    await clientAs(me).projects.submitTask({ projectId: project.id, taskId: t.id, note: 'Half' })
    await clientAs(me).projects.withdrawInterest({ projectId: project.id })
    expect(await task(t.id)).toMatchObject({
      status: 'open',
      assigneeId: null,
      submissionNote: null,
      submittedAt: null,
    })
  })
})

describe('claiming before joining', () => {
  const claim = (
    who: Awaited<ReturnType<typeof createVolunteer>>,
    projectId: number,
    taskId: number,
  ) =>
    clientAs(who).projects.updateTask({
      projectId,
      taskId,
      data: { status: 'in_progress', assigneeId: who.id },
    })

  it('holds the task and asks the owner, who hands it over by accepting', async () => {
    const owner = await createVolunteer()
    const me = await createVolunteer({ name: 'Nell New' })
    const member = await createVolunteer()
    const project = await createProject({ assigneeId: owner.id, status: 'in_progress' })
    await prisma.workItemInterest.create({
      data: {
        workItemId: project.id,
        volunteerId: member.id,
        interestType: 'want_to_contribute',
        status: 'accepted',
      },
    })
    const t = await createTask(project.id, { title: 'Poster' })

    expect(await claim(me, project.id, t.id)).toEqual({
      message: 'Task requested',
      requested: true,
    })
    expect(await task(t.id)).toMatchObject({
      requestedById: me.id,
      assigneeId: null,
      status: 'open',
    })
    const interest = await prisma.workItemInterest.findFirstOrThrow({
      where: { workItemId: project.id, volunteerId: me.id },
    })
    expect(interest).toMatchObject({ status: 'pending', message: "Asked to take 'Poster'" })
    await vi.waitFor(async () =>
      expect(
        await prisma.notification.findFirst({
          where: { volunteerId: owner.id, type: 'new_interest' },
        }),
      ).toMatchObject({ entityId: interest.id }),
    )
    // Held: nobody else can take it, and it is not offered on the Quick Tasks page.
    await expect(claim(member, project.id, t.id)).rejects.toMatchObject({
      message: 'This task has already been claimed',
    })
    const listed = await clientAs(owner).projects.getById({ id: project.id })
    expect(listed.tasks.find((x) => x.id === t.id)).toMatchObject({
      requestedById: me.id,
      requestedByName: 'Nell New',
    })

    // A second task asks nothing new of the owner.
    const t2 = await createTask(project.id, { title: 'Flyer' })
    await claim(me, project.id, t2.id)
    expect(
      await prisma.notification.count({ where: { volunteerId: owner.id, type: 'new_interest' } }),
    ).toBe(1)

    await clientAs(owner).projects.respondToInterest({
      projectId: project.id,
      interestId: interest.id,
      status: 'accepted',
    })
    for (const id of [t.id, t2.id]) {
      const after = await task(id)
      expect(after).toMatchObject({ assigneeId: me.id, status: 'in_progress', requestedById: null })
      expect(after.startedAt).not.toBeNull()
    }
    // Once on the project, claiming is immediate.
    const t3 = await createTask(project.id)
    expect(await claim(me, project.id, t3.id)).toEqual({
      message: 'Task updated',
      requested: false,
    })
  })

  it('frees a held task when the request is declined or withdrawn, or the owner assigns it', async () => {
    const owner = await createVolunteer()
    const me = await createVolunteer()
    const other = await createVolunteer()
    const project = await createProject({ assigneeId: owner.id, status: 'in_progress' })
    const a = await createTask(project.id)
    await claim(me, project.id, a.id)
    const row = await prisma.workItemInterest.findFirstOrThrow({ where: { volunteerId: me.id } })
    await clientAs(owner).projects.respondToInterest({
      projectId: project.id,
      interestId: row.id,
      status: 'declined',
    })
    expect((await task(a.id)).requestedById).toBeNull()

    const b = await createTask(project.id)
    await claim(other, project.id, b.id)
    await clientAs(other).projects.withdrawInterest({ projectId: project.id })
    expect((await task(b.id)).requestedById).toBeNull()

    const c = await createTask(project.id)
    await claim(await createVolunteer(), project.id, c.id)
    await clientAs(owner).projects.assignTask({
      projectId: project.id,
      taskId: c.id,
      assigneeId: owner.id,
    })
    expect(await task(c.id)).toMatchObject({ assigneeId: owner.id, requestedById: null })
    await clientAs(owner).projects.updateTask({
      projectId: project.id,
      taskId: c.id,
      data: { status: 'open' },
    })
    expect(await task(c.id)).toMatchObject({ assigneeId: null, requestedById: null })
  })

  it('treats a claim by someone invited as accepting the invite, and an admin add as accepting', async () => {
    const owner = await createVolunteer()
    const invitee = await createVolunteer()
    const asker = await createVolunteer()
    const project = await createProject({ assigneeId: owner.id, status: 'in_progress' })
    await clientAs(owner).projects.invite({ projectId: project.id, volunteerId: invitee.id })
    const t = await createTask(project.id)
    expect(await claim(invitee, project.id, t.id)).toMatchObject({ requested: false })
    expect(await task(t.id)).toMatchObject({ assigneeId: invitee.id, status: 'in_progress' })
    expect(
      await prisma.workItemInterest.findFirstOrThrow({ where: { volunteerId: invitee.id } }),
    ).toMatchObject({ status: 'accepted' })
    expect(
      await prisma.notification.count({
        where: { volunteerId: invitee.id, type: 'project_invite' },
      }),
    ).toBe(0)

    // Someone who applied and is then invited, or added by an admin, gets their held task.
    const t2 = await createTask(project.id)
    await claim(asker, project.id, t2.id)
    await clientAs(owner).projects.invite({ projectId: project.id, volunteerId: asker.id })
    expect(await task(t2.id)).toMatchObject({ assigneeId: asker.id, requestedById: null })
    const late = await createVolunteer()
    const t3 = await createTask(project.id)
    await claim(late, project.id, t3.id)
    await clientAs(await createAdmin()).projects.assign({
      projectId: project.id,
      volunteerId: late.id,
    })
    expect(await task(t3.id)).toMatchObject({ assigneeId: late.id, requestedById: null })
  })
})

describe('project status rules', () => {
  it('keeps the status when the owner steps down, and keeps Ready for admins', async () => {
    const owner = await createVolunteer()
    const project = await createProject({ assigneeId: owner.id, status: 'in_progress' })
    await clientAs(owner).projects.update({ id: project.id, status: 'ready' })
    expect((await task(project.id)).status).toBe('in_progress')
    await clientAs(owner).projects.update({ id: project.id, assigneeId: null })
    const after = await clientAs(await createAdmin()).projects.getById({ id: project.id })
    expect(after).toMatchObject({ status: 'in_progress', ownerId: null, isSeekingOwner: true })
  })
})
