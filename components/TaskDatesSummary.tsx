import { isOverdue } from '@/lib/overdue'
import { plural } from '@/lib/plural'
import { relativeDue, shortDay } from '@/lib/relative-date'
import { diffInDays } from '@/lib/schedule'
import { dayRange, lateText } from '@/lib/slip'

type Placement = {
  start: Date | string
  end: Date | string
  daysLate: number | null
}

/**
 * The read-only answer to "when is this due, and how much work is it": "Due 14 Oct · in 3 days
 * (from 7 Oct)", then "Effort: about 6 hours". The page heading says Due; the field that sets
 * it is called Deadline.
 */
export default function TaskDatesSummary({
  estimatedHours,
  deadline,
  openStart,
  placement,
  handedIn,
  today = new Date(),
  className = 'mb-4',
}: {
  estimatedHours: number | null
  deadline: Date | string | null
  /** No start date and nothing before it, so only the deadline says when. */
  openStart: boolean
  /** Where the plan puts the task; null when it is not on the timeline. */
  placement: Placement | null
  /** Submitted or done: how far away the deadline is no longer matters. */
  handedIn: boolean
  today?: Date
  /** Spacing around the block, which differs between the task page and the timeline panel. */
  className?: string
}) {
  const start = placement && !openStart ? new Date(placement.start) : null
  const from =
    start && deadline && diffInDays(start, new Date(deadline)) !== 0
      ? ` (from ${shortDay(start, today)})`
      : null
  const overdue = !handedIn && isOverdue(deadline, false, today)
  const daysLate = placement?.daysLate ?? 0
  // The plan runs past a deadline that has not passed yet.
  const overrun = !handedIn && deadline !== null && !overdue && daysLate > 0

  return (
    <div role="group" aria-label="When it is due" className={`${className} text-sm`}>
      {deadline ? (
        <p className="m-0 font-medium">
          Due {shortDay(deadline, today)}
          {!handedIn && (
            <span className={overdue ? 'text-error' : undefined}>
              {' · '}
              {relativeDue(deadline, today)}
            </span>
          )}
          {from && <span className="font-normal text-text-light">{from}</span>}
        </p>
      ) : (
        <p className="m-0 font-medium">
          No deadline
          {placement && (
            <span className="font-normal text-text-light">
              {' · planned '}
              {dayRange(new Date(placement.start), new Date(placement.end), today)}
            </span>
          )}
        </p>
      )}
      {overrun && <p className="m-0 text-error">Planned to finish {lateText(daysLate)}</p>}
      {estimatedHours !== null && (
        <p className="m-0 text-text-light">Effort: about {plural(estimatedHours, 'hour')}</p>
      )}
    </div>
  )
}
