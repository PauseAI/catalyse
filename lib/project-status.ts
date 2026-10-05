import type { BadgeVariant } from '@/components/Badge'
import { ProjectStatus } from '@/generated/prisma/enums'

/**
 * The single source of truth for project lifecycle status — labels, badge colours, and
 * which statuses each role may pick. Server routers, UI and e2e helpers all read from
 * here; previously each kept its own copy and they drifted (notification emails were
 * sending raw enum strings for statuses the server's copy had never heard of).
 *
 *   draft → pending_review → needs_discussion → ready → in_progress → on_hold → completed → archived
 *
 * `ready` means approved and live, but unowned. Assigning an owner is what moves a
 * project to `in_progress`. `draft` is a creator still preparing a project before it
 * enters review (volunteer proposals) or goes live (org projects, which skip review).
 */
export const PROJECT_STATUS_CONFIG: Record<string, { label: string; variant: BadgeVariant }> = {
  draft: { label: 'Draft', variant: 'neutral' },
  pending_review: { label: 'Pending Review', variant: 'warning' },
  needs_discussion: { label: 'Needs Changes', variant: 'neutral' },
  ready: { label: 'Ready', variant: 'caution' },
  in_progress: { label: 'In Progress', variant: 'info' },
  on_hold: { label: 'On Hold', variant: 'neutral' },
  completed: { label: 'Completed', variant: 'success' },
  archived: { label: 'Archived', variant: 'neutral' },
}

export const PROJECT_STATUS_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(PROJECT_STATUS_CONFIG).map(([k, v]) => [k, v.label]),
)

export function projectStatusLabel(status: string): string {
  return PROJECT_STATUS_LABELS[status] ?? status.replace(/_/g, ' ')
}

/**
 * Statuses a project owner may set directly. Admins may set any status. Ready (approved, not
 * started) is an admin's: a project leaves it by itself when it gains an owner.
 */
export const OWNER_ALLOWED_STATUSES: ProjectStatus[] = [
  ProjectStatus.in_progress,
  ProjectStatus.on_hold,
  ProjectStatus.completed,
]

/** Additional statuses only an admin may set. */
export const ADMIN_ONLY_STATUSES: ProjectStatus[] = [
  ProjectStatus.archived,
  ProjectStatus.draft,
  ProjectStatus.pending_review,
  ProjectStatus.needs_discussion,
]

/** Pre-approval: hidden from browse, never advertised to volunteers. */
export const UNAPPROVED_STATUSES: string[] = [
  ProjectStatus.draft,
  ProjectStatus.pending_review,
  ProjectStatus.needs_discussion,
]

/** Finished: no longer taking volunteers, however its flags happen to be set. */
export const TERMINAL_STATUSES: string[] = [ProjectStatus.completed, ProjectStatus.archived]

/**
 * Statuses at which an ownerless project is genuinely looking for an owner: approved
 * ("ready or beyond") but not yet finished. `in_progress`/`on_hold` are included so a
 * project whose owner steps down is re-advertised rather than stranded.
 */
export const SEEKING_OWNER_STATUSES: string[] = [
  ProjectStatus.ready,
  ProjectStatus.in_progress,
  ProjectStatus.on_hold,
]

/**
 * Derived, never stored. There is no `is_seeking_owner` column: a project wants an owner
 * precisely when it hasn't got one and is live. Storing it as a flag meant every mutation
 * that touched ownership had to remember to update it, and several didn't.
 */
export function isSeekingOwner(p: { status: string; assigneeId: number | null }): boolean {
  return p.assigneeId === null && SEEKING_OWNER_STATUSES.includes(p.status)
}

const quoted = (values: string[]) => values.map((v) => `'${v}'`).join(', ')

/** `isSeekingOwner` as a raw SQL predicate, for the hand-written projects.list query. */
export const SEEKING_OWNER_SQL = `(assignee_id IS NULL AND status IN (${quoted(SEEKING_OWNER_STATUSES)}))`

/** Advertisable = approved and not finished. Guards recommendations and admin counts. */
export const ADVERTISABLE_STATUSES_SQL = `status NOT IN (${quoted([...UNAPPROVED_STATUSES, ...TERMINAL_STATUSES])})`

export const ADVERTISABLE_STATUSES: string[] = Object.keys(PROJECT_STATUS_CONFIG).filter(
  (s) => !UNAPPROVED_STATUSES.includes(s) && !TERMINAL_STATUSES.includes(s),
)

/**
 * How an org-proposed project is attributed. `is_org_proposed` projects are created by an
 * admin acting for the organisation, not for themselves, so surfacing the admin's personal
 * name as the proposer misattributes the project to an individual.
 */
export const ORG_PROPOSER_NAME = 'PauseAI'

/**
 * A non-admin volunteer may have at most this many of their own proposals sitting in `draft`
 * at once. Admins are exempt (see the isAdmin check in server/routers/projects.ts:create) —
 * this bounds unreviewed volunteer proposals, not admin work.
 */
export const MAX_VOLUNTEER_DRAFTS = 2

export type ProposerDisplay = { name: string; volunteerId: number | null }

/**
 * Who to name as the proposer of a project, and whether that name links to a profile.
 * `volunteerId` is null for the org — there is no profile page to link to.
 * Returns null when there is nobody to attribute it to at all.
 */
export function proposerDisplay(p: {
  isOrgProposed?: boolean | null
  proposedById?: number | null
  proposedBy?: { name: string } | string | null
}): ProposerDisplay | null {
  if (p.isOrgProposed) return { name: ORG_PROPOSER_NAME, volunteerId: null }
  if (!p.proposedBy) return null
  const name = typeof p.proposedBy === 'string' ? p.proposedBy : p.proposedBy.name
  return { name, volunteerId: p.proposedById ?? null }
}
