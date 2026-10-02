import { Prisma } from '@/generated/prisma/client'
import { prisma } from './prisma'
import { calculateMatchScore, isGeoEligible } from './matching'
import { isSeekingOwner, UNAPPROVED_STATUSES } from './project-status'
import {
  InterestStatus,
  ProjectStatus,
  QuickTaskStatus,
  RemoteEligibility,
  TaskStatus,
  WorkItemType,
  TaskTiming,
} from '@/generated/prisma/enums'

// ── Comment access ────────────────────────────────────────────────────────────
// Reading a work item's comment thread is gated identically to viewing the work
// item itself. Posting is restricted to participants.

export type WorkItemForAccess = {
  type: string
  status: string
  creatorId: number | null
  assigneeId: number | null
  teamId?: number | null
  country: string | null
  remoteEligibility: string
}

export type CommentViewer = {
  id: number
  isAdmin: boolean
  isApproved: boolean
  country: string | null
} | null

/** Which of a project's scope restrictions the viewer is exempt from; see `resolveProjectPrivy`. */
export type ProjectPrivy = { team: boolean; country: boolean }

const PROJECT_HIDDEN_STATUSES: string[] = UNAPPROVED_STATUSES

// A volunteer the owner declined or removed, or who withdrew, is no longer a contributor
// on that project: they cannot self-claim its tasks and its tasks are hidden from their
// Quick Tasks browse list. An owner or admin can still assign them a task explicitly.
export const CLAIM_BLOCKING_INTEREST_STATUSES: InterestStatus[] = [
  InterestStatus.declined,
  InterestStatus.withdrawn,
  InterestStatus.removed,
]

/**
 * Can `viewer` see this work item (and therefore its comment thread)?
 * For TASK, pass the parent PROJECT — task visibility follows the project.
 *
 * `privy` — the project scope restrictions the viewer is exempt from, resolved by the caller
 * with `resolveProjectPrivy` (it needs the database). See "Project scope" below.
 */
export function canViewWorkItem(
  item: WorkItemForAccess,
  viewer: CommentViewer,
  parent?: WorkItemForAccess | null,
  privy?: ProjectPrivy,
): boolean {
  switch (item.type) {
    case WorkItemType.PROJECT: {
      const isDirectParticipant = Boolean(
        viewer && (viewer.isAdmin || viewer.id === item.creatorId || viewer.id === item.assigneeId),
      )
      if (item.teamId !== null && item.teamId !== undefined) {
        if (!isDirectParticipant && !privy?.team) return false
      }
      if (viewer && isOutsideCountry(item, viewer.country)) {
        if (!isDirectParticipant && !privy?.country) return false
      }
      if (!PROJECT_HIDDEN_STATUSES.includes(item.status)) return true
      return Boolean(viewer && (viewer.isAdmin || viewer.id === item.creatorId))
    }
    case WorkItemType.TASK:
      return parent ? canViewWorkItem(parent, viewer, undefined, privy) : Boolean(viewer?.isAdmin)
    case WorkItemType.QUICK_TASK:
      // Open, unclaimed tasks are browsable by any approved volunteer before they claim one —
      // but not by a pending applicant, same as the approvedProcedure gate on the pages that
      // read/claim tasks directly.
      if (item.status === QuickTaskStatus.open && item.assigneeId === null) {
        return Boolean(viewer && (viewer.isAdmin || viewer.isApproved))
      }
      return Boolean(
        viewer && (viewer.isAdmin || viewer.id === item.assigneeId || viewer.id === item.creatorId),
      )
    default:
      return Boolean(viewer?.isAdmin)
  }
}

/**
 * Resolves `isTeamPrivy` for `canViewWorkItem` — does `volunteerId` belong to the
 * project's team, or hold an accepted interest on it? No-ops (returns false) when the
 * project has no team, so callers can call this unconditionally.
 */
export async function resolveTeamPrivy(
  teamId: number | null | undefined,
  projectId: number,
  volunteerId: number,
): Promise<boolean> {
  if (teamId === null || teamId === undefined) return false
  const [membership, interest] = await Promise.all([
    prisma.teamMembership.findUnique({
      where: { teamId_volunteerId: { teamId, volunteerId } },
      select: { id: true },
    }),
    prisma.workItemInterest.findFirst({
      where: { workItemId: projectId, volunteerId, status: InterestStatus.accepted },
      select: { id: true },
    }),
  ])
  return Boolean(membership || interest)
}

// ── Project scope ─────────────────────────────────────────────────────────────
// A project reaches a volunteer only within its scope. A team-tagged project stays within
// its team; a country-scoped one (it names a country and is not open to remote volunteers
// everywhere) stays within that country. Its owner and proposer see it regardless, and so
// do admins. For a team project, its team's members and accepted helpers see it; for a
// country-scoped one, so does anyone already on it: the team's members, anyone who applied
// or was added, and anyone holding one of its tasks. A volunteer who has not given a
// country is not held to the country rule.
//
// The rule is written three ways, for the three shapes of query: `projectScopeSql` for raw
// SQL lists, `projectScopeWhere` for Prisma queries, and `resolveProjectPrivy` with
// `canViewWorkItem` (or `canSeeProjectScope`) for a single row.

export type ProjectViewer = { id: number; isAdmin: boolean | null; country: string | null }

type ScopedProject = {
  id: number
  teamId: number | null
  creatorId: number | null
  assigneeId: number | null
  country: string | null
  remoteEligibility: string
}

/** Is this project scoped to a country other than the viewer's? */
export function isOutsideCountry(
  project: { country: string | null; remoteEligibility: string },
  viewerCountry: string | null,
): boolean {
  return !isGeoEligible(viewerCountry, true, project.country, project.remoteEligibility)
}

/** Has the volunteer applied to, been added to, or been given a task on this project? */
async function isOnProject(projectId: number, volunteerId: number): Promise<boolean> {
  const [interest, task] = await Promise.all([
    prisma.workItemInterest.findFirst({
      where: { workItemId: projectId, volunteerId },
      select: { id: true },
    }),
    prisma.workItem.findFirst({
      where: { parentId: projectId, assigneeId: volunteerId },
      select: { id: true },
    }),
  ])
  return Boolean(interest || task)
}

/** Which of the project's scope restrictions `viewer` is exempt from, for `canViewWorkItem`. */
export async function resolveProjectPrivy(
  project: Omit<ScopedProject, 'creatorId' | 'assigneeId'>,
  viewer: { id: number; country: string | null },
): Promise<ProjectPrivy> {
  const team = await resolveTeamPrivy(project.teamId, project.id, viewer.id)
  const country =
    team || !isOutsideCountry(project, viewer.country) || (await isOnProject(project.id, viewer.id))
  return { team, country }
}

/** Is the project within `viewer`'s scope? Status (drafts and the like) is not checked. */
export async function canSeeProjectScope(
  project: ScopedProject,
  viewer: ProjectViewer,
): Promise<boolean> {
  if (viewer.isAdmin || viewer.id === project.creatorId || viewer.id === project.assigneeId) {
    return true
  }
  const privy = await resolveProjectPrivy(project, viewer)
  return (project.teamId === null || privy.team) && privy.country
}

/** The scope rule as a condition on `work_items` rows, for raw SQL project lists. */
export function projectScopeSql(viewer: ProjectViewer): Prisma.Sql {
  if (viewer.isAdmin) return Prisma.sql`TRUE`
  const id = viewer.id
  const involved = Prisma.sql`creator_id = ${id} OR assignee_id = ${id}
    OR team_id IN (SELECT team_id FROM team_memberships WHERE volunteer_id = ${id})`
  const team = Prisma.sql`(
    team_id IS NULL OR ${involved}
    OR id IN (
      SELECT work_item_id FROM work_item_interests
      WHERE volunteer_id = ${id} AND status = ${InterestStatus.accepted}::"InterestStatus"
    )
  )`
  if (!viewer.country) return team
  return Prisma.sql`${team} AND (
    country IS NULL
    OR remote_eligibility = ${RemoteEligibility.GLOBAL}::"RemoteEligibility"
    OR country = ${viewer.country}
    OR ${involved}
    OR id IN (SELECT work_item_id FROM work_item_interests WHERE volunteer_id = ${id})
    OR id IN (SELECT parent_id FROM work_items WHERE assignee_id = ${id} AND parent_id IS NOT NULL)
  )`
}

/** The scope rule as a Prisma filter on projects. */
export function projectScopeWhere(viewer: ProjectViewer): Prisma.WorkItemWhereInput {
  if (viewer.isAdmin) return {}
  const id = viewer.id
  const involved: Prisma.WorkItemWhereInput[] = [
    { creatorId: id },
    { assigneeId: id },
    { team: { members: { some: { volunteerId: id } } } },
  ]
  const team: Prisma.WorkItemWhereInput = {
    OR: [
      { teamId: null },
      ...involved,
      { interests: { some: { volunteerId: id, status: InterestStatus.accepted } } },
    ],
  }
  if (!viewer.country) return team
  return {
    AND: [
      team,
      {
        OR: [
          { country: null },
          { remoteEligibility: RemoteEligibility.GLOBAL },
          { country: viewer.country },
          ...involved,
          { interests: { some: { volunteerId: id } } },
          { children: { some: { assigneeId: id } } },
        ],
      },
    ],
  }
}

/**
 * Is `volunteerId` a member of this project — an accepted `WorkItemInterest`, or membership
 * of its team (if it has one)? Unlike `resolveTeamPrivy`, this checks the accepted interest
 * even when the project has no team — it answers "is this a member" for permission checks
 * like task creation/deletion, not "does team membership grant extra visibility".
 */
export async function resolveProjectMembership(
  teamId: number | null | undefined,
  projectId: number,
  volunteerId: number,
): Promise<boolean> {
  const [membership, interest] = await Promise.all([
    teamId === null || teamId === undefined
      ? null
      : prisma.teamMembership.findUnique({
          where: { teamId_volunteerId: { teamId, volunteerId } },
          select: { id: true },
        }),
    prisma.workItemInterest.findFirst({
      where: { workItemId: projectId, volunteerId, status: InterestStatus.accepted },
      select: { id: true },
    }),
  ])
  return Boolean(membership || interest)
}

/**
 * Can `viewer` post a comment? Participants only.
 * `isAcceptedHelper` = viewer has an accepted WorkItemInterest on the project
 * (for TASK, on the parent project). The caller resolves it.
 */
export function canPostComment(
  item: WorkItemForAccess,
  viewer: { id: number; isAdmin: boolean },
  opts: { parent?: WorkItemForAccess | null; isAcceptedHelper?: boolean } = {},
): boolean {
  if (viewer.isAdmin) return true
  switch (item.type) {
    case WorkItemType.PROJECT:
      return (
        viewer.id === item.creatorId ||
        viewer.id === item.assigneeId ||
        Boolean(opts.isAcceptedHelper)
      )
    case WorkItemType.TASK:
      return (
        viewer.id === item.assigneeId ||
        viewer.id === (opts.parent?.assigneeId ?? null) ||
        Boolean(opts.isAcceptedHelper)
      )
    case WorkItemType.QUICK_TASK:
      return viewer.id === item.assigneeId
    default:
      return false
  }
}

/**
 * May `viewer` manage this project — its backlog, its schedule, its dependency links?
 * The project owner, an admin, or the creator of a project still in `draft` (which has no
 * owner yet, so its creator runs it until publish).
 */
export function canManageProject(
  project: { creatorId: number | null; assigneeId: number | null; status: string },
  viewer: { id: number; isAdmin: boolean | null },
): boolean {
  if (viewer.isAdmin) return true
  if (project.assigneeId === viewer.id) return true
  return project.creatorId === viewer.id && project.status === ProjectStatus.draft
}

/**
 * May `viewer` manage this project's tasks: create, edit, assign, reorder, link, replan and
 * review them? Whoever manages the project, plus a deputy. Project-level checks (editing the
 * project, its people, status, key date, deadline and original plan) stay on
 * `canManageProject`.
 */
export function canManageProjectTasks(
  project: { creatorId: number | null; assigneeId: number | null; status: string },
  viewer: { id: number; isAdmin: boolean | null },
  isDeputy: boolean,
): boolean {
  return canManageProject(project, viewer) || isDeputy
}

/** Has the owner made `volunteerId` a deputy on this project, and are they still a helper? */
export async function isProjectDeputy(projectId: number, volunteerId: number): Promise<boolean> {
  const deputy = await prisma.projectDeputy.findFirst({
    where: {
      projectId,
      volunteerId,
      volunteer: {
        workItemInterests: { some: { workItemId: projectId, status: InterestStatus.accepted } },
      },
    },
    select: { id: true },
  })
  return deputy !== null
}

/**
 * May `viewer` add a task to this project? Anyone who can manage the project, plus any
 * member — team membership or an accepted `WorkItemInterest` (the same signal as
 * `resolveTeamPrivy`). Members were previously blocked from adding tasks at all; this was
 * loosened per a bug report that they need to. If member-created tasks turn out to cause
 * problems, this may need reverting to owner/admin-only (i.e. back to `canManageProject`).
 */
export function canCreateProjectTask(
  project: { creatorId: number | null; assigneeId: number | null; status: string },
  viewer: { id: number; isAdmin: boolean | null },
  isMember: boolean,
): boolean {
  return canManageProject(project, viewer) || isMember
}

/**
 * May `viewer` delete this task? Anyone who can manage the project, plus the volunteer who
 * created the task themselves — a member can clean up their own addition, but not anyone
 * else's. Like `canCreateProjectTask`, this may need reverting to owner/admin-only.
 */
export function canDeleteProjectTask(
  project: { creatorId: number | null; assigneeId: number | null; status: string },
  task: { creatorId: number | null },
  viewer: { id: number; isAdmin: boolean | null },
  isDeputy: boolean,
): boolean {
  return canManageProjectTasks(project, viewer, isDeputy) || task.creatorId === viewer.id
}

export type WorkItemSkillWithRelations = {
  skillId: number
  isRequired: boolean | null
  skill: {
    id: number
    categoryId: number
    name: string
    description: string | null
    sortOrder: number | null
    createdAt: Date | null
    category: { name: string }
  }
}

export type EnrichedProject = ScheduleFieldsLike & {
  id: number
  title: string
  description: string | null
  status: string
  assigneeId: number | null
  creatorId: number | null
  stakeholderId: number | null
  isOrgProposed: boolean | null
  templateOriginId: number | null
  projectType: string | null
  estimatedDuration: string | null
  timeCommitmentHoursPerWeek: number | null
  urgency: string | null
  reviewNotes: string | null
  reviewedById: number | null
  reviewedAt: Date | null
  collaborationLink: string | null
  autoAcceptTasks: boolean
  outcome: string | null
  outcomeNotes: string | null
  completedAt: Date | null
  deadline: Date | null
  createdAt: Date | null
  updatedAt: Date | null
  country: string | null
  isSeekingHelp: boolean | null
  localGroup: string | null
  remoteEligibility: RemoteEligibility
  teamId: number | null
  skills: WorkItemSkillWithRelations[]
  assignee: { id: number; name: string } | null
  creator: { id: number; name: string } | null
  team: { id: number; name: string } | null
  _count: { interests: number; children: number }
}

// The serialized view keeps the public field names `owner`/`proposedBy`
// (mapped from the WorkItem `assignee`/`creator` columns) so the ProjectCard
// contract and all consuming pages stay stable.

export function withProjectExtras(
  p: EnrichedProject,
  volunteerSkillIds?: Set<number>,
  viewerTeamIds?: Set<number>,
) {
  const matchInput = p.skills.map((ps) => ({ id: ps.skillId, isRequired: ps.isRequired }))
  const match =
    volunteerSkillIds !== undefined ? calculateMatchScore(volunteerSkillIds, matchInput) : undefined

  return {
    id: p.id,
    title: p.title,
    description: p.description,
    status: p.status,
    ownerId: p.assigneeId,
    proposedById: p.creatorId,
    stakeholderId: p.stakeholderId,
    isOrgProposed: p.isOrgProposed,
    templateOriginId: p.templateOriginId,
    projectType: p.projectType,
    estimatedDuration: p.estimatedDuration,
    timeCommitmentHoursPerWeek: p.timeCommitmentHoursPerWeek,
    urgency: p.urgency,
    reviewNotes: p.reviewNotes,
    reviewedById: p.reviewedById,
    reviewedAt: p.reviewedAt,
    collaborationLink: p.collaborationLink,
    outcome: p.outcome,
    outcomeNotes: p.outcomeNotes,
    completedAt: p.completedAt,
    deadline: p.deadline,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    country: p.country,
    isSeekingHelp: p.isSeekingHelp,
    autoAcceptTasks: p.autoAcceptTasks,
    // Derived, not stored — see isSeekingOwner() in lib/project-status.ts.
    isSeekingOwner: isSeekingOwner(p),
    // An owned project with an empty backlog. Surfaced as a badge rather than a status:
    // as a status it flipped back and forth every time a task was completed, so nothing
    // kept it up to date.
    needsTasks: p.status === ProjectStatus.in_progress && p._count.children === 0,
    openTaskCount: p._count.children,
    localGroup: p.localGroup,
    remoteEligibility: p.remoteEligibility,
    teamId: p.teamId,
    team: p.team,
    isMyTeam: p.teamId !== null && Boolean(viewerTeamIds?.has(p.teamId)),
    skills: p.skills.map((ps) => ({
      id: ps.skill.id,
      categoryId: ps.skill.categoryId,
      name: ps.skill.name,
      description: ps.skill.description,
      sortOrder: ps.skill.sortOrder,
      createdAt: ps.skill.createdAt,
      categoryName: ps.skill.category.name,
      isRequired: ps.isRequired,
    })),
    owner: p.assignee,
    proposedBy: p.creator,
    pendingInterestCount: p._count.interests,
    ...serializeScheduleFields(p),
    ...(match !== undefined ? { match } : {}),
  }
}

export const projectInclude = {
  skills: {
    include: { skill: { include: { category: true } } },
    orderBy: [
      { isRequired: Prisma.SortOrder.desc },
      { skill: { category: { sortOrder: Prisma.SortOrder.asc } } },
      { skill: { sortOrder: Prisma.SortOrder.asc } },
    ],
  },
  assignee: { select: { id: true, name: true } },
  creator: { select: { id: true, name: true } },
  team: { select: { id: true, name: true } },
  _count: {
    select: {
      interests: { where: { status: InterestStatus.pending } },
      // Open (non-completed) child tasks — feeds the derived `needsTasks` badge.
      children: { where: { type: WorkItemType.TASK, status: { not: TaskStatus.completed } } },
    },
  },
} satisfies Prisma.WorkItemInclude

// ── Task / starter-task serialization ───────────────────────────────────────────
// The core fields shared by every route that returns a project TASK or a
// QUICK_TASK ("starter task") in detail. Callers spread this and add whatever
// denormalized display fields their own `include` fetched (assignedToName,
// projectTitle, etc.) plus any route-specific extras.

/** The scheduling, baseline and actual-start columns shared by PROJECT and TASK. */
export type ScheduleFieldsLike = {
  startDate: Date | null
  durationDays: number | null
  baselineStartDate: Date | null
  baselineDurationDays: number | null
  baselineSetAt: Date | null
  scheduleUpdatedAt: Date | null
  startedAt: Date | null
  isAnchor?: boolean
  timing?: TaskTiming
}

export function serializeScheduleFields(t: ScheduleFieldsLike) {
  return {
    startDate: t.startDate,
    durationDays: t.durationDays,
    baselineStartDate: t.baselineStartDate,
    baselineDurationDays: t.baselineDurationDays,
    baselineSetAt: t.baselineSetAt,
    scheduleUpdatedAt: t.scheduleUpdatedAt,
    startedAt: t.startedAt,
    isAnchor: t.isAnchor ?? false,
    timing: t.timing ?? TaskTiming.flexible,
  }
}

export type TaskLike = ScheduleFieldsLike & {
  id: number
  parentId: number | null
  title: string
  description: string | null
  assigneeId: number | null
  creatorId: number | null
  requestedById: number | null
  status: string
  estimatedHours: number | null
  deadline: Date | null
  completedAt: Date | null
  createdAt: Date | null
  updatedAt: Date | null
} & SubmissionLike

type SubmissionLike = {
  submissionNote: string | null
  submissionUrl: string | null
  submittedAt: Date | null
}

/** What the assignee handed in, or null before they first submit. */
export function serializeSubmission(t: SubmissionLike) {
  if (t.submittedAt === null) return null
  return { note: t.submissionNote, url: t.submissionUrl, submittedAt: t.submittedAt }
}

/** Writes that forget a submission, for a task going back to nobody's. */
export const CLEARED_SUBMISSION = {
  submissionNote: null,
  submissionUrl: null,
  submittedAt: null,
  changesRequestedNote: null,
} as const

/**
 * The columns a submission writes, or null when it holds neither a note nor a link. Blank
 * strings count as absent.
 */
export function submissionData(input: { note?: string | null; url?: string | null }) {
  const note = input.note?.trim() || null
  const url = input.url?.trim() || null
  if (note === null && url === null) return null
  return {
    submissionNote: note,
    submissionUrl: url,
    submittedAt: new Date(),
    changesRequestedNote: null,
  }
}

export function serializeTask(t: TaskLike) {
  return {
    id: t.id,
    projectId: t.parentId,
    title: t.title,
    description: t.description,
    assignedToId: t.assigneeId,
    createdById: t.creatorId,
    requestedById: t.requestedById,
    status: t.status,
    estimatedHours: t.estimatedHours,
    deadline: t.deadline,
    completedAt: t.completedAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    submission: serializeSubmission(t),
    ...serializeScheduleFields(t),
  }
}

/**
 * Builds the Prisma `data` for a schedule change, and reports whether the write actually
 * touches the schedule.
 *
 * `scheduleUpdatedAt` is stamped whenever startDate or durationDays moves, so every caller
 * (task edit, project edit, drag-to-reschedule) records it identically.
 *
 * The baseline is deliberately NOT touched here. Typing a first date is planning, not
 * committing to a plan: an owner needs to sketch dates and shuffle them before anything is
 * worth measuring against. Only `projects.setBaseline` writes the baseline track, so a
 * variance always refers to a commitment someone actually made.
 */
export function applyScheduleWrite(
  data: Record<string, unknown>,
  input: { startDate?: Date | null; durationDays?: number | null },
  now: Date = new Date(),
): boolean {
  const touchesStart = input.startDate !== undefined
  const touchesDuration = input.durationDays !== undefined
  if (!touchesStart && !touchesDuration) return false

  if (touchesStart) data.startDate = input.startDate
  if (touchesDuration) data.durationDays = input.durationDays
  data.scheduleUpdatedAt = now

  return true
}

export type StarterTaskLike = {
  id: number
  contextProjectId: number | null
  title: string
  description: string | null
  skillId: number | null
  assigneeId: number | null
  creatorId: number | null
  status: string
  reviewRating: string | null
  reviewNotes: string | null
  reviewedById: number | null
  reviewedAt: Date | null
  estimatedHours: number | null
  deadline: Date | null
  createdAt: Date | null
  updatedAt: Date | null
  changesRequestedNote: string | null
} & SubmissionLike

export function serializeStarterTask(t: StarterTaskLike) {
  return {
    id: t.id,
    projectId: t.contextProjectId,
    title: t.title,
    description: t.description,
    skillId: t.skillId,
    assignedToId: t.assigneeId,
    assignedById: t.creatorId,
    status: t.status,
    reviewRating: t.reviewRating,
    reviewNotes: t.reviewNotes,
    reviewedById: t.reviewedById,
    reviewedAt: t.reviewedAt,
    estimatedHours: t.estimatedHours,
    deadline: t.deadline,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    submission: serializeSubmission(t),
    changesRequested: t.changesRequestedNote,
  }
}
