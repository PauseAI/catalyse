/**
 * Filled or outline: a badge is filled when it is the viewer's move and outlined while they
 * wait on someone else. Statuses nobody waits on (To do, In progress, Done) are always filled.
 */

/** Where the viewer stands on a task or Quick Task. */
export type WorkViewer = {
  isAssignee: boolean
  /** May accept the work or send it back, and replan it: owner, deputy or admin. */
  canReview: boolean
}

/**
 * In review waits on whoever can accept it; Changes requested waits on the assignee.
 * `status` is a task's shown status or a Quick Task's stored one.
 */
export function statusOutline(status: string, changesRequested: boolean, v: WorkViewer): boolean {
  if (status === 'under_review') return !v.canReview
  if (changesRequested && status === 'in_progress') return !v.isAssignee
  return false
}

/** Due soon and Late are the move of the assignee and of whoever can replan. */
export function latenessOutline(v: WorkViewer): boolean {
  return !v.isAssignee && !v.canReview
}

/**
 * A request to join or lead waits on whoever can answer it, an invite on the invitee.
 * `answers` is whether the viewer is that person.
 */
export function interestOutline(status: string, answers: boolean): boolean {
  return (status === 'pending' || status === 'invited') && !answers
}
