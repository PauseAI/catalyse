import { describe, expect, it } from 'vitest'
import { auditDates, type AuditItem } from './audit-dates'

const day = (iso: string) => new Date(`${iso}T00:00:00Z`)

function item(id: number, over: Partial<AuditItem> = {}): AuditItem {
  return {
    id,
    type: 'TASK',
    status: 'open',
    parentId: 1,
    deadline: null,
    startDate: null,
    durationDays: null,
    baselineStartDate: null,
    baselineDurationDays: null,
    startedAt: null,
    completedAt: null,
    isAnchor: false,
    ...over,
  }
}

describe('auditDates', () => {
  const today = day('2026-10-10')
  const items: AuditItem[] = [
    item(1, {
      type: 'PROJECT',
      parentId: null,
      startDate: day('2026-10-01'),
      deadline: day('2026-10-02'),
    }),
    // Pinned on the origin, one day, deadline long after: a one-day bar with days to spare.
    item(2, { startDate: day('2026-10-01'), deadline: day('2026-11-30') }),
    // Derived from 2 and five days long (2 Oct – 6 Oct), deadline 4 Oct: two days late.
    item(3, { durationDays: 5, deadline: day('2026-10-04') }),
    // A milestone with work on both sides.
    item(4, { durationDays: 0, isAnchor: true }),
    item(5, { startDate: day('2026-10-01') }),
    item(6, { startDate: day('2026-10-01'), status: 'completed', deadline: day('2026-10-01') }),
    // Deadline only, already past and still open.
    item(7, { deadline: day('2026-10-05') }),
    item(8, { type: 'QUICK_TASK', parentId: null }),
    item(9, { type: 'PROJECT', parentId: null, status: 'archived' }),
  ]
  const edges = [
    { predecessorId: 2, successorId: 3, lagDays: 0 },
    { predecessorId: 3, successorId: 4, lagDays: 0 },
    { predecessorId: 4, successorId: 5, lagDays: 0 },
  ]
  const report = auditDates(items, edges, today)

  it('counts deadline and schedule per type', () => {
    expect(report.byType.TASK).toEqual({
      total: 6,
      open: 5,
      deadline: 4,
      schedule: 5,
      both: 3,
      neither: 0,
      deadlineOnly: 1,
      scheduleOnly: 2,
      overdueOpen: 2,
    })
    expect(report.byType.QUICK_TASK.neither).toBe(1)
    expect(report.byType.PROJECT).toMatchObject({ total: 2, open: 1, deadline: 1 })
  })

  it('measures planned end against the deadline for tasks that have both', () => {
    expect(report.tasksWithBoth.count).toBe(3)
    expect(report.tasksWithBoth.daysLate['30+ days to spare']).toBe(1)
    expect(report.tasksWithBoth.daysLate['1-7 days late']).toBe(1)
    expect(report.tasksWithBoth.daysLate['on the day']).toBe(1)
    expect(report.tasksWithBoth.endAfterDeadline).toBe(1)
    expect(report.tasksWithBoth.oneDayBarPinnedOnOrigin).toBe(2)
  })

  it('finds key-date shapes, stacked pins and late project deadlines', () => {
    expect(report.projects).toEqual({
      total: 2,
      withTasks: 1,
      withAnchor: 1,
      withDeadline: 1,
      deadlineBeforeForecast: 1,
      withMidPlanMilestone: 1,
      withStackedPins: 1,
      tasksInStackedPins: 3,
    })
  })
})
