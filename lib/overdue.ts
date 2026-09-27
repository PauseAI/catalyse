import { startOfUtcDay } from './schedule'

/**
 * A task is overdue once the day after its deadline has begun and it is not done. The deadline
 * day itself is still in time.
 */
/**
 * Work that has been handed in is off the clock even while it waits for review: the volunteer
 * has done their part. Task and Quick Task statuses share these names.
 */
export function handedIn(status: string): boolean {
  return status === 'under_review' || status === 'completed'
}

export function isOverdue(
  deadline: Date | string | null,
  done: boolean,
  now: Date = new Date(),
): boolean {
  if (!deadline || done) return false
  return startOfUtcDay(new Date(deadline)).getTime() < startOfUtcDay(now).getTime()
}
