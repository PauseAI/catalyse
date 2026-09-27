/**
 * The dates on a task as a form holds them, and as people read them.
 *
 * A task has a start and a deadline, and its bar runs from one to the other: the deadline is
 * the one date it should be done by, and the one reminders count towards. `timing` says how to
 * read the window — `flexible` work happens any time within it, `fixed` work happens on exactly
 * those dates (a shift, a stall, the event itself). A fixed task can instead be a milestone: a
 * single moment with no length.
 */

import { diffInDays } from './schedule'
import { formatDateShort, fromDateInputValue, toDateInputValue } from './format-date'
import { plural } from './plural'

export type TaskTimingValue = 'flexible' | 'fixed'

/** Everything the Dates block edits, as the strings its inputs hold. */
export type DatesValue = {
  timing: TaskTimingValue
  /** `yyyy-mm-dd`, or empty to start when the work before it finishes. */
  startDate: string
  /** `yyyy-mm-dd`: the last day, when it should be done by. Empty for none. */
  deadline: string
  /** Fixed timing only: a moment on the start date, with no deadline. */
  milestone: boolean
  estimatedHours: string
}

export function datesValueFrom(task: {
  timing?: TaskTimingValue | null
  startDate: Date | string | null
  durationDays: number | null
  estimatedHours: number | null
  deadline: Date | string | null
}): DatesValue {
  return {
    timing: task.timing ?? 'flexible',
    startDate: toDateInputValue(task.startDate),
    deadline: toDateInputValue(task.deadline),
    milestone: task.durationDays === 0,
    estimatedHours: task.estimatedHours !== null ? String(task.estimatedHours) : '',
  }
}

export const EMPTY_DATES: DatesValue = {
  timing: 'flexible',
  startDate: '',
  deadline: '',
  milestone: false,
  estimatedHours: '',
}

export type DatesPayload = ReturnType<typeof datesPayload>

/** The fields to send to the API. A milestone has a length of zero and no deadline. */
export function datesPayload(v: DatesValue) {
  const milestone = v.timing === 'fixed' && v.milestone
  return {
    timing: v.timing,
    startDate: fromDateInputValue(v.startDate),
    durationDays: milestone ? (0 as const) : null,
    estimatedHours: v.estimatedHours ? parseFloat(v.estimatedHours) : null,
    deadline: milestone ? null : fromDateInputValue(v.deadline),
  }
}

/**
 * Whether a task is on the timeline: it has a start, a deadline, a length (a milestone) or a
 * task before it. One with none of these has no plan to draw or to be past.
 */
export function taskIsDated(
  t: {
    startDate: Date | string | null
    durationDays: number | null
    deadline: Date | string | null
  },
  hasPredecessor: boolean,
): boolean {
  return t.startDate !== null || t.durationDays !== null || t.deadline !== null || hasPredecessor
}

/** Days the deadline falls before the start, or null when it does not (or either is unknown). */
export function deadlineBeforeStart(start: Date | null, deadline: Date | null): number | null {
  if (!start || !deadline) return null
  const days = diffInDays(deadline, start)
  return days > 0 ? days : null
}

/**
 * The line under a task that follows another and cannot start in time: "“Book venue” finishes
 * too late: this can't start until 3 Oct, 2 days after its deadline."
 */
export function lateStartSentence(followsTitle: string, start: Date, days: number): string {
  return `“${followsTitle}” finishes too late: this can’t start until ${formatDateShort(start)}, ${plural(days, 'day')} after its deadline.`
}

/** "14 Sept 2026" or "14 Sept 2026 – 20 Sept 2026". */
export function windowText(start: Date, end: Date): string {
  return start.getTime() === end.getTime()
    ? formatDateShort(start)
    : `${formatDateShort(start)} – ${formatDateShort(end)}`
}

/**
 * The line under the window that says how to read it: "Any time in this window, about 6 hours
 * of work", "Takes the whole window", "On these dates", "A moment, not a stretch of work".
 * `spanDays` is the window's length on the calendar: 0 for a milestone, 1 for a single day.
 */
export function windowReading(
  timing: TaskTimingValue,
  spanDays: number,
  estimatedHours: number | null,
): string {
  if (spanDays === 0) return 'A moment, not a stretch of work'
  const one = spanDays === 1
  const effort = estimatedHours !== null ? `about ${plural(estimatedHours, 'hour')} of work` : null
  if (timing === 'fixed') {
    const when = one ? 'On this day' : 'On these dates'
    return effort ? `${when}, ${effort}` : when
  }
  if (effort) return `Any time ${one ? 'that day' : 'in this window'}, ${effort}`
  return one ? 'Takes the day' : 'Takes the whole window'
}
