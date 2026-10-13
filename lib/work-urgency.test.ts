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

describe('needsAttentionNow', () => {
  it('leaves out done work and work with no deadline', () => {
    expect(needsAttentionNow(task(0, 40, true), today)).toBe(false)
    expect(needsAttentionNow(task(null, 40), today)).toBe(false)
  })

  it('takes an overdue task, however little work it is', () => {
    expect(needsAttentionNow(task(-2), today)).toBe(true)
    expect(needsAttentionNow(task(-1, 40), today)).toBe(true)
  })

  it('takes anything due within the window, and nothing a day past it', () => {
    expect(ATTENTION_WINDOW_DAYS).toBe(7)
    expect(needsAttentionNow(task(0), today)).toBe(true)
    expect(needsAttentionNow(task(7), today)).toBe(true)
    expect(needsAttentionNow(task(8), today)).toBe(false)
  })

  it('takes work big enough that it must start now, up to its last day to start', () => {
    expect(VOLUNTEER_HOURS_PER_DAY).toBe(2)
    expect(START_BUFFER_DAYS).toBe(2)
    // 12 hours is 6 days at 2 a day, plus 2 spare: due in 8 days or fewer.
    expect(needsAttentionNow(task(8, 12), today)).toBe(true)
    expect(needsAttentionNow(task(9, 12), today)).toBe(false)
  })
})

describe('attentionReason', () => {
  it('leaves out done work and work with no deadline', () => {
    expect(attentionReason(task(0, 40, true), today)).toBeNull()
    expect(attentionReason(task(null, 40), today)).toBeNull()
  })

  it('is null when overdue, or merely due within the window: the card already shows the date', () => {
    expect(attentionReason(task(-2), today)).toBeNull()
    expect(attentionReason(task(-1, 40), today)).toBeNull()
    expect(attentionReason(task(0), today)).toBeNull()
    expect(attentionReason(task(7), today)).toBeNull()
    expect(attentionReason(task(8), today)).toBeNull()
  })

  it('names the effort when there is more than a day of work to start now for', () => {
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
    expect(attentionReason(task(2, 2), today)).toBeNull()
    expect(attentionReason(task(1, 3), today)).toBe(
      'About 3 hours of work, due tomorrow: start now',
    )
    // 3 hours is 2 days, plus 2: a deadline 5 days off is only in for the window.
    expect(attentionReason(task(5, 3), today)).toBeNull()
    expect(attentionReason(task(20, 2), today)).toBeNull()
  })
})
