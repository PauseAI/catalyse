import { describe, it, expect, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createVolunteer } from '@/test/factories'
import { emails } from '@/test/fakes/email'
import { addDays } from '@/lib/schedule'
import { logger } from '@/lib/logger'
import { runNotificationDigestJob } from './notification-digest'

const subjects = {
  one: 'Catalyse: your daily digest of 1 notification',
  three: 'Catalyse: your daily digest of 3 notifications',
}

const held = (volunteerId: number, type: string, title: string, extra: object = {}) =>
  prisma.notification.create({
    data: { volunteerId, type, title, link: `/x/${title}`, inDigest: true, ...extra },
  })

describe('runNotificationDigestJob', () => {
  it('sends one email per person, grouped by category, of what is held and unread', async () => {
    const ana = await createVolunteer({ name: 'Ana' })
    const bo = await createVolunteer()
    await held(ana.id, 'project_approved', 'Approved', { body: 'Well done' })
    await held(ana.id, 'new_interest', 'Helper')
    await held(ana.id, 'message_received', 'Hello')
    await held(ana.id, 'task_done', 'Already read', { readAt: new Date() })
    await prisma.notification.create({
      data: { volunteerId: ana.id, type: 'mention', title: 'Not held' },
    })
    await held(bo.id, 'task_assigned', 'Yours')

    const result = await runNotificationDigestJob()
    expect(result).toMatchObject({ sent: 2, notifications: 4 })

    const mail = emails.lastTo(ana.email!)
    expect(mail.subject).toBe(subjects.three)
    expect(emails.to(ana.email!)).toHaveLength(1)
    const order = [
      'Needs action',
      'Helper',
      'Updates',
      'Approved',
      'Well done',
      'Messages',
      'Hello',
    ]
    const at = order.map((s) => mail.html.indexOf(s))
    expect(at.every((i) => i >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(mail.html).toContain('/x/Approved')
    expect(mail.html).not.toContain('Already read')
    expect(mail.html).not.toContain('Not held')
    expect(emails.lastTo(bo.email!).subject).toBe(subjects.one)

    const covered = await prisma.notification.findMany({
      where: { volunteerId: ana.id, digestId: { not: null } },
    })
    expect(covered.map((n) => n.title).sort()).toEqual(['Approved', 'Hello', 'Helper'])
  })

  it('sends nothing twice: not on a rerun, and not a second digest the same day', async () => {
    const ana = await createVolunteer()
    await held(ana.id, 'project_approved', 'First')
    const now = new Date()
    await runNotificationDigestJob(now)
    await runNotificationDigestJob(now)
    expect(emails.to(ana.email!)).toHaveLength(1)

    // A later notification the same day waits for tomorrow's digest.
    await held(ana.id, 'project_approved', 'Second')
    await runNotificationDigestJob(new Date(now.getTime() + 1000))
    expect(emails.to(ana.email!)).toHaveLength(1)
    await runNotificationDigestJob(addDays(now, 1))
    expect(emails.to(ana.email!)).toHaveLength(2)
    expect(emails.lastTo(ana.email!).html).toContain('Second')
    expect(emails.lastTo(ana.email!).html).not.toContain('First')
  })

  it("sends no second digest the same day after the first one's notifications are cleared", async () => {
    const ana = await createVolunteer()
    await held(ana.id, 'team_join_request', 'Join')
    const now = new Date()
    await runNotificationDigestJob(now)
    await prisma.notification.deleteMany({ where: { volunteerId: ana.id } })
    await held(ana.id, 'project_approved', 'Later')
    expect(await runNotificationDigestJob(now)).toMatchObject({ sent: 0 })
    expect(emails.to(ana.email!)).toHaveLength(1)
  })

  it('claims each notification once when two runs overlap', async () => {
    const ana = await createVolunteer()
    await held(ana.id, 'project_approved', 'Once')
    const now = new Date()
    await Promise.all([runNotificationDigestJob(now), runNotificationDigestJob(now)])
    expect(emails.to(ana.email!)).toHaveLength(1)
  })

  it('sends nothing when nothing is held, and leaves out old, deleted and addressless', async () => {
    expect(await runNotificationDigestJob()).toMatchObject({ sent: 0 })
    const old = await createVolunteer()
    await held(old.id, 'project_approved', 'Old', { createdAt: addDays(new Date(), -8) })
    const gone = await createVolunteer({ deletedAt: new Date() })
    await held(gone.id, 'project_approved', 'Gone')
    const noEmail = await createVolunteer({ email: null })
    await held(noEmail.id, 'project_approved', 'Nowhere')
    expect(await runNotificationDigestJob()).toMatchObject({ sent: 0 })
    expect(emails.sent).toEqual([])
  })

  it('releases its claim when the send fails, so the next run tries again', async () => {
    const ana = await createVolunteer()
    await held(ana.id, 'project_approved', 'Retry')
    const error = vi.spyOn(logger, 'error').mockImplementation(() => logger)
    emails.failNext()
    const now = new Date()
    expect(await runNotificationDigestJob(now)).toMatchObject({ sent: 0 })
    expect(error).toHaveBeenCalledWith(expect.any(Error), '[NOTIFICATION DIGEST] send failed')
    expect(
      await prisma.notification.count({
        where: { volunteerId: ana.id, digestId: { not: null } },
      }),
    ).toBe(0)
    await runNotificationDigestJob(now)
    expect(emails.lastTo(ana.email!).html).toContain('Retry')
    error.mockRestore()
  })

  it('skips when email is not configured', async () => {
    emails.setConfigured(false)
    expect(await runNotificationDigestJob()).toEqual({
      skipped: true,
      reason: 'email not configured',
    })
  })
})
