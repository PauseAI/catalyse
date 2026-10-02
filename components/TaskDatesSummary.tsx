import { formatDateShort } from '@/lib/format-date'
import { deadlineStanding } from '@/lib/slip'
import { diffInDays } from '@/lib/schedule'
import { plural } from '@/lib/plural'
import { windowReading, windowText, type TaskTimingValue } from '@/lib/task-dates'

type Placement = {
  start: Date | string
  end: Date | string
  daysLate: number | null
}

/**
 * The read-only answer to "when is this, and who has it", in the words the Dates block uses:
 * the window and how to read it, the deadline and the gap to it, and the person doing it.
 */
export default function TaskDatesSummary({
  timing,
  durationDays,
  estimatedHours,
  deadline,
  placement,
  assigneeName,
  startedAt,
  completedAt,
  hasPosted,
}: {
  timing: TaskTimingValue
  durationDays: number | null
  estimatedHours: number | null
  deadline: Date | string | null
  /** Where the plan puts the task; null when it is not on the timeline. */
  placement: Placement | null
  assigneeName: string | null
  startedAt: Date | string | null
  completedAt: Date | string | null
  /** The assignee has posted an update, so the task reads as started rather than just claimed. */
  hasPosted: boolean
}) {
  const span = placement
    ? durationDays === 0
      ? 0
      : diffInDays(new Date(placement.start), new Date(placement.end)) + 1
    : null
  const showDeadline = deadline !== null && timing === 'flexible'
  const standing = deadline
    ? deadlineStanding(
        { deadline: new Date(deadline), daysLate: placement?.daysLate ?? null },
        completedAt !== null,
      )
    : null

  return (
    <dl className="mb-4 grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-2 text-sm">
      <dt className="text-text-light">When</dt>
      <dd className="m-0">
        {placement ? (
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
            {estimatedHours !== null && (
              <span className="text-text-light block">
                About {plural(estimatedHours, 'hour')} of work
              </span>
            )}
          </>
        )}
      </dd>

      {showDeadline && (
        <>
          <dt className="text-text-light">Deadline</dt>
          <dd className="m-0">
            {formatDateShort(deadline)}
            {standing && (
              <span className={standing.late ? 'text-error' : 'text-text-light'}>
                {' '}
                · {standing.text}
              </span>
            )}
          </dd>
        </>
      )}

      <dt className="text-text-light">Who</dt>
      <dd className="m-0">
        {assigneeName === null
          ? completedAt
            ? `Finished ${formatDateShort(completedAt)}`
            : 'Nobody yet'
          : completedAt
            ? `${assigneeName}, finished ${formatDateShort(completedAt)}`
            : startedAt
              ? `${assigneeName}, ${hasPosted ? 'started' : 'claimed on'} ${formatDateShort(startedAt)}`
              : assigneeName}
      </dd>
    </dl>
  )
}
