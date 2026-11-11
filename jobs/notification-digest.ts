import { prisma } from '@/lib/prisma'
import { isEmailConfigured, sendNotificationDigestEmail } from '@/lib/email'
import { logger } from '@/lib/logger'
import { digestDueOn, digestSections, digestSubject } from '@/lib/notification-digest'
import { digestScheduleOf } from '@/lib/notification-preferences'

const PENDING = { inDigest: true, digestId: null }

/**
 * Runs hourly. Each person holding notifications for their digest gets it in their own local
 * hour once their period has passed: everything held since their last digest, read or not. The
 * digest is recorded against its local day (one per person per day, in the database) and its
 * notifications pointed at it before the send, under a lock on the person while the period is
 * checked, so no rerun, overlap or clock change mails anything twice. A failed send removes the
 * record, which frees its notifications for the next digest.
 */
export async function runNotificationDigestJob(now: Date = new Date()) {
  if (!isEmailConfigured()) return { skipped: true, reason: 'email not configured' }

  const people = await prisma.notification.findMany({
    where: PENDING,
    distinct: ['volunteerId'],
    select: { volunteerId: true },
    orderBy: { volunteerId: 'asc' },
  })

  let due = 0
  let sent = 0
  let notifications = 0
  for (const { volunteerId } of people) {
    const outline = await digestScheduleOf(volunteerId)
    if (!outline || !digestDueOn(now, outline)) continue
    due++

    const digest = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM volunteers WHERE id = ${volunteerId} FOR UPDATE`
      // Read again under the lock, so a run that overlapped this one sees its digest.
      const schedule = await digestScheduleOf(volunteerId, tx)
      const day = schedule && digestDueOn(now, schedule)
      const vol = await tx.volunteer.findUniqueOrThrow({
        where: { id: volunteerId },
        select: { name: true, email: true },
      })
      if (!day || !vol.email) return null
      const sentOn = new Date(`${day}T00:00:00Z`)
      const { count: created } = await tx.notificationDigest.createMany({
        data: { volunteerId, sentOn },
        skipDuplicates: true,
      })
      if (created === 0) return null
      const { id } = await tx.notificationDigest.findUniqueOrThrow({
        where: { volunteerId_sentOn: { volunteerId, sentOn } },
        select: { id: true },
      })
      const { count } = await tx.notification.updateMany({
        where: { volunteerId, ...PENDING },
        data: { digestId: id },
      })
      if (count === 0) {
        await tx.notificationDigest.delete({ where: { id } })
        return null
      }
      return { id, name: vol.name, email: vol.email, schedule }
    })
    if (!digest) continue

    const items = await prisma.notification.findMany({
      where: { digestId: digest.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { type: true, title: true, body: true, link: true, createdAt: true },
    })
    const ok = await sendNotificationDigestEmail({
      to: digest.email,
      name: digest.name,
      subject: digestSubject(items.length, digest.schedule.frequency),
      sections: digestSections(items, digest.schedule.timeZone),
    }).catch((e) => {
      logger.error(e, '[NOTIFICATION DIGEST] send failed')
      return false
    })
    if (ok) {
      sent++
      notifications += items.length
    } else {
      await prisma.notificationDigest.delete({ where: { id: digest.id } })
    }
  }

  return { candidates: people.length, due, sent, notifications }
}
