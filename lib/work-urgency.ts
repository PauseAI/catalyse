import { isOverdue } from './overdue'
import { plural } from './plural'
import { relativeDue } from './relative-date'
import { diffInDays } from './schedule'

// Starting points, to be tuned from how volunteers actually use Home.
/** A deadline this many days away or fewer puts a task in "Needs attention now". */
export const ATTENTION_WINDOW_DAYS = 7
/** How many hours a volunteer is assumed to give a task on a day they work on it. */
export const VOLUNTEER_HOURS_PER_DAY = 2
/** Slack kept between finishing at that pace and the deadline. */
export const START_BUFFER_DAYS = 2

export type UrgencyInput = {
  deadline: Date | string | null
  estimatedHours: number | null
  /** Done or handed in: off the volunteer's clock. */
  done: boolean
}

/**
 * Why a task belongs in Home's "Needs attention now", or null if it does not: it is overdue,
 * due within `ATTENTION_WINDOW_DAYS`, or has so much work left that, at
 * `VOLUNTEER_HOURS_PER_DAY` with `START_BUFFER_DAYS` to spare, it has to start now. More than
 * a day's work is named in the reason; less reads as a plain due date.
 */
export function attentionReason(task: UrgencyInput, today: Date = new Date()): string | null {
  if (task.done || !task.deadline) return null
  const deadline = new Date(task.deadline)
  if (isOverdue(deadline, false, today)) return relativeDue(deadline, today)

  const daysLeft = diffInDays(today, deadline)
  const hours = task.estimatedHours ?? 0
  const workDays = Math.ceil(hours / VOLUNTEER_HOURS_PER_DAY)
  if (hours > VOLUNTEER_HOURS_PER_DAY && daysLeft <= workDays + START_BUFFER_DAYS) {
    return `About ${plural(hours, 'hour')} of work, due ${relativeDue(deadline, today)}: start now`
  }
  if (daysLeft <= ATTENTION_WINDOW_DAYS) return `Due ${relativeDue(deadline, today)}`
  return null
}

/** Whether a task belongs in Home's "Needs attention now"; `attentionReason` says why. */
export function needsAttentionNow(task: UrgencyInput, today: Date = new Date()): boolean {
  return attentionReason(task, today) !== null
}
