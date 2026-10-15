/**
 * What a project task's status reads as. The stored status is the work's own progress
 * (not_started, in_progress, under_review, completed); whether work not yet started can start is
 * worked out from its dependencies here, never stored or set by hand.
 *
 * Quick Tasks are not shown through this: they have no dependencies, and their own enum
 * (`QuickTaskStatus`) still calls an unclaimed one `open`.
 */

export type TaskDisplayStatus = 'blocked' | 'ready' | 'in_progress' | 'under_review' | 'completed'

export type TaskRef = { id: number; title: string }

export type TaskStatusView = {
  displayStatus: TaskDisplayStatus
  /** Open predecessors of work not yet started: what it is "Blocked by". */
  blockedBy: TaskRef[]
  /** Open predecessors of work already under way: shown as a warning, not as Blocked. */
  waitingOn: TaskRef[]
}

/**
 * The status a task is shown with. Work someone has started stays In progress even while a task
 * before it is open again (prep can legitimately start early); it says what it waits on instead.
 */
export function taskDisplayStatus(
  task: { status: string },
  predecessors: { id: number; title: string; status: string }[],
): TaskStatusView {
  if (task.status === 'completed' || task.status === 'under_review') {
    return { displayStatus: task.status, blockedBy: [], waitingOn: [] }
  }
  const open = predecessors
    .filter((p) => p.status !== 'completed')
    .map((p) => ({ id: p.id, title: p.title }))
  if (task.status === 'in_progress') {
    return { displayStatus: 'in_progress', blockedBy: [], waitingOn: open }
  }
  return open.length > 0
    ? { displayStatus: 'blocked', blockedBy: open, waitingOn: [] }
    : { displayStatus: 'ready', blockedBy: [], waitingOn: [] }
}

/** "'Book the venue' and 'Print flyers'", for a Blocked by or Still waiting on line. */
export function quotedTitles(refs: TaskRef[]): string {
  const quoted = refs.map((r) => `'${r.title}'`)
  return quoted.length <= 1
    ? quoted.join('')
    : `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`
}

/**
 * Every task's shown status, in the order given, from one project's tasks and its dependency
 * edges. An edge whose predecessor is not among `tasks` (deleted, or in another project) is
 * ignored.
 */
export function taskStatusViews(
  tasks: { id: number; title: string; status: string }[],
  edges: { predecessorId: number; successorId: number }[],
): TaskStatusView[] {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  return tasks.map((task) =>
    taskDisplayStatus(
      task,
      edges.flatMap((e) => {
        const p = e.successorId === task.id ? byId.get(e.predecessorId) : undefined
        return p ? [p] : []
      }),
    ),
  )
}
