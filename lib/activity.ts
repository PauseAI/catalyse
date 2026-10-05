import { prisma } from './prisma'
import { ACTIVE_WITHIN_DAYS } from './activity-window'

const DAY = 24 * 60 * 60 * 1000

export function isActiveRecently(lastActiveAt: Date | null, now = new Date()): boolean {
  return lastActiveAt !== null && now.getTime() - lastActiveAt.getTime() < ACTIVE_WITHIN_DAYS * DAY
}

/** Records that a volunteer used the site, at most once a day. */
export async function touchLastActive(volunteer: {
  id: number
  lastActiveAt: Date | null
}): Promise<void> {
  const now = new Date()
  if (volunteer.lastActiveAt && now.getTime() - volunteer.lastActiveAt.getTime() < DAY) return
  await prisma.volunteer
    .update({ where: { id: volunteer.id }, data: { lastActiveAt: now } })
    .catch((e) => console.error('[ACTIVITY ERROR]', e))
}
