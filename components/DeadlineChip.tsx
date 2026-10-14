import { LatenessBadge } from '@/components/StatusBadges'
import { formatDateShort } from '@/lib/format-date'
import { lateness } from '@/lib/lateness'

/**
 * "Deadline 30 Sept 2026", after a Late or Due soon badge (`lateness`) while the work is not
 * handed in. `outline` is for a viewer waiting on someone else to meet it (`latenessOutline`).
 */
export default function DeadlineChip({
  deadline,
  done,
  pastPlanDays = null,
  outline = false,
}: {
  deadline: Date | string
  done: boolean
  pastPlanDays?: number | null
  outline?: boolean
}) {
  return (
    <>
      <LatenessBadge lateness={lateness({ deadline, pastPlanDays, done })} outline={outline} />
      <span className="text-text-light text-sm whitespace-nowrap">
        Deadline {formatDateShort(deadline)}
      </span>
    </>
  )
}
