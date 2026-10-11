import type { TaskDisplayStatus } from './task-status'

type ListedTask = {
  displayStatus: TaskDisplayStatus
  assignedToId: number | null
  deadline: Date | null
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
