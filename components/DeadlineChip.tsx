import { Badge } from '@/components/Badge'
import { formatDateShort } from '@/lib/format-date'
import { isOverdue } from '@/lib/overdue'

/** "Deadline 30 Sept 2026", with an Overdue badge once it has passed and the work is not done. */
export default function DeadlineChip({
  deadline,
  done,
}: {
  deadline: Date | string
  done: boolean
}) {
  return (
    <>
      {isOverdue(deadline, done) && <Badge variant="danger">Overdue</Badge>}
      <span className="text-text-light text-sm whitespace-nowrap">
        Deadline {formatDateShort(deadline)}
      </span>
    </>
  )
}
