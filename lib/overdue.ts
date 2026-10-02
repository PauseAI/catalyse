import { startOfUtcDay } from './schedule'

/**
 * A task is overdue once the day after its deadline has begun and it is not done. The deadline
 * day itself is still in time.
 */
export function isOverdue(
  deadline: Date | string | null,
  done: boolean,
  now: Date = new Date(),
): boolean {
  if (!deadline || done) return false
  return startOfUtcDay(new Date(deadline)).getTime() < startOfUtcDay(now).getTime()
}
