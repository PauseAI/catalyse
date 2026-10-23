import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import { DependencyBodySchema } from '@/lib/schemas'
import {
  canManageProject,
  canManageProjectTasks,
  canViewWorkItem,
  isProjectDeputy,
  resolveProjectPrivy,
} from '@/lib/work-item'
import { assertProjectEditable, assertTaskEditable } from '@/lib/work-item-lock'
import { loadProjectEdges, loadTaskEdges } from '@/lib/project-schedule'
import { findDependencyCycle, type ScheduleEdge } from '@/lib/schedule'
import { recordEvent, type EventValues } from '@/lib/work-item-events'
import { approvedProcedure } from '../procedures'
import { actingOn, canAdminChapter, type ChapterAccess } from '@/lib/chapter-access'
import { ApprovalStatus, WorkItemType } from '@/generated/prisma/enums'

const ENDPOINT_SELECT = {
  id: true,
  type: true,
  status: true,
  title: true,
  parentId: true,
  creatorId: true,
  assigneeId: true,
  teamId: true,
  nationalChapterId: true,
} as const

type Endpoint = {
  id: number
  type: string
  status: string
  title: string
  parentId: number | null
  creatorId: number | null
  assigneeId: number | null
  teamId: number | null
  nationalChapterId: number | null
}

type Viewer = {
  id: number
  isAdmin: boolean
  isApproved: boolean
  nationalChapterId: number | null
}

/**
 * Resolves the two work items a link would join and proves the caller may create it.
 *
 * The scope rule — same `type`, same `parentId` — is what keeps the two dependency graphs
 * separate: TASKs of one project, or PROJECTs across the portfolio. QUICK_TASK never links.
 *
 * Manage rights: for a task link, on the shared parent project; for a project link, on the
 * successor (the project being constrained), plus view rights on the predecessor so the link
 * cannot be used to probe for team-restricted projects.
 */
async function resolveLink(
  predecessorId: number,
  successorId: number,
  volunteer: {
    id: number
    isAdmin: boolean | null
    approvalStatus: string
    nationalChapterId: number | null
  },
  access: ChapterAccess,
): Promise<{ predecessor: Endpoint; successor: Endpoint }> {
  if (predecessorId === successorId) {
    throw new ORPCError('BAD_REQUEST', { message: 'A task cannot depend on itself' })
  }

  const [predecessor, successor] = await Promise.all([
    prisma.workItem.findUnique({ where: { id: predecessorId }, select: ENDPOINT_SELECT }),
    prisma.workItem.findUnique({ where: { id: successorId }, select: ENDPOINT_SELECT }),
  ])
  if (!predecessor || !successor) {
    throw new ORPCError('NOT_FOUND', { message: 'One or both items were not found' })
  }
  if (predecessor.type === WorkItemType.QUICK_TASK || successor.type === WorkItemType.QUICK_TASK) {
    throw new ORPCError('BAD_REQUEST', { message: 'Quick tasks cannot have dependencies' })
  }
  if (predecessor.type !== successor.type) {
    throw new ORPCError('BAD_REQUEST', {
      message: 'A dependency must join two tasks, or two projects — not one of each',
    })
  }
  if (predecessor.parentId !== successor.parentId) {
    throw new ORPCError('BAD_REQUEST', {
      message:
        predecessor.type === WorkItemType.TASK
          ? 'Tasks can only depend on other tasks in the same project'
          : 'These projects are not in the same scope',
    })
  }

  // Each end is managed, or seen, with the admin rights its own chapter gives (actingOn).
  const viewer: Viewer = {
    id: volunteer.id,
    isAdmin: canAdminChapter(access, predecessor.nationalChapterId),
    isApproved: volunteer.approvalStatus === ApprovalStatus.approved,
    nationalChapterId: volunteer.nationalChapterId,
  }

  if (predecessor.type === WorkItemType.TASK) {
    const parentId = predecessor.parentId
    const project = parentId
      ? await prisma.workItem.findFirst({
          where: { id: parentId, type: WorkItemType.PROJECT },
          select: ENDPOINT_SELECT,
        })
      : null
    if (!project) throw new ORPCError('NOT_FOUND', { message: 'Project not found' })
    const actor = actingOn(volunteer, access, project.nationalChapterId)
    if (!canManageProjectTasks(project, actor, await isProjectDeputy(project.id, volunteer.id))) {
      throw new ORPCError('FORBIDDEN', {
        message: 'Only the project owner, a deputy or an admin can link its tasks',
      })
    }
    assertProjectEditable(project)
    assertTaskEditable(successor)
  } else {
    if (!canManageProject(successor, actingOn(volunteer, access, successor.nationalChapterId))) {
      throw new ORPCError('FORBIDDEN', {
        message: 'Only the owner or an admin of the dependent project can add this link',
      })
    }
    // Like a done task, a locked project keeps what it waited on; what waits on it is not its own.
    assertProjectEditable(successor)
    const privy = await resolveProjectPrivy(predecessor, viewer)
    if (!canViewWorkItem(predecessor, viewer, undefined, privy)) {
      throw new ORPCError('NOT_FOUND', { message: 'One or both items were not found' })
    }
  }

  return { predecessor, successor }
}

/** Existing edges in the same scope as this link, for the cycle check. */
async function edgesInScope(endpoint: Endpoint): Promise<ScheduleEdge[]> {
  return endpoint.type === WorkItemType.TASK && endpoint.parentId !== null
    ? loadTaskEdges(endpoint.parentId)
    : loadProjectEdges()
}

/** Loads a dependency row and re-proves manage rights on it. */
async function loadManageableDependency(
  dependencyId: number,
  volunteer: {
    id: number
    isAdmin: boolean | null
    approvalStatus: string
    nationalChapterId: number | null
  },
  access: ChapterAccess,
) {
  const dep = await prisma.workItemDependency.findUnique({ where: { id: dependencyId } })
  if (!dep) throw new ORPCError('NOT_FOUND', { message: 'Dependency not found' })
  const { predecessor } = await resolveLink(dep.predecessorId, dep.successorId, volunteer, access)
  return { dep, predecessor }
}

/** A link as its successor's event records it; the title keeps the line readable later. */
function linkValues(
  dep: { predecessorId: number; lagDays: number },
  predecessorTitle: string,
): EventValues {
  return { predecessorId: dep.predecessorId, predecessorTitle, lagDays: dep.lagDays }
}

export const dependenciesRouter = {
  /** Create a finish-to-start link. Rejects cycles, cross-scope links, and self-links. */
  add: approvedProcedure.input(DependencyBodySchema).handler(async ({ input, context }) => {
    const volunteer = context.volunteer
    const { predecessor, successor } = await resolveLink(
      input.predecessorId,
      input.successorId,
      volunteer,
      context.access,
    )

    const existing = await edgesInScope(successor)
    const prospective: ScheduleEdge = {
      predecessorId: input.predecessorId,
      successorId: input.successorId,
      lagDays: 0,
    }
    // Drop any current row for this pair so re-adding an existing link is not counted twice.
    const withoutPair = existing.filter(
      (e) => !(e.predecessorId === input.predecessorId && e.successorId === input.successorId),
    )
    const cycle = findDependencyCycle([...withoutPair, prospective])
    if (cycle) {
      const titles = await prisma.workItem.findMany({
        where: { id: { in: cycle } },
        select: { id: true, title: true },
      })
      const byId = new Map(titles.map((t) => [t.id, t.title]))
      throw new ORPCError('BAD_REQUEST', {
        message: `That link would create a loop: ${cycle.map((id) => byId.get(id) ?? `#${id}`).join(' → ')}`,
      })
    }

    const dependency = await prisma.$transaction(async (tx) => {
      const pair = { predecessorId: input.predecessorId, successorId: input.successorId }
      const was = await tx.workItemDependency.findUnique({
        where: { predecessorId_successorId: pair },
      })
      if (was) return was
      const saved = await tx.workItemDependency.create({
        data: { ...pair, createdById: volunteer.id },
      })
      await tx.workItem.update({
        where: { id: input.successorId },
        data: { scheduleUpdatedAt: new Date() },
      })
      await recordEvent(tx, {
        workItemId: input.successorId,
        actorId: volunteer.id,
        kind: 'dependency_added',
        before: {},
        after: linkValues(saved, predecessor.title),
      })
      return saved
    })

    return {
      id: dependency.id,
      predecessorId: dependency.predecessorId,
      successorId: dependency.successorId,
      lagDays: dependency.lagDays,
      predecessorTitle: predecessor.title,
      successorTitle: successor.title,
    }
  }),

  remove: approvedProcedure
    .input(z.object({ dependencyId: z.number().int() }))
    .handler(async ({ input, context }) => {
      const { dep, predecessor } = await loadManageableDependency(
        input.dependencyId,
        context.volunteer,
        context.access,
      )
      await prisma.$transaction(async (tx) => {
        await tx.workItemDependency.delete({ where: { id: dep.id } })
        await tx.workItem.update({
          where: { id: dep.successorId },
          data: { scheduleUpdatedAt: new Date() },
        })
        await recordEvent(tx, {
          workItemId: dep.successorId,
          actorId: context.volunteer.id,
          kind: 'dependency_removed',
          before: linkValues(dep, predecessor.title),
          after: {},
        })
      })
      return { id: dep.id }
    }),
}
