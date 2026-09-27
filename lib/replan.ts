/**
 * Replanning a task that has run past its plan: where it would end, and what moves with it.
 *
 * Pure, and built on `computeSchedule`, so the dialog's preview and the server's save agree.
 */

import {
  addDays,
  computeSchedule,
  diffInDays,
  startOfUtcDay,
  type ScheduleEdge,
  type ScheduleInput,
} from './schedule'
import { plural } from './plural'

/**
 * Days a task's plan ended before today, or null when there is nothing to decide: the task is
 * done, its plan still runs, or nobody holds it. An unclaimed task with a stale bar is not
 * someone running late; it is work still waiting for hands, and the open list already says so.
 */
export function daysPastPlan(
  end: Date,
  task: { done: boolean; assigned: boolean },
  today: Date = new Date(),
): number | null {
  if (task.done || !task.assigned) return null
  const days = diffInDays(end, today)
  return days > 0 ? days : null
}

/** A replan as the columns it writes: the task's bar ends on its deadline, a milestone on its day. */
export type ReplanWrite = { startDate: Date; taskDeadline: Date | null; durationDays: 0 | null }

/** Days a placed bar covers; zero for a milestone. */
export function barLength(p: { start: Date; end: Date; isMilestone: boolean }): number {
  return p.isMilestone ? 0 : diffInDays(p.start, p.end) + 1
}

/**
 * The dates that put a task's bar so it ends on `newEnd`, which becomes its deadline. The bar
 * keeps its length and moves, rather than growing over the days already gone; `days` replaces
 * the length when the work turned out bigger or smaller, and zero makes it a milestone. The
 * start is written even for a task that followed another, so it stops following.
 */
export function replanWrite(
  current: { start: Date; end: Date; isMilestone: boolean },
  newEnd: Date,
  days: number = barLength(current),
): ReplanWrite {
  const end = startOfUtcDay(newEnd)
  if (days <= 0) return { startDate: end, taskDeadline: null, durationDays: 0 }
  return { startDate: addDays(end, -(days - 1)), taskDeadline: end, durationDays: null }
}

export type ReplanPreview = {
  /** Tasks whose start moves, with how far; the replanned task itself is not listed. */
  moved: { id: number; start: Date; days: number }[]
  /** Pinned tasks that would now start before the replanned work allows. */
  pinConflicts: { id: number; days: number }[]
  /** Key dates the prep would now overrun, by how many days past the key date. */
  keyDatesLate: { id: number; days: number }[]
  /** Where the whole plan ends, before and after. */
  endBefore: Date
  endAfter: Date
}

export function previewReplan(
  items: ScheduleInput[],
  edges: ScheduleEdge[],
  origin: Date,
  taskId: number,
  write: ReplanWrite,
): ReplanPreview {
  const before = computeSchedule(items, edges, origin)
  const replanned = {
    startDate: write.startDate,
    deadline: write.taskDeadline,
    durationDays: write.durationDays,
  }
  const after = computeSchedule(
    items.map((i) => (i.id === taskId ? { ...i, ...replanned } : i)),
    edges,
    origin,
  )

  const moved: ReplanPreview['moved'] = []
  const pinConflicts: ReplanPreview['pinConflicts'] = []
  const keyDatesLate: ReplanPreview['keyDatesLate'] = []
  // Both schedules list the items in input order, so the same index is the same task.
  before.scheduled.forEach((was, i) => {
    if (was.id === taskId) return
    const now = after.scheduled[i]
    const days = diffInDays(was.start, now.start)
    if (days !== 0) moved.push({ id: was.id, start: now.start, days })
    const conflict = now.pinConflictDays ?? 0
    if (conflict > (was.pinConflictDays ?? 0)) {
      // A key date overrun reads from the day after it, as `pinConflictSlip` does.
      if (now.isAnchor) keyDatesLate.push({ id: now.id, days: conflict - 1 })
      else pinConflicts.push({ id: now.id, days: conflict })
    }
  })

  return { moved, pinConflicts, keyDatesLate, endBefore: before.end, endAfter: after.end }
}

/** The quick choices in the replan dialog: a new end this many days after the current one. */
export const REPLAN_STEPS = [
  { label: '+1 day', days: 1 },
  { label: '+3 days', days: 3 },
  { label: '+1 week', days: 7 },
] as const

/** The day the quick choices count from: the old end while it is still ahead, otherwise today. */
export function stepBase(oldEnd: Date, today: Date = new Date()): Date {
  return oldEnd.getTime() > startOfUtcDay(today).getTime() ? oldEnd : startOfUtcDay(today)
}

/** A new end `days` after the step base. */
export function steppedEnd(oldEnd: Date, days: number, today: Date = new Date()): Date {
  return addDays(stepBase(oldEnd, today), days)
}

/** "Assignee: Sam, last update 5 days ago. Replan, reassign or unassign." */
export function pastPlanDetail(
  t: { assigneeName: string; lastUpdateAt: Date | null },
  today: Date = new Date(),
): string {
  const last =
    t.lastUpdateAt === null
      ? 'no update yet'
      : `last update ${plural(Math.max(0, diffInDays(t.lastUpdateAt, today)), 'day')} ago`
  return `Assignee: ${t.assigneeName}, ${last}. Replan, reassign or unassign.`
}
