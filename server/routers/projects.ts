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
  canManageProject,
  canManageProjectTasks,
  isProjectDeputy,
  submissionData,
  CLEARED_SUBMISSION,
  canCreateProjectTask,
  canDeleteProjectTask,
  resolveProjectMembership,
} from '@/lib/work-item'
import { notifyUser, notifyAdmins, notifyTeamOfProject, clearNotifications } from '@/lib/notify'
import { keyDateSides } from '@/lib/key-date'
import { daysPastPlan, previewReplan, replanWrite } from '@/lib/replan'
import {
  lateProjects,
  loadProjectTaskSchedule,
  toScheduleInput,
  loadProjectEdges,
  scheduleProjectsByIds,
} from '@/lib/project-schedule'
import { notifyMatchingVolunteers } from '@/lib/project-match-notify'
import { html } from '@/lib/email'
import { formatDateShort } from '@/lib/format-date'
import { awaitsOwnerReview } from '@/lib/task-review'
import { canReach } from '@/lib/contact'
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
  adminProcedure,
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
} from '@/generated/prisma/enums'

/** Is the project within this volunteer's scope (team and country)? See lib/work-item.ts. */
async function canReachProject(
  project: {
    id: number
    teamId: number | null
    creatorId: number | null
    assigneeId: number | null
    country: string | null
    remoteEligibility: string
  },
  volunteer: { id: number; isAdmin: boolean | null; country: string | null },
): Promise<boolean> {
  return canSeeProjectScope(project, volunteer)
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
async function releaseTasksHeldBy(projectId: number, volunteerId: number): Promise<void> {
  await prisma.workItem.updateMany({
    where: { parentId: projectId, type: WorkItemType.TASK, requestedById: volunteerId },
    data: { requestedById: null },
  })
  await prisma.workItem.updateMany({
    where: {
      parentId: projectId,
      type: WorkItemType.TASK,
      assigneeId: volunteerId,
      status: { not: TaskStatus.completed },
    },
    data: {
      assigneeId: null,
      status: TaskStatus.open,
      updatedAt: new Date(),
      nudgeSentAt: null,
      finalWarningSentAt: null,
      ...CLEARED_SUBMISSION,
    },
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
async function assignHeldTasks(projectId: number, volunteerId: number): Promise<void> {
  const now = new Date()
  await prisma.workItem.updateMany({
    where: {
      parentId: projectId,
      type: WorkItemType.TASK,
      requestedById: volunteerId,
      status: TaskStatus.open,
      assigneeId: null,
    },
    data: {
      assigneeId: volunteerId,
      status: TaskStatus.in_progress,
      requestedById: null,
      startedAt: now,
      updatedAt: now,
      nudgeSentAt: null,
      finalWarningSentAt: null,
    },
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

function actorLabel(volunteer: { name: string }, isDeputy: boolean): string {
  return isDeputy ? `${volunteer.name} (deputy)` : volunteer.name
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
  [TaskStatus.open]: 0,
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
        country: z.string().optional(),
        localGroup: z.string().optional(),
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
        // Asking for an unapproved status by name shows a volunteer their own proposals only.
        if (!volunteer.isAdmin && UNAPPROVED_STATUSES.includes(input.status)) {
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
        conditions.push(Prisma.sql`(title ILIKE ${like} OR description ILIKE ${like})`)
      }

      if (input.urgency) conditions.push(Prisma.sql`urgency = ${input.urgency}`)
      if (input.country) conditions.push(Prisma.sql`country = ${input.country}`)
      if (input.localGroup) conditions.push(Prisma.sql`local_group = ${input.localGroup}`)
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
        country: z.string().optional(),
        localGroup: z.string().optional(),
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
        sharedConditions.push(Prisma.sql`(title ILIKE ${like} OR description ILIKE ${like})`)
      }
      if (input.urgency) sharedConditions.push(Prisma.sql`urgency = ${input.urgency}`)
      if (input.country) sharedConditions.push(Prisma.sql`country = ${input.country}`)
      if (input.localGroup) sharedConditions.push(Prisma.sql`local_group = ${input.localGroup}`)
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
            })),
        })),
      }
    }),

  create: approvedProcedure.input(CreateProjectSchema).handler(async ({ input, context }) => {
    const volunteer = context.volunteer
    const { tasks, wantToOwn, skillIds, skillRequiredMap, saveAsDraft } = input
    if (!saveAsDraft && tasks.length === 0) {
      throw new ORPCError('BAD_REQUEST', {
        message: 'At least one task is required to submit a project proposal',
      })
    }

    // Admins are trusted staff, not volunteers proposing speculative projects — the cap exists
    // to bound unreviewed volunteer proposals, not to limit admin work.
    if (saveAsDraft && !volunteer.isAdmin) {
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
          country: input.country ?? null,
          ...scheduleOnCreate,
          localGroup: input.localGroup ?? null,
          remoteEligibility: input.remoteEligibility ?? 'NONE',
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
          status: TaskStatus.open,
          parentId: newProject.id,
          title: t.title,
          description: t.description ?? null,
          creatorId: volunteer.id,
        })),
      })

      return newProject
    })

    if (!saveAsDraft) {
      await notifyAdmins(
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
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      const project = await prisma.workItem.findFirst({
        where: { id: input.id, type: WorkItemType.PROJECT },
      })
      if (!project) throw new ORPCError('NOT_FOUND', { message: 'Draft not found' })
      if (project.creatorId !== volunteer.id || project.status !== ProjectStatus.draft) {
        throw new ORPCError('FORBIDDEN', { message: 'Not authorized to publish this draft' })
      }

      const taskCount = await prisma.workItem.count({
        where: { parentId: input.id, type: WorkItemType.TASK },
      })
      if (taskCount === 0) {
        throw new ORPCError('BAD_REQUEST', {
          message: 'Add at least one task before submitting this draft for review',
        })
      }

      if (project.isOrgProposed || project.templateOriginId !== null) {
        // Org projects, and projects instantiated from a template, skip review entirely —
        // publishing a draft goes straight live. Template-originated projects already came
        // from a vetted structure, so re-review would be redundant (see
        // lib/template-porting.ts).
        const newStatus =
          project.assigneeId === null ? ProjectStatus.ready : ProjectStatus.in_progress
        await prisma.workItem.update({
          where: { id: input.id },
          data: { status: newStatus, updatedAt: new Date() },
        })

        notifyMatchingVolunteers(project.id).catch((e) => console.error('[MATCH NOTIFY]', e))
        if (project.teamId) {
          notifyTeamOfProject(project.teamId, project.id, project.title).catch((e) =>
            console.error('[TEAM NOTIFY]', e),
          )
        }

        return { message: 'Project published' }
      }

      await prisma.workItem.update({
        where: { id: input.id },
        data: { status: ProjectStatus.pending_review, updatedAt: new Date() },
      })

      await notifyAdmins(
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
          _count: { select: { comments: true } },
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

      const mappedTasks = sortedTasks.map((t, i) => ({
        ...serializeTask(t),
        keyDateSide: sides.get(t.id) ?? null,
        pastPlanDays:
          t.startDate !== null || t.durationDays !== null || hasPredecessor.has(t.id)
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
        featuredAsQuickTask: t.featuredAsQuickTask ?? false,
      }))

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

      const isAssignee = project.assigneeId === volunteer.id
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

      const canClaimTasks =
        isAssignee ||
        Boolean(volunteer.isAdmin) ||
        !(await isBlockedFromClaiming(input.id, volunteer.id))

      const isMember =
        (project.teamId !== null && viewerTeamIds.has(project.teamId)) ||
        myInterest?.status === InterestStatus.accepted
      const canCreateTasks = canCreateProjectTask(project, volunteer, isMember)

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
      const canManageTasks = canManageProjectTasks(project, volunteer, isDeputy)

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
        tasks: mappedTasks,
        interests,
        helpers,
        myInterest,
        canClaimTasks,
        canCreateTasks,
        canManageTasks,
        isDeputy,
        isMember,
        canMessageOwner:
          project.assigneeId !== null &&
          project.assigneeId !== volunteer.id &&
          (await canReach(volunteer, project.assigneeId)),
        reviewRequests,
      }
    }),

  resubmit: approvedProcedure
    .input(z.object({ id: z.number().int() }))
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
      await prisma.workItem.update({
        where: { id: project.id },
        data: { status: ProjectStatus.pending_review, updatedAt: new Date() },
      })
      await prisma.projectReviewRequest.updateMany({
        where: { projectId: project.id, resolvedAt: null },
        data: { resolvedAt: new Date() },
      })
      await clearNotifications('project_needs_discussion', project.id)

      // The admin who asked hears back; with nobody to tell, every admin does.
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
      else await notifyAdmins(...args)

      return { message: 'Project resubmitted for review' }
    }),

  update: approvedProcedure
    .input(z.object({ id: z.number().int() }).merge(UpdateProjectSchema))
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

      const body = input
      const newStatus = body.status

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

      if (
        newStatus &&
        newStatus === ProjectStatus.in_progress &&
        project.status !== ProjectStatus.in_progress
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
        'country',
        'localGroup',
        'remoteEligibility',
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
        if (body.teamId !== null) {
          const team = await prisma.team.findUnique({
            where: { id: body.teamId },
            select: { id: true },
          })
          if (!team) throw new ORPCError('BAD_REQUEST', { message: 'Team not found' })
        }
        data.teamId = body.teamId
      }

      for (const field of stringFields) {
        if (body[field] !== undefined) data[field] = body[field]
      }
      if (body.timeCommitmentHoursPerWeek !== undefined)
        data.timeCommitmentHoursPerWeek = body.timeCommitmentHoursPerWeek
      applyScheduleWrite(data, body)

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
            select: { approvalStatus: true },
          })
          if (!newOwner) throw new ORPCError('BAD_REQUEST', { message: 'Volunteer not found' })
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

      data.updatedAt = new Date()
      await prisma.workItem.update({ where: { id: input.id }, data })

      // Tagging a team onto a project that's already visible alerts that team right away;
      // tagging one still in review waits until it goes live (see admin/projects.ts).
      if (
        typeof data.teamId === 'number' &&
        data.teamId !== project.teamId &&
        !UNAPPROVED_STATUSES.includes(project.status)
      ) {
        notifyTeamOfProject(data.teamId, project.id, project.title).catch((e) =>
          console.error('[TEAM NOTIFY]', e),
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

  delete: adminProcedure.input(z.object({ id: z.number().int() })).handler(async ({ input }) => {
    const project = await prisma.workItem.findFirst({
      where: { id: input.id, type: WorkItemType.PROJECT },
    })
    if (!project) throw new ORPCError('NOT_FOUND', { message: 'Project not found' })
    await prisma.workItem.delete({ where: { id: input.id } })
    return { message: `Project '${project.title}' deleted` }
  }),

  expressInterest: confirmedProcedure
    .input(z.object({ projectId: z.number().int() }).merge(ProjectInterestBodySchema))
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
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

  withdrawInterest: authedProcedure
    .input(z.object({ projectId: z.number().int() }))
    .handler(async ({ input, context }) => {
      const result = await prisma.workItemInterest.updateMany({
        where: {
          workItemId: input.projectId,
          volunteerId: context.volunteer.id,
          status: { in: [InterestStatus.pending, InterestStatus.accepted] },
        },
        data: { status: InterestStatus.withdrawn },
      })
      if (result.count === 0) throw new ORPCError('NOT_FOUND', { message: 'No interest found' })

      await releaseTasksHeldBy(input.projectId, context.volunteer.id)
      const project = await prisma.workItem.findFirst({
        where: { id: input.projectId, type: WorkItemType.PROJECT },
        select: { id: true, title: true, assigneeId: true },
      })
      if (project) await endDeputyRole(project, context.volunteer.id, context.volunteer.name)

      return { message: 'Interest withdrawn' }
    }),

  respondToInterest: authedProcedure
    .input(
      z.object({
        projectId: z.number().int(),
        interestId: z.number().int(),
        status: z.enum([InterestStatus.accepted, InterestStatus.declined]),
        responseMessage: z.string().optional().nullable(),
      }),
    )
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
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
      }

      if (status === InterestStatus.accepted) {
        await assignHeldTasks(input.projectId, interest.volunteerId)
      } else {
        await releaseTasksHeldBy(input.projectId, interest.volunteerId)
      }

      // A project that already has an owner changes hands only through a transfer.
      if (
        input.status === InterestStatus.accepted &&
        interest.interestType === 'want_to_own' &&
        project.assigneeId === null
      ) {
        await prisma.workItem.update({
          where: { id: input.projectId },
          data: {
            assigneeId: interest.volunteerId,
            // A new owner starts the work, but never carries a proposal past triage.
            ...(UNAPPROVED_STATUSES.includes(project.status)
              ? {}
              : { status: ProjectStatus.in_progress }),
          },
        })
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
        await assignHeldTasks(input.projectId, input.volunteerId)
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

      await assignHeldTasks(input.projectId, input.volunteerId)

      // Assigning someone as owner has to actually set the owner. This previously only
      // cleared the (now derived) isSeekingOwner flag, leaving the project ownerless and
      // no longer advertising for one — unlike respondToInterest, which took the same
      // intent and did set the assignee.
      if (input.interestType === 'want_to_own' && project.assigneeId === null) {
        await prisma.workItem.update({
          where: { id: input.projectId },
          data: {
            assigneeId: input.volunteerId,
            status: TERMINAL_STATUSES.includes(project.status)
              ? project.status
              : ProjectStatus.in_progress,
            updatedAt: new Date(),
          },
        })
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
            country: volunteer.country,
          },
          undefined,
          await resolveProjectPrivy(project, volunteer),
        )
      ) {
        throw new ORPCError('NOT_FOUND', { message: 'Project not found' })
      }

      const tasks = await prisma.workItem.findMany({
        where: { parentId: input.projectId, type: WorkItemType.TASK },
        include: {
          assignee: { select: { name: true } },
          creator: { select: { name: true } },
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

      // Loaded here with the row id so the timeline panel can edit/remove links directly.
      const dependencyRows = await prisma.workItemDependency.findMany({
        where: {
          predecessor: { parentId: input.projectId, type: WorkItemType.TASK },
          successor: { parentId: input.projectId, type: WorkItemType.TASK },
        },
        select: { id: true, predecessorId: true, successorId: true, lagDays: true },
      })

      return {
        tasks: tasks.map((t) => ({
          ...serializeTask(t),
          assignedToName: t.assignee?.name ?? null,
          createdByName: t.creator?.name ?? null,
          sortOrder: t.sortOrder,
        })),
        dependencies: dependencyRows,
        // The Map in `schedule` doesn't cross the wire; the array is keyed by `id`.
        scheduled: schedule.scheduled,
        // The origin is where *derived* tasks begin counting from — today, for a project with
        // no pinned start. A task pinned earlier than that still has to fit on the axis, so the
        // scope runs from whichever comes first.
        scopeStart: schedule.start.getTime() < origin.getTime() ? schedule.start : origin,
        scopeEnd: schedule.end,
        // Sent so the client can recompute this exact schedule while a drag is in flight.
        scopeOrigin: origin,
        projectDeadline: project.deadline,
        canSetKeyDate: canManageProject(project, volunteer),
        canManageTasks: canManageProjectTasks(
          project,
          volunteer,
          await isProjectDeputy(project.id, volunteer.id),
        ),
        canCreateTasks: canCreateProjectTask(
          project,
          volunteer,
          await resolveProjectMembership(project.teamId, project.id, volunteer.id),
        ),
      }
    }),

  getTask: confirmedProcedure
    .input(z.object({ projectId: z.number().int(), taskId: z.number().int() }))
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
            country: volunteer.country,
          },
          project,
          await resolveProjectPrivy(project, volunteer),
        )
      ) {
        throw new ORPCError('NOT_FOUND', { message: 'Task not found' })
      }

      const canClaim =
        project.assigneeId === volunteer.id ||
        Boolean(volunteer.isAdmin) ||
        !(await isBlockedFromClaiming(input.projectId, volunteer.id))

      const [predecessorRows, siblingTasks, assigneeUpdates] = await Promise.all([
        prisma.workItemDependency.findMany({
          where: { successorId: input.taskId },
          include: { predecessor: { select: { id: true, title: true } } },
        }),
        prisma.workItem.findMany({
          where: {
            parentId: input.projectId,
            type: WorkItemType.TASK,
            id: { not: input.taskId },
          },
          select: { id: true, title: true },
          orderBy: { sortOrder: 'asc' },
        }),
        prisma.workItemComment.count({
          where: { workItemId: task.id, authorId: task.assigneeId ?? -1 },
        }),
      ])

      // Where the plan puts this task. A task with no start, length or predecessor is not on
      // the timeline, so it has no placement to report.
      const placement =
        task.startDate !== null || task.durationDays !== null || predecessorRows.length > 0
          ? ((
              await loadProjectTaskSchedule(
                project,
                await prisma.workItem.findMany({
                  where: { parentId: input.projectId, type: WorkItemType.TASK },
                }),
              )
            ).schedule.byId.get(task.id) ?? null)
          : null

      const canManage = canManageProjectTasks(
        project,
        volunteer,
        await isProjectDeputy(project.id, volunteer.id),
      )
      // A reviewer's request for changes is between them and the assignee.
      const changesRequested =
        task.changesRequestedNote !== null && (canManage || task.assigneeId === volunteer.id)
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

      return {
        ...serializeTask(task),
        // The assignee has said something on the task, so it reads as under way.
        assigneeHasPosted: assigneeUpdates > 0,
        changesRequested,
        autoAcceptTasks: project.autoAcceptTasks,
        projectTitle: project.title,
        projectOwnerId: project.assigneeId,
        canClaim,
        canManage,
        assignedToName: task.assignee?.name ?? null,
        assigneeContactable:
          task.assigneeId !== null && (await canReach(volunteer, task.assigneeId)),
        createdByName: task.creator?.name ?? null,
        requestedByName: task.requestedBy?.name ?? null,
        featuredAsQuickTask: task.featuredAsQuickTask ?? false,
        predecessors: predecessorRows.map((r) => ({
          dependencyId: r.id,
          predecessorId: r.predecessorId,
          predecessorTitle: r.predecessor.title,
          lagDays: r.lagDays,
        })),
        siblingTasks,
        placement,
        pastPlanDays: placement
          ? daysPastPlan(placement.end, {
              done: task.status === TaskStatus.completed,
              assigned: task.assigneeId !== null,
            })
          : null,
        // The key date is the owner's, not a deputy's (the update enforces the same).
        canSetKeyDate: canManageProject(project, volunteer),
      }
    }),

  createTask: approvedProcedure
    .input(z.object({ projectId: z.number().int() }).merge(CreateProjectTaskSchema))
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
      })

      const task = await prisma.$transaction(async (tx) => {
        const max = await tx.workItem.aggregate({
          where: { parentId: input.projectId, type: WorkItemType.TASK },
          _max: { sortOrder: true },
        })
        const newTask = await tx.workItem.create({
          data: {
            type: WorkItemType.TASK,
            status: TaskStatus.open,
            parentId: input.projectId,
            title: input.title,
            description: input.description ?? null,
            estimatedHours: input.estimatedHours ?? null,
            deadline: input.deadline ?? null,
            featuredAsQuickTask: input.featuredAsQuickTask ?? false,
            timing: input.timing ?? TaskTiming.flexible,
            creatorId: volunteer.id,
            sortOrder: (max._max.sortOrder ?? 0) + 1,
            ...scheduleOnCreate,
          },
        })
        return newTask
      })

      return { id: task.id, message: 'Task created' }
    }),

  reorderTasks: approvedProcedure
    .input(
      z.object({
        projectId: z.number().int(),
        items: z.array(z.object({ id: z.number().int(), sortOrder: z.number().int() })),
      }),
    )
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
      await prisma.$transaction(
        targets
          .filter((t) => t.startDate !== null || t.durationDays !== null)
          .map((t) =>
            prisma.workItem.update({
              where: { id: t.id },
              data: {
                baselineStartDate: t.startDate,
                baselineDurationDays: t.durationDays,
                baselineSetAt: now,
              },
            }),
          ),
      )
      return { message: 'Baseline updated' }
    }),

  /**
   * Portfolio roadmap: one placed bar per visible project, plus the project-to-project edges
   * between them. Defaults to active statuses; completed/archived are opt-in via `statuses`.
   * Reuses the team-visibility rule from `list` — a team-tagged project stays hidden from
   * non-members.
   */
  ganttOverview: confirmedProcedure
    .input(
      z.object({
        statuses: z.array(z.string()).optional(),
        teamId: z.number().int().optional(),
        country: z.string().optional(),
        localGroup: z.string().optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      const requested =
        input.statuses && input.statuses.length > 0
          ? input.statuses
          : [ProjectStatus.ready, ProjectStatus.in_progress, ProjectStatus.on_hold]
      // Proposals awaiting triage are the admins' to see across the organisation.
      const statuses = volunteer.isAdmin
        ? requested
        : requested.filter((s) => !UNAPPROVED_STATUSES.includes(s))

      const visible = await prisma.workItem.findMany({
        where: {
          type: WorkItemType.PROJECT,
          status: { in: statuses },
          ...(input.teamId ? { teamId: input.teamId } : {}),
          ...(input.country ? { country: input.country } : {}),
          ...(input.localGroup ? { localGroup: input.localGroup } : {}),
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
        input.data.isAnchor === undefined &&
        input.data.timing === undefined &&
        input.data.startDate === undefined &&
        input.data.durationDays === undefined
      const isSelfClaim =
        onlyTouchesStatusAndAssignee &&
        newStatus === TaskStatus.in_progress &&
        newAssigneeId === volunteer.id &&
        task.status === TaskStatus.open

      const isDraftCreator =
        project.creatorId === volunteer.id && project.status === ProjectStatus.draft
      if (!isAssignee && !volunteer.isAdmin && !isSelfClaim && !isDraftCreator) {
        throw new ORPCError('FORBIDDEN', { message: 'Not authorized to update this task' })
      }

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
          const held = await prisma.workItem.updateMany({
            where: {
              id: input.taskId,
              status: TaskStatus.open,
              assigneeId: null,
              requestedById: null,
            },
            data: { requestedById: volunteer.id, updatedAt: new Date() },
          })
          if (held.count === 0) {
            throw new ORPCError('BAD_REQUEST', { message: 'This task has already been claimed' })
          }
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

      const data: Record<string, unknown> = {}
      let releasedFrom: number | null = null
      if (input.data.title !== undefined) data.title = input.data.title
      if (input.data.description !== undefined) data.description = input.data.description
      if (input.data.estimatedHours !== undefined) data.estimatedHours = input.data.estimatedHours
      if (input.data.deadline !== undefined) data.deadline = input.data.deadline
      if (input.data.featuredAsQuickTask !== undefined)
        data.featuredAsQuickTask = input.data.featuredAsQuickTask
      if (input.data.isAnchor !== undefined) data.isAnchor = input.data.isAnchor
      if (input.data.timing !== undefined) data.timing = input.data.timing
      applyScheduleWrite(data, input.data)
      if (input.data.status !== undefined) {
        data.status = input.data.status
        if (input.data.status === TaskStatus.completed) data.completedAt = new Date()
        else if (input.data.status === TaskStatus.in_progress) {
          // Actual start, recorded once. Re-entering in_progress after a pause keeps the
          // original date — the work did start then.
          if (task.startedAt === null) data.startedAt = new Date()
        } else if (input.data.status === TaskStatus.open) {
          releasedFrom = task.assigneeId
          data.assigneeId = null
          data.requestedById = null
          data.completedAt = null
          // Back to unstarted: the actuals and any submission describe work that is no
          // longer claimed.
          data.startedAt = null
          Object.assign(data, CLEARED_SUBMISSION)
        }
      }
      if (input.data.assigneeId !== undefined) data.assigneeId = input.data.assigneeId
      data.updatedAt = new Date()
      data.nudgeSentAt = null
      data.finalWarningSentAt = null

      if (isSelfClaim) {
        // Two volunteers hitting claim at once must not both win — only the update that
        // still sees the task open and unheld takes it.
        const claimed = await prisma.workItem.updateMany({
          where: {
            id: input.taskId,
            status: TaskStatus.open,
            assigneeId: null,
            requestedById: null,
          },
          data,
        })
        if (claimed.count === 0) {
          throw new ORPCError('BAD_REQUEST', { message: 'This task has already been claimed' })
        }
      } else {
        await prisma.workItem.update({ where: { id: input.taskId }, data })
      }

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

  /**
   * The assignee hands in their work. It waits for the owner as Submitted for review, unless
   * the project auto-accepts, has no owner to review it, or the submitter could accept it.
   */
  submitTask: approvedProcedure
    .input(
      z.object({ projectId: z.number().int(), taskId: z.number().int() }).merge(SubmitWorkSchema),
    )
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      const { project, task } = await findProjectTask(input.projectId, input.taskId)
      if (task.assigneeId !== volunteer.id) {
        throw new ORPCError('FORBIDDEN', {
          message: 'Only the person doing this task can submit it',
        })
      }
      if (task.status !== TaskStatus.in_progress) {
        throw new ORPCError('BAD_REQUEST', { message: 'Only a task in progress can be submitted' })
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
      await prisma.workItem.update({
        where: { id: task.id },
        data: {
          ...submission,
          status: accepted ? TaskStatus.completed : TaskStatus.under_review,
          ...(accepted ? { completedAt: submission.submittedAt } : {}),
          updatedAt: new Date(),
          nudgeSentAt: null,
          finalWarningSentAt: null,
        },
      })
      await clearNotifications('task_changes_requested', task.id)

      const link = `/projects/${project.id}/tasks/${task.id}`
      const said = submission.submissionNote ?? submission.submissionUrl
      if (accepted) {
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
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      const { task, isDeputy } = await findTaskToReview(input.projectId, input.taskId, volunteer)
      const now = new Date()
      await prisma.workItem.update({
        where: { id: task.id },
        data: {
          status: TaskStatus.completed,
          completedAt: now,
          reviewedById: volunteer.id,
          reviewedAt: now,
          changesRequestedNote: null,
          updatedAt: now,
        },
      })
      await clearNotifications('task_submitted', task.id)
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
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      const { task, isDeputy } = await findTaskToReview(input.projectId, input.taskId, volunteer)
      const now = new Date()
      await prisma.workItem.update({
        where: { id: task.id },
        data: {
          status: TaskStatus.in_progress,
          changesRequestedNote: input.message,
          reviewedById: volunteer.id,
          reviewedAt: now,
          updatedAt: now,
        },
      })
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

  assignTask: approvedProcedure
    .input(
      z.object({
        projectId: z.number().int(),
        taskId: z.number().int(),
        assigneeId: z.number().int(),
      }),
    )
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
      if (task.status === TaskStatus.completed) {
        throw new ORPCError('BAD_REQUEST', { message: 'Cannot assign a completed task' })
      }

      const assignee = await prisma.volunteer.findFirst({
        where: { id: input.assigneeId, deletedAt: null },
      })
      if (!assignee) throw new ORPCError('BAD_REQUEST', { message: 'Volunteer not found' })
      if (assignee.approvalStatus !== ApprovalStatus.approved) {
        throw new ORPCError('BAD_REQUEST', {
          message: 'Cannot assign a task to a volunteer who is not yet approved',
        })
      }

      await prisma.workItem.update({
        where: { id: input.taskId },
        data: {
          assigneeId: input.assigneeId,
          requestedById: null,
          status: TaskStatus.in_progress,
          updatedAt: new Date(),
          nudgeSentAt: null,
          finalWarningSentAt: null,
          // Actual start, recorded once — reassigning a task in flight does not restart it.
          ...(task.startedAt === null ? { startedAt: new Date() } : {}),
        },
      })

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
   * The owner (or a deputy, or an admin) moves the planned end of a task that has run past
   * its plan. Writes only the start and length, never the dependencies or the deadline; says
   * why in the task's Discussion; tells the assignee and everyone whose task moved with it.
   */
  replanTask: approvedProcedure
    .input(
      z.object({
        projectId: z.number().int(),
        taskId: z.number().int(),
        newEnd: z.coerce.date(),
        reason: z.string().trim().min(1, { message: 'Say why the plan is changing' }).max(500),
      }),
    )
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
      const task = tasks.find((t) => t.id === input.taskId)
      if (!task) throw new ORPCError('NOT_FOUND', { message: 'Task not found' })

      const { schedule, edges, origin } = await loadProjectTaskSchedule(project, tasks)
      // A task with no dates sits at the plan's start only as a placeholder; it has no start
      // of its own to keep, so replanning starts it today.
      const dated =
        task.startDate !== null ||
        task.durationDays !== null ||
        edges.some((e) => e.successorId === task.id)
      const placed = dated ? (schedule.byId.get(task.id)?.start ?? null) : null
      const write = replanWrite({ startDate: task.startDate, placedStart: placed }, input.newEnd)
      if (!write) {
        throw new ORPCError('BAD_REQUEST', { message: 'The new end is before the task starts' })
      }
      const preview = previewReplan(tasks.map(toScheduleInput), edges, origin, task.id, write)

      const data: Record<string, unknown> = { updatedAt: new Date() }
      applyScheduleWrite(data, write)
      await prisma.workItem.update({ where: { id: task.id }, data })

      const who = actorLabel(volunteer, isDeputy)
      await prisma.workItemComment.create({
        data: {
          workItemId: task.id,
          authorId: volunteer.id,
          content: `Replanned by ${who}: ${input.reason}`,
        },
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
