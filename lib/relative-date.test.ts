import { describe, expect, it } from 'vitest'
import { relativeDue, shortDay } from './relative-date'

describe('relativeDue', () => {
  const today = new Date('2026-10-11T15:00:00Z')

  it('names today and tomorrow, then counts the days ahead', () => {
    expect(relativeDue(new Date('2026-10-11T00:00:00Z'), today)).toBe('today')
    expect(relativeDue('2026-10-12T00:00:00Z', today)).toBe('tomorrow')
    expect(relativeDue('2026-10-14T00:00:00Z', today)).toBe('in 3 days')
  })

  it('counts the days overdue from the day after the deadline', () => {
    expect(relativeDue('2026-10-10T00:00:00Z', today)).toBe('1 day overdue')
    expect(relativeDue('2026-10-09T00:00:00Z', today)).toBe('2 days overdue')
  })

  it('counts from now when no day is given', () => {
    expect(relativeDue('2000-01-01T00:00:00Z')).toMatch(/^\d+ days overdue$/)
  })
})

describe('shortDay', () => {
  const today = new Date('2026-10-11T15:00:00Z')

  it('drops the year inside the current one and keeps it outside', () => {
    expect(shortDay('2026-10-14T00:00:00Z', today)).toBe('14 Oct')
    expect(shortDay(new Date('2027-01-03T00:00:00Z'), today)).toBe('3 Jan 2027')
  })

  it('reads the day in UTC', () => {
    expect(shortDay('2026-10-14T23:30:00Z', today)).toBe('14 Oct')
  })

  it('compares against this year when no day is given', () => {
    expect(shortDay('2000-01-01T00:00:00Z')).toBe('1 Jan 2000')
  })
})
