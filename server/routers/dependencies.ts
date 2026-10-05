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
import { loadProjectEdges, loadTaskEdges } from '@/lib/project-schedule'
import { findDependencyCycle, type ScheduleEdge } from '@/lib/schedule'
import { approvedProcedure } from '../procedures'
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
  country: true,
  remoteEligibility: true,
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
  country: string | null
  remoteEligibility: string
}

type Viewer = { id: number; isAdmin: boolean; isApproved: boolean; country: string | null }

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
    country: string | null
  },
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

  const viewer: Viewer = {
    id: volunteer.id,
    isAdmin: Boolean(volunteer.isAdmin),
    isApproved: volunteer.approvalStatus === ApprovalStatus.approved,
    country: volunteer.country,
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
    if (
      !canManageProjectTasks(project, volunteer, await isProjectDeputy(project.id, volunteer.id))
    ) {
      throw new ORPCError('FORBIDDEN', {
        message: 'Only the project owner, a deputy or an admin can link its tasks',
      })
    }
  } else {
    if (!canManageProject(successor, volunteer)) {
      throw new ORPCError('FORBIDDEN', {
        message: 'Only the owner or an admin of the dependent project can add this link',
      })
    }
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
    country: string | null
  },
) {
  const dep = await prisma.workItemDependency.findUnique({ where: { id: dependencyId } })
  if (!dep) throw new ORPCError('NOT_FOUND', { message: 'Dependency not found' })
  await resolveLink(dep.predecessorId, dep.successorId, volunteer)
  return dep
}

export const dependenciesRouter = {
  /** Create a finish-to-start link. Rejects cycles, cross-scope links, and self-links. */
  add: approvedProcedure.input(DependencyBodySchema).handler(async ({ input, context }) => {
    const volunteer = context.volunteer
    const { predecessor, successor } = await resolveLink(
      input.predecessorId,
      input.successorId,
      volunteer,
    )

    const existing = await edgesInScope(successor)
    const prospective: ScheduleEdge = {
      predecessorId: input.predecessorId,
      successorId: input.successorId,
      lagDays: input.lagDays,
    }
    // Drop any current row for this pair before testing — re-adding an existing link with a
    // new lag must not read as a one-node loop.
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

    const dependency = await prisma.workItemDependency.upsert({
      where: {
        predecessorId_successorId: {
          predecessorId: input.predecessorId,
          successorId: input.successorId,
        },
      },
      create: {
        predecessorId: input.predecessorId,
        successorId: input.successorId,
        lagDays: input.lagDays,
        createdById: volunteer.id,
      },
      update: { lagDays: input.lagDays },
    })

    await prisma.workItem.update({
      where: { id: input.successorId },
      data: { scheduleUpdatedAt: new Date() },
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

  /** Change only the lag on an existing link. */
  updateLag: approvedProcedure
    .input(
      z.object({ dependencyId: z.number().int(), lagDays: z.number().int().min(-365).max(365) }),
    )
    .handler(async ({ input, context }) => {
      const dep = await loadManageableDependency(input.dependencyId, context.volunteer)
      await prisma.$transaction([
        prisma.workItemDependency.update({
          where: { id: dep.id },
          data: { lagDays: input.lagDays },
        }),
        prisma.workItem.update({
          where: { id: dep.successorId },
          data: { scheduleUpdatedAt: new Date() },
        }),
      ])
      return { id: dep.id, lagDays: input.lagDays }
    }),

  remove: approvedProcedure
    .input(z.object({ dependencyId: z.number().int() }))
    .handler(async ({ input, context }) => {
      const dep = await loadManageableDependency(input.dependencyId, context.volunteer)
      await prisma.$transaction([
        prisma.workItemDependency.delete({ where: { id: dep.id } }),
        prisma.workItem.update({
          where: { id: dep.successorId },
          data: { scheduleUpdatedAt: new Date() },
        }),
      ])
      return { id: dep.id }
    }),
}
