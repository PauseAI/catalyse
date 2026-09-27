import { describe, expect, it } from 'vitest'
import {
  EMPTY_DATES,
  datesPayload,
  datesValueFrom,
  deadlineBeforeStart,
  lateStartSentence,
  taskIsDated,
  windowReading,
  windowText,
} from './task-dates'

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

describe('task dates', () => {
  it('round-trips a task through the form and back to the API', () => {
    const value = datesValueFrom({
      startDate: day('2026-09-14'),
      durationDays: null,
      estimatedHours: 6,
      deadline: day('2026-09-17'),
    })
    expect(value).toEqual({
      timing: 'flexible',
      startDate: '2026-09-14',
      deadline: '2026-09-17',
      milestone: false,
      estimatedHours: '6',
    })
    expect(datesPayload(value)).toEqual({
      timing: 'flexible',
      startDate: day('2026-09-14'),
      durationDays: null,
      estimatedHours: 6,
      deadline: day('2026-09-17'),
    })
    expect(datesPayload(EMPTY_DATES)).toEqual({
      timing: 'flexible',
      startDate: null,
      durationDays: null,
      estimatedHours: null,
      deadline: null,
    })
    // A fixed task keeps its last day as its deadline.
    expect(datesPayload({ ...value, timing: 'fixed' }).deadline).toEqual(day('2026-09-17'))
    expect(
      datesValueFrom({
        timing: 'fixed',
        startDate: null,
        durationDays: null,
        estimatedHours: null,
        deadline: null,
      }),
    ).toEqual({ ...EMPTY_DATES, timing: 'fixed' })
  })

  it('sends a milestone as zero days with no deadline, and only when the timing is fixed', () => {
    const milestone = datesValueFrom({
      timing: 'fixed',
      startDate: day('2026-10-03'),
      durationDays: 0,
      estimatedHours: null,
      deadline: null,
    })
    expect(milestone.milestone).toBe(true)
    const withStaleDeadline = { ...milestone, deadline: '2026-10-05' }
    expect(datesPayload(withStaleDeadline)).toMatchObject({ durationDays: 0, deadline: null })
    // Switching to a window leaves the tick behind, so it is not sent.
    expect(datesPayload({ ...withStaleDeadline, timing: 'flexible' })).toMatchObject({
      durationDays: null,
      deadline: day('2026-10-05'),
    })
  })

  it('knows which tasks are on the timeline', () => {
    const none = { startDate: null, durationDays: null, deadline: null }
    expect(taskIsDated(none, false)).toBe(false)
    expect(taskIsDated(none, true)).toBe(true)
    expect(taskIsDated({ ...none, startDate: day('2026-09-14') }, false)).toBe(true)
    expect(taskIsDated({ ...none, deadline: day('2026-09-14') }, false)).toBe(true)
    expect(taskIsDated({ ...none, durationDays: 0 }, false)).toBe(true)
  })

  it('flags a deadline before the start, and says when the work before it runs too late', () => {
    expect(deadlineBeforeStart(day('2026-09-20'), day('2026-09-17'))).toBe(3)
    expect(deadlineBeforeStart(day('2026-09-17'), day('2026-09-17'))).toBeNull()
    expect(deadlineBeforeStart(null, day('2026-09-17'))).toBeNull()
    expect(deadlineBeforeStart(day('2026-09-17'), null)).toBeNull()
    expect(lateStartSentence('Book venue', day('2026-10-03'), 2)).toBe(
      '“Book venue” finishes too late: this can’t start until 3 Oct 2026, 2 days after its deadline.',
    )
  })

  it('says how to read a window', () => {
    expect(windowText(day('2026-09-14'), day('2026-09-14'))).toBe('14 Sept 2026')
    expect(windowText(day('2026-09-14'), day('2026-09-20'))).toBe('14 Sept 2026 – 20 Sept 2026')
    expect(windowReading('flexible', 7, 6)).toBe('Any time in this window, about 6 hours of work')
    expect(windowReading('flexible', 1, 1)).toBe('Any time that day, about 1 hour of work')
    expect(windowReading('flexible', 7, null)).toBe('Takes the whole window')
    expect(windowReading('flexible', 1, null)).toBe('Takes the day')
    expect(windowReading('fixed', 2, 4)).toBe('On these dates, about 4 hours of work')
    expect(windowReading('fixed', 1, null)).toBe('On this day')
    expect(windowReading('fixed', 0, 4)).toBe('A moment, not a stretch of work')
  })
})
