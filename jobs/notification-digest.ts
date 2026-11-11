import { prisma } from '@/lib/prisma'
import { isEmailConfigured, sendNotificationDigestEmail } from '@/lib/email'
import { logger } from '@/lib/logger'
import { addDays, startOfUtcDay } from '@/lib/schedule'
import { DIGEST_LOOKBACK_DAYS, digestSections, digestSubject } from '@/lib/notification-digest'

/**
 * One email a day to each person holding unread notifications for their digest. A notification
 * is claimed by stamping `digestedAt` before the send, under a lock on the person, so a rerun or
 * a second run at once never mails it twice, and nobody gets two digests in a UTC day. A failed
 * send releases its claim for the next run.
 */
export async function runNotificationDigestJob(now: Date = new Date()) {
  if (!isEmailConfigured()) return { skipped: true, reason: 'email not configured' }

  const today = startOfUtcDay(now)
  const pending = {
    inDigest: true,
    digestedAt: null,
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
    const stamp = now
    const to = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM volunteers WHERE id = ${volunteerId} FOR UPDATE`
      const vol = await tx.volunteer.findFirst({
        where: { id: volunteerId, deletedAt: null },
        select: { name: true, email: true },
      })
      if (!vol?.email) return null
      const already = await tx.notification.findFirst({
        where: { volunteerId, digestedAt: { gte: today } },
        select: { id: true },
      })
      if (already) return null
      const { count } = await tx.notification.updateMany({
        where: { volunteerId, ...pending },
        data: { digestedAt: stamp },
      })
      if (count === 0) return null
      return { name: vol.name, email: vol.email }
    })
    if (!to) continue

    const items = await prisma.notification.findMany({
      where: { volunteerId, digestedAt: stamp },
      orderBy: { createdAt: 'asc' },
      select: { type: true, title: true, body: true, link: true },
    })
    const ok = await sendNotificationDigestEmail({
      to: to.email,
      name: to.name,
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
      await prisma.notification.updateMany({
        where: { volunteerId, digestedAt: stamp },
        data: { digestedAt: null },
      })
    }
  }

  return { recipients: people.length, sent, notifications }
}
