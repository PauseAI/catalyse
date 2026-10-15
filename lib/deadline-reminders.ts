/**
 * When deadline reminders go out, as pure functions of dates, so the whole schedule is one file
 * and one test. The daily job (`jobs/deadline-reminders.ts`) asks these what is due today.
 *
 * Every task with a deadline has an expected finish `E`: the later of its deadline and its
 * planned end. The clock starts at the later of when the assignee took the task and its planned
 * start; `S` is the span in days from the clock start to `E`. Each constant below can be scaled
 * back on its own.
 */

import { addDays, diffInDays, startOfUtcDay } from './schedule'

/** A span this long gets one check-in halfway; shorter gets none. */
export const SINGLE_CHECK_IN_FROM_DAYS = 7
/** A span this long gets a check-in every week instead. */
export const WEEKLY_CHECK_INS_FROM_DAYS = 14
/** No check-in lands closer than this to the clock start. */
export const CHECK_IN_MIN_DAYS_AFTER_START = 3
/** The day-before reminder needs at least this much span to be worth sending. */
export const DAY_BEFORE_MIN_SPAN_DAYS = 2
/** Overdue reminders to the assignee go daily for this many days... */
export const OVERDUE_DAILY_DAYS = 7
/** ...then every this many days... */
export const OVERDUE_TAPER_EVERY_DAYS = 3
/** ...and stop at this many days overdue. The owner's summary keeps listing the task. */
export const OVERDUE_ASSIGNEE_CAP_DAYS = 28
/** A late project's owner is told again when the plan slips this much further. */
export const SLIP_ALERT_GROWTH_DAYS = 3

export type ReminderPlan = {
  /** Days before `E` on which to check in, largest first. */
  checkIns: number[]
  /** Days before `E` for the day-before reminder, or null for none. */
  dayBefore: number | null
}

/** The reminders a span of `spanDays` gets before its expected finish. */
export function reminderStages(spanDays: number): ReminderPlan {
  const checkIns: number[] = []
  if (spanDays >= WEEKLY_CHECK_INS_FROM_DAYS) {
    for (let offset = 7; offset <= spanDays - CHECK_IN_MIN_DAYS_AFTER_START; offset += 7) {
      checkIns.unshift(offset)
    }
  } else if (spanDays >= SINGLE_CHECK_IN_FROM_DAYS) {
    checkIns.push(Math.round(spanDays / 2))
  }
  const dayBefore =
    spanDays < DAY_BEFORE_MIN_SPAN_DAYS ? null : spanDays < WEEKLY_CHECK_INS_FROM_DAYS ? 1 : 2
  return { checkIns, dayBefore }
}

/** Whether day `daysOverdue` of the overdue clock (1 is the first) gets an assignee reminder. */
export function isOverdueReminderDay(daysOverdue: number): boolean {
  if (daysOverdue < 1 || daysOverdue > OVERDUE_ASSIGNEE_CAP_DAYS) return false
  if (daysOverdue <= OVERDUE_DAILY_DAYS) return true
  return (daysOverdue - OVERDUE_DAILY_DAYS) % OVERDUE_TAPER_EVERY_DAYS === 0
}

export type AssigneeStage = 'check_in' | 'day_before' | 'due_today' | 'overdue'
export type OwnerStage = 'at_risk' | 'due_tomorrow' | 'due_today' | 'overdue'

export type TaskClock = {
  /** When the clock started: the later of the assignee taking it and its planned start. */
  clockStart: Date
  /** The expected finish, `E`. */
  finishBy: Date
  /** When the assignee took the task, or null if nobody has it. */
  takenAt: Date | null
  /** The assignee's most recent update (a comment or a change), or null for none. */
  lastUpdateAt: Date | null
  /**
   * The first day the reminder job ran. A task already past `E` then never nags its assignee,
   * so switching reminders on does not bury people in overdue notices on day one.
   */
  remindersSince: Date
}

export type StagesToday = {
  assignee: AssigneeStage[]
  owner: OwnerStage[]
  /** Days past `E`, when it has passed. */
  daysOverdue: number | null
  /** Days until `E`, when it is still ahead. */
  daysLeft: number | null
}

/**
 * What a task's assignee and owner are told on `today`. An unassigned task tells only the owner.
 * An update since the last check-in (or the clock start) spares both the check-in prompt and the
 * owner's "at risk" line; it never silences an overdue reminder.
 */
export function stagesToday(clock: TaskClock, today: Date): StagesToday {
  const day = startOfUtcDay(today)
  const start = startOfUtcDay(clock.clockStart)
  const finishBy = startOfUtcDay(clock.finishBy)
  const toGo = diffInDays(day, finishBy)
  const span = Math.max(0, diffInDays(start, finishBy))
  const plan = reminderStages(span)
  const assignee: AssigneeStage[] = []
  const owner: OwnerStage[] = []
  const assigned = clock.takenAt !== null

  if (toGo > 0) {
    // Check-ins that fall before today, most recent first, bound what counts as "since".
    const passed = plan.checkIns
      .map((offset) => addDays(finishBy, -offset))
      .filter((d) => d.getTime() < day.getTime() && d.getTime() > start.getTime())
    const since = passed.length > 0 ? passed[passed.length - 1] : start
    // Claiming a task stamps it, so only an update after the clock start counts.
    const quiet = clock.lastUpdateAt === null || clock.lastUpdateAt.getTime() <= since.getTime()
    if (plan.checkIns.includes(toGo) && quiet) {
      if (assigned) assignee.push('check_in')
      owner.push('at_risk')
    }
    if (plan.dayBefore === toGo && assigned) assignee.push('day_before')
    if (toGo === 1) owner.push('due_tomorrow')
  } else if (toGo === 0) {
    if (assigned) assignee.push('due_today')
    owner.push('due_today')
  } else {
    owner.push('overdue')
    if (clock.takenAt !== null) {
      const overdueStart = laterOf(addDays(finishBy, 1), startOfUtcDay(clock.takenAt))
      const onClock = diffInDays(overdueStart, day) + 1
      const alreadyLateAtLaunch = finishBy.getTime() < startOfUtcDay(clock.remindersSince).getTime()
      if (!alreadyLateAtLaunch && isOverdueReminderDay(onClock)) assignee.push('overdue')
    }
  }

  return {
    assignee,
    owner,
    daysOverdue: toGo < 0 ? -toGo : null,
    daysLeft: toGo > 0 ? toGo : null,
  }
}

function laterOf(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b
}

/**
 * Whether a late project's owner should hear about it today: the first time it is late, or when
 * it has slipped `SLIP_ALERT_GROWTH_DAYS` further than the last alert said.
 */
export function shouldAlertSlip(daysLate: number, lastAlerted: number | null): boolean {
  if (daysLate <= 0) return false
  return lastAlerted === null || daysLate >= lastAlerted + SLIP_ALERT_GROWTH_DAYS
}
