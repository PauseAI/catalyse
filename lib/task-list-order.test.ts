import { describe, expect, it } from 'vitest'
import { tasksByStatus } from './task-list-order'
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
