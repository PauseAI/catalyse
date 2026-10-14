import type { ReactNode } from 'react'
import Link from 'next/link'
import { LatenessBadge, WorkStatusBadge } from '@/components/StatusBadges'
import { WorkItemType } from '@/generated/prisma/enums'
import { lateness } from '@/lib/lateness'
import { handedIn } from '@/lib/overdue'
import { relativeDue, shortDay } from '@/lib/relative-date'
import { latenessOutline, statusOutline } from '@/lib/status-emphasis'
import { UNCLAIMED_LABEL } from '@/lib/status-labels'
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

/**
 * "Done 9 Oct", "14 Oct · in 3 days", "Due 14 Oct" while handed in or beside a Late or Due soon
 * badge, or "No deadline".
 */
function dueText(item: WorkItemSummary, today: Date, badged: boolean): string | null {
  if (item.displayStatus === 'completed') {
    return item.completedAt ? `Done ${shortDay(item.completedAt, today)}` : null
  }
  if (!item.deadline) return 'No deadline'
  const day = shortDay(item.deadline, today)
  return handedIn(item.displayStatus) || badged
    ? `Due ${day}`
    : `${day} · ${relativeDue(item.deadline, today)}`
}

/**
 * A task or Quick Task referenced from elsewhere, on one row that wraps when narrow: its title
 * (a link to it), its status, whether it is late or due soon, who has it and when it is due.
 * `compact` leaves out who has it, for dense lists; `extra` takes anything the place showing it
 * adds, such as a lag or a role. `pastPlanDays` counts towards Late where the place knows it.
 */
export default function WorkItemCard({
  item,
  variant = 'default',
  extra,
  pastPlanDays = null,
  today = new Date(),
}: {
  item: WorkItemSummary
  variant?: 'default' | 'compact'
  extra?: ReactNode
  pastPlanDays?: number | null
  today?: Date
}) {
  const late = lateness(
    { deadline: item.deadline, pastPlanDays, done: handedIn(item.displayStatus) },
    today,
  )
  const due = dueText(item, today, late !== null)

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <Link href={item.href} className="text-primary-text font-medium underline">
        {item.title}
      </Link>
      <WorkStatusBadge
        status={item.displayStatus}
        quick={item.type === WorkItemType.QUICK_TASK}
        outline={statusOutline(item.displayStatus, false, item.viewer)}
      />
      <LatenessBadge lateness={late} outline={latenessOutline(item.viewer)} />
      {variant === 'default' && <span className="text-text-light">{whoText(item)}</span>}
      {due && <span className="text-text-light">{due}</span>}
      {extra}
    </div>
  )
}
