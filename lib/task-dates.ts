/**
 * The dates on a task as a form holds them, and as people read them.
 *
 * A task's window is stored as a start and a number of days. The form also offers an end date,
 * and the three fields keep each other in step: only the day count is saved. `timing` says how
 * to read the window — `flexible` work happens any time within it, `fixed` work happens on
 * exactly those dates (a shift, a stall, the event itself).
 */

import { addDays, diffInDays, startOfUtcDay } from './schedule'
import { formatDateShort, fromDateInputValue, toDateInputValue } from './format-date'
import { plural } from './plural'

export type TaskTimingValue = 'flexible' | 'fixed'

/** Everything the Dates block edits, as the strings its inputs hold. */
export type DatesValue = {
  timing: TaskTimingValue
  /** `yyyy-mm-dd`, or empty to start when the work before it finishes. */
  startDate: string
  /** Whole days; "0" is a milestone, empty reads as one day. */
  durationDays: string
  estimatedHours: string
  deadline: string
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
    durationDays: task.durationDays !== null ? String(task.durationDays) : '',
    estimatedHours: task.estimatedHours !== null ? String(task.estimatedHours) : '',
    deadline: toDateInputValue(task.deadline),
  }
}

export const EMPTY_DATES: DatesValue = {
  timing: 'flexible',
  startDate: '',
  durationDays: '',
  estimatedHours: '',
  deadline: '',
}

export type DatesPayload = ReturnType<typeof datesPayload>

/** The fields to send to the API. A fixed task has no deadline: its dates are the commitment. */
export function datesPayload(v: DatesValue) {
  return {
    timing: v.timing,
    startDate: fromDateInputValue(v.startDate),
    durationDays: v.durationDays ? parseInt(v.durationDays, 10) : null,
    estimatedHours: v.estimatedHours ? parseFloat(v.estimatedHours) : null,
    deadline: v.timing === 'fixed' ? null : fromDateInputValue(v.deadline),
  }
}

/** Days as the scheduler reads them: empty or unparseable is one day; a milestone takes its day. */
function spanDays(durationDays: string): number {
  const n = parseInt(durationDays, 10)
  return Number.isNaN(n) ? 1 : Math.max(1, n)
}

/** The last day of a window starting on `start`, as an input value. */
export function endInputValue(start: string, durationDays: string): string {
  const from = fromDateInputValue(start)
  return from ? toDateInputValue(addDays(from, spanDays(durationDays) - 1)) : ''
}

/** Days from `start` to `end` inclusive, or null when the end comes before the start. */
export function daysBetween(start: string, end: string): number | null {
  const from = fromDateInputValue(start)
  const to = fromDateInputValue(end)
  if (!from || !to) return null
  const days = diffInDays(from, to) + 1
  return days >= 1 ? days : null
}

/**
 * Where the plan puts the end, from the form: a set start, or the start the schedule derived
 * when the task follows another. Null when neither is known.
 */
export function plannedEnd(v: DatesValue, derivedStart: Date | null): Date | null {
  const start = fromDateInputValue(v.startDate) ?? derivedStart
  return start ? addDays(start, spanDays(v.durationDays) - 1) : null
}

/**
 * "Planned to finish 20 Sept 2026, 3 days after the deadline." Once the deadline has gone by,
 * how the plan compared to it no longer matters; what matters is that it has passed.
 */
export function finishSentence(end: Date, deadline: Date, today: Date = new Date()): string {
  const overdue = diffInDays(deadline, today)
  if (overdue > 0) {
    return `Planned to finish ${formatDateShort(end)}; the deadline passed ${plural(overdue, 'day')} ago.`
  }
  const late = diffInDays(deadline, end)
  const gap =
    late === 0
      ? 'on the deadline'
      : `${plural(Math.abs(late), 'day')} ${late > 0 ? 'after' : 'before'} the deadline`
  return `Planned to finish ${formatDateShort(end)}, ${gap}.`
}

/** Whether the deadline has already passed, so fitting the window to it would end in the past. */
export function deadlinePassed(deadline: Date, today: Date = new Date()): boolean {
  return diffInDays(deadline, today) > 0
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

/**
 * The dates that make the window end on the deadline: the same start (or the one the schedule
 * gives it, or today when it has neither), and the days to reach the deadline. Null when there
 * is no deadline, it has passed, it already ends there, or the deadline comes before the start.
 */
export function fitToDeadline(
  v: DatesValue,
  derivedStart: Date | null,
  today: Date = new Date(),
): DatesValue | null {
  const deadline = fromDateInputValue(v.deadline)
  if (v.timing === 'fixed' || !deadline || deadlinePassed(deadline, today)) return null
  const start = fromDateInputValue(v.startDate) ?? derivedStart ?? startOfUtcDay(today)
  const days = diffInDays(start, deadline) + 1
  if (days < 1) return null
  const end = plannedEnd(v, derivedStart)
  if (end && end.getTime() === deadline.getTime()) return null
  return {
    ...v,
    startDate: v.startDate || (derivedStart ? '' : toDateInputValue(start)),
    durationDays: String(days),
  }
}
