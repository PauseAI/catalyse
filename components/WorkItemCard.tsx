import type { ReactNode } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/Badge'
import { WorkItemType } from '@/generated/prisma/enums'
import { handedIn, isOverdue } from '@/lib/overdue'
import { relativeDue, shortDay } from '@/lib/relative-date'
import {
  QUICK_TASK_STATUS_LABELS,
  QUICK_TASK_STATUS_VARIANTS,
  TASK_STATUS_LABELS,
  TASK_STATUS_VARIANTS,
  UNCLAIMED_LABEL,
} from '@/lib/status-labels'
import type { WorkItemSummary } from '@/lib/work-item-summary'
import { helperSummary, leadAndHelpers } from '@/lib/helper-summary'

/** "Lead: Sam · 3 helpers (2 more wanted)", or who has it alone when nobody helps or is sought. */
function whoText(item: WorkItemSummary): string {
  if (item.assigneeName !== null) {
    return leadAndHelpers(item.assigneeName, item.helperCount, item.helpersWanted)
  }
  const helpers = helperSummary(item.helperCount, item.helpersWanted)
  return helpers ? `${UNCLAIMED_LABEL} · ${helpers}` : UNCLAIMED_LABEL
}

/** "Done 9 Oct", "14 Oct · in 3 days", "Due 14 Oct" while handed in, or "No deadline". */
function dueText(item: WorkItemSummary, today: Date): string | null {
  if (item.displayStatus === 'completed') {
    return item.completedAt ? `Done ${shortDay(item.completedAt, today)}` : null
  }
  if (!item.deadline) return 'No deadline'
  const day = shortDay(item.deadline, today)
  return handedIn(item.displayStatus)
    ? `Due ${day}`
    : `${day} · ${relativeDue(item.deadline, today)}`
}

/**
 * A task or Quick Task referenced from elsewhere, on one row that wraps when narrow: its title
 * (a link to it), its status, who has it and when it is due. `compact` leaves out who has it,
 * for dense lists; `extra` takes anything the place showing it adds, such as a lag or a role.
 */
export default function WorkItemCard({
  item,
  variant = 'default',
  extra,
  today = new Date(),
}: {
  item: WorkItemSummary
  variant?: 'default' | 'compact'
  extra?: ReactNode
  today?: Date
}) {
  const quick = item.type === WorkItemType.QUICK_TASK
  const labels = quick ? QUICK_TASK_STATUS_LABELS : TASK_STATUS_LABELS
  const variants = quick ? QUICK_TASK_STATUS_VARIANTS : TASK_STATUS_VARIANTS
  const due = dueText(item, today)
  const overdue = isOverdue(item.deadline, handedIn(item.displayStatus), today)

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <Link href={item.href} className="text-primary-text font-medium underline">
        {item.title}
      </Link>
      <Badge variant={variants[item.displayStatus]}>{labels[item.displayStatus]}</Badge>
      {variant === 'default' && <span className="text-text-light">{whoText(item)}</span>}
      {due && <span className={overdue ? 'text-error' : 'text-text-light'}>{due}</span>}
      {extra}
    </div>
  )
}
