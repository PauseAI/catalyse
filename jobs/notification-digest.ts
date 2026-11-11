import { prisma } from '@/lib/prisma'
import { isEmailConfigured, sendNotificationDigestEmail } from '@/lib/email'
import { logger } from '@/lib/logger'
import { addDays, startOfUtcDay } from '@/lib/schedule'
import { DIGEST_LOOKBACK_DAYS, digestSections, digestSubject } from '@/lib/notification-digest'

/**
 * One email a day to each person holding unread notifications for their digest. The day's
 * digest is recorded (one per person per UTC day) and its notifications pointed at it before the
 * send, so a rerun or a second run at once never mails anything twice. A failed send removes the
 * record, which frees its notifications for the next run.
 */
export async function runNotificationDigestJob(now: Date = new Date()) {
  if (!isEmailConfigured()) return { skipped: true, reason: 'email not configured' }

  const sentOn = startOfUtcDay(now)
  const pending = {
    inDigest: true,
    digestId: null,
    readAt: null,
    createdAt: { gte: addDays(now, -DIGEST_LOOKBACK_DAYS) },
  }
  const people = await prisma.notification.findMany({
    where: pending,
    distinct: ['volunteerId'],
    select: { volunteerId: true },
    orderBy: { volunteerId: 'asc' },
  })

  let sent = 0
  let notifications = 0
  for (const { volunteerId } of people) {
    const digest = await prisma.$transaction(async (tx) => {
      const vol = await tx.volunteer.findFirst({
        where: { id: volunteerId, deletedAt: null },
        select: { name: true, email: true },
      })
      if (!vol?.email) return null
      // A second run the same day waits here on the first, then finds the day taken.
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
        where: { volunteerId, ...pending },
        data: { digestId: id },
      })
      if (count === 0) {
        await tx.notificationDigest.delete({ where: { id } })
        return null
      }
      return { id, name: vol.name, email: vol.email }
    })
    if (!digest) continue

    const items = await prisma.notification.findMany({
      where: { digestId: digest.id },
      orderBy: { createdAt: 'asc' },
      select: { type: true, title: true, body: true, link: true },
    })
    const ok = await sendNotificationDigestEmail({
      to: digest.email,
      name: digest.name,
      subject: digestSubject(items.length),
      sections: digestSections(items),
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

  return { candidates: people.length, sent, notifications }
}
