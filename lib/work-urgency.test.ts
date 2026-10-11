import { describe, it, expect } from 'vitest'
import {
  ATTENTION_WINDOW_DAYS,
  START_BUFFER_DAYS,
  VOLUNTEER_HOURS_PER_DAY,
  attentionReason,
  needsAttentionNow,
} from './work-urgency'

const today = new Date('2026-10-11T15:00:00Z')
const inDays = (n: number) => new Date(Date.UTC(2026, 9, 11 + n))
const task = (days: number | null, estimatedHours: number | null = null, done = false) => ({
  deadline: days === null ? null : inDays(days),
  estimatedHours,
  done,
})

describe('attentionReason', () => {
  it('leaves out done work and work with no deadline', () => {
    expect(attentionReason(task(0, 40, true), today)).toBeNull()
    expect(attentionReason(task(null, 40), today)).toBeNull()
  })

  it('takes an overdue task, however little work it is', () => {
    expect(attentionReason(task(-2), today)).toBe('2 days overdue')
    expect(attentionReason(task(-1, 40), today)).toBe('1 day overdue')
  })

  it('takes anything due within the window, and nothing a day past it', () => {
    expect(ATTENTION_WINDOW_DAYS).toBe(7)
    expect(attentionReason(task(0), today)).toBe('Due today')
    expect(attentionReason(task(1), today)).toBe('Due tomorrow')
    expect(attentionReason(task(7), today)).toBe('Due in 7 days')
    expect(attentionReason(task(8), today)).toBeNull()
    expect(attentionReason({ ...task(7), deadline: inDays(7).toISOString() }, today)).toBe(
      'Due in 7 days',
    )
  })

  it('takes work big enough that it must start now, up to its last day to start', () => {
    expect(VOLUNTEER_HOURS_PER_DAY).toBe(2)
    expect(START_BUFFER_DAYS).toBe(2)
    // 12 hours is 6 days at 2 a day, plus 2 spare: due in 8 days or fewer.
    const start = 'About 12 hours of work, due in 6 days: start now'
    expect(attentionReason(task(6, 12), today)).toBe(start)
    expect(attentionReason(task(8, 12), today)).toBe(
      'About 12 hours of work, due in 8 days: start now',
    )
    expect(attentionReason(task(9, 12), today)).toBeNull()
    // An odd hour rounds up to a whole day: 21 hours is 11 days, plus 2.
    expect(attentionReason(task(13, 21), today)).toMatch(/^About 21 hours of work/)
    expect(attentionReason(task(14, 21), today)).toBeNull()
  })

  it('names the effort only when it is more than a day of work', () => {
    expect(attentionReason(task(2, 2), today)).toBe('Due in 2 days')
    expect(attentionReason(task(1, 3), today)).toBe(
      'About 3 hours of work, due tomorrow: start now',
    )
    // 3 hours is 2 days, plus 2: a deadline 5 days off is only in for the window.
    expect(attentionReason(task(5, 3), today)).toBe('Due in 5 days')
    expect(attentionReason(task(20, 2), today)).toBeNull()
  })
})

describe('needsAttentionNow', () => {
  it('is whether there is a reason', () => {
    expect(needsAttentionNow(task(2), today)).toBe(true)
    expect(needsAttentionNow(task(20, 2), today)).toBe(false)
    expect(needsAttentionNow(task(null))).toBe(false)
    expect(attentionReason(task(null))).toBeNull()
  })
})
