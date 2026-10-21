import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import {
  withProjectExtras,
  projectInclude,
  EnrichedProject,
  canViewWorkItem,
  canSeeProjectScope,
  projectScopeSql,
  projectScopeWhere,
  resolveProjectPrivy,
  CLAIM_BLOCKING_INTEREST_STATUSES,
  serializeTask,
  applyScheduleWrite,
  baselineLength,
  canManageProject,
  canManageProjectTasks,
  isProjectDeputy,
  submissionData,
  canCreateProjectTask,
  canDeleteProjectTask,
  resolveProjectMembership,
  resolveClaimViewer,
  RELEASED_TASK,
  CLEARED_SUBMISSION,
  startWorkData,
} from '@/lib/work-item'
import {
  assertProjectEditable,
  assertTaskEditable,
  isProjectLocked,
  projectEditable,
} from '@/lib/work-item-lock'
import { recordChange, recordEvent, updateWorkItem, workItemChanges } from '@/lib/work-item-events'
import { taskDisplayStatus, taskStatusViews } from '@/lib/task-status'
import {
  HELPER_COUNT,
  TASK_HELPER,
  endHelpingOnProject,
  loadTaskHelpers,
  stopHelpingAsLead,
  taskHelperIds,
} from '@/lib/task-helpers'
import { taskCounts } from '@/lib/task-list-order'
import { loadWorkItemSummaries, toWorkItemSummary } from '@/lib/work-item-summary'
import {
  createNotification,
  notifyUser,
  notifyChapterStaff,
  notifyTeamOfProject,
  clearNotifications,
} from '@/lib/notify'
import { keyDateSides } from '@/lib/key-date'
import { daysPastPlan, previewReplan, replanWrite } from '@/lib/replan'
import {
  lateProjects,
  loadProjectTaskSchedule,
  toTaskScheduleInput,
  loadProjectEdges,
  scheduleProjectsByIds,
} from '@/lib/project-schedule'
import { startOfUtcDay } from '@/lib/schedule'
import { taskIsDated } from '@/lib/task-dates'
import { notifyMatchingVolunteers } from '@/lib/project-match-notify'
import { html } from '@/lib/email'
import { logger } from '@/lib/logger'
import { formatDateShort } from '@/lib/format-date'
import { awaitsOwnerReview } from '@/lib/task-review'
import { handedIn } from '@/lib/overdue'
import { canReach } from '@/lib/contact'
import { assertTeamInChapter, projectLocation } from '@/lib/project-location'
import { chapterNarrowing, chapterNarrowingSql } from '@/lib/chapter-access-server'
import { audit } from '@/lib/chapter-roles'
import { isStaff, type ChapterAccess } from '@/lib/chapter-access'
import {
  CreateProjectSchema,
  UpdateProjectSchema,
  ProjectInterestBodySchema,
  CreateProjectTaskSchema,
  UpdateProjectTaskSchema,
  SubmitWorkSchema,
  RequestChangesSchema,
} from '@/lib/schemas'
import {
  authedProcedure,
  approvedProcedure,
  confirmedProcedure,
  staffProcedure,
  asProjectAdmin,
} from '../procedures'
import {
  OWNER_ALLOWED_STATUSES,
  SEEKING_OWNER_SQL,
  TERMINAL_STATUSES,
  UNAPPROVED_STATUSES,
  MAX_VOLUNTEER_DRAFTS,
  projectStatusLabel,
} from '@/lib/project-status'
import {
  ApprovalStatus,
  InterestOrigin,
  InterestStatus,
  ProjectStatus,
  TaskStatus,
  WorkItemType,
  TaskTiming,
  ChapterAuditAction,
} from '@/generated/prisma/enums'

/** Is the project within this volunteer's scope (team and chapter)? See lib/work-item.ts. */
async function canReachProject(
  project: {
    id: number
    teamId: number | null
    creatorId: number | null
    assigneeId: number | null
    nationalChapterId: number | null
  },
  volunteer: { id: number; isAdmin: boolean | null; nationalChapterId: number | null },
): Promise<boolean> {
  return canSeeProjectScope(project, volunteer)
}

/** Throws unless `person` belongs to the project's chapter; a global admin brings in anyone. */
function assertInProjectChapter(
  access: ChapterAccess,
  person: { nationalChapterId: number | null },
  project: { nationalChapterId: number | null },
): void {
  if (!access.globalAdmin && person.nationalChapterId !== project.nationalChapterId) {
    throw new ORPCError('BAD_REQUEST', { message: 'They are in another national chapter' })
  }
}

/**
 * Throws FORBIDDEN unless `volunteer` may manage this project (owner, admin, or the creator
 * of a still-draft project). See canManageProject in lib/work-item.ts for the rule.
 */
function assertCanManageProject(
  project: { creatorId: number | null; assigneeId: number | null; status: string },
  volunteer: { id: number; isAdmin: boolean | null },
  message: string,
): void {
  if (!canManageProject(project, volunteer)) {
    throw new ORPCError('FORBIDDEN', { message })
  }
}

/** Has this volunteer been declined from, or withdrawn from, this project? */
async function isBlockedFromClaiming(projectId: number, volunteerId: number): Promise<boolean> {
  const blocking = await prisma.workItemInterest.findFirst({
    where: {
      workItemId: projectId,
      volunteerId,
      status: { in: CLAIM_BLOCKING_INTEREST_STATUSES },
    },
    select: { id: true },
  })
  return Boolean(blocking)
}

/**
 * Leaving a project — by withdrawing, or by the owner declining you — also gives up the
 * tasks you hold on it. Completed tasks keep their assignee: they are a record of work
 * done, not an outstanding commitment.
 */
async function releaseTasksHeldBy(
  projectId: number,
  volunteerId: number,
  actorId: number,
): Promise<void> {
  const held = await prisma.workItem.findMany({
    where: {
      parentId: projectId,
      type: WorkItemType.TASK,
      OR: [
        { requestedById: volunteerId },
        { assigneeId: volunteerId, status: { not: TaskStatus.completed } },
      ],
    },
  })
  const now = new Date()
  await prisma.$transaction(async (tx) => {
    for (const task of held) {
      const data =
        task.assigneeId === volunteerId
          ? { ...RELEASED_TASK, updatedAt: now }
          : { requestedById: null }
      await tx.workItem.update({ where: { id: task.id }, data })
      await recordChange(tx, { row: task, data, actorId, kind: 'released' })
    }
  })
}

/** Tells a project's owner that someone wants to help or lead it. */
async function notifyOwnerOfInterest(
  project: { id: number; title: string; assigneeId: number | null },
  volunteer: { name: string },
  interestType: string,
  message: string | null,
  interestId: number,
): Promise<void> {
  if (!project.assigneeId) return
  const role = interestType === 'want_to_own' ? 'lead' : 'help out on'
  await notifyUser(
    project.assigneeId,
    'new_interest',
    `Someone's interested in '${project.title}'!`,
    `${volunteer.name} asked to ${role} the project`,
    `/projects/${project.id}`,
    {
      subject: `${volunteer.name} wants to ${role} '${project.title}'`,
      message: html`<strong>${volunteer.name}</strong> has expressed interest in your project
        <strong>${project.title}</strong>.`,
      projectTitle: project.title,
      projectId: project.id,
      extraHtml: message
        ? html`<div style="padding: 12px; background: #f7fafc; border-radius: 8px; margin: 16px 0;">
            <strong>Their message:</strong> ${message}
          </div>`
        : undefined,
    },
    interestId,
  )
}

/**
 * Hands someone the tasks held for them while their request to join waited, now that they
 * are on the project.
 */
async function assignHeldTasks(
  projectId: number,
  volunteerId: number,
  actorId: number,
): Promise<void> {
  const held = await prisma.workItem.findMany({
    where: {
      parentId: projectId,
      type: WorkItemType.TASK,
      requestedById: volunteerId,
      status: TaskStatus.not_started,
      assigneeId: null,
    },
  })
  const now = new Date()
  const data = {
    assigneeId: volunteerId,
    requestedById: null,
    claimedAt: now,
    updatedAt: now,
    nudgeSentAt: null,
    finalWarningSentAt: null,
  }
  await prisma.$transaction(async (tx) => {
    for (const task of held) {
      const taken = await tx.workItem.updateMany({
        where: { id: task.id, requestedById: volunteerId, assigneeId: null },
        data,
      })
      if (taken.count > 0) await recordChange(tx, { row: task, data, actorId, kind: 'assigned' })
    }
  })
}

async function findProjectTask(projectId: number, taskId: number) {
  const [project, task] = await Promise.all([
    prisma.workItem.findFirst({ where: { id: projectId, type: WorkItemType.PROJECT } }),
    prisma.workItem.findFirst({
      where: { id: taskId, parentId: projectId, type: WorkItemType.TASK },
    }),
  ])
  if (!project || !task) throw new ORPCError('NOT_FOUND', { message: 'Project or task not found' })
  return { project, task }
}

// ── Task helpers ──────────────────────────────────────────────────────────────
// expressInterest, withdrawInterest and respondToInterest given a `taskId` act on the task's
// helpers (lib/task-helpers.ts) through these, and none of the project-only steps (held tasks,
// deputies, ownership) run.

/** Can't join, leave or change the helpers of a task that is handed in or done. */
function assertTaskTakesHelpers(task: { status: string }): void {
  assertTaskEditable(task)
  if (task.status === TaskStatus.under_review) {
    throw new ORPCError('BAD_REQUEST', { message: 'This task has been handed in' })
  }
}

/** Tells the task's lead, or the project's owner when it has none, about its helpers. */
async function tellLeadAboutHelpers(
  project: { id: number; assigneeId: number | null },
  task: { id: number; title: string; assigneeId: number | null },
  actorId: number,
  title: string,
): Promise<void> {
  const to = task.assigneeId ?? project.assigneeId
  if (to === null || to === actorId) return
  await notifyUser(
    to,
    'task_helpers_changed',
    title,
    null,
    `/projects/${project.id}/tasks/${task.id}`,
    undefined,
    task.id,
  )
}

/** Tells a task's helpers, less `actorId`, what happened to it. */
async function tellHelpers(
  task: { id: number; parentId: number | null },
  actorId: number,
  type: string,
  title: string,
  body: string | null,
): Promise<void> {
  for (const id of await taskHelperIds(task.id, actorId)) {
    await notifyUser(
      id,
      type,
      title,
      body,
      `/projects/${task.parentId}/tasks/${task.id}`,
      undefined,
      task.id,
    )
  }
}

/** A member of the project joins a task that seeks helpers, until it has as many as it wants. */
async function joinTaskAsHelper(
  projectId: number,
  taskId: number,
  volunteer: { id: number; name: string; isAdmin: boolean | null },
  message: string | null,
): Promise<{ message: string }> {
  const { project, task } = await findProjectTask(projectId, taskId)
  assertTaskTakesHelpers(task)
  if (task.helpersWanted === null) {
    throw new ORPCError('BAD_REQUEST', { message: 'This task is not looking for helpers' })
  }
  if (task.assigneeId === volunteer.id) {
    throw new ORPCError('BAD_REQUEST', { message: 'You already lead this task' })
  }
  if (!(await resolveClaimViewer(project, volunteer)).onProject) {
    throw new ORPCError('FORBIDDEN', { message: 'Join the project to help on its tasks' })
  }
  const wanted = task.helpersWanted

  await prisma.$transaction(async (tx) => {
    // Holds the task row so two people taking the last place cannot both get it.
    await tx.$queryRaw`SELECT id FROM work_items WHERE id = ${taskId} FOR UPDATE`
    const existing = await tx.workItemInterest.findFirst({
      where: { workItemId: taskId, volunteerId: volunteer.id },
    })
    if (existing?.status === InterestStatus.accepted) {
      throw new ORPCError('BAD_REQUEST', { message: 'You are already helping on this task' })
    }
    // As on a project, leaving keeps the way back open; being taken off does not.
    if (existing?.status === InterestStatus.removed) {
      throw new ORPCError('FORBIDDEN', { message: 'You were taken off this task' })
    }
    const helping = await tx.workItemInterest.count({
      where: { workItemId: taskId, status: InterestStatus.accepted },
    })
    if (helping >= wanted) {
      throw new ORPCError('BAD_REQUEST', { message: 'This task has all the helpers it wants' })
    }
    const data = {
      interestType: TASK_HELPER,
      message,
      status: InterestStatus.accepted,
      origin: InterestOrigin.applied,
      respondedAt: new Date(),
      responseMessage: null,
      invitedById: null,
    }
    if (existing) {
      await tx.workItemInterest.update({ where: { id: existing.id }, data })
    } else {
      await tx.workItemInterest.create({
        data: { ...data, volunteerId: volunteer.id, workItemId: taskId },
      })
    }
    await recordEvent(tx, {
      workItemId: taskId,
      actorId: volunteer.id,
      kind: 'helper_joined',
      before: {},
      after: { helperId: volunteer.id },
    })
  })

  await tellLeadAboutHelpers(
    project,
    task,
    volunteer.id,
    `${volunteer.name} joined '${task.title}' as a helper`,
  )
  return { message: "You're helping on this task" }
}

/** A helper leaves a task. */
async function leaveTaskAsHelper(
  projectId: number,
  taskId: number,
  volunteer: { id: number; name: string },
): Promise<{ message: string }> {
  const { project, task } = await findProjectTask(projectId, taskId)
  assertTaskTakesHelpers(task)
  await prisma.$transaction(async (tx) => {
    const left = await tx.workItemInterest.updateMany({
      where: { workItemId: taskId, volunteerId: volunteer.id, status: InterestStatus.accepted },
      data: { status: InterestStatus.withdrawn, respondedAt: new Date() },
    })
    if (left.count === 0) {
      throw new ORPCError('NOT_FOUND', { message: 'You are not helping on this task' })
    }
    await recordEvent(tx, {
      workItemId: taskId,
      actorId: volunteer.id,
      kind: 'helper_left',
      before: { helperId: volunteer.id },
      after: {},
    })
  })
  await tellLeadAboutHelpers(
    project,
    task,
    volunteer.id,
    `${volunteer.name} stopped helping on '${task.title}'`,
  )
  return { message: 'You are no longer helping on this task' }
}

/** The task's lead, or whoever manages the project's tasks, takes a helper off it. */
async function removeTaskHelper(
  projectId: number,
  taskId: number,
  interestId: number,
  volunteer: { id: number; name: string; isAdmin: boolean | null },
  responseMessage: string | null,
): Promise<{ message: string }> {
  const { project, task } = await findProjectTask(projectId, taskId)
  const manages = canManageProjectTasks(
    project,
    volunteer,
    await isProjectDeputy(project.id, volunteer.id),
  )
  if (task.assigneeId !== volunteer.id && !manages) {
    throw new ORPCError('FORBIDDEN', {
      message: 'Only the task lead or the project owner can remove a helper',
    })
  }
  assertTaskTakesHelpers(task)
  const helper = await prisma.workItemInterest.findFirst({
    where: { id: interestId, workItemId: taskId, status: InterestStatus.accepted },
  })
  if (!helper) throw new ORPCError('NOT_FOUND', { message: 'Helper not found' })

  await prisma.$transaction(async (tx) => {
    await tx.workItemInterest.update({
      where: { id: helper.id },
      data: { status: InterestStatus.removed, responseMessage, respondedAt: new Date() },
    })
    await recordEvent(tx, {
      workItemId: taskId,
      actorId: volunteer.id,
      kind: 'helper_removed',
      before: {},
      after: { helperId: helper.volunteerId },
    })
  })
  await notifyUser(
    helper.volunteerId,
    'helper_removed',
    `Removed: you're no longer helping on '${task.title}'`,
    responseMessage,
    `/projects/${projectId}/tasks/${taskId}`,
    undefined,
    taskId,
  )
  return { message: 'Helper removed' }
}

/** The project owner, a deputy, or an admin puts a member on a task as a helper directly. */
async function addTaskHelper(
  projectId: number,
  taskId: number,
  volunteerId: number,
  actor: { id: number; name: string; isAdmin: boolean | null },
): Promise<{ message: string }> {
  const { project, task } = await findProjectTask(projectId, taskId)
  const manages = canManageProjectTasks(project, actor, await isProjectDeputy(project.id, actor.id))
  if (!manages) {
    throw new ORPCError('FORBIDDEN', {
      message: 'Only the project owner or a deputy can add a helper',
    })
  }
  assertTaskTakesHelpers(task)
  if (task.helpersWanted === null) {
    throw new ORPCError('BAD_REQUEST', { message: 'This task is not looking for helpers' })
  }
  if (volunteerId === task.assigneeId) {
    throw new ORPCError('BAD_REQUEST', { message: 'They already lead this task' })
  }
  if (!(await resolveProjectMembership(project.teamId, project.id, volunteerId))) {
    throw new ORPCError('BAD_REQUEST', { message: 'They need to join the project first' })
  }
  const target = await prisma.volunteer.findFirst({
    where: { id: volunteerId, deletedAt: null },
    select: { name: true },
  })
  if (!target) throw new ORPCError('BAD_REQUEST', { message: 'Volunteer not found' })
  const wanted = task.helpersWanted

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM work_items WHERE id = ${taskId} FOR UPDATE`
    const existing = await tx.workItemInterest.findFirst({
      where: { workItemId: taskId, volunteerId },
    })
    if (existing?.status === InterestStatus.accepted) {
      throw new ORPCError('BAD_REQUEST', { message: 'They are already helping on this task' })
    }
    const helping = await tx.workItemInterest.count({
      where: { workItemId: taskId, status: InterestStatus.accepted },
    })
    if (helping >= wanted) {
      throw new ORPCError('BAD_REQUEST', { message: 'This task has all the helpers it wants' })
    }
    const data = {
      interestType: TASK_HELPER,
      message: null,
      status: InterestStatus.accepted,
      origin: InterestOrigin.added,
      respondedAt: new Date(),
      responseMessage: null,
      invitedById: actor.id,
    }
    if (existing) {
      await tx.workItemInterest.update({ where: { id: existing.id }, data })
    } else {
      await tx.workItemInterest.create({ data: { ...data, volunteerId, workItemId: taskId } })
    }
    await recordEvent(tx, {
      workItemId: taskId,
      actorId: actor.id,
      kind: 'helper_added',
      before: {},
      after: { helperId: volunteerId },
    })
  })

  await notifyUser(
    volunteerId,
    'helper_added',
    `Added: you're helping on '${task.title}'`,
    `${actor.name} added you as a helper`,
    `/projects/${projectId}/tasks/${taskId}`,
    undefined,
    taskId,
  )
  return { message: `${target.name} is now helping on this task` }
}

/** A submitted task the volunteer may accept or send back: the project's owner, a deputy or an admin. */
async function findTaskToReview(
  projectId: number,
  taskId: number,
  volunteer: { id: number; isAdmin: boolean | null },
) {
  const found = await findProjectTask(projectId, taskId)
  const isDeputy = await isProjectDeputy(projectId, volunteer.id)
  if (!canManageProjectTasks(found.project, volunteer, isDeputy)) {
    throw new ORPCError('FORBIDDEN', {
      message: 'Only the project owner or a deputy can review this task',
    })
  }
  if (found.task.status !== TaskStatus.under_review) {
    throw new ORPCError('BAD_REQUEST', { message: 'This task is not waiting for review' })
  }
  return { ...found, isDeputy }
}

/** How a person is named on something they did as a manager: a deputy says so. */
/**
 * Tells whoever held a task that it has been handed on or opened up again, so they stop working
 * on it. Nobody is told about a task they are simply keeping.
 */
async function tellPreviousAssignee(
  task: { id: number; title: string; parentId: number | null; assigneeId: number | null },
  newAssigneeId: number | null,
  how: 'reassigned' | 'released',
): Promise<void> {
  if (task.assigneeId === null || task.assigneeId === newAssigneeId) return
  await notifyUser(
    task.assigneeId,
    how === 'reassigned' ? 'task_reassigned' : 'task_released',
    how === 'reassigned'
      ? `'${task.title}' has been handed to someone else`
      : `'${task.title}' is open again`,
    'The owner has taken it off your list, so there is nothing more to do on it.',
    `/projects/${task.parentId}/tasks/${task.id}`,
    undefined,
    task.id,
  )
}

const READY_TO_COMPLETE = 'project_ready_to_complete'

/**
 * Once every task of a running project is done, asks its owner to complete it: one notification,
 * which goes when a task reopens or is added, or the project's status changes.
 */
async function askOwnerToComplete(projectId: number): Promise<void> {
  const project = await prisma.workItem.findFirst({
    where: {
      id: projectId,
      status: ProjectStatus.in_progress,
      children: {
        some: { type: WorkItemType.TASK },
        none: { type: WorkItemType.TASK, status: { not: TaskStatus.completed } },
      },
    },
    select: { id: true, title: true, assigneeId: true },
  })
  if (!project?.assigneeId) return
  const asked = await prisma.notification.count({
    where: { volunteerId: project.assigneeId, type: READY_TO_COMPLETE, entityId: project.id },
  })
  if (asked > 0) return
  await createNotification(
    project.assigneeId,
    READY_TO_COMPLETE,
    `Every task on '${project.title}' is done`,
    'Ready to complete the project?',
    `/projects/${project.id}`,
    project.id,
  )
}

function actorLabel(volunteer: { name: string }, isDeputy: boolean): string {
  return isDeputy ? `${volunteer.name} (deputy)` : volunteer.name
}

/** The event context that labels a deputy's action as theirs, as actorLabel does. */
function deputyContext(isDeputy: boolean) {
  return isDeputy ? { asDeputy: true } : undefined
}

/** Accepted helpers the owner has made deputies, minus `exceptId`. */
async function deputyIdsOf(projectId: number, exceptId: number | null = null): Promise<number[]> {
  const rows = await prisma.projectDeputy.findMany({
    where: {
      projectId,
      volunteer: {
        workItemInterests: { some: { workItemId: projectId, status: InterestStatus.accepted } },
      },
    },
    select: { volunteerId: true },
  })
  return rows.map((r) => r.volunteerId).filter((id) => id !== exceptId)
}

/** A helper who leaves or is removed stops being a deputy; the owner is told. */
async function endDeputyRole(
  project: { id: number; title: string; assigneeId: number | null },
  volunteerId: number,
  volunteerName: string,
): Promise<void> {
  const removed = await prisma.projectDeputy.deleteMany({
    where: { projectId: project.id, volunteerId },
  })
  if (removed.count > 0 && project.assigneeId !== null) {
    await notifyUser(
      project.assigneeId,
      'deputy_removed',
      `${volunteerName} is no longer a deputy on '${project.title}'`,
      'They are no longer a helper on the project.',
      `/projects/${project.id}#people`,
    )
  }
}

// Unfinished tasks share a bucket so claiming, assigning or submitting a task doesn't
// disturb its priority position — only completed tasks sink to the bottom.
const TASK_ORDER: Record<string, number> = {
  [TaskStatus.not_started]: 0,
  [TaskStatus.in_progress]: 0,
  [TaskStatus.under_review]: 0,
  [TaskStatus.completed]: 1,
}

const URGENCY_RANK_SQL = `CASE urgency WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`
// Projects looking for people first, then the most urgent, then the newest.
const DEFAULT_PROJECT_ORDER_SQL = `ORDER BY
  CASE WHEN is_seeking_help OR ${SEEKING_OWNER_SQL} THEN 0 ELSE 1 END,
  ${URGENCY_RANK_SQL},
  created_at DESC, id DESC`

export const projectsRouter = {
  list: confirmedProcedure
    .input(
      z.object({
        status: z.string().optional(),
        skillIds: z.array(z.number().int()).optional(),
        search: z.string().optional(),
        urgency: z.string().optional(),
        chapter: z.union([z.number().int(), z.literal('pool')]).optional(),
        localGroupId: z.number().int().optional(),
        teamId: z.number().int().optional(),
        isOrgProposed: z.boolean().optional(),
        isSeekingHelp: z.boolean().optional(),
        isSeekingOwner: z.boolean().optional(),
        isSeekingAny: z.boolean().optional(),
        notSeeking: z.boolean().optional(),
        sortBy: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional().default(50),
        offset: z.number().int().min(0).optional().default(0),
      }),
    )
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer

      const v = await prisma.volunteer.findUnique({
        where: { id: volunteer.id },
        select: { skills: { select: { skillId: true } } },
      })
      const volunteerSkillIds = new Set((v?.skills ?? []).map((s) => s.skillId))

      const teamMemberships = await prisma.teamMembership.findMany({
        where: { volunteerId: volunteer.id },
        select: { teamId: true },
      })
      const viewerTeamIds = new Set(teamMemberships.map((m) => m.teamId))

      const conditions: Prisma.Sql[] = [Prisma.sql`type = ${WorkItemType.PROJECT}`]

      if (input.status) {
        conditions.push(Prisma.sql`status = ${input.status}`)
        // Asking for an unapproved status by name shows a volunteer their own proposals only,
        // and a chapter's staff their chapter's (the scope below holds them to it).
        const seesProposals = volunteer.isAdmin || isStaff(context.access)
        if (!seesProposals && UNAPPROVED_STATUSES.includes(input.status)) {
          conditions.push(
            Prisma.sql`(creator_id = ${volunteer.id} OR assignee_id = ${volunteer.id})`,
          )
        }
      } else {
        conditions.push(
          Prisma.raw(
            `status NOT IN ('${ProjectStatus.archived}', ${UNAPPROVED_STATUSES.map((s) => `'${s}'`).join(', ')})`,
          ),
        )
      }

      if (input.skillIds && input.skillIds.length > 0) {
        conditions.push(
          Prisma.sql`id IN (SELECT work_item_id FROM work_item_skills WHERE skill_id IN (${Prisma.join(input.skillIds)}))`,
        )
      }

      if (input.search) {
        const like = `%${input.search}%`
        conditions.push(
          Prisma.sql`(public.unaccent(title) ILIKE public.unaccent(${like}) OR public.unaccent(description) ILIKE public.unaccent(${like}))`,
        )
      }

      if (input.urgency) conditions.push(Prisma.sql`urgency = ${input.urgency}`)
      const narrowing = chapterNarrowingSql(context.access, input.chapter)
      if (narrowing) conditions.push(narrowing)
      if (input.localGroupId) conditions.push(Prisma.sql`local_group_id = ${input.localGroupId}`)
      if (input.teamId) conditions.push(Prisma.sql`team_id = ${input.teamId}`)

      if (input.isOrgProposed !== undefined) {
        conditions.push(Prisma.sql`is_org_proposed = ${input.isOrgProposed}`)
      }
      if (input.isSeekingHelp !== undefined) {
        conditions.push(Prisma.sql`is_seeking_help = ${input.isSeekingHelp}`)
      }
      if (input.isSeekingOwner !== undefined) {
        conditions.push(
          Prisma.raw(input.isSeekingOwner ? SEEKING_OWNER_SQL : `NOT ${SEEKING_OWNER_SQL}`),
        )
      }
      if (input.isSeekingAny) {
        conditions.push(Prisma.raw(`(is_seeking_help OR ${SEEKING_OWNER_SQL})`))
      }
      if (input.notSeeking) {
        conditions.push(Prisma.raw(`NOT is_seeking_help AND NOT ${SEEKING_OWNER_SQL}`))
      }

      conditions.push(projectScopeSql(volunteer))

      const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
      const orderClause = Prisma.raw(
        input.sortBy === 'created_at'
          ? 'ORDER BY created_at DESC, id DESC'
          : input.sortBy === 'urgency'
            ? `ORDER BY ${URGENCY_RANK_SQL}, created_at DESC, id DESC`
            : DEFAULT_PROJECT_ORDER_SQL,
      )

      const [countResult, idRows] = await Promise.all([
        prisma.$queryRaw<
          [{ count: bigint }]
        >`SELECT COUNT(*) as count FROM work_items ${whereClause}`,
        input.sortBy === 'match'
          ? prisma.$queryRaw<
              { id: number }[]
            >`SELECT id FROM work_items ${whereClause} ${orderClause}`
          : prisma.$queryRaw<
              { id: number }[]
            >`SELECT id FROM work_items ${whereClause} ${orderClause} LIMIT ${input.limit} OFFSET ${input.offset}`,
      ])

      const total = Number(countResult[0].count)
      const ids = idRows.map((r) => r.id)

      const rawProjects = await prisma.workItem.findMany({
        where: { id: { in: ids } },
        include: projectInclude,
      })

      const projectMap = new Map(rawProjects.map((p) => [p.id, p]))
      const late = await lateProjects(rawProjects)
      const projects = ids
        .map((id) => projectMap.get(id))
        .filter((p): p is NonNullable<typeof p> => p !== undefined)
        .map((p) => ({
          ...withProjectExtras(p as EnrichedProject, volunteerSkillIds, viewerTeamIds),
          daysLate: late.get(p.id) ?? null,
          viewerLeads: canManageProject(p, volunteer),
        }))

      // Match sorting can't be done in SQL, so this branch fetched every matching id and
      // paginates here. The slice has to happen whether or not the volunteer has skills to
      // sort by — without it, a volunteer with no skills got the entire result set back.
      if (input.sortBy === 'match') {
        if (volunteerSkillIds.size > 0) {
          projects.sort((a, b) => (b.match?.overallScore ?? 0) - (a.match?.overallScore ?? 0))
        }
        return { projects: projects.slice(input.offset, input.offset + input.limit), total }
      }

      return { projects, total }
    }),

  /**
   * The unfiltered projects page groups by status/seeking-state into sections (Your Team,
   * Looking for People, In Progress, On Hold, Completed). A single capped `list` query can't
   * back that: whichever 50 rows happen to come back get sliced client-side into sections, so
   * a section can silently lose members to whichever other section ate the cap first. Each
   * section gets its own capped query + total here instead, so every section is complete up
   * to its own cap and knows how many more there are.
   */
  listGrouped: confirmedProcedure
    .input(
      z.object({
        skillIds: z.array(z.number().int()).optional(),
        search: z.string().optional(),
        urgency: z.string().optional(),
        chapter: z.union([z.number().int(), z.literal('pool')]).optional(),
        localGroupId: z.number().int().optional(),
        teamId: z.number().int().optional(),
        isOrgProposed: z.boolean().optional(),
        previewLimit: z.number().int().min(1).max(100).optional().default(50),
      }),
    )
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer

      const v = await prisma.volunteer.findUnique({
        where: { id: volunteer.id },
        select: { skills: { select: { skillId: true } } },
      })
      const volunteerSkillIds = new Set((v?.skills ?? []).map((s) => s.skillId))

      const teamMemberships = await prisma.teamMembership.findMany({
        where: { volunteerId: volunteer.id },
        select: { teamId: true },
      })
      const viewerTeamIds = new Set(teamMemberships.map((m) => m.teamId))

      const sharedConditions: Prisma.Sql[] = [
        Prisma.sql`type = ${WorkItemType.PROJECT}`,
        Prisma.raw(
          `status NOT IN ('${ProjectStatus.archived}', ${UNAPPROVED_STATUSES.map((s) => `'${s}'`).join(', ')})`,
        ),
      ]
      if (input.skillIds && input.skillIds.length > 0) {
        sharedConditions.push(
          Prisma.sql`id IN (SELECT work_item_id FROM work_item_skills WHERE skill_id IN (${Prisma.join(input.skillIds)}))`,
        )
      }
      if (input.search) {
        const like = `%${input.search}%`
        sharedConditions.push(
          Prisma.sql`(public.unaccent(title) ILIKE public.unaccent(${like}) OR public.unaccent(description) ILIKE public.unaccent(${like}))`,
        )
      }
      if (input.urgency) sharedConditions.push(Prisma.sql`urgency = ${input.urgency}`)
      const narrowing = chapterNarrowingSql(context.access, input.chapter)
      if (narrowing) sharedConditions.push(narrowing)
      if (input.localGroupId) {
        sharedConditions.push(Prisma.sql`local_group_id = ${input.localGroupId}`)
      }
      if (input.teamId) sharedConditions.push(Prisma.sql`team_id = ${input.teamId}`)
      if (input.isOrgProposed !== undefined) {
        sharedConditions.push(Prisma.sql`is_org_proposed = ${input.isOrgProposed}`)
      }
      sharedConditions.push(projectScopeSql(volunteer))

      const seekingSqlStr = `(is_seeking_help OR ${SEEKING_OWNER_SQL})`
      const orderClause = Prisma.raw(DEFAULT_PROJECT_ORDER_SQL)

      const bucketDefs: { key: string; extra: Prisma.Sql }[] = [
        { key: 'seeking', extra: Prisma.raw(seekingSqlStr) },
        {
          key: 'in_progress',
          extra: Prisma.raw(`NOT ${seekingSqlStr} AND status = '${ProjectStatus.in_progress}'`),
        },
        {
          key: 'on_hold',
          extra: Prisma.raw(`NOT ${seekingSqlStr} AND status = '${ProjectStatus.on_hold}'`),
        },
        { key: 'completed', extra: Prisma.sql`status = ${ProjectStatus.completed}` },
        {
          key: 'other',
          extra: Prisma.raw(
            `NOT ${seekingSqlStr} AND status NOT IN ('${ProjectStatus.ready}', '${ProjectStatus.in_progress}', '${ProjectStatus.on_hold}', '${ProjectStatus.completed}')`,
          ),
        },
        // Cross-cuts the other buckets rather than partitioning them — a project can be both
        // "your team" and "seeking". Only meaningful for non-admins, to whom "your team" is a
        // quick-jump; admins see every team's projects so it isn't a distinguishing cut.
        ...(!volunteer.isAdmin
          ? [
              {
                key: 'your_team',
                extra:
                  viewerTeamIds.size > 0
                    ? Prisma.sql`team_id IN (${Prisma.join([...viewerTeamIds])})`
                    : Prisma.sql`1 = 0`,
              },
            ]
          : []),
      ]

      const bucketResults = await Promise.all(
        bucketDefs.map(async ({ key, extra }) => {
          const whereClause = Prisma.sql`WHERE ${Prisma.join([...sharedConditions, extra], ' AND ')}`
          const [countResult, idRows] = await Promise.all([
            prisma.$queryRaw<
              [{ count: bigint }]
            >`SELECT COUNT(*) as count FROM work_items ${whereClause}`,
            prisma.$queryRaw<{ id: number }[]>`
              SELECT id FROM work_items ${whereClause} ${orderClause} LIMIT ${input.previewLimit}`,
          ])
          return { key, total: Number(countResult[0].count), ids: idRows.map((r) => r.id) }
        }),
      )

      const allIds = [...new Set(bucketResults.flatMap((b) => b.ids))]
      const rawProjects = await prisma.workItem.findMany({
        where: { id: { in: allIds } },
        include: projectInclude,
      })
      const projectMap = new Map(rawProjects.map((p) => [p.id, p]))
      const late = await lateProjects(rawProjects)

      return {
        groups: bucketResults.map(({ key, total, ids }) => ({
          key,
          total,
          projects: ids
            .map((id) => projectMap.get(id))
            .filter((p): p is NonNullable<typeof p> => p !== undefined)
            .map((p) => ({
              ...withProjectExtras(p as EnrichedProject, volunteerSkillIds, viewerTeamIds),
              daysLate: late.get(p.id) ?? null,
              viewerLeads: canManageProject(p, volunteer),
            })),
        })),
      }
    }),

  create: approvedProcedure.input(CreateProjectSchema).handler(async ({ input, context }) => {
    const volunteer = context.volunteer
    const { tasks, wantToOwn, skillIds, skillRequiredMap, saveAsDraft } = input

    // Admins and chapter staff are trusted, not volunteers proposing speculative projects — the
    // cap exists to bound unreviewed volunteer proposals, not to limit their work.
    if (saveAsDraft && !volunteer.isAdmin && !isStaff(context.access)) {
      const draftCount = await prisma.workItem.count({
        where: {
          type: WorkItemType.PROJECT,
          creatorId: volunteer.id,
          status: ProjectStatus.draft,
          isOrgProposed: false,
        },
      })
      if (draftCount >= MAX_VOLUNTEER_DRAFTS) {
        throw new ORPCError('BAD_REQUEST', {
          message: `You already have ${MAX_VOLUNTEER_DRAFTS} drafts. Publish or delete one before saving another.`,
        })
      }
    }

    // Dates given at creation are a sketch, not a commitment — the baseline stays unset until
    // someone explicitly sets it.
    const scheduleOnCreate: Record<string, unknown> = {}
    applyScheduleWrite(scheduleOnCreate, {
      startDate: input.startDate ?? null,
      durationDays: input.durationDays ?? null,
    })

    const { chapterChanged: _, ...location } = await projectLocation(context.access, input)
    await assertTeamInChapter(context.access, input.teamId, location.nationalChapterId)
    const project = await prisma.$transaction(async (tx) => {
      const newProject = await tx.workItem.create({
        data: {
          type: WorkItemType.PROJECT,
          title: input.title,
          description: input.description,
          // A draft stays invisible to admins until the volunteer explicitly publishes it.
          status: saveAsDraft ? ProjectStatus.draft : ProjectStatus.pending_review,
          assigneeId: wantToOwn ? volunteer.id : null,
          creatorId: volunteer.id,
          isOrgProposed: false,
          projectType: input.projectType ?? null,
          estimatedDuration: input.estimatedDuration ?? null,
          timeCommitmentHoursPerWeek: input.timeCommitmentHoursPerWeek ?? null,
          urgency: input.urgency ?? 'medium',
          collaborationLink: input.collaborationLink ?? null,
          ...scheduleOnCreate,
          ...location,
          isSeekingHelp: input.isSeekingHelp !== false,
          teamId: input.teamId ?? null,
        },
      })

      if (skillIds.length > 0) {
        await tx.workItemSkill.createMany({
          data: skillIds.map((skillId) => ({
            workItemId: newProject.id,
            skillId,
            isRequired: skillRequiredMap[skillId] !== false,
          })),
        })
      }

      await tx.workItem.createMany({
        data: tasks.map((t) => ({
          type: WorkItemType.TASK,
          status: TaskStatus.not_started,
          parentId: newProject.id,
          title: t.title,
          description: t.description ?? null,
          creatorId: volunteer.id,
        })),
      })

      return newProject
    })

    if (!saveAsDraft) {
      await notifyChapterStaff(
        project.nationalChapterId,
        'new_project_proposal',
        `New project proposal: ${project.title}`,
        `Proposed by ${volunteer.name}`,
        '/admin/triage',
        {
          message: html`<strong>${volunteer.name}</strong> has submitted a new project proposal:
            <strong>${project.title}</strong>. Please review it in the triage queue.`,
          projectTitle: project.title,
          projectId: project.id,
        },
        project.id,
      )
    }

    return {
      id: project.id,
      message: saveAsDraft ? 'Draft saved' : 'Project submitted for review',
    }
  }),

  myDrafts: approvedProcedure.handler(async ({ context }) => {
    const volunteer = context.volunteer
    const drafts = await prisma.workItem.findMany({
      where: {
        type: WorkItemType.PROJECT,
        creatorId: volunteer.id,
        status: ProjectStatus.draft,
        // Org drafts belong to the "Org Projects" admin page's own My Drafts list.
        isOrgProposed: false,
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, createdAt: true },
    })
    return drafts
  }),

  publishDraft: approvedProcedure
    .input(z.object({ id: z.number().int() }))
    .use(asProjectAdmin, (input) => input.id)
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      const project = await prisma.workItem.findFirst({
        where: { id: input.id, type: WorkItemType.PROJECT },
      })
      if (!project) throw new ORPCError('NOT_FOUND', { message: 'Draft not found' })
      if (project.creatorId !== volunteer.id || project.status !== ProjectStatus.draft) {
        throw new ORPCError('FORBIDDEN', { message: 'Not authorized to publish this draft' })
      }

      const isOrgOrTemplate = project.isOrgProposed || project.templateOriginId !== null
      if (isOrgOrTemplate) {
        // Org projects, and projects instantiated from a template, go straight live on publish
        // with no review to catch a missing task list, so they need one up front.
        const taskCount = await prisma.workItem.count({
          where: { parentId: input.id, type: WorkItemType.TASK },
        })
        if (taskCount === 0) {
          throw new ORPCError('BAD_REQUEST', {
            message: 'Add at least one task before submitting this draft for review',
          })
        }
      }

      if (isOrgOrTemplate) {
        // Org projects, and projects instantiated from a template, skip review entirely —
        // publishing a draft goes straight live. Template-originated projects already came
        // from a vetted structure, so re-review would be redundant (see
        // lib/template-porting.ts).
        const newStatus =
          project.assigneeId === null ? ProjectStatus.ready : ProjectStatus.in_progress
        await updateWorkItem(
          project,
          { status: newStatus, updatedAt: new Date() },
          { actorId: volunteer.id, kind: 'status' },
        )

        notifyMatchingVolunteers(project.id).catch((e) => logger.error(e, '[MATCH NOTIFY]'))
        if (project.teamId) {
          notifyTeamOfProject(project.teamId, project.id, project.title).catch((e) =>
            logger.error(e, '[TEAM NOTIFY]'),
          )
        }

        return { message: 'Project published' }
      }

      await updateWorkItem(
        project,
        { status: ProjectStatus.pending_review, updatedAt: new Date() },
        { actorId: volunteer.id, kind: 'status' },
      )

      await notifyChapterStaff(
        project.nationalChapterId,
        'new_project_proposal',
        `New project proposal: ${project.title}`,
        `Proposed by ${volunteer.name}`,
        '/admin/triage',
        {
          message: html`<strong>${volunteer.name}</strong> has submitted a new project proposal:
            <strong>${project.title}</strong>. Please review it in the triage queue.`,
          projectTitle: project.title,
          projectId: project.id,
        },
        project.id,
      )

      return { message: 'Project submitted for review' }
    }),

  deleteDraft: approvedProcedure
    .input(z.object({ id: z.number().int() }))
    .use(asProjectAdmin, (input) => input.id)
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      const project = await prisma.workItem.findFirst({
        where: { id: input.id, type: WorkItemType.PROJECT },
      })
      if (!project) throw new ORPCError('NOT_FOUND', { message: 'Draft not found' })
      if (project.creatorId !== volunteer.id || project.status !== ProjectStatus.draft) {
        throw new ORPCError('FORBIDDEN', { message: 'Not authorized to delete this draft' })
      }
      await prisma.workItem.delete({ where: { id: input.id } })
      return { message: 'Draft deleted' }
    }),

  getById: confirmedProcedure
    .input(z.object({ id: z.number().int() }))
    .use(asProjectAdmin, (input) => input.id)
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer

      const project = await prisma.workItem.findFirst({
        where: { id: input.id, type: WorkItemType.PROJECT },
        include: projectInclude,
      })

      if (!project) throw new ORPCError('NOT_FOUND', { message: 'Project not found' })

      if (!(await canReachProject(project, volunteer))) {
        throw new ORPCError('NOT_FOUND', { message: 'Project not found' })
      }

      const hiddenStatuses: string[] = [
        ProjectStatus.draft,
        ProjectStatus.pending_review,
        ProjectStatus.needs_discussion,
      ]
      if (hiddenStatuses.includes(project.status)) {
        const isCreator = project.creatorId === volunteer.id
        if (!isCreator && !volunteer.isAdmin)
          throw new ORPCError('NOT_FOUND', { message: 'Project not found' })
      }

      const v = await prisma.volunteer.findUnique({
        where: { id: volunteer.id },
        select: { skills: { select: { skillId: true } } },
      })
      const volunteerSkillIds = new Set((v?.skills ?? []).map((s) => s.skillId))

      const teamMemberships = await prisma.teamMembership.findMany({
        where: { volunteerId: volunteer.id },
        select: { teamId: true },
      })
      const viewerTeamIds = new Set(teamMemberships.map((m) => m.teamId))

      const base = withProjectExtras(project as EnrichedProject, volunteerSkillIds, viewerTeamIds)

      const tasks = await prisma.workItem.findMany({
        where: { parentId: input.id, type: WorkItemType.TASK },
        include: {
          assignee: { select: { name: true } },
          creator: { select: { name: true } },
          requestedBy: { select: { name: true } },
          _count: {
            select: {
              comments: true,
              interests: { where: { status: InterestStatus.accepted } },
            },
          },
        },
      })

      const sortedTasks = tasks.sort((a, b) => {
        const orderDiff = (TASK_ORDER[a.status] ?? 0) - (TASK_ORDER[b.status] ?? 0)
        if (orderDiff !== 0) return orderDiff
        const sortOrderDiff = (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
        if (sortOrderDiff !== 0) return sortOrderDiff
        return (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)
      })

      // The schedule gives each task's days past plan; its edges give the key-date sides.
      const { schedule, edges } = await loadProjectTaskSchedule(project, sortedTasks)
      const hasPredecessor = new Set(edges.map((e) => e.successorId))
      const sides = keyDateSides(sortedTasks, edges)
      const views = taskStatusViews(sortedTasks, edges)
      // The list names a Blocked task's first open predecessor, in the manual order, as a card.
      const reviewer = {
        id: volunteer.id,
        canReview: canManageProjectTasks(
          project,
          volunteer,
          await isProjectDeputy(input.id, volunteer.id),
        ),
      }
      const firstBlocker = (i: number) => {
        const open = new Set(views[i].blockedBy.map((b) => b.id))
        const n = sortedTasks.findIndex((t) => open.has(t.id))
        return n < 0 ? null : toWorkItemSummary(sortedTasks[n], views[n].displayStatus, reviewer)
      }

      const mappedTasks = sortedTasks.map((t, i) => ({
        ...serializeTask(t),
        ...views[i],
        firstBlocker: firstBlocker(i),
        keyDateSide: sides.get(t.id) ?? null,
        pastPlanDays: taskIsDated(t, hasPredecessor.has(t.id))
          ? daysPastPlan(schedule.scheduled[i].end, {
              done: t.status === TaskStatus.completed,
              assigned: t.assigneeId !== null,
            })
          : null,
        assignedToName: t.assignee?.name ?? null,
        createdByName: t.creator?.name ?? null,
        requestedByName: t.requestedBy?.name ?? null,
        sortOrder: t.sortOrder,
        commentCount: t._count.comments,
        helperCount: t._count.interests,
        featuredAsQuickTask: t.featuredAsQuickTask ?? false,
      }))
      // The Overview counts down to the soonest key date still to come, as the timeline places it.
      const keyDate =
        sortedTasks
          .flatMap((t, i) =>
            t.isAnchor &&
            t.status !== TaskStatus.completed &&
            taskIsDated(t, hasPredecessor.has(t.id))
              ? [schedule.scheduled[i].start]
              : [],
          )
          .sort((a, b) => a.getTime() - b.getTime())[0] ?? null

      const isAssignee = project.assigneeId === volunteer.id
      // The owner or an admin is asked to complete a running project once every task is done.
      // `lastDoneAt` changes whenever a task is done again, which brings back a dismissed ask.
      const allTasksDone =
        (isAssignee || volunteer.isAdmin) &&
        project.status === ProjectStatus.in_progress &&
        sortedTasks.length > 0 &&
        sortedTasks.every((t) => t.status === TaskStatus.completed)
          ? {
              count: sortedTasks.length,
              includesKeyDate: sortedTasks.some((t) => t.isAnchor),
              lastDoneAt: new Date(
                Math.max(...sortedTasks.map((t) => t.completedAt?.getTime() ?? 0)),
              ),
            }
          : null

      let interests:
        | Array<{
            id: number
            volunteerId: number
            projectId: number
            interestType: string
            message: string | null
            status: string
            origin: string
            responseMessage: string | null
            createdAt: Date | null
            respondedAt: Date | null
            invitedByName: string | null
            volunteerName: string
            volunteerBio: string | null
            volunteerSkills: Array<{
              id: number
              name: string
              categoryName: string
              proficiencyLevel: string | null
            }>
          }>
        | undefined

      if (isAssignee || volunteer.isAdmin) {
        const rawInterests = await prisma.workItemInterest.findMany({
          where: { workItemId: input.id },
          include: {
            invitedBy: { select: { name: true } },
            volunteer: {
              select: {
                id: true,
                name: true,
                bio: true,
                skills: { include: { skill: { include: { category: true } } } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        })
        interests = rawInterests.map((i) => ({
          id: i.id,
          volunteerId: i.volunteerId,
          projectId: i.workItemId,
          interestType: i.interestType,
          message: i.message,
          status: i.status,
          origin: i.origin,
          responseMessage: i.responseMessage,
          createdAt: i.createdAt,
          respondedAt: i.respondedAt,
          invitedByName: i.invitedBy?.name ?? null,
          volunteerName: i.volunteer.name,
          volunteerBio: i.volunteer.bio,
          volunteerSkills: i.volunteer.skills.map((vs) => ({
            id: vs.skill.id,
            name: vs.skill.name,
            categoryName: vs.skill.category.name,
            proficiencyLevel: vs.proficiencyLevel,
          })),
        }))
      }

      const rawMyInterest = await prisma.workItemInterest.findFirst({
        where: {
          workItemId: input.id,
          volunteerId: volunteer.id,
          status: { not: InterestStatus.withdrawn },
        },
        include: { invitedBy: { select: { name: true } } },
      })
      const myInterest = rawMyInterest
        ? {
            id: rawMyInterest.id,
            volunteerId: rawMyInterest.volunteerId,
            projectId: rawMyInterest.workItemId,
            interestType: rawMyInterest.interestType,
            origin: rawMyInterest.origin,
            message: rawMyInterest.message,
            status: rawMyInterest.status,
            responseMessage: rawMyInterest.responseMessage,
            createdAt: rawMyInterest.createdAt,
            respondedAt: rawMyInterest.respondedAt,
            invitedByName: rawMyInterest.invitedBy?.name ?? null,
          }
        : null

      // Nothing on a locked project can be claimed, created or managed until it is reopened.
      const locked = isProjectLocked(project)
      const canClaimTasks =
        !locked &&
        (isAssignee ||
          Boolean(volunteer.isAdmin) ||
          !(await isBlockedFromClaiming(input.id, volunteer.id)))

      const isMember =
        (project.teamId !== null && viewerTeamIds.has(project.teamId)) ||
        myInterest?.status === InterestStatus.accepted
      const canCreateTasks = !locked && canCreateProjectTask(project, volunteer, isMember)

      // A lightweight, non-sensitive roster (name + role only, no application message/bio)
      // any member can see — unlike `interests`, which carries pending applicants' private
      // messages and is restricted to the owner/admin for review.
      const helperRows = await prisma.workItemInterest.findMany({
        where: { workItemId: input.id, status: InterestStatus.accepted },
        include: { volunteer: { select: { name: true } } },
        orderBy: { respondedAt: 'asc' },
      })
      const deputyIds = new Set(await deputyIdsOf(input.id))
      const helpers = helperRows
        .filter((h) => h.volunteerId !== project.assigneeId)
        .map((h) => ({
          id: h.id,
          volunteerId: h.volunteerId,
          volunteerName: h.volunteer.name,
          interestType: h.interestType,
          isDeputy: deputyIds.has(h.volunteerId),
        }))
      const isDeputy = deputyIds.has(volunteer.id)
      const canManageTasks = !locked && canManageProjectTasks(project, volunteer, isDeputy)

      // Change requests are between the admins and whoever proposed or runs the project.
      const canSeeReview =
        isAssignee || project.creatorId === volunteer.id || Boolean(volunteer.isAdmin)
      const reviewRequests = canSeeReview
        ? (
            await prisma.projectReviewRequest.findMany({
              where: { projectId: input.id },
              include: { requestedBy: { select: { name: true } } },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            })
          ).map((r) => ({
            id: r.id,
            message: r.message,
            requestedByName: r.requestedBy?.name ?? null,
            createdAt: r.createdAt,
            resolvedAt: r.resolvedAt,
          }))
        : []

      return {
        ...base,
        // A global admin, or this project's chapter's staff (see asProjectAdmin).
        viewerCanAdmin: Boolean(volunteer.isAdmin),
        tasks: mappedTasks,
        taskCounts: taskCounts(mappedTasks),
        daysLate: (await lateProjects([project])).get(project.id) ?? null,
        keyDate,
        allTasksDone,
        interests,
        helpers,
        myInterest,
        canClaimTasks,
        claimViewer: await resolveClaimViewer(project, volunteer),
        canCreateTasks,
        canManageTasks,
        isDeputy,
        isMember,
        canMessageOwner:
          project.assigneeId !== null &&
          project.assigneeId !== volunteer.id &&
          (await canReach(volunteer, context.access, project.assigneeId)),
        reviewRequests,
      }
    }),

  resubmit: approvedProcedure
    .input(z.object({ id: z.number().int() }))
    .use(asProjectAdmin, (input) => input.id)
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      const project = await prisma.workItem.findFirst({
        where: { id: input.id, type: WorkItemType.PROJECT },
      })
      if (!project) throw new ORPCError('NOT_FOUND', { message: 'Project not found' })
      if (project.creatorId !== volunteer.id && project.assigneeId !== volunteer.id) {
        throw new ORPCError('FORBIDDEN', { message: 'Not authorized to resubmit this project' })
      }
      if (project.status !== ProjectStatus.needs_discussion) {
        throw new ORPCError('BAD_REQUEST', { message: 'No changes have been requested' })
      }

      const open = await prisma.projectReviewRequest.findFirst({
        where: { projectId: project.id, resolvedAt: null },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: { requestedBy: { select: { id: true, deletedAt: true } } },
      })
      await updateWorkItem(
        project,
        { status: ProjectStatus.pending_review, updatedAt: new Date() },
        { actorId: volunteer.id, kind: 'status' },
      )
      await prisma.projectReviewRequest.updateMany({
        where: { projectId: project.id, resolvedAt: null },
        data: { resolvedAt: new Date() },
      })
      await clearNotifications('project_needs_discussion', project.id)

      // The admin who asked hears back; with nobody to tell, the chapter's staff do.
      const args = [
        'project_resubmitted',
        `Resubmitted: '${project.title}' is ready for another look`,
        `${volunteer.name} made the changes you asked for`,
        `/projects/${project.id}`,
        undefined,
        project.id,
      ] as const
      const requester = open?.requestedBy
      if (requester && !requester.deletedAt) await notifyUser(requester.id, ...args)
      else await notifyChapterStaff(project.nationalChapterId, ...args)

      return { message: 'Project resubmitted for review' }
    }),

  update: approvedProcedure
    .input(z.object({ id: z.number().int() }).merge(UpdateProjectSchema))
    .use(asProjectAdmin, (input) => input.id)
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      const project = await prisma.workItem.findFirst({
        where: { id: input.id, type: WorkItemType.PROJECT },
      })
      if (!project) throw new ORPCError('NOT_FOUND', { message: 'Project not found' })

      const isAssignee = project.assigneeId === volunteer.id
      const isCreator = project.creatorId === volunteer.id
      if (!isAssignee && !isCreator && !volunteer.isAdmin) {
        throw new ORPCError('FORBIDDEN', { message: 'Not authorized to edit this project' })
      }

      // A locked project takes one change, a new status from its owner or an admin, and nothing
      // else that was sent with it. A status out of completed or archived reopens it.
      const locked = isProjectLocked(project)
      if (locked) {
        const canMove =
          input.status !== undefined &&
          input.status !== project.status &&
          (Boolean(volunteer.isAdmin) ||
            (isAssignee && OWNER_ALLOWED_STATUSES.includes(input.status as ProjectStatus)))
        if (!canMove) assertProjectEditable(project)
      }
      const body: typeof input = locked ? { id: input.id, status: input.status } : input
      const newStatus = body.status
      const reopening = locked && !isProjectLocked({ status: newStatus as string })

      // Until an admin has triaged it, a proposal's status is the admins' to change; the
      // proposer's one move, submitting a draft, goes through publishDraft.
      if (
        newStatus !== undefined &&
        newStatus !== project.status &&
        !volunteer.isAdmin &&
        UNAPPROVED_STATUSES.includes(project.status)
      ) {
        throw new ORPCError('FORBIDDEN', {
          message: 'This project is awaiting admin review, so its status cannot be changed yet',
        })
      }

      // Reopening a finished project brings back its work as it was, done tasks and all.
      if (
        newStatus &&
        newStatus === ProjectStatus.in_progress &&
        project.status !== ProjectStatus.in_progress &&
        !reopening
      ) {
        const openTaskCount = await prisma.workItem.count({
          where: {
            parentId: input.id,
            type: WorkItemType.TASK,
            status: { not: TaskStatus.completed },
          },
        })
        if (openTaskCount === 0) {
          throw new ORPCError('BAD_REQUEST', {
            message: 'A project cannot be moved to In Progress without at least one open task',
          })
        }
      }

      const data: Record<string, unknown> = {}
      const stringFields = [
        'title',
        'description',
        'projectType',
        'estimatedDuration',
        'urgency',
        'collaborationLink',
        'outcome',
        'outcomeNotes',
      ] as const
      // Handing the project to a different owner or team is the owner's call (or an
      // admin's) — a proposer who never owned it can't appoint themselves. Submitting the
      // current value is always fine: the edit form posts every field back unchanged.
      // A draft has no owner yet, so its creator can set themselves as owner while it's
      // still a draft — the "I want to lead this project" choice from the create form.
      const canReassign =
        isAssignee ||
        Boolean(volunteer.isAdmin) ||
        (isCreator && project.status === ProjectStatus.draft)

      if (body.teamId !== undefined && body.teamId !== project.teamId) {
        if (!canReassign) {
          throw new ORPCError('FORBIDDEN', {
            message: 'Only the project owner or an admin can change the team',
          })
        }
        await assertTeamInChapter(context.access, body.teamId, project.nationalChapterId)
        data.teamId = body.teamId
      }

      for (const field of stringFields) {
        if (body[field] !== undefined) data[field] = body[field]
      }
      let movedChapter = false
      if (
        body.reach !== undefined ||
        body.localGroupId !== undefined ||
        body.chapterId !== undefined
      ) {
        const { chapterChanged, ...location } = await projectLocation(context.access, body, project)
        Object.assign(data, location)
        movedChapter = chapterChanged
      }
      if (body.timeCommitmentHoursPerWeek !== undefined)
        data.timeCommitmentHoursPerWeek = body.timeCommitmentHoursPerWeek
      applyScheduleWrite(data, { startDate: body.startDate, durationDays: body.durationDays })

      // The project's deadline is a promise the owner makes, so a proposer who never owned the
      // project cannot move it.
      if (body.deadline !== undefined) {
        if (!canReassign && body.deadline?.getTime() !== project.deadline?.getTime()) {
          throw new ORPCError('FORBIDDEN', {
            message: 'Only the project owner or an admin can set the project deadline',
          })
        }
        data.deadline = body.deadline
      }

      if (body.assigneeId !== undefined && body.assigneeId !== project.assigneeId) {
        if (!canReassign) {
          throw new ORPCError('FORBIDDEN', {
            message: 'Only the project owner or an admin can change the owner',
          })
        }
        if (body.assigneeId !== null) {
          const newOwner = await prisma.volunteer.findFirst({
            where: { id: body.assigneeId, deletedAt: null },
            select: { approvalStatus: true, nationalChapterId: true },
          })
          if (!newOwner) throw new ORPCError('BAD_REQUEST', { message: 'Volunteer not found' })
          assertInProjectChapter(context.access, newOwner, {
            nationalChapterId:
              data.nationalChapterId === undefined
                ? project.nationalChapterId
                : (data.nationalChapterId as number | null),
          })
          if (newOwner.approvalStatus !== ApprovalStatus.approved) {
            throw new ORPCError('BAD_REQUEST', {
              message: 'Cannot assign a project to a volunteer who is not yet approved',
            })
          }
        }
        data.assigneeId = body.assigneeId
      }

      if (newStatus !== undefined) {
        if (volunteer.isAdmin) {
          data.status = newStatus
        } else if (isAssignee && OWNER_ALLOWED_STATUSES.includes(newStatus as ProjectStatus)) {
          data.status = newStatus
        }
      }

      if (body.isSeekingHelp !== undefined) data.isSeekingHelp = body.isSeekingHelp
      // Whether helpers' work needs the owner's review is the owner's call, not the proposer's.
      if (body.autoAcceptTasks !== undefined && body.autoAcceptTasks !== project.autoAcceptTasks) {
        if (!canReassign) {
          throw new ORPCError('FORBIDDEN', {
            message: 'Only the project owner or an admin can change how submitted work is accepted',
          })
        }
        data.autoAcceptTasks = body.autoAcceptTasks
      }
      if (body.showTimeline !== undefined && body.showTimeline !== project.showTimeline) {
        if (!canReassign) {
          throw new ORPCError('FORBIDDEN', {
            message: 'Only the project owner or an admin can show or hide the timeline',
          })
        }
        data.showTimeline = body.showTimeline
      }

      // Gaining an owner starts the work. Losing one leaves the status as it is: the work is
      // still where it was, and the derived isSeekingOwner shows the project needs an owner.
      const resultingAssigneeId =
        body.assigneeId !== undefined ? body.assigneeId : project.assigneeId
      if (
        data.status === undefined &&
        resultingAssigneeId !== null &&
        project.status === ProjectStatus.ready
      ) {
        data.status = ProjectStatus.in_progress
      }

      if (TERMINAL_STATUSES.includes(data.status as string)) {
        if (data.isSeekingHelp === undefined) data.isSeekingHelp = false
      }
      if (data.status === ProjectStatus.completed && project.status !== ProjectStatus.completed) {
        data.completedAt = new Date()
      } else if (reopening) {
        data.completedAt = null
      }

      data.updatedAt = new Date()
      await updateWorkItem(project, data, {
        actorId: volunteer.id,
        kind: reopening ? 'reopened' : undefined,
      })
      if (movedChapter) {
        await audit(prisma, ChapterAuditAction.PROJECT_CHAPTER_CHANGED, {
          actorId: volunteer.id,
          chapterId: data.nationalChapterId as number | null,
          workItemId: project.id,
          details: { fromChapterId: project.nationalChapterId },
        })
      }

      // Tagging a team onto a project that's already visible alerts that team right away;
      // tagging one still in review waits until it goes live (see admin/projects.ts).
      if (
        typeof data.teamId === 'number' &&
        data.teamId !== project.teamId &&
        !UNAPPROVED_STATUSES.includes(project.status)
      ) {
        notifyTeamOfProject(data.teamId, project.id, project.title).catch((e) =>
          logger.error(e, '[TEAM NOTIFY]'),
        )
      }

      if (body.skillIds !== undefined) {
        const skillRequiredMap = body.skillRequiredMap ?? {}
        await prisma.workItemSkill.deleteMany({ where: { workItemId: input.id } })
        if (body.skillIds.length > 0) {
          await prisma.workItemSkill.createMany({
            data: body.skillIds.map((skillId) => ({
              workItemId: input.id,
              skillId,
              isRequired: skillRequiredMap[skillId] !== false,
            })),
          })
        }
      }

      // Covers the implicit ready ⇄ in_progress moves above, not just an explicit pick.
      const effectiveStatus = data.status as string | undefined
      if (effectiveStatus && effectiveStatus !== project.status) {
        await clearNotifications(READY_TO_COMPLETE, project.id)
        const statusLabel = projectStatusLabel(effectiveStatus)
        const notifyIds = new Set<number>()
        if (project.assigneeId && project.assigneeId !== volunteer.id)
          notifyIds.add(project.assigneeId)
        if (project.creatorId && project.creatorId !== volunteer.id)
          notifyIds.add(project.creatorId)

        const accepted = await prisma.workItemInterest.findMany({
          where: { workItemId: input.id, status: InterestStatus.accepted },
          select: { volunteerId: true },
        })
        for (const row of accepted) {
          if (row.volunteerId !== volunteer.id) notifyIds.add(row.volunteerId)
        }

        for (const vid of notifyIds) {
          await notifyUser(
            vid,
            'project_status_changed',
            `'${project.title}' is now ${statusLabel}`,
            `Status changed by ${volunteer.name}`,
            `/projects/${input.id}`,
            {
              message: html`The project <strong>${project.title}</strong> has been updated to
                <strong>${statusLabel}</strong>.`,
              projectTitle: project.title,
              projectId: input.id,
            },
          )
        }
      }

      const updated = await prisma.workItem.findUnique({
        where: { id: input.id },
        include: projectInclude,
      })
      return withProjectExtras(updated as EnrichedProject)
    }),

  /** A global admin, or its chapter's staff, deletes a project outright. */
  delete: approvedProcedure
    .input(z.object({ id: z.number().int() }))
    .use(asProjectAdmin, (input) => input.id)
    .handler(async ({ input, context }) => {
      if (!context.volunteer.isAdmin) throw new ORPCError('FORBIDDEN')
      const project = await prisma.workItem.findFirst({
        where: { id: input.id, type: WorkItemType.PROJECT },
      })
      if (!project) throw new ORPCError('NOT_FOUND', { message: 'Project not found' })
      await prisma.workItem.delete({ where: { id: input.id } })
      return { message: `Project '${project.title}' deleted` }
    }),

  /** Asks to help on or lead a project; given a `taskId`, joins that task as a helper. */
  expressInterest: confirmedProcedure
    .input(
      z
        .object({ projectId: z.number().int(), taskId: z.number().int().optional() })
        .merge(ProjectInterestBodySchema),
    )
    .use(projectEditable, (input) => input.projectId)
    .use(asProjectAdmin, (input) => input.projectId)
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      if ((input.taskId !== undefined) !== (input.interestType === TASK_HELPER)) {
        throw new ORPCError('BAD_REQUEST', {
          message: 'Helping on a task is for tasks; leading or helping a project is for projects',
        })
      }
      if (input.taskId !== undefined) {
        return joinTaskAsHelper(input.projectId, input.taskId, volunteer, input.message ?? null)
      }
      const project = await prisma.workItem.findFirst({
        where: {
          id: input.projectId,
          type: WorkItemType.PROJECT,
          status: { notIn: [...TERMINAL_STATUSES, ...UNAPPROVED_STATUSES] },
          // Seeking help is a stored flag; seeking an owner is simply having none.
          OR: [{ isSeekingHelp: true }, { assigneeId: null }],
        },
      })
      if (!project) {
        throw new ORPCError('NOT_FOUND', {
          message: 'This project is not currently seeking volunteers',
        })
      }

      if (!(await canReachProject(project, volunteer))) {
        throw new ORPCError('NOT_FOUND', { message: 'Project not found' })
      }

      const existing = await prisma.workItemInterest.findFirst({
        where: { workItemId: input.projectId, volunteerId: volunteer.id },
      })
      if (existing?.status === InterestStatus.invited) {
        throw new ORPCError('BAD_REQUEST', {
          message: "You've been invited to this project: accept the invite instead",
        })
      }
      // Withdrawing, or turning down or losing an invite, leaves the way open to apply.
      const canApplyAgain =
        existing?.status === InterestStatus.withdrawn ||
        (existing?.origin === InterestOrigin.invited &&
          (existing.status === InterestStatus.declined ||
            existing.status === InterestStatus.cancelled))
      if (existing && !canApplyAgain) {
        throw new ORPCError('BAD_REQUEST', { message: "You've already expressed interest" })
      }

      const { interestType, message = null } = input

      const interest = existing
        ? await prisma.workItemInterest.update({
            where: {
              volunteerId_workItemId: { volunteerId: volunteer.id, workItemId: input.projectId },
            },
            data: {
              interestType,
              message,
              status: InterestStatus.pending,
              origin: InterestOrigin.applied,
              respondedAt: null,
              responseMessage: null,
              invitedById: null,
            },
          })
        : await prisma.workItemInterest.create({
            data: {
              volunteerId: volunteer.id,
              workItemId: input.projectId,
              interestType,
              message,
              status: InterestStatus.pending,
              origin: InterestOrigin.applied,
            },
          })

      await notifyOwnerOfInterest(project, volunteer, interestType, message, interest.id)

      return { message: 'Interest expressed successfully' }
    }),

  /** Leaves a project, or applying to it; given a `taskId`, stops helping on that task. */
  withdrawInterest: authedProcedure
    .input(z.object({ projectId: z.number().int(), taskId: z.number().int().optional() }))
    .use(projectEditable, (input) => input.projectId)
    .use(asProjectAdmin, (input) => input.projectId)
    .handler(async ({ input, context }) => {
      if (input.taskId !== undefined) {
        return leaveTaskAsHelper(input.projectId, input.taskId, context.volunteer)
      }
      const result = await prisma.workItemInterest.updateMany({
        where: {
          workItemId: input.projectId,
          volunteerId: context.volunteer.id,
          status: { in: [InterestStatus.pending, InterestStatus.accepted] },
        },
        data: { status: InterestStatus.withdrawn },
      })
      if (result.count === 0) throw new ORPCError('NOT_FOUND', { message: 'No interest found' })

      await releaseTasksHeldBy(input.projectId, context.volunteer.id, context.volunteer.id)
      await endHelpingOnProject(input.projectId, context.volunteer.id, InterestStatus.withdrawn)
      const project = await prisma.workItem.findFirst({
        where: { id: input.projectId, type: WorkItemType.PROJECT },
        select: { id: true, title: true, assigneeId: true },
      })
      if (project) await endDeputyRole(project, context.volunteer.id, context.volunteer.name)

      return { message: 'Interest withdrawn' }
    }),

  /**
   * The owner accepts, declines or removes someone on a project. Given a `taskId`, the task's
   * lead or a manager removes a helper (`declined`); a manager adds one directly through
   * `addTaskHelper` instead, so accepting here is never valid for a task.
   */
  respondToInterest: authedProcedure
    .input(
      z.object({
        projectId: z.number().int(),
        taskId: z.number().int().optional(),
        interestId: z.number().int(),
        status: z.enum([InterestStatus.accepted, InterestStatus.declined]),
        responseMessage: z.string().optional().nullable(),
      }),
    )
    .use(projectEditable, (input) => input.projectId)
    .use(asProjectAdmin, (input) => input.projectId)
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      if (input.taskId !== undefined) {
        if (input.status === InterestStatus.accepted) {
          throw new ORPCError('BAD_REQUEST', {
            message: 'Helpers join a task themselves; there is nobody to accept',
          })
        }
        return removeTaskHelper(
          input.projectId,
          input.taskId,
          input.interestId,
          volunteer,
          input.responseMessage ?? null,
        )
      }
      const project = await prisma.workItem.findFirst({
        where: { id: input.projectId, type: WorkItemType.PROJECT },
      })
      const isAssignee = project && project.assigneeId === volunteer.id
      if (!project || (!isAssignee && !volunteer.isAdmin)) {
        throw new ORPCError('FORBIDDEN', { message: 'Not authorized' })
      }

      const interest = await prisma.workItemInterest.findFirst({
        where: { id: input.interestId, workItemId: input.projectId },
        include: { volunteer: { select: { approvalStatus: true, name: true } } },
      })
      if (!interest) throw new ORPCError('NOT_FOUND', { message: 'Interest not found' })
      // An invite is the invitee's to answer; only an admin puts someone on a project unasked.
      if (interest.status === InterestStatus.invited) {
        throw new ORPCError('BAD_REQUEST', {
          message: 'They have been invited and have not answered yet. Cancel the invite instead.',
        })
      }
      if (
        input.status === InterestStatus.accepted &&
        interest.volunteer.approvalStatus !== ApprovalStatus.approved
      ) {
        throw new ORPCError('BAD_REQUEST', {
          message: 'Cannot accept interest from a volunteer who is not yet approved',
        })
      }

      // Turning down someone already on the project is a removal, not a decline.
      const status =
        input.status === InterestStatus.declined && interest.status === InterestStatus.accepted
          ? InterestStatus.removed
          : input.status

      await prisma.workItemInterest.update({
        where: { id: input.interestId },
        data: {
          status,
          responseMessage: input.responseMessage ?? null,
          respondedAt: new Date(),
        },
      })

      await clearNotifications('new_interest', input.interestId)

      if (status === InterestStatus.removed) {
        await endDeputyRole(project, interest.volunteerId, interest.volunteer.name)
        await endHelpingOnProject(input.projectId, interest.volunteerId, InterestStatus.removed)
      }

      if (status === InterestStatus.accepted) {
        await assignHeldTasks(input.projectId, interest.volunteerId, volunteer.id)
      } else {
        await releaseTasksHeldBy(input.projectId, interest.volunteerId, volunteer.id)
      }

      // A project that already has an owner changes hands only through a transfer.
      if (
        input.status === InterestStatus.accepted &&
        interest.interestType === 'want_to_own' &&
        project.assigneeId === null
      ) {
        await updateWorkItem(
          project,
          {
            assigneeId: interest.volunteerId,
            // A new owner starts the work, but never carries a proposal past triage.
            ...(UNAPPROVED_STATUSES.includes(project.status)
              ? {}
              : { status: ProjectStatus.in_progress }),
          },
          { actorId: volunteer.id, kind: 'assigned' },
        )
      }

      await notifyUser(
        interest.volunteerId,
        `interest_${status}`,
        status === InterestStatus.removed
          ? `Removed: you're no longer on '${project.title}'`
          : `${status === InterestStatus.accepted ? 'Accepted' : 'Declined'}: your interest in '${project.title}'`,
        input.responseMessage ?? null,
        `/projects/${input.projectId}`,
        {
          message:
            status === InterestStatus.removed
              ? html`The team has taken you off the project <strong>${project.title}</strong>.`
              : html`The team has <strong>${status}</strong> your interest in the project
                  <strong>${project.title}</strong>.`,
          projectTitle: project.title,
          projectId: input.projectId,
          extraHtml: input.responseMessage
            ? html`<div
                style="padding: 12px; background: #f7fafc; border-radius: 8px; margin: 16px 0;"
              >
                <strong>Message:</strong> ${input.responseMessage}
              </div>`
            : undefined,
        },
      )

      return { message: `Interest ${status}` }
    }),

  /**
   * The project owner, a deputy or an admin puts a project member on a task as a helper
   * directly, with no apply-and-accept step. Helpers otherwise join themselves (`expressInterest`).
   */
  addTaskHelper: authedProcedure
    .input(
      z.object({
        projectId: z.number().int(),
        taskId: z.number().int(),
        volunteerId: z.number().int(),
      }),
    )
    .use(projectEditable, (input) => input.projectId)
    .use(asProjectAdmin, (input) => input.projectId)
    .handler(async ({ input, context }) =>
      addTaskHelper(input.projectId, input.taskId, input.volunteerId, context.volunteer),
    ),

  /**
   * The owner or an admin asks a volunteer to help. They are not on the project until they
   * accept. Someone who already applied has said yes, so they are simply accepted.
   */
  invite: authedProcedure
    .input(
      z.object({
        projectId: z.number().int(),
        volunteerId: z.number().int(),
        message: z.string().trim().max(1000).optional().nullable(),
      }),
    )
    .use(projectEditable, (input) => input.projectId)
    .use(asProjectAdmin, (input) => input.projectId)
    .handler(async ({ input, context }) => {
      const inviter = context.volunteer
      const project = await prisma.workItem.findFirst({
        where: { id: input.projectId, type: WorkItemType.PROJECT },
      })
      if (!project) throw new ORPCError('NOT_FOUND', { message: 'Project not found' })
      if (project.assigneeId !== inviter.id && !inviter.isAdmin) {
        throw new ORPCError('FORBIDDEN', {
          message: 'Only the project owner or an admin can invite volunteers',
        })
      }
      if (input.volunteerId === project.assigneeId) {
        throw new ORPCError('BAD_REQUEST', { message: 'They already own this project' })
      }
      const target = await prisma.volunteer.findFirst({
        where: { id: input.volunteerId, deletedAt: null },
      })
      if (!target) throw new ORPCError('BAD_REQUEST', { message: 'Volunteer not found' })
      if (target.approvalStatus !== ApprovalStatus.approved) {
        throw new ORPCError('BAD_REQUEST', {
          message: 'Cannot invite a volunteer who is not yet approved',
        })
      }
      assertInProjectChapter(context.access, target, project)

      const existing = await prisma.workItemInterest.findFirst({
        where: { workItemId: input.projectId, volunteerId: input.volunteerId },
      })
      if (existing?.status === InterestStatus.accepted) {
        throw new ORPCError('BAD_REQUEST', { message: 'They are already on this project' })
      }
      if (existing?.status === InterestStatus.invited) {
        throw new ORPCError('BAD_REQUEST', { message: 'They have already been invited' })
      }
      const link = `/projects/${input.projectId}`

      if (existing?.status === InterestStatus.pending) {
        await prisma.workItemInterest.update({
          where: { id: existing.id },
          data: { status: InterestStatus.accepted, respondedAt: new Date() },
        })
        await clearNotifications('new_interest', existing.id)
        await assignHeldTasks(input.projectId, input.volunteerId, inviter.id)
        await notifyUser(
          input.volunteerId,
          'interest_accepted',
          `Accepted: your interest in '${project.title}'`,
          null,
          link,
        )
        return { message: 'They had already applied, so they are now on the project' }
      }

      const note = input.message || null
      const data = {
        status: InterestStatus.invited,
        origin: InterestOrigin.invited,
        interestType: 'want_to_contribute',
        message: note,
        invitedById: inviter.id,
        respondedAt: null,
        responseMessage: null,
      }
      const interest = existing
        ? await prisma.workItemInterest.update({ where: { id: existing.id }, data })
        : await prisma.workItemInterest.create({
            data: { ...data, volunteerId: input.volunteerId, workItemId: input.projectId },
          })

      await notifyUser(
        input.volunteerId,
        'project_invite',
        `Invited: help on '${project.title}'`,
        note ?? `${inviter.name} would like you to help`,
        link,
        {
          subject: `${inviter.name} invited you to help on '${project.title}'`,
          message: html`<strong>${inviter.name}</strong> has invited you to help on the project
            <strong>${project.title}</strong>. Accept or decline from your Inbox or the project
            page.`,
          projectTitle: project.title,
          projectId: input.projectId,
          extraHtml: note
            ? html`<div
                style="padding: 12px; background: #f7fafc; border-radius: 8px; margin: 16px 0;"
              >
                <strong>Their note:</strong> ${note}
              </div>`
            : undefined,
        },
        interest.id,
      )
      return { message: 'Invite sent' }
    }),

  /** The invited volunteer says yes or no; whoever invited them is told. */
  respondToInvite: authedProcedure
    .input(z.object({ projectId: z.number().int(), accept: z.boolean() }))
    .use(projectEditable, (input) => input.projectId)
    .use(asProjectAdmin, (input) => input.projectId)
    .handler(async ({ input, context }) => {
      const me = context.volunteer
      const interest = await prisma.workItemInterest.findFirst({
        where: {
          workItemId: input.projectId,
          volunteerId: me.id,
          status: InterestStatus.invited,
        },
        include: { workItem: { select: { title: true, assigneeId: true } } },
      })
      if (!interest) throw new ORPCError('NOT_FOUND', { message: 'No invite found' })

      await prisma.workItemInterest.update({
        where: { id: interest.id },
        data: {
          status: input.accept ? InterestStatus.accepted : InterestStatus.declined,
          respondedAt: new Date(),
        },
      })
      await clearNotifications('project_invite', interest.id)

      const tell = interest.invitedById ?? interest.workItem.assigneeId
      if (tell !== null) {
        const title = interest.workItem.title
        notifyUser(
          tell,
          input.accept ? 'invite_accepted' : 'invite_declined',
          input.accept
            ? `Accepted: ${me.name} joined '${title}'`
            : `Declined: ${me.name} won't join '${title}'`,
          null,
          `/projects/${input.projectId}`,
        )
      }
      return { message: input.accept ? "You're on the project" : 'Invite declined' }
    }),

  /** The owner or an admin takes back an invite nobody has answered yet. */
  cancelInvite: authedProcedure
    .input(z.object({ projectId: z.number().int(), interestId: z.number().int() }))
    .use(projectEditable, (input) => input.projectId)
    .use(asProjectAdmin, (input) => input.projectId)
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      const project = await prisma.workItem.findFirst({
        where: { id: input.projectId, type: WorkItemType.PROJECT },
      })
      if (!project || (project.assigneeId !== volunteer.id && !volunteer.isAdmin)) {
        throw new ORPCError('FORBIDDEN', { message: 'Not authorized' })
      }
      const cancelled = await prisma.workItemInterest.updateMany({
        where: {
          id: input.interestId,
          workItemId: input.projectId,
          status: InterestStatus.invited,
        },
        data: { status: InterestStatus.cancelled, respondedAt: new Date() },
      })
      if (cancelled.count === 0) {
        throw new ORPCError('BAD_REQUEST', { message: 'This invite has already been answered' })
      }
      await clearNotifications('project_invite', input.interestId)
      return { message: 'Invite cancelled' }
    }),

  assign: authedProcedure
    .input(
      z.object({
        projectId: z.number().int(),
        volunteerId: z.number().int(),
        interestType: z.string().optional().default('want_to_contribute'),
      }),
    )
    .use(projectEditable, (input) => input.projectId)
    .use(asProjectAdmin, (input) => input.projectId)
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      const project = await prisma.workItem.findFirst({
        where: { id: input.projectId, type: WorkItemType.PROJECT },
      })
      if (!project) throw new ORPCError('NOT_FOUND', { message: 'Project not found' })

      // Owners invite (see `invite`); only an admin puts someone on a project without asking.
      if (!volunteer.isAdmin) {
        throw new ORPCError('FORBIDDEN', {
          message: 'Only an admin can add a volunteer directly; invite them instead',
        })
      }

      const targetVolunteer = await prisma.volunteer.findFirst({
        where: { id: input.volunteerId, deletedAt: null },
      })
      if (!targetVolunteer) throw new ORPCError('BAD_REQUEST', { message: 'Volunteer not found' })
      if (targetVolunteer.approvalStatus !== ApprovalStatus.approved) {
        throw new ORPCError('BAD_REQUEST', {
          message: 'Cannot assign a project to a volunteer who is not yet approved',
        })
      }
      assertInProjectChapter(context.access, targetVolunteer, project)

      // One row per person and project, whatever happened before.
      const existing = await prisma.workItemInterest.findFirst({
        where: { workItemId: input.projectId, volunteerId: input.volunteerId },
      })

      if (existing?.status === InterestStatus.accepted) {
        return { message: 'This volunteer is already assigned to this project' }
      }
      if (existing?.status === InterestStatus.pending) {
        // They applied; the owner said yes.
        await prisma.workItemInterest.update({
          where: { id: existing.id },
          data: { status: InterestStatus.accepted, respondedAt: new Date() },
        })
      } else if (existing) {
        // Declined, removed, withdrawn or invited earlier: this time an admin added them.
        if (existing.status === InterestStatus.invited) {
          await clearNotifications('project_invite', existing.id)
        }
        await prisma.workItemInterest.update({
          where: { id: existing.id },
          data: {
            status: InterestStatus.accepted,
            origin: InterestOrigin.added,
            interestType: input.interestType,
            respondedAt: new Date(),
          },
        })
      } else {
        await prisma.workItemInterest.create({
          data: {
            volunteerId: input.volunteerId,
            workItemId: input.projectId,
            interestType: input.interestType,
            status: InterestStatus.accepted,
            origin: InterestOrigin.added,
            respondedAt: new Date(),
          },
        })
      }

      await assignHeldTasks(input.projectId, input.volunteerId, volunteer.id)

      // Assigning someone as owner has to actually set the owner. This previously only
      // cleared the (now derived) isSeekingOwner flag, leaving the project ownerless and
      // no longer advertising for one — unlike respondToInterest, which took the same
      // intent and did set the assignee.
      if (input.interestType === 'want_to_own' && project.assigneeId === null) {
        await updateWorkItem(
          project,
          {
            assigneeId: input.volunteerId,
            status: ProjectStatus.in_progress,
            updatedAt: new Date(),
          },
          { actorId: volunteer.id, kind: 'assigned' },
        )
      }

      await notifyUser(
        input.volunteerId,
        'assigned_to_project',
        `Assigned: you're on '${project.title}'`,
        `Assigned by ${volunteer.name}`,
        `/projects/${input.projectId}`,
        {
          message: html`<strong>${volunteer.name}</strong> has assigned you to the project
            <strong>${project.title}</strong>.`,
          projectTitle: project.title,
          projectId: input.projectId,
        },
      )

      return { message: 'Volunteer assigned to project' }
    }),

  listTasks: confirmedProcedure
    .input(z.object({ projectId: z.number().int() }))
    .use(asProjectAdmin, (input) => input.projectId)
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer

      // Task visibility follows the project's: without this any approved volunteer could
      // read the task list of a team-restricted or still-unapproved project by id.
      const project = await prisma.workItem.findFirst({
        where: { id: input.projectId, type: WorkItemType.PROJECT },
      })
      if (!project) throw new ORPCError('NOT_FOUND', { message: 'Project not found' })

      if (
        !canViewWorkItem(
          project,
          {
            id: volunteer.id,
            isAdmin: Boolean(volunteer.isAdmin),
            isApproved: volunteer.approvalStatus === ApprovalStatus.approved,
            nationalChapterId: volunteer.nationalChapterId,
          },
          undefined,
          await resolveProjectPrivy(project, volunteer),
        )
      ) {
        throw new ORPCError('NOT_FOUND', { message: 'Project not found' })
      }
      // A hidden timeline stays open to whoever plans the tasks, for replanning from a task page.
      const managesTasks = canManageProjectTasks(
        project,
        volunteer,
        await isProjectDeputy(project.id, volunteer.id),
      )
      if (!project.showTimeline && !managesTasks) {
        throw new ORPCError('FORBIDDEN', { message: "This project's timeline is hidden" })
      }
      const locked = isProjectLocked(project)

      const tasks = await prisma.workItem.findMany({
        where: { parentId: input.projectId, type: WorkItemType.TASK },
        include: {
          assignee: { select: { name: true } },
          creator: { select: { name: true } },
          ...HELPER_COUNT,
        },
      })

      tasks.sort((a, b) => {
        const orderDiff = (TASK_ORDER[a.status] ?? 0) - (TASK_ORDER[b.status] ?? 0)
        if (orderDiff !== 0) return orderDiff
        const sortOrderDiff = (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
        if (sortOrderDiff !== 0) return sortOrderDiff
        return (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)
      })

      const { schedule, origin } = await loadProjectTaskSchedule(project, tasks)
      const today = startOfUtcDay(new Date())

      // Loaded here with the row id so the timeline panel can edit/remove links directly.
      const dependencyRows = await prisma.workItemDependency.findMany({
        where: {
          predecessor: { parentId: input.projectId, type: WorkItemType.TASK },
          successor: { parentId: input.projectId, type: WorkItemType.TASK },
        },
        select: { id: true, predecessorId: true, successorId: true, lagDays: true },
      })

      const views = taskStatusViews(tasks, dependencyRows)

      return {
        tasks: tasks.map((t, i) => ({
          ...serializeTask(t),
          ...views[i],
          assignedToName: t.assignee?.name ?? null,
          createdByName: t.creator?.name ?? null,
          helperCount: t._count.interests,
          sortOrder: t.sortOrder,
        })),
        dependencies: dependencyRows,
        // The Map in `schedule` doesn't cross the wire; the array is keyed by `id`.
        scheduled: schedule.scheduled,
        // The origin is where *derived* tasks begin counting from — today, for a project with
        // no pinned start. A task pinned earlier than that still has to fit on the axis, so the
        // scope runs from whichever comes first.
        scopeStart: schedule.start.getTime() < origin.getTime() ? schedule.start : origin,
        // A plan that ended before today still has to show today, so the Today line and the
        // work still running past its bars stay on the axis.
        scopeEnd: schedule.end.getTime() < today.getTime() ? today : schedule.end,
        // Sent so the client can recompute this exact schedule while a drag is in flight.
        scopeOrigin: origin,
        projectDeadline: project.deadline,
        canSetKeyDate: !locked && canManageProject(project, volunteer),
        canManageTasks: !locked && managesTasks,
        canCreateTasks:
          !locked &&
          canCreateProjectTask(
            project,
            volunteer,
            await resolveProjectMembership(project.teamId, project.id, volunteer.id),
          ),
      }
    }),

  getTask: confirmedProcedure
    .input(z.object({ projectId: z.number().int(), taskId: z.number().int() }))
    .use(asProjectAdmin, (input) => input.projectId)
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer

      const project = await prisma.workItem.findFirst({
        where: { id: input.projectId, type: WorkItemType.PROJECT },
      })
      if (!project) throw new ORPCError('NOT_FOUND', { message: 'Project not found' })

      const task = await prisma.workItem.findFirst({
        where: { id: input.taskId, parentId: input.projectId, type: WorkItemType.TASK },
        include: {
          assignee: { select: { name: true } },
          creator: { select: { name: true } },
          reviewedBy: { select: { name: true } },
          requestedBy: { select: { name: true } },
        },
      })
      if (!task) throw new ORPCError('NOT_FOUND', { message: 'Task not found' })

      if (
        !canViewWorkItem(
          task,
          {
            id: volunteer.id,
            isAdmin: Boolean(volunteer.isAdmin),
            isApproved: volunteer.approvalStatus === ApprovalStatus.approved,
            nationalChapterId: volunteer.nationalChapterId,
          },
          project,
          await resolveProjectPrivy(project, volunteer),
        )
      ) {
        throw new ORPCError('NOT_FOUND', { message: 'Task not found' })
      }

      const locked = isProjectLocked(project)
      const canClaim =
        !locked &&
        (project.assigneeId === volunteer.id ||
          Boolean(volunteer.isAdmin) ||
          !(await isBlockedFromClaiming(input.projectId, volunteer.id)))

      const predecessorRows = await prisma.workItemDependency.findMany({
        where: { successorId: input.taskId },
        include: { predecessor: { select: { id: true, title: true, status: true } } },
        orderBy: { id: 'asc' },
      })

      // Where the plan puts this task. One that is not on the timeline has no placement.
      const placement = taskIsDated(task, predecessorRows.length > 0)
        ? ((
            await loadProjectTaskSchedule(
              project,
              await prisma.workItem.findMany({
                where: { parentId: input.projectId, type: WorkItemType.TASK },
              }),
            )
          ).schedule.byId.get(task.id) ?? null)
        : null

      const manages = canManageProjectTasks(
        project,
        volunteer,
        await isProjectDeputy(project.id, volunteer.id),
      )
      const successorIds = (
        await prisma.workItemDependency.findMany({
          where: { predecessorId: input.taskId },
          select: { successorId: true },
          orderBy: { id: 'asc' },
        })
      ).map((r) => r.successorId)
      const predecessorIds = predecessorRows.map((r) => r.predecessorId)
      const summaries = await loadWorkItemSummaries([...predecessorIds, ...successorIds], volunteer)
      const visibleSummaries = (ids: number[]) =>
        ids.flatMap((id) => {
          const item = summaries.get(id)
          return item ? [item] : []
        })
      // A reviewer's request for changes is between them and the assignee.
      const changesRequested =
        task.changesRequestedNote !== null && (manages || task.assigneeId === volunteer.id)
          ? {
              message: task.changesRequestedNote,
              byName: task.reviewedBy
                ? actorLabel(
                    task.reviewedBy,
                    task.reviewedById !== null &&
                      task.reviewedById !== project.assigneeId &&
                      (await isProjectDeputy(project.id, task.reviewedById)),
                  )
                : null,
            }
          : null

      const helpers = await loadTaskHelpers(task.id)
      const claimViewer = await resolveClaimViewer(project, volunteer)
      const myHelperRow = await prisma.workItemInterest.findFirst({
        where: { workItemId: task.id, volunteerId: volunteer.id },
        select: { status: true },
      })
      const isHelper = myHelperRow?.status === InterestStatus.accepted
      // Joining, leaving and removing helpers stop once the task is handed in (joinTaskAsHelper).
      const takesHelpers = !locked && !handedIn(task.status)
      const canJoinAsHelper =
        takesHelpers &&
        task.helpersWanted !== null &&
        helpers.length < task.helpersWanted &&
        task.assigneeId !== volunteer.id &&
        claimViewer.onProject &&
        myHelperRow?.status !== InterestStatus.accepted &&
        myHelperRow?.status !== InterestStatus.removed
      const canAddHelpers =
        takesHelpers &&
        manages &&
        task.helpersWanted !== null &&
        helpers.length < task.helpersWanted
      const helperIds = new Set(helpers.map((h) => h.volunteerId))
      const eligibleHelpers = canAddHelpers
        ? (
            await prisma.workItemInterest.findMany({
              where: { workItemId: input.projectId, status: InterestStatus.accepted },
              include: { volunteer: { select: { id: true, name: true } } },
              orderBy: { volunteer: { name: 'asc' } },
            })
          )
            .map((r) => r.volunteer)
            .filter((v) => v.id !== task.assigneeId && !helperIds.has(v.id))
        : []

      return {
        ...serializeTask(task),
        ...taskDisplayStatus(
          task,
          predecessorRows.map((r) => r.predecessor),
        ),
        viewerCanAdmin: Boolean(volunteer.isAdmin),
        helpers,
        isHelper,
        canJoinAsHelper,
        canLeaveAsHelper: takesHelpers && isHelper,
        canRemoveHelpers: takesHelpers && (task.assigneeId === volunteer.id || manages),
        canAddHelpers,
        eligibleHelpers,
        changesRequested,
        autoAcceptTasks: project.autoAcceptTasks,
        projectTitle: project.title,
        projectOwnerId: project.assigneeId,
        projectStatus: project.status,
        projectCompletedAt: project.completedAt,
        canClaim,
        claimViewer,
        canManage: !locked && manages,
        assignedToName: task.assignee?.name ?? null,
        assigneeContactable:
          task.assigneeId !== null && (await canReach(volunteer, context.access, task.assigneeId)),
        createdByName: task.creator?.name ?? null,
        requestedByName: task.requestedBy?.name ?? null,
        featuredAsQuickTask: task.featuredAsQuickTask ?? false,
        waitsOn: visibleSummaries(predecessorIds),
        unblocks: visibleSummaries(successorIds),
        placement,
        pastPlanDays: placement
          ? daysPastPlan(placement.end, {
              done: task.status === TaskStatus.completed,
              assigned: task.assigneeId !== null,
            })
          : null,
        // The key date is the owner's, not a deputy's (the update enforces the same).
        canSetKeyDate: !locked && canManageProject(project, volunteer),
      }
    }),

  createTask: approvedProcedure
    .input(z.object({ projectId: z.number().int() }).merge(CreateProjectTaskSchema))
    .use(projectEditable, (input) => input.projectId)
    .use(asProjectAdmin, (input) => input.projectId)
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      const project = await prisma.workItem.findFirst({
        where: { id: input.projectId, type: WorkItemType.PROJECT },
      })
      if (!project) throw new ORPCError('NOT_FOUND', { message: 'Project not found' })

      const isMember = await resolveProjectMembership(project.teamId, project.id, volunteer.id)
      if (!canCreateProjectTask(project, volunteer, isMember)) {
        throw new ORPCError('FORBIDDEN', {
          message: 'Only project owner, admin, or a project member can create tasks',
        })
      }

      // Dates given at creation are a sketch; the baseline is set deliberately, later.
      const scheduleOnCreate: Record<string, unknown> = {}
      applyScheduleWrite(scheduleOnCreate, {
        startDate: input.startDate ?? null,
        durationDays: input.durationDays ?? null,
        taskDeadline: input.deadline ?? null,
      })

      const task = await prisma.$transaction(async (tx) => {
        const max = await tx.workItem.aggregate({
          where: { parentId: input.projectId, type: WorkItemType.TASK },
          _max: { sortOrder: true },
        })
        const newTask = await tx.workItem.create({
          data: {
            type: WorkItemType.TASK,
            status: TaskStatus.not_started,
            parentId: input.projectId,
            title: input.title,
            description: input.description ?? null,
            estimatedHours: input.estimatedHours ?? null,
            featuredAsQuickTask: input.featuredAsQuickTask ?? false,
            submissionPrompt: input.submissionPrompt ?? null,
            submissionAsksLink: input.submissionAsksLink ?? false,
            helpersWanted: input.helpersWanted ?? null,
            timing: input.timing ?? TaskTiming.flexible,
            creatorId: volunteer.id,
            sortOrder: (max._max.sortOrder ?? 0) + 1,
            ...scheduleOnCreate,
          },
        })
        return newTask
      })
      await clearNotifications(READY_TO_COMPLETE, project.id)

      return { id: task.id, message: 'Task created' }
    }),

  reorderTasks: approvedProcedure
    .input(
      z.object({
        projectId: z.number().int(),
        items: z.array(z.object({ id: z.number().int(), sortOrder: z.number().int() })),
      }),
    )
    .use(projectEditable, (input) => input.projectId)
    .use(asProjectAdmin, (input) => input.projectId)
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      const project = await prisma.workItem.findFirst({
        where: { id: input.projectId, type: WorkItemType.PROJECT },
      })
      if (!project) throw new ORPCError('NOT_FOUND', { message: 'Project not found' })

      if (
        !canManageProjectTasks(project, volunteer, await isProjectDeputy(project.id, volunteer.id))
      ) {
        throw new ORPCError('FORBIDDEN', {
          message: 'Only the project owner, a deputy or an admin can reorder tasks',
        })
      }

      await prisma.$transaction(
        input.items.map(({ id, sortOrder }) =>
          prisma.workItem.updateMany({
            where: { id, parentId: input.projectId, type: WorkItemType.TASK },
            data: { sortOrder },
          }),
        ),
      )

      return { success: true }
    }),

  /**
   * Re-baseline: copy the current schedule onto the baseline track. This is the only thing
   * that moves a baseline after it is first captured, so the plan-vs-actual comparison stays
   * anchored to a deliberate commitment. Skips items with no current schedule.
   */
  setBaseline: approvedProcedure
    .input(
      z.object({ projectId: z.number().int(), includeTasks: z.boolean().optional().default(true) }),
    )
    .use(projectEditable, (input) => input.projectId)
    .use(asProjectAdmin, (input) => input.projectId)
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      const project = await prisma.workItem.findFirst({
        where: { id: input.projectId, type: WorkItemType.PROJECT },
      })
      if (!project) throw new ORPCError('NOT_FOUND', { message: 'Project not found' })
      assertCanManageProject(project, volunteer, 'Only project owner or admin can re-baseline')

      const targets = [
        project,
        ...(input.includeTasks
          ? await prisma.workItem.findMany({
              where: { parentId: input.projectId, type: WorkItemType.TASK },
            })
          : []),
      ]
      const now = new Date()
      await prisma.$transaction(async (tx) => {
        for (const t of targets) {
          if (t.startDate === null && t.durationDays === null) continue
          const data = {
            baselineStartDate: t.startDate,
            baselineDurationDays: baselineLength(t),
            baselineSetAt: now,
          }
          await tx.workItem.update({ where: { id: t.id }, data })
          await recordChange(tx, { row: t, data, actorId: volunteer.id, kind: 'baseline' })
        }
      })
      return { message: 'Baseline updated' }
    }),

  /**
   * Portfolio roadmap, for overseeing a chapter's work: one placed bar per visible project,
   * plus the project-to-project edges between them. Defaults to active statuses;
   * completed/archived are opt-in via `statuses`. Reuses the scope rule from `list`, so a
   * chapter's staff see their own chapter and a team-tagged project stays hidden from non-members.
   */
  ganttOverview: staffProcedure
    .input(
      z.object({
        statuses: z.array(z.string()).optional(),
        teamId: z.number().int().optional(),
        chapter: z.union([z.number().int(), z.literal('pool')]).optional(),
        localGroupId: z.number().int().optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      const statuses =
        input.statuses && input.statuses.length > 0
          ? input.statuses
          : [ProjectStatus.ready, ProjectStatus.in_progress, ProjectStatus.on_hold]

      const visible = await prisma.workItem.findMany({
        where: {
          type: WorkItemType.PROJECT,
          status: { in: statuses },
          ...(input.teamId ? { teamId: input.teamId } : {}),
          ...chapterNarrowing(context.access, input.chapter),
          ...(input.localGroupId ? { localGroupId: input.localGroupId } : {}),
          AND: [projectScopeWhere(volunteer)],
        },
        select: { id: true, title: true, status: true },
      })

      const visibleIds = visible.map((p) => p.id)
      const allEdges = await loadProjectEdges()
      const edges = allEdges.filter(
        (e) => visibleIds.includes(e.predecessorId) && visibleIds.includes(e.successorId),
      )
      const schedule = await scheduleProjectsByIds(visibleIds, edges)

      // Task counts in one grouped query.
      const counts = await prisma.workItem.groupBy({
        by: ['parentId'],
        where: { type: WorkItemType.TASK, parentId: { in: visibleIds } },
        _count: { _all: true },
      })
      const countByProject = new Map(counts.map((c) => [c.parentId, c._count._all]))

      return {
        projects: visible.map((p) => ({
          id: p.id,
          title: p.title,
          status: p.status,
          taskCount: countByProject.get(p.id) ?? 0,
          placement: schedule.byId.get(p.id) ?? null,
        })),
        dependencies: edges,
        scopeStart: schedule.start,
        scopeEnd: schedule.end,
      }
    }),

  updateTask: approvedProcedure
    .input(
      z.object({
        projectId: z.number().int(),
        taskId: z.number().int(),
        data: UpdateProjectTaskSchema,
      }),
    )
    .use(projectEditable, (input) => input.projectId)
    .use(asProjectAdmin, (input) => input.projectId)
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer

      const [project, task] = await Promise.all([
        prisma.workItem.findFirst({ where: { id: input.projectId, type: WorkItemType.PROJECT } }),
        prisma.workItem.findFirst({
          where: { id: input.taskId, parentId: input.projectId, type: WorkItemType.TASK },
        }),
      ])

      if (!project || !task)
        throw new ORPCError('NOT_FOUND', { message: 'Project or task not found' })

      const isAssignee =
        project.assigneeId === volunteer.id || (await isProjectDeputy(project.id, volunteer.id))

      const newStatus = input.data.status
      const newAssigneeId = input.data.assigneeId
      // Every editable field except status/assigneeId must be listed here. A field missing
      // from this check would ride along on the self-claim path below, letting any volunteer
      // who can claim the task edit it too.
      const onlyTouchesStatusAndAssignee =
        input.data.title === undefined &&
        input.data.description === undefined &&
        input.data.estimatedHours === undefined &&
        input.data.deadline === undefined &&
        input.data.featuredAsQuickTask === undefined &&
        input.data.submissionPrompt === undefined &&
        input.data.submissionAsksLink === undefined &&
        input.data.helpersWanted === undefined &&
        input.data.isAnchor === undefined &&
        input.data.timing === undefined &&
        input.data.startDate === undefined &&
        input.data.durationDays === undefined
      // Claiming sets the assignee only; the work starts when they press Start or post.
      const isSelfClaim =
        onlyTouchesStatusAndAssignee &&
        newStatus === undefined &&
        newAssigneeId === volunteer.id &&
        task.status === TaskStatus.not_started &&
        task.assigneeId === null

      const isDraftCreator =
        project.creatorId === volunteer.id && project.status === ProjectStatus.draft
      if (!isAssignee && !volunteer.isAdmin && !isSelfClaim && !isDraftCreator) {
        throw new ORPCError('FORBIDDEN', { message: 'Not authorized to update this task' })
      }
      assertTaskEditable(task)

      if (input.data.isAnchor !== undefined && !canManageProject(project, volunteer)) {
        throw new ORPCError('FORBIDDEN', { message: 'Only the project owner can set the key date' })
      }

      if (isSelfClaim && !isAssignee && !volunteer.isAdmin) {
        if (await isBlockedFromClaiming(input.projectId, volunteer.id)) {
          throw new ORPCError('FORBIDDEN', {
            message:
              'You are no longer contributing to this project, so you cannot claim its tasks',
          })
        }
        if (!(await canReachProject(project, volunteer))) {
          throw new ORPCError('NOT_FOUND', { message: 'Project or task not found' })
        }
        const interest = await prisma.workItemInterest.findFirst({
          where: { workItemId: input.projectId, volunteerId: volunteer.id },
        })
        if (interest?.status === InterestStatus.invited) {
          // Claiming answers the invite: they have said yes.
          await prisma.workItemInterest.update({
            where: { id: interest.id },
            data: { status: InterestStatus.accepted, respondedAt: new Date() },
          })
          await clearNotifications('project_invite', interest.id)
        } else if (!(await resolveProjectMembership(project.teamId, project.id, volunteer.id))) {
          // Not on the project yet: ask the owner, and hold the task until they answer.
          await prisma.$transaction(async (tx) => {
            const data = { requestedById: volunteer.id, updatedAt: new Date() }
            const held = await tx.workItem.updateMany({
              where: {
                id: input.taskId,
                status: TaskStatus.not_started,
                assigneeId: null,
                requestedById: null,
              },
              data,
            })
            if (held.count === 0) {
              throw new ORPCError('BAD_REQUEST', { message: 'This task has already been claimed' })
            }
            await recordChange(tx, { row: task, data, actorId: volunteer.id, kind: 'requested' })
          })
          if (interest?.status !== InterestStatus.pending) {
            const message = `Asked to take '${task.title}'`
            const request = {
              interestType: 'want_to_contribute',
              message,
              status: InterestStatus.pending,
              origin: InterestOrigin.applied,
              respondedAt: null,
              responseMessage: null,
              invitedById: null,
            }
            const row = interest
              ? await prisma.workItemInterest.update({ where: { id: interest.id }, data: request })
              : await prisma.workItemInterest.create({
                  data: { ...request, volunteerId: volunteer.id, workItemId: input.projectId },
                })
            await notifyOwnerOfInterest(project, volunteer, 'want_to_contribute', message, row.id)
          }
          return { message: 'Task requested', requested: true }
        }
      }

      const now = new Date()
      const data: Record<string, unknown> = {}
      let releasedFrom: number | null = null
      if (input.data.title !== undefined) data.title = input.data.title
      if (input.data.description !== undefined) data.description = input.data.description
      if (input.data.estimatedHours !== undefined) data.estimatedHours = input.data.estimatedHours
      if (input.data.featuredAsQuickTask !== undefined)
        data.featuredAsQuickTask = input.data.featuredAsQuickTask
      if (input.data.submissionPrompt !== undefined)
        data.submissionPrompt = input.data.submissionPrompt
      if (input.data.submissionAsksLink !== undefined)
        data.submissionAsksLink = input.data.submissionAsksLink
      if (input.data.helpersWanted !== undefined) data.helpersWanted = input.data.helpersWanted
      if (input.data.isAnchor !== undefined) data.isAnchor = input.data.isAnchor
      if (input.data.timing !== undefined) data.timing = input.data.timing
      applyScheduleWrite(data, { ...input.data, taskDeadline: input.data.deadline })
      if (input.data.assigneeId !== undefined) {
        data.assigneeId = input.data.assigneeId
        if (input.data.assigneeId === null) data.claimedAt = null
        else if (input.data.assigneeId !== task.assigneeId) data.claimedAt = now
      }
      if (input.data.status !== undefined) {
        data.status = input.data.status
        if (input.data.status === TaskStatus.completed) data.completedAt = now
        else if (input.data.status === TaskStatus.in_progress) {
          // Actual start, recorded once. Re-entering in_progress after a pause keeps the
          // original date — the work did start then.
          if (task.startedAt === null) data.startedAt = now
        } else if (input.data.status === TaskStatus.not_started) {
          // Back to nobody's, unstarted: the actuals and any submission describe work that is
          // no longer claimed.
          releasedFrom = task.assigneeId
          Object.assign(data, RELEASED_TASK)
        }
      }
      data.updatedAt = now
      data.nudgeSentAt = null
      data.finalWarningSentAt = null

      await prisma.$transaction(async (tx) => {
        if (isSelfClaim) {
          // Two volunteers hitting claim at once must not both win — only the update that
          // still sees the task open and unheld takes it.
          const claimed = await tx.workItem.updateMany({
            where: {
              id: input.taskId,
              status: TaskStatus.not_started,
              assigneeId: null,
              requestedById: null,
            },
            data,
          })
          if (claimed.count === 0) {
            throw new ORPCError('BAD_REQUEST', { message: 'This task has already been claimed' })
          }
        } else {
          await tx.workItem.update({ where: { id: input.taskId }, data })
        }
        await recordChange(tx, { row: task, data, actorId: volunteer.id })
      })
      if (data.status === TaskStatus.completed) await askOwnerToComplete(project.id)
      if (typeof data.assigneeId === 'number') await stopHelpingAsLead(task.id, data.assigneeId)

      if (isSelfClaim) {
        const existingInterest = await prisma.workItemInterest.findFirst({
          where: { workItemId: input.projectId, volunteerId: volunteer.id },
        })
        if (!existingInterest) {
          await prisma.workItemInterest.create({
            data: {
              volunteerId: volunteer.id,
              workItemId: input.projectId,
              interestType: 'want_to_contribute',
              status: InterestStatus.accepted,
              respondedAt: new Date(),
              message: `${volunteer.name} has claimed '${task.title}' task`,
            },
          })
        }
      }

      if (releasedFrom !== null && releasedFrom !== volunteer.id) {
        await tellPreviousAssignee(task, null, 'released')
        await clearNotifications('task_needs_decision', task.id)
      }

      return { message: 'Task updated', requested: false }
    }),

  /** The assignee says they have begun. Allowed while Blocked too: prep can start early. */
  startTask: approvedProcedure
    .input(z.object({ projectId: z.number().int(), taskId: z.number().int() }))
    .use(projectEditable, (input) => input.projectId)
    .use(asProjectAdmin, (input) => input.projectId)
    .handler(async ({ input, context }) => {
      const { task } = await findProjectTask(input.projectId, input.taskId)
      if (task.assigneeId !== context.volunteer.id) {
        throw new ORPCError('FORBIDDEN', {
          message: 'Only the person doing this task can start it',
        })
      }
      if (task.status !== TaskStatus.not_started) {
        throw new ORPCError('BAD_REQUEST', { message: 'This task has already started' })
      }
      await updateWorkItem(
        task,
        { ...startWorkData(task), updatedAt: new Date() },
        { actorId: context.volunteer.id, kind: 'started' },
      )
      return { message: 'Task started' }
    }),

  /**
   * The assignee hands in their work. It waits for the owner as Submitted for review, unless
   * the project auto-accepts, has no owner to review it, or the submitter could accept it.
   */
  submitTask: approvedProcedure
    .input(
      z.object({ projectId: z.number().int(), taskId: z.number().int() }).merge(SubmitWorkSchema),
    )
    .use(projectEditable, (input) => input.projectId)
    .use(asProjectAdmin, (input) => input.projectId)
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      const { project, task } = await findProjectTask(input.projectId, input.taskId)
      if (task.assigneeId !== volunteer.id) {
        throw new ORPCError('FORBIDDEN', {
          message: 'Only the person doing this task can submit it',
        })
      }
      if (task.status !== TaskStatus.in_progress && task.status !== TaskStatus.not_started) {
        throw new ORPCError('BAD_REQUEST', { message: 'This task has already been submitted' })
      }
      const submission = submissionData(input)
      if (!submission) {
        throw new ORPCError('BAD_REQUEST', { message: 'Say what you did or add a link to it' })
      }

      const reviewerId = project.assigneeId
      const accepted = !awaitsOwnerReview(
        { autoAcceptTasks: project.autoAcceptTasks, ownerId: reviewerId },
        canManageProjectTasks(project, volunteer, await isProjectDeputy(project.id, volunteer.id)),
      )
      await updateWorkItem(
        task,
        {
          // Handing it in without pressing Start still records when the work began.
          ...startWorkData(task, submission.submittedAt),
          ...submission,
          status: accepted ? TaskStatus.completed : TaskStatus.under_review,
          ...(accepted ? { completedAt: submission.submittedAt } : {}),
          updatedAt: new Date(),
          nudgeSentAt: null,
          finalWarningSentAt: null,
        },
        { actorId: volunteer.id, kind: 'submitted' },
      )
      await clearNotifications('task_changes_requested', task.id)
      if (accepted) await askOwnerToComplete(project.id)

      const link = `/projects/${project.id}/tasks/${task.id}`
      const said = submission.submissionNote ?? submission.submissionUrl
      if (accepted) {
        await tellHelpers(task, volunteer.id, 'task_done', `Done: '${task.title}'`, null)
        if (reviewerId !== null && reviewerId !== volunteer.id) {
          notifyUser(
            reviewerId,
            'task_done',
            `Done: '${task.title}'`,
            `${volunteer.name}: ${said}`,
            link,
          )
        }
      } else {
        const reviewers = [
          ...(reviewerId === null ? [] : [reviewerId]),
          ...(await deputyIdsOf(project.id)),
        ].filter((id) => id !== volunteer.id)
        for (const id of new Set(reviewers)) {
          await notifyUser(
            id,
            'task_submitted',
            `Submitted for review: '${task.title}'`,
            `${volunteer.name}: ${said}`,
            link,
            {
              message: html`${volunteer.name} submitted the task <strong>${task.title}</strong> on
                <strong>${project.title}</strong> for your review.`,
              projectTitle: project.title,
              projectId: project.id,
            },
            task.id,
          )
        }
      }

      return {
        message: accepted ? 'Task done' : 'Task submitted for review',
        status: accepted ? TaskStatus.completed : TaskStatus.under_review,
      }
    }),

  acceptTask: approvedProcedure
    .input(z.object({ projectId: z.number().int(), taskId: z.number().int() }))
    .use(projectEditable, (input) => input.projectId)
    .use(asProjectAdmin, (input) => input.projectId)
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      const { task, isDeputy } = await findTaskToReview(input.projectId, input.taskId, volunteer)
      const now = new Date()
      await updateWorkItem(
        task,
        {
          status: TaskStatus.completed,
          completedAt: now,
          reviewedById: volunteer.id,
          reviewedAt: now,
          changesRequestedNote: null,
          updatedAt: now,
        },
        { actorId: volunteer.id, kind: 'accepted', extra: deputyContext(isDeputy) },
      )
      await clearNotifications('task_submitted', task.id)
      await askOwnerToComplete(input.projectId)
      await tellHelpers(task, volunteer.id, 'task_done', `Done: '${task.title}'`, null)
      if (task.assigneeId !== null) {
        notifyUser(
          task.assigneeId,
          'task_accepted',
          `Accepted: '${task.title}'`,
          `${actorLabel(volunteer, isDeputy)} accepted your work`,
          `/projects/${input.projectId}/tasks/${task.id}`,
        )
      }
      return { message: 'Task accepted' }
    }),

  requestTaskChanges: approvedProcedure
    .input(
      z
        .object({ projectId: z.number().int(), taskId: z.number().int() })
        .merge(RequestChangesSchema),
    )
    .use(projectEditable, (input) => input.projectId)
    .use(asProjectAdmin, (input) => input.projectId)
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      const { task, isDeputy } = await findTaskToReview(input.projectId, input.taskId, volunteer)
      const now = new Date()
      await updateWorkItem(
        task,
        {
          status: TaskStatus.in_progress,
          changesRequestedNote: input.message,
          reviewedById: volunteer.id,
          reviewedAt: now,
          updatedAt: now,
        },
        { actorId: volunteer.id, kind: 'changes_requested', extra: deputyContext(isDeputy) },
      )
      await clearNotifications('task_submitted', task.id)
      if (task.assigneeId !== null) {
        notifyUser(
          task.assigneeId,
          'task_changes_requested',
          isDeputy
            ? `Changes requested by ${actorLabel(volunteer, isDeputy)}: '${task.title}'`
            : `Changes requested: '${task.title}'`,
          input.message,
          `/projects/${input.projectId}/tasks/${task.id}`,
          undefined,
          task.id,
        )
      }
      return { message: 'Changes requested' }
    }),

  /**
   * The owner, a deputy or an admin takes back a done or handed-in task: In progress for whoever
   * holds it, Not started when nobody does. Says so in its Discussion and tells the assignee.
   */
  reopenTask: approvedProcedure
    .input(z.object({ projectId: z.number().int(), taskId: z.number().int() }))
    .use(projectEditable, (input) => input.projectId)
    .use(asProjectAdmin, (input) => input.projectId)
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      const { project, task } = await findProjectTask(input.projectId, input.taskId)
      const isDeputy = await isProjectDeputy(project.id, volunteer.id)
      if (!canManageProjectTasks(project, volunteer, isDeputy)) {
        throw new ORPCError('FORBIDDEN', {
          message: 'Only the project owner, a deputy or an admin can reopen a task',
        })
      }

      const status = task.assigneeId === null ? TaskStatus.not_started : TaskStatus.in_progress
      const now = new Date()
      const data = {
        status,
        completedAt: null,
        reviewedById: null,
        reviewedAt: null,
        changesRequestedNote: null,
        // Its holder keeps what they handed in, as when changes are requested; a task nobody
        // holds forgets it, as a released one does.
        ...(status === TaskStatus.in_progress
          ? { startedAt: task.startedAt ?? now }
          : { ...CLEARED_SUBMISSION, startedAt: null }),
        updatedAt: now,
        nudgeSentAt: null,
        finalWarningSentAt: null,
      }
      await prisma.$transaction(async (tx) => {
        const reopened = await tx.workItem.updateMany({
          where: { id: task.id, status: { in: [TaskStatus.completed, TaskStatus.under_review] } },
          data,
        })
        if (reopened.count === 0) {
          throw new ORPCError('BAD_REQUEST', { message: 'This task is not done' })
        }
        await recordChange(tx, {
          row: task,
          data,
          actorId: volunteer.id,
          kind: 'reopened',
          extra: deputyContext(isDeputy),
        })
      })
      await clearNotifications('task_submitted', task.id)
      await clearNotifications(READY_TO_COMPLETE, project.id)

      const who = actorLabel(volunteer, isDeputy)
      if (task.assigneeId !== null && task.assigneeId !== volunteer.id) {
        await notifyUser(
          task.assigneeId,
          'task_reopened',
          `Reopened: '${task.title}'`,
          `${who} reopened it, so it is back on your list.`,
          `/projects/${project.id}/tasks/${task.id}`,
          undefined,
          task.id,
        )
      }
      await tellHelpers(
        task,
        volunteer.id,
        'task_reopened',
        `Reopened: '${task.title}'`,
        `${who} reopened it.`,
      )
      return { message: 'Task reopened', status }
    }),

  assignTask: approvedProcedure
    .input(
      z.object({
        projectId: z.number().int(),
        taskId: z.number().int(),
        assigneeId: z.number().int(),
      }),
    )
    .use(projectEditable, (input) => input.projectId)
    .use(asProjectAdmin, (input) => input.projectId)
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      const [project, task] = await Promise.all([
        prisma.workItem.findFirst({ where: { id: input.projectId, type: WorkItemType.PROJECT } }),
        prisma.workItem.findFirst({
          where: { id: input.taskId, parentId: input.projectId, type: WorkItemType.TASK },
        }),
      ])
      if (!project || !task)
        throw new ORPCError('NOT_FOUND', { message: 'Project or task not found' })

      const isDeputy = await isProjectDeputy(project.id, volunteer.id)
      if (project.assigneeId !== volunteer.id && !volunteer.isAdmin && !isDeputy) {
        throw new ORPCError('FORBIDDEN', {
          message: 'Only the project owner, a deputy or an admin can assign',
        })
      }
      assertTaskEditable(task)

      const assignee = await prisma.volunteer.findFirst({
        where: { id: input.assigneeId, deletedAt: null },
      })
      if (!assignee) throw new ORPCError('BAD_REQUEST', { message: 'Volunteer not found' })
      if (assignee.approvalStatus !== ApprovalStatus.approved) {
        throw new ORPCError('BAD_REQUEST', {
          message: 'Cannot assign a task to a volunteer who is not yet approved',
        })
      }

      // Assigning sets who holds it, not how far the work has got: work in flight stays started.
      const now = new Date()
      await updateWorkItem(
        task,
        {
          assigneeId: input.assigneeId,
          requestedById: null,
          ...(input.assigneeId !== task.assigneeId ? { claimedAt: now } : {}),
          updatedAt: now,
          nudgeSentAt: null,
          finalWarningSentAt: null,
        },
        { actorId: volunteer.id, extra: deputyContext(isDeputy) },
      )
      await stopHelpingAsLead(task.id, input.assigneeId)

      await notifyUser(
        input.assigneeId,
        'task_assigned',
        isDeputy
          ? `Assigned by ${actorLabel(volunteer, isDeputy)}: a task on '${project.title}'`
          : `Assigned: a task on '${project.title}'`,
        task.title,
        `/projects/${input.projectId}`,
        {
          message: html`You've been assigned the task <strong>${task.title}</strong> on the project
            <strong>${project.title}</strong>.`,
          projectTitle: project.title,
          projectId: input.projectId,
        },
      )
      await tellPreviousAssignee(task, input.assigneeId, 'reassigned')
      await clearNotifications('task_needs_decision', task.id)

      return { message: 'Task assigned' }
    }),

  /**
   * The owner (or a deputy, or an admin) moves the deadline of a task that has run past its
   * plan, and its start with it. Never touches the dependencies; says
   * why in the task's Discussion; tells the assignee and everyone whose task moved with it.
   */
  replanTask: approvedProcedure
    .input(
      z.object({
        projectId: z.number().int(),
        taskId: z.number().int(),
        newEnd: z.coerce.date(),
        /** Only when the work turned out bigger or smaller; the length is kept otherwise. */
        durationDays: z.number().int().min(0).max(3650).optional(),
        reason: z.string().trim().min(1, { message: 'Say why the plan is changing' }).max(500),
      }),
    )
    .use(projectEditable, (input) => input.projectId)
    .use(asProjectAdmin, (input) => input.projectId)
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      const project = await prisma.workItem.findFirst({
        where: { id: input.projectId, type: WorkItemType.PROJECT },
      })
      if (!project) throw new ORPCError('NOT_FOUND', { message: 'Project not found' })
      const isDeputy = await isProjectDeputy(project.id, volunteer.id)
      if (!canManageProjectTasks(project, volunteer, isDeputy)) {
        throw new ORPCError('FORBIDDEN', {
          message: 'Only the project owner, a deputy or an admin can replan a task',
        })
      }

      const tasks = await prisma.workItem.findMany({
        where: { parentId: input.projectId, type: WorkItemType.TASK },
        include: { assignee: { select: { name: true } } },
      })
      const index = tasks.findIndex((t) => t.id === input.taskId)
      if (index < 0) throw new ORPCError('NOT_FOUND', { message: 'Task not found' })
      const task = tasks[index]
      assertTaskEditable(task)

      const { schedule, edges, origin } = await loadProjectTaskSchedule(project, tasks)
      const write = replanWrite(schedule.scheduled[index], input.newEnd, input.durationDays)
      const preview = previewReplan(tasks.map(toTaskScheduleInput), edges, origin, task.id, write)

      const data: Record<string, unknown> = { updatedAt: new Date() }
      applyScheduleWrite(data, write)
      // Recorded even if the dates come out unchanged: the reason is worth keeping.
      await prisma.$transaction(async (tx) => {
        await tx.workItem.update({ where: { id: task.id }, data })
        const { before, after } = workItemChanges(task, data)
        await recordEvent(tx, {
          workItemId: task.id,
          actorId: volunteer.id,
          kind: 'replanned',
          before,
          after: {
            ...after,
            finish: startOfUtcDay(input.newEnd).toISOString(),
            reason: input.reason,
            ...deputyContext(isDeputy),
          },
        })
      })
      await clearNotifications('task_needs_decision', task.id)

      const endText = formatDateShort(input.newEnd)
      const taskLink = `/projects/${project.id}/tasks/${task.id}`
      if (task.assigneeId !== null && task.assigneeId !== volunteer.id) {
        await notifyUser(
          task.assigneeId,
          'task_replanned',
          `'${task.title}' now finishes ${endText}`,
          input.reason,
          taskLink,
          undefined,
          task.id,
        )
      }
      await tellHelpers(
        task,
        volunteer.id,
        'task_replanned',
        `'${task.title}' now finishes ${endText}`,
        input.reason,
      )
      const titleOf = new Map(tasks.map((t) => [t.id, t]))
      for (const m of preview.moved) {
        const movedTask = titleOf.get(m.id)
        if (!movedTask?.assigneeId || movedTask.assigneeId === volunteer.id) continue
        await notifyUser(
          movedTask.assigneeId,
          'plan_moved',
          `'${movedTask.title}' now starts ${formatDateShort(m.start)} because '${task.title}' was replanned`,
          null,
          `/projects/${project.id}/tasks/${m.id}`,
          undefined,
          m.id,
        )
      }

      return { message: 'Task replanned', moved: preview.moved.length }
    }),

  deleteTask: approvedProcedure
    .input(z.object({ projectId: z.number().int(), taskId: z.number().int() }))
    .use(projectEditable, (input) => input.projectId)
    .use(asProjectAdmin, (input) => input.projectId)
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      const project = await prisma.workItem.findFirst({
        where: { id: input.projectId, type: WorkItemType.PROJECT },
      })
      if (!project) throw new ORPCError('NOT_FOUND', { message: 'Project not found' })

      const task = await prisma.workItem.findFirst({
        where: { id: input.taskId, parentId: input.projectId, type: WorkItemType.TASK },
        select: { creatorId: true },
      })
      if (!task) throw new ORPCError('NOT_FOUND', { message: 'Task not found' })

      const isDeputy = await isProjectDeputy(project.id, volunteer.id)
      if (!canDeleteProjectTask(project, task, volunteer, isDeputy)) {
        throw new ORPCError('FORBIDDEN', {
          message:
            'Only the project owner, a deputy, an admin or the task creator can delete this task',
        })
      }

      const deleted = await prisma.workItem.deleteMany({
        where: { id: input.taskId, parentId: input.projectId, type: WorkItemType.TASK },
      })
      if (deleted.count === 0) throw new ORPCError('NOT_FOUND', { message: 'Task not found' })
      return { message: 'Task deleted' }
    }),

  /** The owner (or an admin) hands an accepted helper the management of the project's tasks. */
  appointDeputy: approvedProcedure
    .input(z.object({ projectId: z.number().int(), volunteerId: z.number().int() }))
    .use(projectEditable, (input) => input.projectId)
    .use(asProjectAdmin, (input) => input.projectId)
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      const project = await prisma.workItem.findFirst({
        where: { id: input.projectId, type: WorkItemType.PROJECT },
      })
      if (!project || (project.assigneeId !== volunteer.id && !volunteer.isAdmin)) {
        throw new ORPCError('FORBIDDEN', { message: 'Only the project owner can appoint a deputy' })
      }
      const helper = await prisma.workItemInterest.findFirst({
        where: {
          workItemId: input.projectId,
          volunteerId: input.volunteerId,
          status: InterestStatus.accepted,
        },
      })
      if (!helper || input.volunteerId === project.assigneeId) {
        throw new ORPCError('BAD_REQUEST', { message: 'Only an accepted helper can be a deputy' })
      }
      const existing = await prisma.projectDeputy.findFirst({
        where: { projectId: input.projectId, volunteerId: input.volunteerId },
      })
      if (existing) throw new ORPCError('BAD_REQUEST', { message: 'They are already a deputy' })

      await prisma.projectDeputy.create({
        data: {
          projectId: input.projectId,
          volunteerId: input.volunteerId,
          appointedById: volunteer.id,
        },
      })
      await notifyUser(
        input.volunteerId,
        'deputy_appointed',
        `${volunteer.name} made you a deputy on '${project.title}'`,
        'You can now manage its tasks.',
        `/projects/${project.id}#tasks`,
      )
      return { message: 'Deputy appointed' }
    }),

  removeDeputy: approvedProcedure
    .input(z.object({ projectId: z.number().int(), volunteerId: z.number().int() }))
    .use(projectEditable, (input) => input.projectId)
    .use(asProjectAdmin, (input) => input.projectId)
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      const project = await prisma.workItem.findFirst({
        where: { id: input.projectId, type: WorkItemType.PROJECT },
      })
      if (!project || (project.assigneeId !== volunteer.id && !volunteer.isAdmin)) {
        throw new ORPCError('FORBIDDEN', { message: 'Only the project owner can remove a deputy' })
      }
      const removed = await prisma.projectDeputy.deleteMany({
        where: { projectId: input.projectId, volunteerId: input.volunteerId },
      })
      if (removed.count === 0) throw new ORPCError('NOT_FOUND', { message: 'Deputy not found' })
      await notifyUser(
        input.volunteerId,
        'deputy_removed',
        `You are no longer a deputy on '${project.title}'`,
        `${volunteer.name} took back the management of its tasks.`,
        `/projects/${project.id}`,
      )
      return { message: 'Deputy removed' }
    }),

  stepDownAsDeputy: approvedProcedure
    .input(z.object({ projectId: z.number().int() }))
    .use(projectEditable, (input) => input.projectId)
    .use(asProjectAdmin, (input) => input.projectId)
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      const project = await prisma.workItem.findFirst({
        where: { id: input.projectId, type: WorkItemType.PROJECT },
      })
      const removed = await prisma.projectDeputy.deleteMany({
        where: { projectId: input.projectId, volunteerId: volunteer.id },
      })
      if (!project || removed.count === 0) {
        throw new ORPCError('NOT_FOUND', { message: 'You are not a deputy on this project' })
      }
      if (project.assigneeId !== null) {
        await notifyUser(
          project.assigneeId,
          'deputy_removed',
          `${volunteer.name} stepped down as a deputy on '${project.title}'`,
          null,
          `/projects/${project.id}#people`,
        )
      }
      return { message: 'You are no longer a deputy' }
    }),
}
