import { describe, it, expect, vi, afterEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createVolunteer, createAdmin, createTeam } from '@/test/factories'

import { emails } from '@/test/fakes/email'
import {
  createNotification,
  clearNotifications,
  refreshNotification,
  notifyUser,
  notifyTeamOfProject,
  notifyAdmins,
} from './notify'

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('createNotification / clearNotifications', () => {
  it('stores and clears notifications by type and entity', async () => {
    const vol = await createVolunteer()
    await createNotification(vol.id, 'thing', 'Title', 'body', '/x', 42)
    await createNotification(vol.id, 'thing', 'Title2')
    expect(await prisma.notification.count({ where: { volunteerId: vol.id } })).toBe(2)
    await clearNotifications('thing', 42)
    const left = await prisma.notification.findMany({ where: { volunteerId: vol.id } })
    expect(left).toHaveLength(1)
    expect(left[0]).toMatchObject({ body: null, link: null, entityId: null })
  })

  it('refreshes one notification per person, type and thing in place', async () => {
    const vol = await createVolunteer()
    await refreshNotification(vol.id, 'late', 'Day 1', null, '/t', 7)
    await prisma.notification.updateMany({
      where: { volunteerId: vol.id },
      data: { readAt: new Date() },
    })
    await refreshNotification(vol.id, 'late', 'Day 2', 'b', '/t', 7)
    const rows = await prisma.notification.findMany({ where: { volunteerId: vol.id } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ title: 'Day 2', body: 'b', readAt: null, entityId: 7 })
  })

  it('logs rather than throws when the clear fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(prisma.notification, 'deleteMany').mockRejectedValueOnce(new Error('db') as never)
    await clearNotifications('x', 1)
    expect(error).toHaveBeenCalledWith('[NOTIFY CLEAR ERROR]', expect.any(Error))
  })
})

describe('notifyUser email preferences', () => {
  const payload = { message: 'm', projectId: 1, projectTitle: 'P' }

  it('skips the email for a muted category but still notifies in the app', async () => {
    const vol = await createVolunteer({ emailMutedCategories: ['update'] })
    await notifyUser(vol.id, 'project_approved', 'Approved', null, null, payload)
    expect(emails.to(vol.email!)).toEqual([])
    await vi.waitFor(async () =>
      expect(await prisma.notification.count({ where: { volunteerId: vol.id } })).toBe(1),
    )
    // Needs-action email still goes.
    await notifyUser(vol.id, 'new_interest', 'Someone wants to help', null, null, payload)
    expect(emails.lastTo(vol.email!)).toMatchObject({ subject: 'Someone wants to help' })
  })

  it('records when a notification was emailed', async () => {
    const vol = await createVolunteer()
    await notifyUser(vol.id, 'project_approved', 'Approved', null, null, payload)
    await vi.waitFor(async () =>
      expect(
        (await prisma.notification.findFirstOrThrow({ where: { volunteerId: vol.id } })).emailedAt,
      ).not.toBeNull(),
    )
    // An in-app notice that failed to save leaves nothing to stamp.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(prisma.notification, 'create').mockRejectedValueOnce(new Error('db') as never)
    await notifyUser(vol.id, 'project_approved', 'Again', null, null, payload)
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith('[NOTIFY ERROR]', expect.any(Error)))
    expect(emails.lastTo(vol.email!)).toMatchObject({ subject: 'Again' })
  })
})

describe('notifyUser', () => {
  it('creates the notification and emails a project or admin-alert payload', async () => {
    const vol = await createVolunteer()
    await notifyUser(vol.id, 'a', 'T', null, null)
    expect(emails.sent).toEqual([])

    await notifyUser(vol.id, 'a', 'T', 'b', '/l', { message: 'm', projectId: 1, projectTitle: 'P' })
    expect(emails.last).toMatchObject({ to: vol.email, subject: 'T' })
    expect(emails.last.html).toContain('/projects/1')
    await notifyUser(vol.id, 'a', 'T', 'b', '/l', {
      subject: 'Custom',
      message: 'm',
      ctaLabel: 'Go',
      ctaUrl: '/go',
    })
    expect(emails.last.subject).toBe('Custom')
    expect(emails.last.html).toContain('http://localhost:3000/go')
  })

  it('skips the email for a volunteer without one, and logs send/insert failures', async () => {
    const noEmail = await createVolunteer({ email: null })
    await notifyUser(noEmail.id, 'a', 'T', null, null, {
      message: 'm',
      projectId: 1,
      projectTitle: 'P',
    })
    expect(emails.sent).toEqual([])

    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const vol = await createVolunteer()
    emails.failNext()
    await notifyUser(vol.id, 'a', 'T', null, null, {
      message: 'm',
      projectId: 1,
      projectTitle: 'P',
    })
    await new Promise((r) => setImmediate(r))
    expect(error).toHaveBeenCalledWith('[EMAIL ERROR]', expect.any(Error))

    vi.spyOn(prisma.notification, 'create').mockRejectedValueOnce(new Error('db') as never)
    await notifyUser(vol.id, 'a', 'T', null, null)
    await new Promise((r) => setImmediate(r))
    expect(error).toHaveBeenCalledWith('[NOTIFY ERROR]', expect.any(Error))
  })
})

describe('notifyTeamOfProject / notifyAdmins', () => {
  it('fans out to team members and to live admins', async () => {
    const team = await createTeam()
    const m1 = await createVolunteer()
    const m2 = await createVolunteer()
    await prisma.teamMembership.createMany({
      data: [
        { teamId: team.id, volunteerId: m1.id },
        { teamId: team.id, volunteerId: m2.id },
      ],
    })
    await notifyTeamOfProject(team.id, 7, 'Proj')
    // createNotification is fire-and-forget inside notifyUser, so poll for the rows.
    const notes = await vi.waitFor(async () => {
      const rows = await prisma.notification.findMany({ where: { type: 'team_project_assigned' } })
      expect(rows).toHaveLength(2)
      return rows
    })
    expect(notes.map((n) => n.volunteerId).sort()).toEqual([m1.id, m2.id].sort())
    expect(notes[0]).toMatchObject({ link: '/projects/7', entityId: 7 })

    const admin = await createAdmin()
    await createAdmin({ deletedAt: new Date() })
    await notifyAdmins('alert', 'T', null, null, { message: 'm', ctaLabel: 'L', ctaUrl: '/u' }, 3)
    await vi.waitFor(async () =>
      expect(await prisma.notification.count({ where: { type: 'alert' } })).toBe(1),
    )
    expect(emails.to(admin.email!)).toHaveLength(1)
  })
})
