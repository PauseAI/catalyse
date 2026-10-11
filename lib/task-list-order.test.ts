import { describe, expect, it } from 'vitest'
import { matchesTaskFilter, taskCounts, tasksByStatus } from './task-list-order'
import type { TaskDisplayStatus } from './task-status'

const task = (
  name: string,
  displayStatus: TaskDisplayStatus,
  {
    assignedToId = null,
    deadline = null,
  }: { assignedToId?: number | null; deadline?: string | null } = {},
) => ({
  name,
  displayStatus,
  assignedToId,
  deadline: deadline ? new Date(deadline) : null,
})
const names = (tasks: { name: string }[]) => tasks.map((t) => t.name)

describe('tasksByStatus', () => {
  it('puts ready work first, unclaimed before claimed, and done work apart', () => {
    const { open, done } = tasksByStatus([
      task('done', 'completed'),
      task('blocked', 'blocked'),
      task('review', 'under_review'),
      task('doing', 'in_progress', { assignedToId: 1 }),
      task('claimed', 'ready', { assignedToId: 1 }),
      task('free', 'ready'),
    ])
    expect(names(open)).toEqual(['free', 'claimed', 'doing', 'review', 'blocked'])
    expect(names(done)).toEqual(['done'])
  })

  it('orders a group by deadline, none last, then by the order given', () => {
    const { open } = tasksByStatus([
      task('no date A', 'ready'),
      task('later', 'ready', { deadline: '2030-02-01' }),
      task('no date B', 'ready'),
      task('sooner', 'ready', { deadline: '2030-01-01' }),
      task('sooner too', 'ready', { deadline: '2030-01-01' }),
    ])
    expect(names(open)).toEqual(['sooner', 'sooner too', 'later', 'no date A', 'no date B'])
  })
})

describe('matchesTaskFilter / taskCounts', () => {
  const now = new Date('2030-01-10T12:00:00Z')
  const counted = (
    status: string,
    displayStatus: TaskDisplayStatus,
    rest: { assignedToId?: number | null; deadline?: string | null } = {},
  ) => ({ ...task(status, displayStatus, rest), status })
  const tasks = [
    counted('completed', 'completed', { deadline: '2030-01-01' }),
    counted('under_review', 'under_review', { assignedToId: 1, deadline: '2030-01-01' }),
    counted('in_progress', 'in_progress', { assignedToId: 1, deadline: '2030-01-09' }),
    counted('not_started', 'blocked', { deadline: '2030-01-10' }),
    counted('not_started', 'ready'),
    counted('not_started', 'ready', { assignedToId: 2 }),
  ]

  it('counts each filter, with overdue from the day after the deadline and handed-in work off the clock', () => {
    expect(taskCounts(tasks, now)).toEqual({
      total: 6,
      done: 1,
      overdue: 1,
      blocked: 1,
      unclaimed: 2,
    })
    expect(tasks.filter((t) => matchesTaskFilter(t, 'overdue', now))).toEqual([tasks[2]])
    expect(tasks.filter((t) => matchesTaskFilter(t, 'unclaimed', now))).toEqual([
      tasks[3],
      tasks[4],
    ])
  })

  it('reads today by default', () => {
    expect(taskCounts([counted('not_started', 'ready', { deadline: '2000-01-01' })]).overdue).toBe(
      1,
    )
  })
})
