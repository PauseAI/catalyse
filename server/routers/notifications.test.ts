import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createVolunteer,
  createAdmin,
  createProject,
  createQuickTask,
  createTask,
  createTeam,
  createChapter,
  createChapterDeputy,
  createMember,
  createCoordinator,
} from '@/test/factories'
import { clientAs } from '@/test/rpc'

describe('notifications', () => {
  it('lists with filters and paging, hiding admin-only types from admins', async () => {
    const vol = await createVolunteer()
    await prisma.notification.createMany({
      data: [
        { volunteerId: vol.id, type: 'a', title: '1' },
        { volunteerId: vol.id, type: 'b', title: '2', readAt: new Date() },
        { volunteerId: vol.id, type: 'new_bug_report', title: '3' },
      ],
    })
    const c = clientAs(vol)
    expect((await c.notifications.list({})).total).toBe(3)
    expect((await c.notifications.list({ filter: 'unread' })).total).toBe(2)
    expect(
      (await c.notifications.list({ filter: 'read' })).notifications.map((n) => n.title),
    ).toEqual(['2'])
    expect((await c.notifications.list({ limit: 1, offset: 1 })).notifications).toHaveLength(1)

    const admin = await createAdmin()
    await prisma.notification.createMany({
      data: [
        { volunteerId: admin.id, type: 'a', title: 'mine' },
        { volunteerId: admin.id, type: 'new_bug_report', title: 'admin-only' },
      ],
    })
    const ac = clientAs(admin)
    expect((await ac.notifications.list({})).notifications.map((n) => n.title)).toEqual(['mine'])
    await ac.notifications.readAll()
    const unread = await prisma.notification.findMany({
      where: { volunteerId: admin.id, readAt: null },
    })
    expect(unread.map((n) => n.title)).toEqual(['admin-only'])
  })

  it('carries the task or Quick Task a notification links to, while the viewer can see it', async () => {
    const vol = await createVolunteer()
    const team = await createTeam()
    await prisma.teamMembership.create({ data: { teamId: team.id, volunteerId: vol.id } })
    const project = await createProject({ teamId: team.id })
    const task = await createTask(project.id, { title: 'Pack flyering stall kit' })
    const quick = await createQuickTask({ title: 'Print posters' })
    await prisma.notification.createMany({
      data: [
        {
          volunteerId: vol.id,
          type: 'mention',
          title: 'on the task',
          link: `/projects/${project.id}/tasks/${task.id}#comment-1`,
        },
        {
          volunteerId: vol.id,
          type: 'a',
          title: 'on the quick task',
          link: `/quick-tasks/${quick.id}`,
        },
        {
          volunteerId: vol.id,
          type: 'a',
          title: 'on the project',
          link: `/projects/${project.id}`,
        },
        { volunteerId: vol.id, type: 'a', title: 'no link' },
      ],
    })
    const workItems = async () =>
      Object.fromEntries(
        (await clientAs(vol).notifications.list({})).notifications.map((n) => [
          n.title,
          n.workItem && { title: n.workItem.title, displayStatus: n.workItem.displayStatus },
        ]),
      )

    expect(await workItems()).toEqual({
      'on the task': { title: 'Pack flyering stall kit', displayStatus: 'ready' },
      'on the quick task': { title: 'Print posters', displayStatus: 'open' },
      'on the project': null,
      'no link': null,
    })

    await prisma.teamMembership.deleteMany({ where: { volunteerId: vol.id } })
    expect((await workItems())['on the task']).toBeNull()
  })

  it('lists unread before read, paging across the boundary', async () => {
    const vol = await createVolunteer()
    const day = (d: number) => new Date(Date.UTC(2026, 0, d))
    await prisma.notification.createMany({
      data: [
        { volunteerId: vol.id, type: 'a', title: 'read new', readAt: day(9), createdAt: day(5) },
        { volunteerId: vol.id, type: 'a', title: 'unread old', createdAt: day(1) },
        { volunteerId: vol.id, type: 'a', title: 'read old', readAt: day(9), createdAt: day(2) },
        { volunteerId: vol.id, type: 'a', title: 'unread new', createdAt: day(4) },
      ],
    })
    const c = clientAs(vol)
    const titles = async (input: { limit?: number; offset?: number }) =>
      (await c.notifications.list(input)).notifications.map((n) => n.title)
    expect(await titles({})).toEqual(['unread new', 'unread old', 'read new', 'read old'])
    expect(await titles({ limit: 3 })).toEqual(['unread new', 'unread old', 'read new'])
    expect(await titles({ limit: 2, offset: 1 })).toEqual(['unread old', 'read new'])
    expect(await titles({ limit: 2, offset: 3 })).toEqual(['read old'])
    expect((await c.notifications.list({ limit: 1 })).total).toBe(4)
  })

  it('marks one read/unread only for the owner, and readAll for a volunteer', async () => {
    const vol = await createVolunteer()
    const other = await createVolunteer()
    const n = await prisma.notification.create({
      data: { volunteerId: vol.id, type: 'a', title: '1' },
    })
    const c = clientAs(vol)
    expect(await c.notifications.markRead({ id: n.id })).toEqual({ message: 'Marked as read' })
    expect(await c.notifications.markUnread({ id: n.id })).toEqual({ message: 'Marked as unread' })
    await expect(clientAs(other).notifications.markRead({ id: n.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await expect(clientAs(other).notifications.markUnread({ id: n.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect(await c.notifications.readAll()).toEqual({ message: 'All marked as read' })
    expect((await c.notifications.list({ filter: 'unread' })).total).toBe(0)
  })
})

describe('notifications by category', () => {
  it('filters, counts and marks read by Inbox category', async () => {
    const vol = await createVolunteer()
    await prisma.notification.createMany({
      data: [
        { volunteerId: vol.id, type: 'mention', title: 'act' },
        { volunteerId: vol.id, type: 'message_received', title: 'msg' },
        { volunteerId: vol.id, type: 'project_approved', title: 'upd' },
        { volunteerId: vol.id, type: 'something_new', title: 'unknown' },
      ],
    })
    const c = clientAs(vol)
    const titles = async (category: 'needs_action' | 'update' | 'message') =>
      (await c.notifications.list({ category })).notifications.map((n) => n.title).sort()
    expect(await titles('needs_action')).toEqual(['act'])
    expect(await titles('message')).toEqual(['msg'])
    // A type nobody classified is an update.
    expect(await titles('update')).toEqual(['unknown', 'upd'])
    const all = (await c.notifications.list({})).notifications
    expect(all.find((n) => n.title === 'act')).toMatchObject({ category: 'needs_action' })
    expect(await c.notifications.counts()).toEqual({ needs_action: 1, update: 2, message: 1 })

    await c.notifications.readAll({ category: 'update' })
    expect(await c.notifications.counts()).toEqual({ needs_action: 1, update: 0, message: 1 })

    // Admin-only types never count for an admin, whatever the category.
    const admin = await createAdmin()
    await prisma.notification.create({
      data: { volunteerId: admin.id, type: 'new_project_proposal', title: 'admin only' },
    })
    expect(await clientAs(admin).notifications.counts()).toEqual({
      needs_action: 0,
      update: 0,
      message: 0,
    })
  })

  it('offers Accept/Decline only while the applicant or join request is still waiting on me', async () => {
    const owner = await createVolunteer()
    const applicant = await createVolunteer()
    const other = await createVolunteer()
    const project = await createProject({ assigneeId: owner.id })
    const interest = await prisma.workItemInterest.create({
      data: {
        workItemId: project.id,
        volunteerId: applicant.id,
        interestType: 'want_to_contribute',
      },
    })
    const team = await createTeam()
    await prisma.teamMembership.create({
      data: { teamId: team.id, volunteerId: owner.id, role: 'leader' },
    })
    const request = await prisma.teamJoinRequest.create({
      data: { teamId: team.id, volunteerId: applicant.id },
    })
    for (const v of [owner, other]) {
      await prisma.notification.createMany({
        data: [
          { volunteerId: v.id, type: 'new_interest', title: 'interest', entityId: interest.id },
          { volunteerId: v.id, type: 'team_join_request', title: 'join', entityId: request.id },
          { volunteerId: v.id, type: 'new_interest', title: 'no entity' },
        ],
      })
    }
    const actionOf = async (who: typeof owner, title: string) =>
      (await clientAs(who).notifications.list({})).notifications.find((n) => n.title === title)
        ?.action
    expect(await actionOf(owner, 'interest')).toEqual({
      kind: 'interest',
      projectId: project.id,
      interestId: interest.id,
    })
    expect(await actionOf(owner, 'join')).toEqual({ kind: 'join_request', requestId: request.id })
    expect(await actionOf(owner, 'no entity')).toBeNull()
    // Not their project or team.
    expect(await actionOf(other, 'interest')).toBeNull()
    expect(await actionOf(other, 'join')).toBeNull()
    // An admin may answer either.
    const admin = await createAdmin()
    await prisma.notification.create({
      data: {
        volunteerId: admin.id,
        type: 'team_join_request',
        title: 'join',
        entityId: request.id,
      },
    })
    expect(await actionOf(admin, 'join')).toEqual({ kind: 'join_request', requestId: request.id })

    // Once answered, nothing is left to do.
    await prisma.workItemInterest.update({
      where: { id: interest.id },
      data: { status: 'accepted' },
    })
    await prisma.teamJoinRequest.update({ where: { id: request.id }, data: { status: 'declined' } })
    expect(await actionOf(owner, 'interest')).toBeNull()
    expect(await actionOf(owner, 'join')).toBeNull()
  })

  it('offers Accept/Decline on an invite only to the invitee, while it is open', async () => {
    const owner = await createVolunteer()
    const invitee = await createVolunteer()
    const project = await createProject({ assigneeId: owner.id })
    const invite = await prisma.workItemInterest.create({
      data: {
        workItemId: project.id,
        volunteerId: invitee.id,
        interestType: 'want_to_contribute',
        status: 'invited',
        origin: 'invited',
      },
    })
    for (const v of [invitee, owner]) {
      await prisma.notification.create({
        data: { volunteerId: v.id, type: 'project_invite', title: 'invite', entityId: invite.id },
      })
    }
    const actionOf = async (who: typeof owner) =>
      (await clientAs(who).notifications.list({})).notifications.find((n) => n.title === 'invite')
        ?.action
    expect(await actionOf(invitee)).toEqual({ kind: 'invite', projectId: project.id })
    expect(await actionOf(owner)).toBeNull()
    await prisma.workItemInterest.update({ where: { id: invite.id }, data: { status: 'accepted' } })
    expect(await actionOf(invitee)).toBeNull()
  })
})

describe('notification preferences', () => {
  const rowOf = async (c: ReturnType<typeof clientAs>, type: string) =>
    (await c.notifications.preferences()).rows.find((r) => r.type === type)

  it('lists the types for each person, admin types only for staff', async () => {
    const vol = await createVolunteer()
    const admin = await createAdmin()
    const deputy = await createChapterDeputy(await createChapter())
    const types = async (v: Parameters<typeof clientAs>[0]) =>
      (await clientAs(v).notifications.preferences()).rows.map((r) => r.type)
    expect(await types(vol)).not.toContain('new_volunteer_signup')
    expect(await types(admin)).toContain('new_volunteer_signup')
    expect(await types(deputy)).toContain('new_volunteer_signup')
    expect(await types(vol)).toContain('project_approved')
  })

  it('saves choices, storing only those that differ from the default', async () => {
    const vol = await createVolunteer()
    const c = clientAs(vol)
    await c.volunteers.updateMe({
      notificationPreferences: {
        project_approved: 'digest',
        mention: 'email',
        task_done: 'in_app',
      },
    })
    expect(await rowOf(c, 'project_approved')).toMatchObject({ delivery: 'digest' })
    expect(await rowOf(c, 'mention')).toMatchObject({ delivery: 'email' })
    const stored = await prisma.notificationPreference.findMany({ where: { volunteerId: vol.id } })
    expect(stored.map((p) => p.type).sort()).toEqual(['mention', 'project_approved'])

    // Back to the default leaves no choice behind; types left out keep theirs.
    await c.volunteers.updateMe({ notificationPreferences: { project_approved: 'email' } })
    const after = await prisma.notificationPreference.findMany({ where: { volunteerId: vol.id } })
    expect(after.map((p) => p.type)).toEqual(['mention'])
  })

  it('refuses a fixed or unknown type', async () => {
    const c = clientAs(await createVolunteer())
    await expect(
      c.volunteers.updateMe({ notificationPreferences: { call_posted: 'email', nope: 'email' } }),
    ).rejects.toMatchObject({
      message: 'These notifications have no choice to make: call_posted, nope',
    })
  })
})

describe('digest settings', () => {
  it("falls back to the chapter's country, then follows a chosen zone, hour and frequency", async () => {
    const japan =
      (await prisma.nationalChapter.findFirst({ where: { country: 'Japan' } })) ??
      (await createChapter({ country: 'Japan' }))
    const vol = await createMember(japan)
    const c = clientAs(vol)
    expect(await c.notifications.digestSettings()).toMatchObject({
      frequency: 'daily',
      hour: 8,
      timeZone: null,
      effectiveTimeZone: 'Asia/Tokyo',
      timeZoneSource: 'country',
    })
    await c.volunteers.updateMe({
      timeZone: 'America/Chicago',
      digestHour: 18,
      digestFrequency: 'weekly',
    })
    const after = await c.notifications.digestSettings()
    expect(after).toMatchObject({
      frequency: 'weekly',
      hour: 18,
      effectiveTimeZone: 'America/Chicago',
      timeZoneSource: 'chosen',
    })
    expect(after.nextDigestAt!.getTime()).toBeGreaterThan(Date.now())
    await expect(c.volunteers.updateMe({ timeZone: 'Mars/Olympus' })).rejects.toMatchObject({
      message: expect.stringContaining('Input validation failed'),
    })
  })

  it("records the browser's zone only for someone who has none", async () => {
    const fresh = await createVolunteer({ timeZone: null })
    const chosen = await createVolunteer({ timeZone: 'Asia/Tokyo' })
    expect(await clientAs(fresh).volunteers.detectTimeZone({ timeZone: 'Europe/Paris' })).toEqual({
      saved: true,
    })
    expect(await clientAs(chosen).volunteers.detectTimeZone({ timeZone: 'Europe/Paris' })).toEqual({
      saved: false,
    })
    const zones = await prisma.volunteer.findMany({
      where: { id: { in: [fresh.id, chosen.id] } },
      orderBy: { id: 'asc' },
      select: { timeZone: true },
    })
    expect(zones.map((z) => z.timeZone)).toEqual(['Europe/Paris', 'Asia/Tokyo'])
  })
})

describe('roles in the preferences panel', () => {
  const rolesOf = async (v: Parameters<typeof clientAs>[0]) =>
    (await clientAs(v).notifications.preferences()).heldRoles

  it('reads the roles someone holds from what they lead, deputise, post and coordinate', async () => {
    expect(await rolesOf(await createVolunteer())).toEqual(['everyone'])

    const owner = await createVolunteer()
    await createProject({ assigneeId: owner.id, status: 'in_progress' })
    const deputy = await createVolunteer()
    const deputised = await createProject({ status: 'ready' })
    await prisma.projectDeputy.create({ data: { projectId: deputised.id, volunteerId: deputy.id } })
    const pastLead = await createVolunteer()
    await createProject({ assigneeId: pastLead.id, status: 'completed' })
    expect(await rolesOf(owner)).toEqual(['everyone', 'project_lead'])
    expect(await rolesOf(deputy)).toEqual(['everyone', 'project_lead'])
    expect(await rolesOf(pastLead)).toEqual(['everyone'])

    const leader = await createVolunteer()
    const team = await createTeam()
    await prisma.teamMembership.create({
      data: { teamId: team.id, volunteerId: leader.id, role: 'leader' },
    })
    const poster = await createVolunteer()
    await createQuickTask({ creatorId: poster.id, status: 'open' })
    const coordinator = await createCoordinator()
    expect(await rolesOf(leader)).toEqual(['everyone', 'team_lead'])
    expect(await rolesOf(poster)).toEqual(['everyone', 'quick_task_poster'])
    expect(await rolesOf(coordinator)).toEqual(['everyone', 'coordinator'])
    expect(await rolesOf(await createAdmin())).toEqual(['everyone', 'staff'])
    expect(await rolesOf(await createAdmin({ isTechnicalAdmin: true }))).toEqual([
      'everyone',
      'staff',
      'technical',
    ])
  })
})
