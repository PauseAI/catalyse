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

/**
 * The start and length that make `taskId` end on `newEnd`. A task with a start keeps it; one
 * that follows another keeps following and only lengthens; one with neither starts today.
 * Null when the new end comes before the start.
 */
export function replanWrite(
  current: { startDate: Date | null; placedStart: Date | null },
  newEnd: Date,
  today: Date = new Date(),
): { startDate: Date | null; durationDays: number } | null {
  const start = current.startDate ?? current.placedStart ?? startOfUtcDay(today)
  const durationDays = diffInDays(start, newEnd) + 1
  if (durationDays < 1) return null
  return {
    startDate: current.startDate ?? (current.placedStart ? null : startOfUtcDay(today)),
    durationDays,
  }
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
  write: { startDate: Date | null; durationDays: number },
): ReplanPreview {
  const before = computeSchedule(items, edges, origin)
  const after = computeSchedule(
    items.map((i) => (i.id === taskId ? { ...i, ...write } : i)),
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

/** "Assignee: Sam, last update 5 days ago. Replan, reassign or release." */
export function pastPlanDetail(
  t: { assigneeName: string; lastUpdateAt: Date | null },
  today: Date = new Date(),
): string {
  const last =
    t.lastUpdateAt === null
      ? 'no update yet'
      : `last update ${plural(Math.max(0, diffInDays(t.lastUpdateAt, today)), 'day')} ago`
  return `Assignee: ${t.assigneeName}, ${last}. Replan, reassign or release.`
}
