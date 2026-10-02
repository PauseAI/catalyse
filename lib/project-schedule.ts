/**
 * Server-side scheduling: turning stored work items and dependency rows into a placed timeline.
 *
 * `lib/schedule.ts` is the pure kernel and runs on both client and server. This module is
 * server-only — it loads from Prisma — and adds the two things the kernel cannot know on its own:
 *   - which dependency edges belong to a given scope, and
 *   - where a project's timeline begins, which for a project with project-level predecessors
 *     means running the portfolio pass first.
 */

import { prisma } from './prisma'
import { ProjectStatus, TaskStatus, WorkItemType } from '@/generated/prisma/enums'
import { daysPastPlan } from './replan'
import {
  computeSchedule,
  diffInDays,
  startOfUtcDay,
  type Schedule,
  type ScheduleEdge,
  type ScheduleInput,
} from './schedule'

/** The stored columns the scheduler reads off any work item. */
export type SchedulableWorkItem = {
  id: number
  startDate: Date | null
  durationDays: number | null
  deadline: Date | null
  baselineStartDate: Date | null
  baselineDurationDays: number | null
  startedAt: Date | null
  completedAt: Date | null
  isAnchor?: boolean
}

export function toScheduleInput(w: SchedulableWorkItem): ScheduleInput {
  return {
    id: w.id,
    startDate: w.startDate,
    durationDays: w.durationDays,
    deadline: w.deadline,
    baselineStartDate: w.baselineStartDate,
    baselineDurationDays: w.baselineDurationDays,
    startedAt: w.startedAt,
    completedAt: w.completedAt,
    isAnchor: w.isAnchor ?? false,
  }
}

const SCHEDULABLE_SELECT = {
  id: true,
  startDate: true,
  durationDays: true,
  deadline: true,
  baselineStartDate: true,
  baselineDurationDays: true,
  startedAt: true,
  completedAt: true,
  isAnchor: true,
} as const

/** Inclusive day-count a placed schedule occupies, minimum 1. */
export function spanDays(schedule: Schedule): number {
  if (schedule.scheduled.length === 0) return 1
  return diffInDays(schedule.start, schedule.end) + 1
}

/**
 * Dependency edges where both endpoints are tasks of `projectId`. Rows that point at a task
 * outside this project can exist only through data corruption; they are filtered so a stray
 * one cannot drag an unrelated item into the scope.
 */
export async function loadTaskEdges(projectId: number): Promise<ScheduleEdge[]> {
  const rows = await prisma.workItemDependency.findMany({
    where: {
      predecessor: { parentId: projectId, type: WorkItemType.TASK },
      successor: { parentId: projectId, type: WorkItemType.TASK },
    },
    select: { predecessorId: true, successorId: true, lagDays: true },
  })
  return rows
}

/** Every PROJECT→PROJECT dependency edge in the system. The portfolio graph is small. */
export async function loadProjectEdges(): Promise<ScheduleEdge[]> {
  const rows = await prisma.workItemDependency.findMany({
    where: {
      predecessor: { type: WorkItemType.PROJECT },
      successor: { type: WorkItemType.PROJECT },
    },
    select: { predecessorId: true, successorId: true, lagDays: true },
  })
  return rows
}

/**
 * The absolute calendar day a project's own timeline begins.
 *   1. A pinned `startDate` always wins.
 *   2. With no pin and no project-level predecessor, the timeline begins today.
 *   3. With no pin but a project-level predecessor, run the portfolio pass — schedule every
 *      linked project (each using its task span as its duration unless it sets one explicitly)
 *      and take this project's computed start.
 */
export async function resolveProjectOrigin(
  project: { id: number; startDate: Date | null },
  today: Date = new Date(),
): Promise<Date> {
  if (project.startDate) return startOfUtcDay(project.startDate)

  const projectEdges = await loadProjectEdges()
  if (!projectEdges.some((e) => e.successorId === project.id)) {
    return startOfUtcDay(today)
  }

  const portfolio = await scheduleAllProjects(projectEdges, today)
  return portfolio.byId.get(project.id)?.start ?? startOfUtcDay(today)
}

/**
 * Places a given set of projects on the calendar. A project's duration is its explicit
 * `durationDays` when set, otherwise the span of its own tasks (scheduled from a zero origin —
 * only the width matters here). Project-level edges pointing outside `ids` are ignored by the
 * scheduler, so passing the full edge list is safe.
 */
export async function scheduleProjectsByIds(
  ids: number[],
  projectEdges: ScheduleEdge[],
  today: Date = new Date(),
): Promise<Schedule> {
  const projects = await prisma.workItem.findMany({
    where: { id: { in: ids }, type: WorkItemType.PROJECT },
    select: SCHEDULABLE_SELECT,
  })

  const origin = startOfUtcDay(today)
  const nodes: ScheduleInput[] = await Promise.all(
    projects.map(async (p) => {
      const base = toScheduleInput(p)
      if (p.durationDays !== null) return base
      const tasks = await prisma.workItem.findMany({
        where: { parentId: p.id, type: WorkItemType.TASK },
        select: SCHEDULABLE_SELECT,
      })
      if (tasks.length === 0) return base
      const taskEdges = await loadTaskEdges(p.id)
      const taskSchedule = computeSchedule(tasks.map(toScheduleInput), taskEdges, origin)
      return { ...base, durationDays: spanDays(taskSchedule) }
    }),
  )

  return computeSchedule(nodes, projectEdges, origin)
}

/**
 * Portfolio pass over just the projects that participate in a project-level link — used to
 * resolve one project's absolute start (see resolveProjectOrigin).
 */
export async function scheduleAllProjects(
  projectEdges: ScheduleEdge[],
  today: Date = new Date(),
): Promise<Schedule> {
  const linkedIds = new Set<number>()
  for (const e of projectEdges) {
    linkedIds.add(e.predecessorId)
    linkedIds.add(e.successorId)
  }
  return scheduleProjectsByIds([...linkedIds], projectEdges, today)
}

/**
 * Full task-level schedule for one project: its edges loaded, its origin resolved (portfolio
 * pass included when needed), and its tasks placed.
 */
export async function loadProjectTaskSchedule(
  project: { id: number; startDate: Date | null },
  tasks: SchedulableWorkItem[],
): Promise<{ schedule: Schedule; edges: ScheduleEdge[]; origin: Date }> {
  const [edges, origin] = await Promise.all([
    loadTaskEdges(project.id),
    resolveProjectOrigin(project),
  ])
  const schedule = computeSchedule(tasks.map(toScheduleInput), edges, origin)
  return { schedule, edges, origin }
}

const CLOSED_PROJECT_STATUSES: string[] = [ProjectStatus.completed, ProjectStatus.archived]

/**
 * How many days each open project's plan runs past its own deadline, keyed by id. Only projects
 * that are late appear: one with no deadline, no dated task, or time to spare is left out. The
 * plan's end is the latest end among tasks that have a start, a duration or a predecessor, so a
 * task nobody has put on the timeline does not count as finishing on the first day.
 */
export async function lateProjects(
  projects: { id: number; status: string; startDate: Date | null; deadline: Date | null }[],
): Promise<Map<number, number>> {
  const late = new Map<number, number>()
  const candidates = projects.filter(
    (p): p is typeof p & { deadline: Date } =>
      p.deadline !== null && !CLOSED_PROJECT_STATUSES.includes(p.status),
  )
  await Promise.all(
    candidates.map(async (project) => {
      const tasks = await prisma.workItem.findMany({
        where: { parentId: project.id, type: WorkItemType.TASK },
        select: SCHEDULABLE_SELECT,
      })
      const { schedule, edges } = await loadProjectTaskSchedule(project, tasks)
      const hasPredecessor = new Set(edges.map((e) => e.successorId))
      const dated = tasks.filter(
        (t) => t.startDate !== null || t.durationDays !== null || hasPredecessor.has(t.id),
      )
      if (dated.length === 0) return
      const end = Math.max(...dated.map((t) => schedule.byId.get(t.id)?.end.getTime() ?? 0))
      const days = diffInDays(project.deadline, new Date(end))
      if (days > 0) late.set(project.id, days)
    }),
  )
  return late
}

/** Statuses in which a project's plan is live, so a task running past it needs a decision. */
const LIVE_PROJECT_STATUSES: string[] = [ProjectStatus.ready, ProjectStatus.in_progress]

export type PastPlanTask = {
  id: number
  title: string
  projectId: number
  projectTitle: string
  daysPast: number
  assigneeId: number
  assigneeName: string
  /** When the assignee last posted on the task, or null if they never have. */
  lastUpdateAt: Date | null
}

/**
 * Tasks on live projects whose planned end has passed while someone holds them and they are
 * not done. Only tasks on the timeline count: one with no dates has no plan to be past.
 */
export async function pastPlanTasks(
  projectIds: number[],
  today: Date = new Date(),
): Promise<PastPlanTask[]> {
  const projects = await prisma.workItem.findMany({
    where: {
      id: { in: projectIds },
      type: WorkItemType.PROJECT,
      status: { in: LIVE_PROJECT_STATUSES },
    },
    select: { id: true, title: true, startDate: true },
  })
  const found: PastPlanTask[] = []
  for (const project of projects) {
    const tasks = await prisma.workItem.findMany({
      where: { parentId: project.id, type: WorkItemType.TASK },
      select: {
        ...SCHEDULABLE_SELECT,
        title: true,
        status: true,
        assigneeId: true,
        assignee: { select: { name: true } },
      },
    })
    const { schedule, edges } = await loadProjectTaskSchedule(project, tasks)
    const hasPredecessor = new Set(edges.map((e) => e.successorId))
    // The schedule lists the tasks in the order they were given.
    for (const [i, t] of tasks.entries()) {
      if (t.startDate === null && t.durationDays === null && !hasPredecessor.has(t.id)) continue
      const placed = schedule.scheduled[i]
      const days = daysPastPlan(
        placed.end,
        { done: t.status === TaskStatus.completed, assigned: t.assignee !== null },
        today,
      )
      if (days === null || t.assigneeId === null || t.assignee === null) continue
      const lastUpdate = await prisma.workItemComment.findFirst({
        where: { workItemId: t.id, authorId: t.assigneeId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      })
      found.push({
        id: t.id,
        title: t.title,
        projectId: project.id,
        projectTitle: project.title,
        daysPast: days,
        assigneeId: t.assigneeId,
        assigneeName: t.assignee.name,
        lastUpdateAt: lastUpdate?.createdAt ?? null,
      })
    }
  }
  return found
}
