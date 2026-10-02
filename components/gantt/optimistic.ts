/**
 * Re-running the schedule in the browser so a drag lands immediately.
 *
 * A drag ends by writing to the server, but dnd-kit drops its transform the moment the pointer
 * is released — so without this the bar snaps back to where it started and only jumps forward
 * once the refetch arrives. `computeSchedule` is pure and shared with the server, which is what
 * makes an honest preview possible: the same code, the same rules, so the optimistic placement
 * is what the round trip will confirm rather than a guess that has to be corrected.
 *
 * Cascades come along for free — moving a predecessor moves everything derived from it here,
 * exactly as it will on the server.
 */

import {
  computeSchedule,
  type ScheduleEdge,
  type ScheduleInput,
  type ScheduledItem,
} from '@/lib/schedule'

/** The stored columns the scheduler reads, as they arrive on the client. */
export type ClientSchedulable = {
  id: number
  startDate: Date | string | null
  durationDays: number | null
  deadline: Date | string | null
  baselineStartDate: Date | string | null
  baselineDurationDays: number | null
  startedAt: Date | string | null
  completedAt: Date | string | null
  isAnchor?: boolean
}

/** One item's pending schedule change, in the shape the reschedule mutation sends. */
export type PendingPatch = {
  id: number
  startDate: Date | string | null
  durationDays?: number | null
}

function asDate(value: Date | string | null): Date | null {
  return value === null ? null : value instanceof Date ? value : new Date(value)
}

/** A task as it arrives on the client, in the shape the scheduler reads. */
export function toClientScheduleInput(t: ClientSchedulable): ScheduleInput {
  return {
    id: t.id,
    startDate: asDate(t.startDate),
    durationDays: t.durationDays,
    deadline: asDate(t.deadline),
    baselineStartDate: asDate(t.baselineStartDate),
    baselineDurationDays: t.baselineDurationDays,
    startedAt: asDate(t.startedAt),
    completedAt: asDate(t.completedAt),
    isAnchor: t.isAnchor ?? false,
  }
}

/**
 * The schedule as it will be once `patches` are saved. `origin` must be the same origin the
 * server used (`scopeOrigin` on the timeline payload) — derived items count from it, so a
 * different one here would move bars the server is about to leave alone.
 */
export function scheduleWithPatches(
  tasks: ClientSchedulable[],
  edges: ScheduleEdge[],
  origin: Date | string,
  patches: PendingPatch[],
): ScheduledItem[] {
  const patchById = new Map(patches.map((p) => [p.id, p]))

  const items = tasks.map((t) => {
    const patch = patchById.get(t.id)
    const item = toClientScheduleInput(t)
    return {
      ...item,
      startDate: patch ? asDate(patch.startDate) : item.startDate,
      durationDays: patch && patch.durationDays !== undefined ? patch.durationDays : t.durationDays,
    }
  })

  return computeSchedule(items, edges, asDate(origin)!).scheduled
}
