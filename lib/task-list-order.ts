import { handedIn, isOverdue } from './overdue'
import type { TaskDisplayStatus } from './task-status'

type ListedTask = {
  displayStatus: TaskDisplayStatus
  assignedToId: number | null
  deadline: Date | null
}

export type TaskFilter = 'done' | 'overdue' | 'blocked' | 'unclaimed'
export const TASK_FILTERS: TaskFilter[] = ['done', 'overdue', 'blocked', 'unclaimed']

/**
 * Whether a task shows under one of the Tasks tab's filters. The Overview's status bar counts
 * with this too, so each count matches the list its link opens. Unclaimed is open work with
 * nobody on it, blocked or not.
 */
export function matchesTaskFilter(
  task: ListedTask & { status: string },
  filter: TaskFilter,
  now: Date = new Date(),
): boolean {
  switch (filter) {
    case 'done':
      return task.displayStatus === 'completed'
    case 'overdue':
      return isOverdue(task.deadline, handedIn(task.status), now)
    case 'blocked':
      return task.displayStatus === 'blocked'
    case 'unclaimed':
      return task.assignedToId === null && !handedIn(task.status)
  }
}

export type TaskCounts = { total: number } & Record<TaskFilter, number>

export function taskCounts(
  tasks: (ListedTask & { status: string })[],
  now: Date = new Date(),
): TaskCounts {
  const count = (filter: TaskFilter) =>
    tasks.filter((t) => matchesTaskFilter(t, filter, now)).length
  return {
    total: tasks.length,
    done: count('done'),
    overdue: count('overdue'),
    blocked: count('blocked'),
    unclaimed: count('unclaimed'),
  }
}

/** Ready and unclaimed first, as that is what someone can pick up now; finished work last. */
function groupRank(task: ListedTask): number {
  switch (task.displayStatus) {
    case 'ready':
      return task.assignedToId === null ? 0 : 1
    case 'in_progress':
      return 2
    case 'under_review':
      return 3
    case 'blocked':
      return 4
    case 'completed':
      return 5
  }
}

/**
 * A project's task list as it is shown by default: grouped by shown status, then by deadline
 * (none last), then in the manual order `tasks` arrive in. Done tasks come back apart, for the
 * list to fold away.
 */
export function tasksByStatus<T extends ListedTask>(tasks: T[]): { open: T[]; done: T[] } {
  const sorted = tasks
    .map((task, manual) => ({ task, manual, rank: groupRank(task) }))
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        (a.task.deadline?.getTime() ?? Infinity) - (b.task.deadline?.getTime() ?? Infinity) ||
        a.manual - b.manual,
    )
    .map((s) => s.task)
  return {
    open: sorted.filter((t) => t.displayStatus !== 'completed'),
    done: sorted.filter((t) => t.displayStatus === 'completed'),
  }
}
