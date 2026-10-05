import type { BadgeVariant } from '@/components/Badge'

/**
 * The words the site uses for the state of a piece of work, an application and a
 * suggestion. Project *lifecycle* status has its own map in `lib/project-status.ts`,
 * because the server and the e2e helpers read it too.
 *
 * Every screen showing one of these reads it from here: the same Quick Task used to be
 * "In Progress" on the dashboard and "Assigned" on the Quick Tasks page.
 */

/** Quick Tasks: a volunteer claims one, submits it, and an admin reviews it. */
export const QUICK_TASK_STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  in_progress: 'In progress',
  under_review: 'Submitted for review',
  completed: 'Done',
}

export const QUICK_TASK_STATUS_VARIANTS: Record<string, BadgeVariant> = {
  open: 'warning',
  in_progress: 'info',
  under_review: 'caution',
  completed: 'success',
}

/** Project tasks: claimed, then submitted, and accepted by the owner unless they auto-accept. */
export const TASK_STATUS_LABELS: Record<string, string> = {
  open: 'Not started',
  in_progress: 'In progress',
  under_review: 'Submitted for review',
  completed: 'Done',
}

export const TASK_STATUS_VARIANTS: Record<string, BadgeVariant> = {
  open: 'neutral',
  in_progress: 'info',
  under_review: 'caution',
  completed: 'success',
}

/** A volunteer's interest in a project, from their side and the owner's. */
export const INTEREST_STATUS_LABELS: Record<string, string> = {
  pending: 'Applied',
  accepted: 'Accepted',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
  removed: 'Removed',
  invited: 'Invited',
  cancelled: 'Cancelled',
}

const INTEREST_ORIGINS: Record<string, string> = {
  applied: 'Applied',
  added: 'Added',
  invited: 'Invited',
}

const INTEREST_ENDINGS: Record<string, string> = {
  declined: 'declined',
  removed: 'removed',
  withdrawn: 'withdrew',
  cancelled: 'cancelled',
}

/**
 * How someone came to a project and how they left it, for the project owner: "Applied,
 * declined", "Added, removed", "Invited, cancelled". Null while they are still on it or
 * waiting.
 */
export function interestHistoryLabel(origin: string, status: string): string | null {
  const ending = INTEREST_ENDINGS[status]
  if (!ending) return null
  return `${INTEREST_ORIGINS[origin] ?? 'Applied'}, ${ending}`
}

/** A proposed team or local group, waiting on an admin. */
export const SUGGESTION_STATUS_LABELS: Record<string, string> = {
  pending: 'Applied',
  on_hold: 'Under review',
  accepted: 'Approved',
  declined: 'Declined',
}
