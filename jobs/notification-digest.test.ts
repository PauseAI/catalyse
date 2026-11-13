import { describe, it, expect, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createVolunteer } from '@/test/factories'
import { emails } from '@/test/fakes/email'
import { logger } from '@/lib/logger'
import { notifyUser } from '@/lib/notify'
import { runNotificationDigestJob } from './notification-digest'

const held = (volunteerId: number, type: string, title: string, extra: object = {}) =>
  prisma.notification.create({
    data: {
      volunteerId,
      type,
      title,
      link: `/x/${title}`,
      inDigest: true,
      createdAt: new Date('2026-11-01T00:00:00Z'),
      ...extra,
    },
  })

/** Someone whose digest goes at 08:00 in `timeZone`. */
const person = (timeZone = 'UTC', extra: object = {}) =>
  createVolunteer({ timeZone, digestHour: 8, ...extra })

const at = (iso: string) => new Date(iso)
const digestsTo = (v: { email: string | null }) => emails.to(v.email!)

describe('runNotificationDigestJob', () => {
  it('sends everything held, read or not, grouped by category, in one email', async () => {
    const ana = await person('UTC', { name: 'Ana' })
    await held(ana.id, 'project_approved', 'Approved', { body: 'Well done' })
    await held(ana.id, 'new_interest', 'Helper')
    await held(ana.id, 'message_received', 'Hello')
    await held(ana.id, 'task_done', 'Already read', { readAt: new Date() })
    await prisma.notification.create({
      data: { volunteerId: ana.id, type: 'mention', title: 'Not held' },
    })

    const result = await runNotificationDigestJob(at('2026-11-12T08:05:00Z'))
    expect(result).toMatchObject({ sent: 1, notifications: 4 })
    const mail = emails.lastTo(ana.email!)
    expect(mail.subject).toBe('Catalyse: your daily digest of 4 notifications')
    const order = ['Needs action', 'Helper', 'Updates', 'Approved', 'Messages', 'Hello']
    const found = order.map((s) => mail.html.indexOf(s))
    expect(found.every((i) => i >= 0)).toBe(true)
    expect([...found].sort((a, b) => a - b)).toEqual(found)
    expect(mail.html).toContain('Already read')
    expect(mail.html).toContain('/x/Approved')
    expect(mail.html).not.toContain('Not held')
  })

  it("goes in each person's own local hour", async () => {
    const tokyo = await person('Asia/Tokyo')
    const newYork = await person('America/New_York')
    await held(tokyo.id, 'project_approved', 'Tokyo')
    // It came after New York's hour on the 11th, so it waits for the 12th.
    await held(newYork.id, 'project_approved', 'New York', {
      createdAt: at('2026-11-11T20:00:00Z'),
    })
    await runNotificationDigestJob(at('2026-11-11T23:00:00Z'))
    expect(digestsTo(tokyo)).toHaveLength(1)
    expect(digestsTo(newYork)).toHaveLength(0)
    await runNotificationDigestJob(at('2026-11-12T08:00:00Z'))
    expect(digestsTo(newYork)).toHaveLength(0)
    await runNotificationDigestJob(at('2026-11-12T13:00:00Z'))
    expect(digestsTo(newYork)).toHaveLength(1)
  })

  it('makes up a missed hour later that day, holding back what came after it', async () => {
    const ana = await person()
    await held(ana.id, 'project_approved', 'Waiting')
    const late = await person()
    await held(late.id, 'project_approved', 'Late', { createdAt: at('2026-11-12T10:00:00Z') })
    await runNotificationDigestJob(at('2026-11-12T13:00:00Z'))
    expect(digestsTo(ana)).toHaveLength(1)
    expect(digestsTo(late)).toHaveLength(0)
    await runNotificationDigestJob(at('2026-11-13T08:00:00Z'))
    expect(digestsTo(late)).toHaveLength(1)
  })

  it('follows a chosen hour', async () => {
    const late = await person('Europe/Berlin', { digestHour: 19 })
    await held(late.id, 'project_approved', 'Evening')
    await runNotificationDigestJob(at('2026-11-12T07:00:00Z'))
    expect(digestsTo(late)).toHaveLength(0)
    await runNotificationDigestJob(at('2026-11-12T18:00:00Z'))
    expect(digestsTo(late)).toHaveLength(1)
  })

  it('sends at most once per period, for each frequency', async () => {
    const day = (n: number) => at(`2026-11-${String(10 + n).padStart(2, '0')}T08:00:00Z`)
    for (const [frequency, period] of [
      ['daily', 1],
      ['every_3_days', 3],
      ['weekly', 7],
    ] as const) {
      const v = await person('UTC', { digestFrequency: frequency })
      await held(v.id, 'project_approved', `${frequency} first`)
      await runNotificationDigestJob(day(0))
      expect(digestsTo(v)).toHaveLength(1)
      for (let n = 1; n <= period; n++) {
        await held(v.id, 'project_approved', `${frequency} day ${n}`)
        await runNotificationDigestJob(day(n))
        expect(digestsTo(v), `${frequency} on day ${n}`).toHaveLength(n < period ? 1 : 2)
      }
      // The second carries everything since the first.
      const second = emails.lastTo(v.email!).html
      for (let n = 1; n <= period; n++) expect(second).toContain(`${frequency} day ${n}`)
      expect(second).not.toContain(`${frequency} first`)
    }
  })

  it('sends nothing twice: not on a rerun, an overlap, or a repeated clock hour', async () => {
    const ana = await person()
    await held(ana.id, 'project_approved', 'Once')
    const now = at('2026-11-12T08:10:00Z')
    await Promise.all([runNotificationDigestJob(now), runNotificationDigestJob(now)])
    await runNotificationDigestJob(now)
    expect(digestsTo(ana)).toHaveLength(1)

    // New York repeats 01:00 on 1 November; the second pass sends nothing more.
    const ny = await person('America/New_York', { digestHour: 1 })
    await held(ny.id, 'project_approved', 'Autumn')
    await runNotificationDigestJob(at('2026-11-01T05:00:00Z'))
    await held(ny.id, 'project_approved', 'Autumn again')
    await runNotificationDigestJob(at('2026-11-01T06:00:00Z'))
    expect(digestsTo(ny)).toHaveLength(1)
  })

  it('keeps the day taken in the database even when its notifications are deleted', async () => {
    const ana = await person()
    await held(ana.id, 'team_join_request', 'Join')
    const now = at('2026-11-12T08:00:00Z')
    await runNotificationDigestJob(now)
    await prisma.notification.deleteMany({ where: { volunteerId: ana.id } })
    await held(ana.id, 'project_approved', 'Later')
    expect(await runNotificationDigestJob(now)).toMatchObject({ sent: 0 })
    expect(digestsTo(ana)).toHaveLength(1)
    await expect(
      prisma.notificationDigest.create({
        data: { volunteerId: ana.id, sentOn: new Date('2026-11-12T00:00:00Z') },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })
  })

  it('first covers what came after Digest was chosen', async () => {
    const ana = await person()
    const payload = { message: 'm', projectId: 1, projectTitle: 'P' }
    await notifyUser(ana.id, 'project_approved', 'Before choosing', null, null, payload)
    await prisma.notificationPreference.create({
      data: { volunteerId: ana.id, type: 'project_approved', delivery: 'digest' },
    })
    await notifyUser(ana.id, 'project_approved', 'After choosing', null, null, payload)
    await prisma.notification.updateMany({
      where: { volunteerId: ana.id },
      data: { createdAt: new Date('2026-11-01T00:00:00Z') },
    })
    await runNotificationDigestJob(at('2026-11-12T08:00:00Z'))
    const digest = emails.to(ana.email!).find((e) => e.subject.includes('digest'))!
    expect(digest.html).toContain('After choosing')
    expect(digest.html).not.toContain('Before choosing')
  })

  it('sends nothing to someone with nothing new, deleted or without an address', async () => {
    const quiet = await person()
    const gone = await person('UTC', { deletedAt: new Date() })
    await held(gone.id, 'project_approved', 'Gone')
    const noEmail = await person('UTC', { email: null })
    await held(noEmail.id, 'project_approved', 'Nowhere')
    const result = await runNotificationDigestJob(at('2026-11-12T08:00:00Z'))
    expect(result).toMatchObject({ sent: 0 })
    expect(digestsTo(quiet)).toEqual([])
  })

  it('releases its claim when the send fails, so the next hourly run tries again', async () => {
    const ana = await person()
    await held(ana.id, 'project_approved', 'Retry')
    const error = vi.spyOn(logger, 'error').mockImplementation(() => logger)
    emails.failNext()
    expect(await runNotificationDigestJob(at('2026-11-12T08:00:00Z'))).toMatchObject({ sent: 0 })
    expect(error).toHaveBeenCalledWith(expect.any(Error), '[NOTIFICATION DIGEST] send failed')
    expect(await prisma.notificationDigest.count({ where: { volunteerId: ana.id } })).toBe(0)
    await runNotificationDigestJob(at('2026-11-12T09:00:00Z'))
    expect(emails.lastTo(ana.email!).html).toContain('Retry')
    error.mockRestore()
  })

  it("carries on to everyone else when one person's digest fails", async () => {
    const first = await person()
    const second = await person()
    await held(first.id, 'project_approved', 'First')
    await held(second.id, 'project_approved', 'Second')
    const error = vi.spyOn(logger, 'error').mockImplementation(() => logger)
    vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('lock timeout') as never)
    const result = await runNotificationDigestJob(at('2026-11-12T08:00:00Z'))
    expect(result).toMatchObject({ failed: 1, sent: 1 })
    expect(error).toHaveBeenCalledWith(expect.any(Error), '[NOTIFICATION DIGEST] failed')
    expect(digestsTo(first)).toHaveLength(0)
    expect(digestsTo(second)).toHaveLength(1)
    vi.restoreAllMocks()
  })

  it('skips when email is not configured', async () => {
    emails.setConfigured(false)
    expect(await runNotificationDigestJob()).toEqual({
      skipped: true,
      reason: 'email not configured',
    })
  })
})
