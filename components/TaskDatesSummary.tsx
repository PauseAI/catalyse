import { formatDateShort } from '@/lib/format-date'
import { deadlineStanding } from '@/lib/slip'
import { diffInDays } from '@/lib/schedule'
import { plural } from '@/lib/plural'
import { UNCLAIMED_LABEL } from '@/lib/status-labels'
import { windowReading, windowText, type TaskTimingValue } from '@/lib/task-dates'

type Placement = {
  start: Date | string
  end: Date | string
  daysLate: number | null
  isMilestone: boolean
}

/**
 * The read-only answer to "when is this, and who has it", in the words the Dates block uses:
 * the window (or, with no start of its own, just the deadline), how to read it, whether it is
 * late, and the person doing it.
 */
export default function TaskDatesSummary({
  timing,
  estimatedHours,
  deadline,
  openStart,
  placement,
  assigneeName,
  claimedAt,
  startedAt,
  completedAt,
}: {
  timing: TaskTimingValue
  estimatedHours: number | null
  deadline: Date | string | null
  /** No start date and nothing before it, so only the deadline says when. */
  openStart: boolean
  /** Where the plan puts the task; null when it is not on the timeline. */
  placement: Placement | null
  assigneeName: string | null
  claimedAt: Date | string | null
  startedAt: Date | string | null
  completedAt: Date | string | null
}) {
  const span = placement
    ? placement.isMilestone
      ? 0
      : diffInDays(new Date(placement.start), new Date(placement.end)) + 1
    : null
  const standing = deadline
    ? deadlineStanding(
        { deadline: new Date(deadline), daysLate: placement?.daysLate ?? null },
        completedAt !== null,
      )
    : null
  const effort = estimatedHours !== null ? `Effort: about ${plural(estimatedHours, 'hour')}` : null

  return (
    <dl className="mb-4 grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-2 text-sm">
      <dt className="text-text-light">When</dt>
      <dd className="m-0">
        {placement && openStart && deadline ? (
          <>
            <span className="font-medium">By {formatDateShort(deadline)}</span>
            {effort && <span className="text-text-light block">{effort}</span>}
          </>
        ) : placement ? (
          <>
            <span className="font-medium">
              {windowText(new Date(placement.start), new Date(placement.end))}
            </span>
            <span className="text-text-light block">
              {windowReading(timing, span ?? 1, estimatedHours)}
            </span>
          </>
        ) : (
          <>
            <span>Not on the timeline yet</span>
            {effort && <span className="text-text-light block">{effort}</span>}
          </>
        )}
        {standing?.late && <span className="text-error block">{standing.text}</span>}
      </dd>

      <dt className="text-text-light">Who</dt>
      <dd className="m-0">
        {assigneeName === null
          ? completedAt
            ? `Finished ${formatDateShort(completedAt)}`
            : UNCLAIMED_LABEL
          : completedAt
            ? `${assigneeName}, finished ${formatDateShort(completedAt)}`
            : startedAt
              ? `${assigneeName}, started ${formatDateShort(startedAt)}`
              : claimedAt
                ? `${assigneeName}, claimed on ${formatDateShort(claimedAt)}`
                : assigneeName}
      </dd>
    </dl>
  )
}
