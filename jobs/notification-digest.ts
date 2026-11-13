import { prisma } from '@/lib/prisma'
import { isEmailConfigured, sendNotificationDigestEmail } from '@/lib/email'
import { logger } from '@/lib/logger'
import { digestDueOn, digestSections, digestSubject } from '@/lib/notification-digest'
import { digestScheduleOf, pendingDigestSchedules } from '@/lib/notification-preferences'

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

  const candidates = await pendingDigestSchedules()
  const due = candidates.filter((s) => digestDueOn(now, s))

  let sent = 0
  let failed = 0
  let notifications = 0
  for (const { volunteerId } of due) {
    // One person's failure, a lock that times out or a send that throws, never costs the
    // others their hour.
    try {
      const count = await sendDigest(volunteerId, now)
      if (count > 0) {
        sent++
        notifications += count
      }
    } catch (e) {
      failed++
      logger.error(e, '[NOTIFICATION DIGEST] failed')
    }
  }

  return { candidates: candidates.length, due: due.length, sent, failed, notifications }
}

/** Sends `volunteerId` their digest if it is still due; the number of notifications it carried. */
async function sendDigest(volunteerId: number, now: Date): Promise<number> {
  const digest = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM volunteers WHERE id = ${volunteerId} FOR UPDATE`
    // Read again under the lock, so a run that overlapped this one sees its digest.
    const schedule = await digestScheduleOf(volunteerId, tx)
    const day = digestDueOn(now, schedule)
    const vol = await tx.volunteer.findUniqueOrThrow({
      where: { id: volunteerId },
      select: { name: true, email: true, deletedAt: true },
    })
    if (!day || !vol.email || vol.deletedAt) return null
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
  if (!digest) return 0

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
  if (ok) return items.length
  await prisma.notificationDigest.delete({ where: { id: digest.id } })
  return 0
}
