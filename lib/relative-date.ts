import { isOverdue } from './overdue'
import { plural } from './plural'
import { diffInDays } from './schedule'

/**
 * How far away a deadline is, in days: "today", "tomorrow", "in 3 days", "2 days overdue". The
 * one place this phrase is made. Days are whole UTC days, as the scheduler counts them, and
 * overdue follows `isOverdue`: the deadline day itself is still "today".
 */
export function relativeDue(deadline: Date | string, today: Date = new Date()): string {
  const days = diffInDays(today, new Date(deadline))
  if (isOverdue(deadline, false, today)) return `${plural(-days, 'day')} overdue`
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `in ${days} days`
}

/** "14 Oct", or "14 Oct 2027" outside `today`'s year. Read in UTC, so a date never drifts a day. */
export function shortDay(date: Date | string, today: Date = new Date()): string {
  const d = new Date(date)
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: d.getUTCFullYear() === today.getUTCFullYear() ? undefined : 'numeric',
    timeZone: 'UTC',
  })
}
