import type { BadgeVariant } from '@/components/Badge'
import { isOverdue } from './overdue'
import { plural } from './plural'
import { diffInDays } from './schedule'

/** A deadline this many days away or fewer makes work Due soon. */
export const DUE_SOON_DAYS = 3

export type Lateness = { kind: 'late'; days: number } | { kind: 'due_soon'; days: number }

/**
 * Whether open work is late or due soon. Late counts from whichever passed first: the deadline
 * (`isOverdue`) or the end of its plan (`pastPlanDays`, from `daysPastPlan`). Due soon is a
 * deadline within `DUE_SOON_DAYS`. Null for work done or handed in, and for work with time to
 * spare.
 */
export function lateness(
  work: { deadline: Date | string | null; pastPlanDays?: number | null; done: boolean },
  today: Date = new Date(),
): Lateness | null {
  if (work.done) return null
  const deadline = work.deadline ? new Date(work.deadline) : null
  const pastDeadline =
    deadline && isOverdue(deadline, false, today) ? diffInDays(deadline, today) : 0
  const days = Math.max(pastDeadline, work.pastPlanDays ?? 0)
  if (days > 0) return { kind: 'late', days }
  if (!deadline) return null
  const left = diffInDays(today, deadline)
  return left <= DUE_SOON_DAYS ? { kind: 'due_soon', days: left } : null
}

/** "3 days late", "Due today", "Due tomorrow", "Due in 2 days". */
export function latenessLabel(l: Lateness): string {
  if (l.kind === 'late') return `${plural(l.days, 'day')} late`
  if (l.days === 0) return 'Due today'
  if (l.days === 1) return 'Due tomorrow'
  return `Due in ${l.days} days`
}

export const LATENESS_VARIANTS: Record<Lateness['kind'], BadgeVariant> = {
  late: 'danger',
  due_soon: 'attention',
}
