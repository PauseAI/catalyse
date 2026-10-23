import type { ScheduledItem } from '@/lib/schedule'
import type { TaskRef } from '@/lib/task-status'

/** One bar on the chart: a work item, its computed placement, and how to label/link it. */
export type GanttRow = {
  id: number
  label: string
  /** Optional deep link for the row's name. */
  href?: string
  /** A task's shown status (lib/task-status.ts) or a ProjectStatus — drives the bar colour. */
  status: string
  placement: ScheduledItem
  /** Tasks only: how to read the window (see lib/task-dates.ts). */
  timing?: 'flexible' | 'fixed'
  /** Tasks only: hours of work inside the window. */
  effortHours?: number | null
  /** Tasks only: who holds it, null while unclaimed. */
  assigneeName?: string | null
  /** Tasks only: the open work a Blocked task waits on. */
  blockedBy?: TaskRef[]
}

/** An item with no dates yet: a row with an empty track, under the dated rows. */
export type GanttUndatedRow = Pick<GanttRow, 'id' | 'label' | 'href'>

/** A finish-to-start edge, already filtered to rows present on the chart. */
export type GanttEdge = {
  /** Dependency row id, when the caller has it (lets the panel edit the link). */
  id?: number
  predecessorId: number
  successorId: number
}
