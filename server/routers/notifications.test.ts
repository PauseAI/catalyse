import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createVolunteer, createAdmin, createProject, createTeam } from '@/test/factories'
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
