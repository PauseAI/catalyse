/**
 * The words on the buttons that decide who does a task. Every component that offers one of
 * these actions takes its label from here, so the same action reads the same everywhere.
 */

/** Takes the task, or accepts an invite and takes it. Quick Tasks use it too. */
export const CLAIM_TASK = 'Claim task'

/** Holds the task for someone not yet on the project and asks the owner to let them in. */
export const ASK_TO_TAKE = 'Ask to take this'

/** Shown while a claim or request is on its way. */
export const CLAIMING = 'Claiming…'

/** Opens the volunteer picker, for someone who hands tasks out. */
export const ASSIGN = 'Assign…'

/** Hands the task to the volunteer already picked. */
export const ASSIGN_PICKED = 'Assign'

/** The assignee giving the task back. */
export const RELEASE = 'Release'

/** Whoever hands tasks out taking it off the assignee. */
export const UNASSIGN = 'Unassign'

/**
 * Where the viewer stands on a task's project, which is all that decides whether claiming
 * takes the task or asks first. `onProject` covers the owner, an admin, a deputy, an accepted
 * helper and a member of the project's team.
 */
export type ClaimViewer = { onProject: boolean; invited: boolean }

/** Claiming takes the task for someone on the project or invited to it; anyone else asks. */
export function claimLabel(viewer: ClaimViewer): string {
  return viewer.onProject || viewer.invited ? CLAIM_TASK : ASK_TO_TAKE
}
