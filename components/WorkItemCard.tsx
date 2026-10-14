import type { ReactNode } from 'react'
import Link from 'next/link'
import { DueChip, WorkStatusBadge } from '@/components/StatusBadges'
import { WorkItemType } from '@/generated/prisma/enums'
import { handedIn } from '@/lib/overdue'
import { shortDay } from '@/lib/relative-date'
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
 * A task or Quick Task referenced from elsewhere, on one row that wraps when narrow: its title
 * (a link to it), its status, who has it and when it is due (`DueChip`), or when it was done.
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
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <Link href={item.href} className="text-primary-text font-medium underline">
        {item.title}
      </Link>
      <WorkStatusBadge
        status={item.displayStatus}
        quick={item.type === WorkItemType.QUICK_TASK}
        viewer={item.viewer}
      />
      {variant === 'default' && <span className="text-text-light">{whoText(item)}</span>}
      {item.displayStatus === 'completed' ? (
        item.completedAt && (
          <span className="text-text-light">Done {shortDay(item.completedAt, today)}</span>
        )
      ) : (
        <DueChip
          deadline={item.deadline}
          done={handedIn(item.displayStatus)}
          viewer={item.viewer}
          pastPlanDays={pastPlanDays}
          noDeadline="No deadline"
          today={today}
        />
      )}
      {extra}
    </div>
  )
}
