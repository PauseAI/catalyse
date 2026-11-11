import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  addLocalDays,
  browserTimeZone,
  daysBetween,
  effectiveTimeZone,
  isTimeZone,
  localTime,
  zonedInstant,
} from './time-zone'

afterEach(() => vi.restoreAllMocks())

describe('time zones', () => {
  it('uses a chosen zone, else the chapter country where it has one zone, else UTC', () => {
    expect(effectiveTimeZone('America/Chicago', 'UK')).toEqual({
      timeZone: 'America/Chicago',
      source: 'chosen',
    })
    expect(effectiveTimeZone(null, 'UK')).toEqual({ timeZone: 'Europe/London', source: 'country' })
    expect(effectiveTimeZone('Not/AZone', 'Japan')).toEqual({
      timeZone: 'Asia/Tokyo',
      source: 'country',
    })
    // The US spans several zones, so it decides nothing.
    expect(effectiveTimeZone(null, 'US')).toEqual({ timeZone: 'UTC', source: 'default' })
    expect(effectiveTimeZone(null, null)).toEqual({ timeZone: 'UTC', source: 'default' })
    expect(isTimeZone('Europe/London')).toBe(true)
    expect(isTimeZone('Mars/Olympus')).toBe(false)
  })

  it("reads the browser's zone, and none when it reports nothing usable", () => {
    expect(browserTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: '',
    } as Intl.ResolvedDateTimeFormatOptions)
    expect(browserTimeZone()).toBeNull()
  })

  it('converts between instants and local wall-clock time, half-hour zones included', () => {
    expect(localTime(new Date('2026-11-12T02:30:00Z'), 'Asia/Kolkata')).toEqual({
      date: '2026-11-12',
      hour: 8,
    })
    expect(zonedInstant('2026-11-12', 8, 'Asia/Kolkata').toISOString()).toBe(
      '2026-11-12T02:30:00.000Z',
    )
    expect(zonedInstant('2026-07-12', 8, 'Europe/London').toISOString()).toBe(
      '2026-07-12T07:00:00.000Z',
    )
    expect(zonedInstant('2026-11-12', 8, 'America/Los_Angeles').toISOString()).toBe(
      '2026-11-12T16:00:00.000Z',
    )
    expect(daysBetween('2026-11-10', '2026-11-17')).toBe(7)
    expect(addLocalDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('places an hour the clocks skip at the hour after, and a repeated hour at its first pass', () => {
    // New York springs forward at 02:00 on 8 March 2026: 02:00 never happens.
    const skipped = zonedInstant('2026-03-08', 2, 'America/New_York')
    expect(localTime(skipped, 'America/New_York')).toEqual({ date: '2026-03-08', hour: 3 })
    // And falls back at 02:00 on 1 November: 01:00 happens twice, first at 05:00 UTC.
    expect(zonedInstant('2026-11-01', 1, 'America/New_York').toISOString()).toBe(
      '2026-11-01T05:00:00.000Z',
    )
  })
})
