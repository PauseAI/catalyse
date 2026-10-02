import { describe, expect, it } from 'vitest'
import {
  computeSchedule,
  findDependencyCycle,
  type ScheduleEdge,
  type ScheduleInput,
} from './schedule'
import { applyScheduleWrite } from './work-item'

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const ymd = (d: Date) => d.toISOString().slice(0, 10)

function item(id: number, over: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    id,
    startDate: null,
    durationDays: null,
    deadline: null,
    baselineStartDate: null,
    baselineDurationDays: null,
    startedAt: null,
    completedAt: null,
    ...over,
  }
}

const link = (predecessorId: number, successorId: number, lagDays = 0): ScheduleEdge => ({
  predecessorId,
  successorId,
  lagDays,
})

const origin = day('2026-03-02')

describe('computeSchedule', () => {
  it('reads a null duration as one day', () => {
    const [only] = computeSchedule(
      [item(1, { startDate: day('2026-03-10') })],
      [],
      origin,
    ).scheduled
    expect(ymd(only.start)).toBe('2026-03-10')
    expect(ymd(only.end)).toBe('2026-03-10')
  })

  it('places a zero-day milestone on its start day and marks it as one', () => {
    const [milestone] = computeSchedule(
      [item(1, { startDate: day('2026-03-10'), durationDays: 0 })],
      [],
      origin,
    ).scheduled
    expect(milestone.isMilestone).toBe(true)
    expect(ymd(milestone.start)).toBe('2026-03-10')
    expect(ymd(milestone.end)).toBe('2026-03-10')
  })

  it('starts a successor of a milestone the following day', () => {
    const { byId } = computeSchedule(
      [item(1, { startDate: day('2026-03-10'), durationDays: 0 }), item(2, { durationDays: 3 })],
      [link(1, 2)],
      origin,
    )
    expect(ymd(byId.get(2)!.start)).toBe('2026-03-11')
  })

  it('falls back to the scope origin when an item has neither a pin nor a predecessor', () => {
    const [bare] = computeSchedule([item(1, { durationDays: 3 })], [], origin).scheduled
    expect(ymd(bare.start)).toBe('2026-03-02')
    expect(ymd(bare.end)).toBe('2026-03-04')
  })

  it('leaves the baseline null when the item has none, so variance is not invented', () => {
    const [none] = computeSchedule(
      [item(1, { startDate: day('2026-03-10') })],
      [],
      origin,
    ).scheduled
    expect(none.baseline).toBeNull()
    expect(none.startVarianceDays).toBeNull()
  })

  it('measures variance from the baseline when one is set', () => {
    const [late] = computeSchedule(
      [
        item(1, {
          startDate: day('2026-03-12'),
          durationDays: 2,
          baselineStartDate: day('2026-03-10'),
          baselineDurationDays: 2,
        }),
      ],
      [],
      origin,
    ).scheduled
    expect(late.startVarianceDays).toBe(2)
    expect(late.finishVarianceDays).toBe(2)
  })

  it('flags a pin that sits earlier than its dependencies allow, and keeps the pin', () => {
    const { byId } = computeSchedule(
      [
        item(1, { startDate: day('2026-03-10'), durationDays: 5 }),
        item(2, { startDate: day('2026-03-11'), durationDays: 2 }),
      ],
      [link(1, 2)],
      origin,
    )
    expect(byId.get(2)!.pinnedBeforePredecessor).toBe(true)
    expect(ymd(byId.get(2)!.start)).toBe('2026-03-11')
    // Predecessor ends 14 Mar, so the earliest permitted start is 15 Mar: four days after the pin.
    expect(byId.get(2)!.pinConflictDays).toBe(4)
    expect(byId.get(2)!.pinConflictWith).toBe(1)
    expect(byId.get(1)!.pinConflictDays).toBeNull()
    expect(byId.get(1)!.pinConflictWith).toBeNull()
  })

  it('names the predecessor that binds hardest, lag included', () => {
    const { byId } = computeSchedule(
      [
        item(1, { startDate: day('2026-03-10'), durationDays: 5 }),
        item(2, { startDate: day('2026-03-10'), durationDays: 2 }),
        item(3, { startDate: day('2026-03-10') }),
      ],
      [link(1, 3), link(2, 3, 6)],
      origin,
    )
    // 1 permits 15 Mar; 2 ends 11 Mar and with six days' lag permits 18 Mar.
    expect(byId.get(3)!.pinConflictWith).toBe(2)
    expect(byId.get(3)!.pinConflictDays).toBe(8)
  })

  it('counts days late or to spare against the deadline', () => {
    // A task ending 1 Oct with a deadline of 30 Sept is one day late.
    const { byId } = computeSchedule(
      [
        item(1, { startDate: day('2026-09-20'), durationDays: 12, deadline: day('2026-09-30') }),
        item(2, { startDate: day('2026-09-20'), deadline: new Date('2026-09-23T15:00:00Z') }),
        item(3, { startDate: day('2026-09-20'), durationDays: 0, deadline: day('2026-09-20') }),
        item(4, { startDate: day('2026-09-20') }),
      ],
      [],
      origin,
    )
    expect(byId.get(1)).toMatchObject({ daysLate: 1, breachesDeadline: true })
    expect(ymd(byId.get(1)!.deadline!)).toBe('2026-09-30')
    // A deadline carrying a time of day is read as its UTC day.
    expect(byId.get(2)).toMatchObject({ daysLate: -3, breachesDeadline: false })
    expect(ymd(byId.get(2)!.deadline!)).toBe('2026-09-23')
    expect(byId.get(3)).toMatchObject({ daysLate: 0, breachesDeadline: false })
    expect(byId.get(4)).toMatchObject({ deadline: null, daysLate: null, breachesDeadline: false })
  })

  it('does not hang on a dependency cycle', () => {
    const { scheduled } = computeSchedule(
      [item(1, { durationDays: 2 }), item(2, { durationDays: 2 })],
      [link(1, 2), link(2, 1)],
      origin,
    )
    expect(scheduled).toHaveLength(2)
  })
})

describe('findDependencyCycle', () => {
  it('returns null for an acyclic graph, including a diamond', () => {
    expect(findDependencyCycle([])).toBeNull()
    expect(findDependencyCycle([link(1, 2), link(1, 3), link(2, 4), link(3, 4)])).toBeNull()
  })

  it('returns the ids that close the loop', () => {
    expect(findDependencyCycle([link(1, 2), link(2, 3), link(3, 2)])).toEqual([2, 3, 2])
    expect(findDependencyCycle([link(5, 5)])).toEqual([5, 5])
  })

  it('finds a cycle reached only from a later root', () => {
    expect(findDependencyCycle([link(1, 2), link(3, 4), link(4, 3)])).toEqual([3, 4, 3])
  })
})

describe('computeSchedule with converging and diverging edges', () => {
  it('starts an item after the later of two predecessors', () => {
    const s = computeSchedule(
      [item(1, { durationDays: 1 }), item(2, { durationDays: 3 }), item(3)],
      [link(1, 3), link(2, 3), link(1, 2)],
      origin,
    )
    expect(ymd(s.byId.get(3)!.start)).toBe('2026-03-06')
  })
})

describe('critical path', () => {
  /** prep → event → followUp, where followUp is the longest and finishes last. */
  const chain = () => ({
    items: [
      item(1, { startDate: day('2026-03-02'), durationDays: 5 }),
      item(2, { durationDays: 1 }),
      item(3, { durationDays: 10 }),
    ],
    edges: [link(1, 2), link(2, 3)],
  })

  it('seeds from the latest finish when nothing is anchored', () => {
    const { items, edges } = chain()
    const { byId } = computeSchedule(items, edges, origin)
    expect(byId.get(3)!.isCritical).toBe(true)
    expect(byId.get(1)!.isCritical).toBe(true)
  })

  it('seeds from the anchor instead, leaving work that only trails it slack', () => {
    const { items, edges } = chain()
    items[1] = { ...items[1], isAnchor: true }
    const { byId } = computeSchedule(items, edges, origin)

    expect(byId.get(2)!.isAnchor).toBe(true)
    expect(byId.get(2)!.isCritical).toBe(true)
    expect(byId.get(1)!.isCritical).toBe(true)
    // Finishes last, but nothing depends on it — so it cannot delay the anchor.
    expect(byId.get(3)!.isCritical).toBe(false)
  })

  it('does not mark a predecessor that finishes with slack before its successor', () => {
    const { byId } = computeSchedule(
      [
        // Ends 2026-03-06, a week clear of the pinned successor.
        item(1, { startDate: day('2026-03-02'), durationDays: 5 }),
        item(2, { startDate: day('2026-03-16'), durationDays: 1, isAnchor: true }),
      ],
      [link(1, 2)],
      origin,
    )
    expect(byId.get(2)!.isCritical).toBe(true)
    expect(byId.get(1)!.isCritical).toBe(false)
  })

  it('counts lag as part of the constraint, so a lagged chain is still critical', () => {
    const { byId } = computeSchedule(
      [
        item(1, { startDate: day('2026-03-02'), durationDays: 5 }),
        item(2, { durationDays: 1, isAnchor: true }),
      ],
      [link(1, 2, 3)],
      origin,
    )
    expect(byId.get(1)!.isCritical).toBe(true)
  })
})

describe('applyScheduleWrite', () => {
  it('stamps scheduleUpdatedAt when the schedule moves', () => {
    const data: Record<string, unknown> = {}
    const now = day('2026-03-02')
    expect(applyScheduleWrite(data, { startDate: day('2026-03-10') }, now)).toBe(true)
    expect(data.scheduleUpdatedAt).toEqual(now)
  })

  it('reports no change when the write touches neither start nor duration', () => {
    const data: Record<string, unknown> = {}
    expect(applyScheduleWrite(data, {})).toBe(false)
    expect(data).toEqual({})
  })

  it('never captures a baseline — that is only ever a deliberate act', () => {
    const data: Record<string, unknown> = {}
    applyScheduleWrite(data, { startDate: day('2026-03-10'), durationDays: 4 })
    expect(data).not.toHaveProperty('baselineStartDate')
    expect(data).not.toHaveProperty('baselineDurationDays')
    expect(data).not.toHaveProperty('baselineSetAt')
  })

  it('writes an explicit null through, so a date can be cleared', () => {
    const data: Record<string, unknown> = {}
    applyScheduleWrite(data, { startDate: null })
    expect(data.startDate).toBeNull()
  })
})
