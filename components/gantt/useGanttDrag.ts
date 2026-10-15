'use client'

import { addDays } from '@/lib/schedule'
import type { GanttRow } from './types'

/** What a given drag is doing, encoded on the draggable's `data`. */
export type DragKind = 'move' | 'resize-end' | 'link'

export type DragData =
  | { kind: 'move'; rowId: number }
  | { kind: 'resize-end'; rowId: number }
  | { kind: 'link'; rowId: number }

export type ReschedulePatch = {
  id: number
  startDate: Date | null
  /** Omitted when the gesture doesn't touch the duration. */
  durationDays?: number | null
  /** Tasks only: where the bar ends, omitted when the gesture leaves it. */
  deadline?: Date | null
}

/** Whole days a pixel delta represents at the current scale. */
export function deltaToDays(deltaX: number, pxPerDay: number): number {
  return Math.round(deltaX / pxPerDay)
}

/**
 * Turns a finished move/resize drag into the single stored change it implies.
 *  - move   → pins the row's start to where it was dropped (writes startDate); a task's
 *             deadline moves with it, since that is where its bar ends.
 *  - resize → changes only the end: a task's deadline, a project's duration. A 1-day floor
 *             keeps the bar visible.
 * Returns null when the gesture is a no-op.
 */
export function patchFromDrag(
  row: GanttRow,
  data: DragData,
  deltaX: number,
  pxPerDay: number,
): ReschedulePatch | null {
  const days = deltaToDays(deltaX, pxPerDay)
  if (days === 0) return null

  if (data.kind === 'move') {
    // Moving pins the start; the length is left exactly as it was.
    const moved = { id: row.id, startDate: addDays(row.placement.start, days) }
    const { deadline, endsOnDeadline } = row.placement
    return endsOnDeadline && deadline ? { ...moved, deadline: addDays(deadline, days) } : moved
  }
  if (data.kind === 'resize-end') {
    const current = daysBetween(row.placement.start, row.placement.end) + 1
    const next = Math.max(1, current + days)
    if (next === current) return null
    // Resize alone must not pin a following task — keep its start rule as-is.
    const startDate = row.placement.isPinned ? row.placement.start : null
    return row.placement.endsOnDeadline
      ? { id: row.id, startDate, deadline: addDays(row.placement.start, next - 1) }
      : { id: row.id, startDate, durationDays: next }
  }
  return null
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}
