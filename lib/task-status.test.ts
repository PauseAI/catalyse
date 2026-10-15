import { describe, expect, it } from 'vitest'
import { quotedTitles, taskDisplayStatus, taskStatusViews } from './task-status'

const emergency = { id: 1, title: 'Emergency thing', status: 'not_started' }
const stall = { id: 2, title: 'Pack flyering stall kit', status: 'completed' }

describe('taskDisplayStatus', () => {
  it('shows a finished task as done and a handed-in one as submitted, whatever waits before it', () => {
    expect(taskDisplayStatus({ status: 'completed' }, [emergency])).toEqual({
      displayStatus: 'completed',
      blockedBy: [],
      waitingOn: [],
    })
    expect(taskDisplayStatus({ status: 'under_review' }, [emergency])).toEqual({
      displayStatus: 'under_review',
      blockedBy: [],
      waitingOn: [],
    })
  })

  it('blocks work not yet started on any open predecessor, and names it', () => {
    expect(taskDisplayStatus({ status: 'not_started' }, [emergency, stall])).toEqual({
      displayStatus: 'blocked',
      blockedBy: [{ id: 1, title: 'Emergency thing' }],
      waitingOn: [],
    })
  })

  it('counts a submitted predecessor as still open', () => {
    const submitted = { ...emergency, status: 'under_review' }
    expect(taskDisplayStatus({ status: 'not_started' }, [submitted]).displayStatus).toBe('blocked')
  })

  it('reads work not yet started as ready once every predecessor is done, or with none', () => {
    expect(taskDisplayStatus({ status: 'not_started' }, [stall]).displayStatus).toBe('ready')
    expect(taskDisplayStatus({ status: 'not_started' }, []).displayStatus).toBe('ready')
  })

  it('keeps started work in progress while a predecessor is open, and says what it waits on', () => {
    expect(taskDisplayStatus({ status: 'in_progress' }, [emergency, stall])).toEqual({
      displayStatus: 'in_progress',
      blockedBy: [],
      waitingOn: [{ id: 1, title: 'Emergency thing' }],
    })
    expect(taskDisplayStatus({ status: 'in_progress' }, []).waitingOn).toEqual([])
  })
})

describe('taskStatusViews', () => {
  const a = { id: 1, title: 'A', status: 'completed' }
  const b = { id: 2, title: 'B', status: 'not_started' }
  const c = { id: 3, title: 'C', status: 'not_started' }

  it('reads each task in a chain from its own predecessors only', () => {
    const views = taskStatusViews(
      [a, b, c],
      [
        { predecessorId: 1, successorId: 2 },
        { predecessorId: 2, successorId: 3 },
      ],
    )
    expect(views.map((v) => v.displayStatus)).toEqual(['completed', 'ready', 'blocked'])
    expect(views[2].blockedBy).toEqual([{ id: 2, title: 'B' }])
  })

  it('ignores an edge whose predecessor is no longer among the tasks', () => {
    const views = taskStatusViews([b], [{ predecessorId: 99, successorId: 2 }])
    expect(views[0].displayStatus).toBe('ready')
  })
})

describe('quotedTitles', () => {
  it('quotes one title, and joins several with commas and a final "and"', () => {
    expect(quotedTitles([{ id: 1, title: 'A' }])).toBe("'A'")
    expect(
      quotedTitles([
        { id: 1, title: 'A' },
        { id: 2, title: 'B' },
        { id: 3, title: 'C' },
      ]),
    ).toBe("'A', 'B' and 'C'")
  })
})
