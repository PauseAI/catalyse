import { ApprovalStatus, WorkItemType } from '@/generated/prisma/enums'
import { prisma } from './prisma'
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
  assigneeName: string | null
  deadline: Date | null
  completedAt: Date | null
  href: string
}

type SummaryRow = {
  id: number
  type: string
  parentId: number | null
  title: string
  status: string
  deadline: Date | null
  completedAt: Date | null
  assignee: { name: string } | null
}

export function toWorkItemSummary(item: SummaryRow, displayStatus: string): WorkItemSummary {
  const isTask = item.type === WorkItemType.TASK
  return {
    id: item.id,
    projectId: isTask ? item.parentId : null,
    title: item.title,
    type: isTask ? WorkItemType.TASK : WorkItemType.QUICK_TASK,
    displayStatus,
    assigneeName: item.assignee?.name ?? null,
    deadline: item.deadline,
    completedAt: item.completedAt,
    href: isTask ? `/projects/${item.parentId}/tasks/${item.id}` : `/quick-tasks/${item.id}`,
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
  country: string | null
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
    include: { assignee: { select: { name: true } }, parent: true },
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
    country: viewer.country,
  }
  const visible = items.filter((i) =>
    canViewWorkItem(i, access, i.parent, i.parent ? privies.get(i.parent.id) : undefined),
  )

  const tasks = visible.filter((i) => i.type === WorkItemType.TASK)
  const views = await loadTaskStatusViews(tasks)
  const shown = new Map(tasks.map((t, n) => [t.id, views[n].displayStatus]))
  return new Map(visible.map((i) => [i.id, toWorkItemSummary(i, shown.get(i.id) ?? i.status)]))
}
