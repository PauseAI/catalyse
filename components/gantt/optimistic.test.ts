import { describe, expect, it } from 'vitest'
import { computeSchedule, type ScheduleEdge } from '@/lib/schedule'
import { scheduleWithPatches, type ClientSchedulable } from './optimistic'

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const ymd = (d: Date) => d.toISOString().slice(0, 10)

const origin = day('2026-03-02')

function task(id: number, over: Partial<ClientSchedulable> = {}): ClientSchedulable {
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

const found = (scheduled: ReturnType<typeof scheduleWithPatches>, id: number) =>
  scheduled.find((s) => s.id === id)!

describe('scheduleWithPatches', () => {
  it('moves the dragged bar to where it was dropped', () => {
    const scheduled = scheduleWithPatches(
      [task(1, { startDate: day('2026-03-10'), durationDays: 3 })],
      [],
      origin,
      [{ id: 1, startDate: day('2026-03-14') }],
    )
    expect(ymd(found(scheduled, 1).start)).toBe('2026-03-14')
    expect(ymd(found(scheduled, 1).end)).toBe('2026-03-16')
  })

  it('cascades the move onto everything derived from it', () => {
    const scheduled = scheduleWithPatches(
      [task(1, { startDate: day('2026-03-10'), durationDays: 3 }), task(2, { durationDays: 2 })],
      [link(1, 2)],
      origin,
      [{ id: 1, startDate: day('2026-03-14') }],
    )
    expect(ymd(found(scheduled, 2).start)).toBe('2026-03-17')
  })

  it('changes only the duration for a resize, leaving the start alone', () => {
    const scheduled = scheduleWithPatches(
      [task(1, { startDate: day('2026-03-10'), durationDays: 3 })],
      [],
      origin,
      [{ id: 1, startDate: day('2026-03-10'), durationDays: 6 }],
    )
    expect(ymd(found(scheduled, 1).start)).toBe('2026-03-10')
    expect(ymd(found(scheduled, 1).end)).toBe('2026-03-15')
  })

  it('leaves the duration untouched when the patch omits it', () => {
    const scheduled = scheduleWithPatches(
      [task(1, { startDate: day('2026-03-10'), durationDays: 4 })],
      [],
      origin,
      [{ id: 1, startDate: day('2026-03-12') }],
    )
    expect(ymd(found(scheduled, 1).end)).toBe('2026-03-15')
  })

  it('unpins an item when the patch clears its start', () => {
    const scheduled = scheduleWithPatches(
      [task(1, { startDate: day('2026-03-20'), durationDays: 2 })],
      [],
      origin,
      [{ id: 1, startDate: null }],
    )
    expect(found(scheduled, 1).isPinned).toBe(false)
    expect(ymd(found(scheduled, 1).start)).toBe('2026-03-02')
  })

  it('recounts the days late while a bar is dragged past its deadline', () => {
    const scheduled = scheduleWithPatches(
      [task(1, { startDate: day('2026-03-10'), durationDays: 3, deadline: '2026-03-13' })],
      [],
      origin,
      [{ id: 1, startDate: day('2026-03-14') }],
    )
    expect(found(scheduled, 1)).toMatchObject({ daysLate: 3, breachesDeadline: true })
  })

  it('accepts the serialised date strings that arrive over the wire', () => {
    const scheduled = scheduleWithPatches(
      [task(1, { startDate: '2026-03-10T00:00:00.000Z', durationDays: 3 })],
      [],
      '2026-03-02T00:00:00.000Z',
      [{ id: 1, startDate: '2026-03-14T00:00:00.000Z' }],
    )
    expect(ymd(found(scheduled, 1).start)).toBe('2026-03-14')
  })

  it('leaves every unpatched item exactly where it was', () => {
    const tasks = [
      task(1, { startDate: day('2026-03-10'), durationDays: 3 }),
      task(2, { startDate: day('2026-03-20'), durationDays: 2 }),
    ]
    const scheduled = scheduleWithPatches(tasks, [], origin, [
      { id: 1, startDate: day('2026-03-14') },
    ])
    expect(ymd(found(scheduled, 2).start)).toBe('2026-03-20')
  })

  /**
   * The whole point of the optimistic path: it must land the bar where the server will put it,
   * or the drag settles and then visibly jumps a moment later.
   */
  it('agrees with the schedule the server will compute from the saved patch', () => {
    const tasks = [
      task(1, { startDate: day('2026-03-10'), durationDays: 3, isAnchor: true }),
      task(2, { durationDays: 2 }),
      task(3, { durationDays: 4 }),
    ]
    const edges = [link(1, 2), link(2, 3, 2)]
    const patch = { id: 1, startDate: day('2026-03-16'), durationDays: 5 }

    const optimistic = scheduleWithPatches(tasks, edges, origin, [patch])

    // What the server stores, then reschedules from.
    const saved = tasks.map((t) =>
      t.id === patch.id
        ? { ...t, startDate: patch.startDate, durationDays: patch.durationDays }
        : t,
    )
    const authoritative = computeSchedule(
      saved.map((t) => ({
        id: t.id,
        startDate: t.startDate as Date | null,
        durationDays: t.durationDays,
        deadline: null,
        baselineStartDate: null,
        baselineDurationDays: null,
        startedAt: null,
        completedAt: null,
        isAnchor: t.isAnchor ?? false,
      })),
      edges,
      origin,
    ).scheduled

    expect(optimistic).toEqual(authoritative)
  })
})
