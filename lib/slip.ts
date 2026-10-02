/**
 * The words for how far a plan has slipped, from the numbers `computeSchedule` puts on each
 * item. One copy so the bar tooltip, the side panel and the timeline header say the same thing.
 */

import { formatDateShort } from './format-date'
import { plural } from './plural'
import { diffInDays, type ScheduledItem } from './schedule'

function cap(text: string): string {
  return `${text[0].toUpperCase()}${text.slice(1)}`
}

/** "2 days late", "on the day", "3 days to spare". */
export function lateText(daysLate: number): string {
  if (daysLate > 0) return `${plural(daysLate, 'day')} late`
  if (daysLate < 0) return `${plural(-daysLate, 'day')} to spare`
  return 'on the day'
}

/** "2 days late (Deadline 30 Sept)", or null when the item has no deadline. */
export function deadlineSlip(
  p: Pick<ScheduledItem, 'deadline' | 'daysLate'>,
  done: boolean,
  today: Date = new Date(),
): string | null {
  const standing = deadlineStanding(p, done, today)
  if (p.deadline === null || standing === null) return null
  return `${cap(standing.text)} (Deadline ${formatDateShort(p.deadline)})`
}

/** "Finish moved 3 days later since the original plan (12 Oct → 15 Oct)", or null if it has not. */
export function movedSlip(
  p: Pick<ScheduledItem, 'baseline' | 'end' | 'finishVarianceDays'>,
): string | null {
  const days = p.finishVarianceDays
  if (!p.baseline || !days) return null
  return `Finish moved ${movedText(days)} since the original plan (${formatDateShort(p.baseline.end)} → ${formatDateShort(p.end)})`
}

/** "3 days later", "1 day earlier". */
export function movedText(days: number): string {
  return `${plural(Math.abs(days), 'day')} ${days > 0 ? 'later' : 'earlier'}`
}

/**
 * Why a pinned start is flagged. On a key date the conflict reads as the prep overrunning it:
 * prep that finishes the day before is on time, so the overrun is one less than the conflict.
 */
export function pinConflictSlip(
  p: Pick<ScheduledItem, 'pinConflictDays' | 'isAnchor'>,
  predecessorLabel: string | undefined,
): string | null {
  const days = p.pinConflictDays
  if (days === null) return null
  const prep = predecessorLabel ? `“${predecessorLabel}”` : 'the work before it'
  if (p.isAnchor) {
    const over = days - 1
    return cap(
      over === 0
        ? `${prep} finishes on the key date itself.`
        : `${prep} finishes ${plural(over, 'day')} after the key date.`,
    )
  }
  return `Starts ${plural(days, 'day')} too early for ${prep}. Move it, or clear its start date to follow it.`
}

/**
 * How an item stands against its deadline today. Once the deadline has passed on unfinished
 * work it is overdue, whatever the plan says; before that, the plan's end is compared with it.
 */
export function deadlineStanding(
  p: Pick<ScheduledItem, 'deadline' | 'daysLate'>,
  done: boolean,
  today: Date = new Date(),
): { text: string; late: boolean; days: number } | null {
  if (p.deadline === null) return null
  const overdue = diffInDays(p.deadline, today)
  if (!done && overdue > 0) {
    return { text: `${plural(overdue, 'day')} overdue`, late: true, days: overdue }
  }
  if (p.daysLate === null) return null
  return { text: lateText(p.daysLate), late: p.daysLate > 0, days: p.daysLate }
}
