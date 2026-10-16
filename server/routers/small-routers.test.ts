import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createVolunteer,
  createAdmin,
  createSuperAdmin,
  createProject,
  createQuickTask,
  createSkill,
  createLocalGroup,
  createTask,
  chapterFor,
  createMember,
  createChapter,
} from '@/test/factories'
import { clientAs, anon } from '@/test/rpc'

import { cronJobs } from '@/test/fakes/cron-jobs'

describe('contact', () => {
  it('is an empty pass-through router', async () => {
    const { contactRouter } = await import('./contact')
    expect(contactRouter).toEqual({})
  })
})

describe('admin.platformSettings', () => {
  it('reads and updates the singleton', async () => {
    const c = clientAs(await createSuperAdmin())
    expect(await c.admin.platformSettings.update({ requireApplicationApproval: false })).toEqual({
      requireApplicationApproval: false,
      maintenanceMode: false,
    })
    expect(await c.admin.platformSettings.get()).toEqual({
      requireApplicationApproval: false,
      maintenanceMode: false,
    })
  })
})

describe('chapters.list', () => {
  it('lists the countries with a chapter, to anyone', async () => {
    const chapter = await createChapter()
    expect(await anon().chapters.list()).toContainEqual({
      id: chapter.id,
      country: chapter.country,
      name: chapter.name,
    })
  })
})

describe('localGroups', () => {
  it('lists all or by country, and fetches one by id', async () => {
    const g = await createLocalGroup({ name: 'Aardvark Town', country: 'Zzland' })
    const all = await anon().localGroups.list({})
    expect(all.groups.some((x) => x.id === g.id)).toBe(true)
    const zz = await anon().localGroups.list({ country: 'Zzland' })
    expect(zz.groups).toEqual([expect.objectContaining({ id: g.id })])
    const c = clientAs(await createMember(await chapterFor('Zzland')))
    expect(await c.localGroups.getById({ id: g.id })).toEqual({
      id: g.id,
      name: 'Aardvark Town',
      country: 'Zzland',
    })
    await expect(c.localGroups.getById({ id: 999_999 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    // Another chapter's group is not one to join.
    await expect(
      clientAs(await createVolunteer()).localGroups.getById({ id: g.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('admin.cronRuns', () => {
  it('lists runs with optional filters and triggers a job', async () => {
    const c = clientAs(await createSuperAdmin())
    await prisma.cronJobRun.createMany({
      data: [
        { jobName: 'digest', status: 'success' },
        { jobName: 'nudges', status: 'error' },
      ],
    })
    expect(await c.admin.cronRuns.list({})).toHaveLength(2)
    expect(await c.admin.cronRuns.list({ jobName: 'digest' })).toHaveLength(1)
    expect(await c.admin.cronRuns.list({ status: 'error' })).toHaveLength(1)
    cronJobs.returns('backup', { ok: true })
    expect(await c.admin.cronRuns.run({ jobName: 'backup' })).toEqual({ result: { ok: true } })
    expect(await c.admin.cronRuns.list({ jobName: 'backup', status: 'success' })).toHaveLength(1)
  })
})

describe('admin.overview.counts', () => {
  it('counts triage, applications, bugs and unread admin notifications', async () => {
    const admin = await createAdmin()
    await createProject({ status: 'pending_review' })
    await createProject({ status: 'needs_discussion' })
    await createVolunteer({ approvalStatus: 'pending' })
    await createVolunteer({ approvalStatus: 'under_review', deletedAt: new Date() })
    await prisma.bugReport.create({
      data: { title: 'b', description: 'ten chars..', status: 'open' },
    })
    await prisma.notification.createMany({
      data: [
        { volunteerId: admin.id, type: 'new_bug_report', title: 't' },
        { volunteerId: admin.id, type: 'other', title: 't' },
        { volunteerId: admin.id, type: 'new_bug_report', title: 't', readAt: new Date() },
      ],
    })
    expect(await clientAs(admin).admin.overview.counts()).toEqual({
      pendingTriage: 2,
      pendingApplications: 1,
      openBugReports: 1,
      unreadNotifications: 1,
    })
  })
})

describe('my.projectTasks', () => {
  it('lists only my claimed, unfinished project tasks, longest quiet first', async () => {
    const me = await createVolunteer()
    const other = await createVolunteer()
    const project = await createProject({ title: 'Host' })
    const recent = await createTask(project.id, {
      title: 'Recent',
      status: 'in_progress',
      assigneeId: me.id,
    })
    const quiet = await createTask(project.id, {
      title: 'Quiet',
      status: 'in_progress',
      assigneeId: me.id,
    })
    await prisma.workItem.update({
      where: { id: quiet.id },
      data: { updatedAt: new Date('2020-01-01T00:00:00Z') },
    })
    await createTask(project.id, { title: 'Done', status: 'completed', assigneeId: me.id })
    const open = await createTask(project.id, { title: 'Open' })
    await createTask(project.id, { title: 'Theirs', status: 'in_progress', assigneeId: other.id })
    await createQuickTask({ assigneeId: me.id, status: 'in_progress' })
    // Claimed, not started, waiting on 'Open': still mine, shown as Blocked.
    const claimed = await createTask(project.id, { title: 'Claimed', assigneeId: me.id })
    await prisma.workItemDependency.create({
      data: { predecessorId: open.id, successorId: claimed.id },
    })
    await prisma.workItem.update({
      where: { id: claimed.id },
      data: { updatedAt: new Date('2021-01-01T00:00:00Z') },
    })

    const tasks = await clientAs(me).my.projectTasks()
    expect(tasks.map((t) => t.id)).toEqual([quiet.id, claimed.id, recent.id])
    expect(tasks[0]).toMatchObject({
      title: 'Quiet',
      projectId: project.id,
      projectTitle: 'Host',
      status: 'in_progress',
      displayStatus: 'in_progress',
    })
    expect(tasks[1]).toMatchObject({
      status: 'not_started',
      displayStatus: 'blocked',
      blockedBy: [{ id: open.id, title: 'Open' }],
    })
  })
})

describe('my.quickTasks', () => {
  it('lists the tasks assigned to me with skill and project names', async () => {
    const me = await createVolunteer()
    const skill = await createSkill()
    const project = await createProject()
    await createQuickTask({ assigneeId: me.id, skillId: skill.id, contextProjectId: project.id })
    await createQuickTask({ assigneeId: me.id })
    await createQuickTask()
    const tasks = await clientAs(me).my.quickTasks()
    expect(tasks).toHaveLength(2)
    expect(tasks.find((t) => t.skillId === skill.id)).toMatchObject({
      skillName: skill.name,
      projectTitle: project.title,
      projectId: project.id,
    })
    expect(tasks.find((t) => t.skillId === null)).toMatchObject({
      skillName: null,
      projectTitle: null,
    })
  })
})

describe('admin.rejectedApplications', () => {
  it('lists rejections with their reapply status, and allows reapplication', async () => {
    const c = clientAs(await createSuperAdmin())
    expect(await c.admin.rejectedApplications.list()).toEqual([])
    await prisma.rejectedApplication.createMany({
      data: [
        { emailHash: 'h1', rejectedAt: new Date('2026-01-01'), adminNotes: 'a' },
        { emailHash: 'h2', rejectedAt: new Date('2026-02-01') },
      ],
    })
    await prisma.anonymisedEmail.create({ data: { emailHash: 'h1' } })
    const list = await c.admin.rejectedApplications.list()
    expect(list.map((r) => [r.emailHash, r.reapplyAllowedAt])).toEqual([
      ['h2', null],
      ['h1', null],
    ])
    expect(await c.admin.rejectedApplications.allowReapply({ emailHash: 'h1' })).toEqual({
      message: 'Reapplication allowed',
    })
    expect((await c.admin.rejectedApplications.list())[1].reapplyAllowedAt).toBeInstanceOf(Date)
    await expect(
      c.admin.rejectedApplications.allowReapply({ emailHash: 'h2' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('admin.notifications', () => {
  it('lists, marks one, and marks all admin-type notifications read', async () => {
    const admin = await createAdmin()
    const c = clientAs(admin)
    await prisma.notification.createMany({
      data: [
        { volunteerId: admin.id, type: 'new_bug_report', title: 'a', body: 'b', link: '/x' },
        { volunteerId: admin.id, type: 'new_project_proposal', title: 'c' },
        { volunteerId: admin.id, type: 'personal', title: 'd' },
      ],
    })
    const list = await c.admin.notifications.list()
    expect(list.map((n) => n.title).sort()).toEqual(['a', 'c'])
    expect(await c.admin.notifications.markRead({ id: list[0].id })).toEqual({
      message: 'Marked as read',
    })
    await expect(c.admin.notifications.markRead({ id: 999_999 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect(await c.admin.notifications.readAll()).toEqual({ message: 'All marked as read' })
    const unread = await prisma.notification.findMany({
      where: { volunteerId: admin.id, readAt: null },
    })
    expect(unread.map((n) => n.title)).toEqual(['d'])
  })
})

describe('admin.interests', () => {
  it('lists interests with project, volunteer and skill details, filtered by status', async () => {
    const admin = await createAdmin()
    const owner = await createVolunteer()
    const skill = await createSkill()
    const vol = await createVolunteer({
      skills: { create: [{ skillId: skill.id, proficiencyLevel: 'expert' }] },
    })
    const p1 = await createProject({ assigneeId: owner.id })
    const p2 = await createProject()
    await prisma.workItemInterest.createMany({
      data: [
        {
          workItemId: p1.id,
          volunteerId: vol.id,
          interestType: 'want_to_contribute',
          status: 'pending',
        },
        { workItemId: p2.id, volunteerId: vol.id, interestType: 'want_to_own', status: 'accepted' },
      ],
    })
    const all = await clientAs(admin).admin.interests.list({})
    expect(all).toHaveLength(2)
    const first = all.find((i) => i.projectId === p1.id)!
    expect(first).toMatchObject({
      ownerName: owner.name,
      volunteerName: vol.name,
      volunteerEmail: vol.email,
      projectTitle: p1.title,
    })
    expect(first.volunteerSkills[0]).toMatchObject({ name: skill.name, proficiencyLevel: 'expert' })
    expect(all.find((i) => i.projectId === p2.id)!.ownerName).toBeNull()
    expect(await clientAs(admin).admin.interests.list({ status: 'accepted' })).toHaveLength(1)
  })
})
