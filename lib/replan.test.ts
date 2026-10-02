import { describe, expect, it } from 'vitest'
import {
  daysPastPlan,
  pastPlanDetail,
  previewReplan,
  replanWrite,
  stepBase,
  steppedEnd,
} from './replan'
import type { ScheduleInput } from './schedule'

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
const link = (predecessorId: number, successorId: number, lagDays = 0) => ({
  predecessorId,
  successorId,
  lagDays,
})

describe('replan', () => {
  const today = day('2026-10-10')

  it('counts days past plan only for unfinished work someone holds whose plan has ended', () => {
    const held = { done: false, assigned: true }
    expect(daysPastPlan(day('2026-10-07'), held, today)).toBe(3)
    expect(daysPastPlan(day('2026-10-10'), held, today)).toBeNull()
    expect(daysPastPlan(day('2026-10-07'), { ...held, done: true }, today)).toBeNull()
    expect(daysPastPlan(day('2026-10-07'), { ...held, assigned: false }, today)).toBeNull()
  })

  it('keeps a set start, keeps following a predecessor, and starts today with neither', () => {
    expect(
      replanWrite(
        { startDate: day('2026-10-01'), placedStart: day('2026-10-01') },
        day('2026-10-13'),
        today,
      ),
    ).toEqual({ startDate: day('2026-10-01'), durationDays: 13 })
    expect(
      replanWrite({ startDate: null, placedStart: day('2026-10-05') }, day('2026-10-13'), today),
    ).toEqual({ startDate: null, durationDays: 9 })
    expect(replanWrite({ startDate: null, placedStart: null }, day('2026-10-13'), today)).toEqual({
      startDate: day('2026-10-10'),
      durationDays: 4,
    })
    expect(
      replanWrite({ startDate: day('2026-10-05'), placedStart: null }, day('2026-10-01'), today),
    ).toBeNull()
  })

  it('steps from today when the old end has passed, and from the old end when it has not', () => {
    expect(ymd(steppedEnd(day('2026-10-07'), 3, today))).toBe('2026-10-13')
    expect(ymd(steppedEnd(day('2026-10-20'), 1, today))).toBe('2026-10-21')
    expect(ymd(stepBase(day('2026-10-07'), today))).toBe('2026-10-10')
    expect(ymd(stepBase(day('2026-10-20'), today))).toBe('2026-10-20')
  })

  it('previews what moves, what now conflicts, and the key dates it overruns', () => {
    const items = [
      // Book venue, 1–7 Oct, replanned to end 12 Oct.
      item(1, { startDate: day('2026-10-01'), durationDays: 7 }),
      // Follows it: derived, so it moves.
      item(2, { durationDays: 2 }),
      // Follows it but is pinned to 10 Oct: now too early.
      item(3, { startDate: day('2026-10-10') }),
      // The protest, pinned 11 Oct, key date: prep now runs a day past it.
      item(4, { startDate: day('2026-10-11'), durationDays: 0, isAnchor: true }),
      // Unrelated.
      item(5, { startDate: day('2026-10-01') }),
    ]
    const preview = previewReplan(
      items,
      [link(1, 2), link(1, 3), link(1, 4)],
      day('2026-10-01'),
      1,
      { startDate: day('2026-10-01'), durationDays: 12 },
    )
    expect(preview.moved).toEqual([{ id: 2, start: day('2026-10-13'), days: 5 }])
    expect(preview.pinConflicts).toEqual([{ id: 3, days: 3 }])
    expect(preview.keyDatesLate).toEqual([{ id: 4, days: 1 }])
    expect(ymd(preview.endBefore)).toBe('2026-10-11')
    expect(ymd(preview.endAfter)).toBe('2026-10-14')

    const nothing = previewReplan(items, [], day('2026-10-01'), 5, {
      startDate: day('2026-10-01'),
      durationDays: 1,
    })
    expect(nothing).toMatchObject({ moved: [], pinConflicts: [], keyDatesLate: [] })
  })

  it('describes who has a late task and when they last said anything', () => {
    expect(pastPlanDetail({ assigneeName: 'Sam', lastUpdateAt: day('2026-10-05') }, today)).toBe(
      'Assignee: Sam, last update 5 days ago. Replan, reassign or release.',
    )
    expect(pastPlanDetail({ assigneeName: 'Sam', lastUpdateAt: null }, today)).toBe(
      'Assignee: Sam, no update yet. Replan, reassign or release.',
    )
    expect(pastPlanDetail({ assigneeName: 'Sam', lastUpdateAt: day('2026-10-09') })).toMatch(
      /^Assignee: Sam, last update \d+ days? ago/,
    )
  })
})
