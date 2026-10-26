import { ApprovalStatus, WorkItemType } from '@/generated/prisma/enums'
import { prisma } from './prisma'
import type { WorkViewer } from './status-emphasis'
import { HELPER_COUNT } from './task-helpers'
import { canViewWorkItem, loadTaskStatusViews, resolveProjectPrivy } from './work-item'

/**
 * A task or Quick Task referenced from somewhere else (a dependency, a notification, Home), as
 * `WorkItemCard` draws it. Every router that returns one builds it with `toWorkItemSummary`.
 */
export type WorkItemSummary = {
  id: number
  /** The project a task belongs to; null for a Quick Task. */
  projectId: number | null
  title: string
  type: typeof WorkItemType.TASK | typeof WorkItemType.QUICK_TASK
  /** A task's shown status (`taskDisplayStatus`); a Quick Task's stored one. */
  displayStatus: string
  assigneeId: number | null
  assigneeName: string | null
  /** A task's helpers beside its assignee, and how many it seeks (null for none). */
  helperCount: number
  helpersWanted: number | null
  deadline: Date | null
  completedAt: Date | null
  href: string
  /** Where the viewer stands on it, for whether its badges are their move. */
  viewer: WorkViewer
}

type SummaryRow = {
  id: number
  type: string
  parentId: number | null
  title: string
  status: string
  deadline: Date | null
  completedAt: Date | null
  assigneeId: number | null
  assignee: { name: string } | null
  helpersWanted: number | null
  /** Loaded with HELPER_COUNT (lib/task-helpers.ts). */
  _count: { interests: number }
}

/**
 * `canReview` is whether the viewer may accept the work and replan it: an admin, or for a task
 * the project's owner or a deputy.
 */
export function toWorkItemSummary(
  item: SummaryRow,
  displayStatus: string,
  viewer: { id: number; canReview: boolean },
): WorkItemSummary {
  const isTask = item.type === WorkItemType.TASK
  return {
    id: item.id,
    projectId: isTask ? item.parentId : null,
    title: item.title,
    type: isTask ? WorkItemType.TASK : WorkItemType.QUICK_TASK,
    displayStatus,
    assigneeId: item.assigneeId,
    assigneeName: item.assignee?.name ?? null,
    helperCount: item._count.interests,
    helpersWanted: item.helpersWanted,
    deadline: item.deadline,
    completedAt: item.completedAt,
    href: isTask ? `/projects/${item.parentId}/tasks/${item.id}` : `/quick-tasks/${item.id}`,
    viewer: { isAssignee: item.assigneeId === viewer.id, canReview: viewer.canReview },
  }
}

/** The task or Quick Task a link points at, read from an `href` like the one above. */
export function workItemIdFromLink(link: string | null): number | null {
  const match = link?.match(/^\/(?:projects\/\d+\/tasks|quick-tasks)\/(\d+)(?:[/?#]|$)/)
  return match ? Number(match[1]) : null
}

export type SummaryViewer = {
  id: number
  isAdmin: boolean | null
  approvalStatus: string
  nationalChapterId: number | null
}

/**
 * Summaries of the tasks and Quick Tasks among `ids` that `viewer` may see, keyed by id. An
 * item they cannot see (a task on a project outside their scope, someone else's Quick Task),
 * or that is not a task at all, is left out.
 */
export async function loadWorkItemSummaries(
  ids: number[],
  viewer: SummaryViewer,
): Promise<Map<number, WorkItemSummary>> {
  const items = await prisma.workItem.findMany({
    where: { id: { in: ids }, type: { in: [WorkItemType.TASK, WorkItemType.QUICK_TASK] } },
    include: { assignee: { select: { name: true } }, parent: true, ...HELPER_COUNT },
  })
  const projects = new Map(items.flatMap((i) => (i.parent ? [[i.parent.id, i.parent]] : [])))
  const privies = new Map(
    await Promise.all(
      [...projects.values()].map(
        async (p) => [p.id, await resolveProjectPrivy(p, viewer)] as const,
      ),
    ),
  )
  const access = {
    id: viewer.id,
    isAdmin: Boolean(viewer.isAdmin),
    isApproved: viewer.approvalStatus === ApprovalStatus.approved,
    nationalChapterId: viewer.nationalChapterId,
  }
  const visible = items.filter((i) =>
    canViewWorkItem(i, access, i.parent, i.parent ? privies.get(i.parent.id) : undefined),
  )

  const tasks = visible.filter((i) => i.type === WorkItemType.TASK)
  const views = await loadTaskStatusViews(tasks)
  const shown = new Map(tasks.map((t, n) => [t.id, views[n].displayStatus]))
  const deputyOf = new Set(
    (
      await prisma.projectDeputy.findMany({
        where: { volunteerId: viewer.id, projectId: { in: [...projects.keys()] } },
        select: { projectId: true },
      })
    ).map((d) => d.projectId),
  )
  const canReview = (i: (typeof visible)[number]) =>
    Boolean(viewer.isAdmin) ||
    (i.parent !== null && (i.parent.assigneeId === viewer.id || deputyOf.has(i.parent.id)))
  return new Map(
    visible.map((i) => [
      i.id,
      toWorkItemSummary(i, shown.get(i.id) ?? i.status, { id: viewer.id, canReview: canReview(i) }),
    ]),
  )
}
