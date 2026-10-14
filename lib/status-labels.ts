import type { BadgeVariant } from '@/components/Badge'

/**
 * The words and badge colours the site uses for the state of a piece of work, an application
 * and a suggestion. Project *lifecycle* status has its own map in `lib/project-status.ts`,
 * because the server and the e2e helpers read it too.
 *
 * Every screen showing one of these reads it from here: the same Quick Task used to be
 * "In Progress" on the dashboard and "Assigned" on the Quick Tasks page.
 */

/** What work not yet under way reads as, whatever it waits on. */
export const TO_DO_LABEL = 'To do'
/** Work handed in and waiting for someone to accept it. */
export const IN_REVIEW_LABEL = 'In review'
/** Work sent back by its reviewer, until it is handed in again. */
export const CHANGES_REQUESTED_LABEL = 'Changes requested'

/** Quick Tasks: a volunteer claims one, submits it, and an admin reviews it. */
export const QUICK_TASK_STATUS_LABELS: Record<string, string> = {
  open: TO_DO_LABEL,
  in_progress: 'In progress',
  under_review: IN_REVIEW_LABEL,
  completed: 'Done',
}

export const QUICK_TASK_STATUS_VARIANTS: Record<string, BadgeVariant> = {
  open: 'neutral',
  in_progress: 'info',
  under_review: 'info',
  completed: 'success',
}

/**
 * Project tasks, by stored status and by the shown status (`taskDisplayStatus`). Blocked and
 * Ready both read as To do: what a blocked task waits on is said beside its badge.
 */
export const TASK_STATUS_LABELS: Record<string, string> = {
  not_started: TO_DO_LABEL,
  blocked: TO_DO_LABEL,
  ready: TO_DO_LABEL,
  in_progress: 'In progress',
  under_review: IN_REVIEW_LABEL,
  completed: 'Done',
}

export const TASK_STATUS_VARIANTS: Record<string, BadgeVariant> = {
  not_started: 'neutral',
  blocked: 'neutral',
  ready: 'neutral',
  in_progress: 'info',
  under_review: 'info',
  completed: 'success',
}

/**
 * A task or Quick Task's badge: its status, or Changes requested while work sent back is under
 * way again.
 */
export function workStatusBadge(
  status: string,
  quick: boolean,
  changesRequested = false,
): { label: string; variant: BadgeVariant } {
  if (changesRequested && status === 'in_progress') {
    return { label: CHANGES_REQUESTED_LABEL, variant: 'attention' }
  }
  const labels = quick ? QUICK_TASK_STATUS_LABELS : TASK_STATUS_LABELS
  const variants = quick ? QUICK_TASK_STATUS_VARIANTS : TASK_STATUS_VARIANTS
  return { label: labels[status] ?? status, variant: variants[status] ?? 'neutral' }
}

/** Who holds a task, beside its status: the two are separate. */
export const UNCLAIMED_LABEL = 'Unclaimed'

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

/** Waiting on an answer is blue, an acceptance green, and every ending grey. */
export const INTEREST_STATUS_VARIANTS: Record<string, BadgeVariant> = {
  pending: 'info',
  invited: 'info',
  accepted: 'success',
}

export function interestStatusVariant(status: string): BadgeVariant {
  return INTEREST_STATUS_VARIANTS[status] ?? 'neutral'
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

/** Waiting on an admin is blue, approved (`accepted`, or a live `active` one) green. */
const SUGGESTION_STATUS_VARIANTS: Record<string, BadgeVariant> = {
  pending: 'info',
  on_hold: 'info',
  accepted: 'success',
  active: 'success',
}

export function suggestionStatusVariant(status: string): BadgeVariant {
  return SUGGESTION_STATUS_VARIANTS[status] ?? 'neutral'
}

/** For the volunteer who made it, a suggestion still waiting is an admin's move. */
export function suggestionOutline(status: string): boolean {
  return status === 'pending' || status === 'on_hold'
}
