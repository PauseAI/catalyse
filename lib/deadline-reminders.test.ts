import { describe, expect, it } from 'vitest'
import {
  isOverdueReminderDay,
  reminderStages,
  shouldAlertSlip,
  stagesToday,
  type TaskClock,
} from './deadline-reminders'

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

describe('reminderStages', () => {
  it('gives each span the check-ins and day-before reminder in the table', () => {
    expect(reminderStages(1)).toEqual({ checkIns: [], dayBefore: null })
    expect(reminderStages(3)).toEqual({ checkIns: [], dayBefore: 1 })
    expect(reminderStages(7)).toEqual({ checkIns: [4], dayBefore: 1 })
    expect(reminderStages(10)).toEqual({ checkIns: [5], dayBefore: 1 })
    expect(reminderStages(14)).toEqual({ checkIns: [7], dayBefore: 2 })
    expect(reminderStages(21)).toEqual({ checkIns: [14, 7], dayBefore: 2 })
    expect(reminderStages(30)).toEqual({ checkIns: [21, 14, 7], dayBefore: 2 })
  })

  it('reminds an overdue assignee daily for a week, then every three days, to day 28', () => {
    const days = Array.from({ length: 35 }, (_, i) => i + 1).filter(isOverdueReminderDay)
    expect(days).toEqual([1, 2, 3, 4, 5, 6, 7, 10, 13, 16, 19, 22, 25, 28])
    expect(isOverdueReminderDay(0)).toBe(false)
  })
})

describe('stagesToday', () => {
  // Assigned 1 Oct, due 11 Oct: S = 10.
  const clock: TaskClock = {
    clockStart: day('2026-10-01'),
    finishBy: day('2026-10-11'),
    takenAt: day('2026-10-01'),
    lastUpdateAt: null,
    remindersSince: day('2026-09-01'),
  }
  const on = (iso: string, over: Partial<TaskClock> = {}) =>
    stagesToday({ ...clock, ...over }, day(iso))

  it('follows the medium example day by day', () => {
    expect(on('2026-10-05')).toMatchObject({ assignee: [], owner: [] })
    expect(on('2026-10-06')).toMatchObject({ assignee: ['check_in'], owner: ['at_risk'] })
    expect(on('2026-10-10')).toMatchObject({
      assignee: ['day_before'],
      owner: ['due_tomorrow'],
      daysLeft: 1,
    })
    expect(on('2026-10-11')).toMatchObject({ assignee: ['due_today'], owner: ['due_today'] })
    const overdueDays = [
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
      '2026-10-21',
      '2026-10-24',
      '2026-10-27',
      '2026-10-30',
      '2026-11-02',
      '2026-11-05',
      '2026-11-08',
    ]
    for (
      let d = day('2026-10-12');
      d <= day('2026-11-20');
      d = new Date(d.getTime() + 86_400_000)
    ) {
      const iso = d.toISOString().slice(0, 10)
      const st = on(iso)
      expect(st.owner).toEqual(['overdue'])
      expect(st.assignee).toEqual(overdueDays.includes(iso) ? ['overdue'] : [])
    }
    expect(on('2026-10-13').daysOverdue).toBe(2)
  })

  it('spares the check-in when there was an update, and never tells nobody', () => {
    // Taking the task is not an update.
    expect(on('2026-10-06', { lastUpdateAt: day('2026-10-01') }).owner).toEqual(['at_risk'])
    expect(on('2026-10-06', { lastUpdateAt: day('2026-10-05') })).toMatchObject({
      assignee: [],
      owner: [],
    })
    expect(on('2026-10-06', { takenAt: null })).toMatchObject({ assignee: [], owner: ['at_risk'] })
    expect(on('2026-10-11', { takenAt: null })).toMatchObject({
      assignee: [],
      owner: ['due_today'],
    })
    expect(on('2026-10-12', { takenAt: null })).toMatchObject({ assignee: [], owner: ['overdue'] })
  })

  it('checks in weekly on a long task, each time only if there was no update since the last', () => {
    const long = { clockStart: day('2026-10-01'), finishBy: day('2026-10-22') }
    expect(on('2026-10-08', long).owner).toEqual(['at_risk'])
    expect(on('2026-10-15', long).owner).toEqual(['at_risk'])
    // An update after the first check-in spares the second.
    expect(on('2026-10-15', { ...long, lastUpdateAt: day('2026-10-09') }).owner).toEqual([])
    // An update before the first check-in does not count for the second.
    expect(on('2026-10-15', { ...long, lastUpdateAt: day('2026-10-05') }).owner).toEqual([
      'at_risk',
    ])
    expect(on('2026-10-20', long).assignee).toEqual(['day_before'])
  })

  it('starts the overdue clock for a new assignee on the day they take it', () => {
    const handed = { takenAt: day('2026-10-20') }
    expect(on('2026-10-19', handed).assignee).toEqual([])
    expect(on('2026-10-20', handed).assignee).toEqual(['overdue'])
    expect(on('2026-10-26', handed).assignee).toEqual(['overdue'])
    expect(on('2026-10-27', handed).assignee).toEqual([])
  })

  it('does not nag about a finish that had already passed when reminders began', () => {
    expect(on('2026-10-20', { remindersSince: day('2026-10-15') })).toMatchObject({
      assignee: [],
      owner: ['overdue'],
    })
  })
})

describe('shouldAlertSlip', () => {
  it('alerts the first time a project is late, then when it slips three days further', () => {
    expect(shouldAlertSlip(0, null)).toBe(false)
    expect(shouldAlertSlip(1, null)).toBe(true)
    expect(shouldAlertSlip(3, 1)).toBe(false)
    expect(shouldAlertSlip(4, 1)).toBe(true)
  })
})
