import { describe, it, expect } from 'vitest'
import {
  digestDueOn,
  digestSections,
  digestSubject,
  nextDigestAt,
  type DigestSchedule,
} from './notification-digest'

const london: DigestSchedule = {
  timeZone: 'Europe/London',
  hour: 8,
  frequency: 'daily',
  lastSentOn: null,
}
const at = (iso: string) => new Date(iso)

describe('digest schedule', () => {
  it('is due in the local hour only, in each zone', () => {
    expect(digestDueOn(at('2026-11-12T08:00:00Z'), london)).toBe('2026-11-12')
    expect(digestDueOn(at('2026-11-12T08:59:00Z'), london)).toBe('2026-11-12')
    expect(digestDueOn(at('2026-11-12T07:59:00Z'), london)).toBeNull()
    expect(digestDueOn(at('2026-11-12T09:00:00Z'), london)).toBeNull()
    const tokyo = { ...london, timeZone: 'Asia/Tokyo' }
    expect(digestDueOn(at('2026-11-11T23:00:00Z'), tokyo)).toBe('2026-11-12')
    const la = { ...london, timeZone: 'America/Los_Angeles', hour: 18 }
    expect(digestDueOn(at('2026-11-13T02:00:00Z'), la)).toBe('2026-11-12')
    // British summer time moves the hour.
    expect(digestDueOn(at('2026-07-12T07:00:00Z'), london)).toBe('2026-07-12')
    expect(digestDueOn(at('2026-07-12T08:00:00Z'), london)).toBeNull()
  })

  it('neither skips nor doubles a digest when the clocks change', () => {
    const ny = { ...london, timeZone: 'America/New_York', hour: 2 }
    // 02:00 is skipped on 8 March; the 03:00 hour carries the digest.
    const spring = ['2026-03-08T06:00:00Z', '2026-03-08T07:00:00Z', '2026-03-08T08:00:00Z']
    expect(spring.map((t) => digestDueOn(at(t), ny))).toEqual([null, '2026-03-08', null])
    // 01:00 happens twice on 1 November; only the first pass carries it.
    const nyOne = { ...ny, hour: 1 }
    const autumn = ['2026-11-01T05:00:00Z', '2026-11-01T06:00:00Z']
    expect(autumn.map((t) => digestDueOn(at(t), nyOne))).toEqual(['2026-11-01', null])
  })

  it('waits for the period to pass since the last digest, for each frequency', () => {
    const when = at('2026-11-12T08:00:00Z')
    const after = (frequency: DigestSchedule['frequency'], lastSentOn: string) =>
      digestDueOn(when, { ...london, frequency, lastSentOn })
    expect(after('daily', '2026-11-11')).toBe('2026-11-12')
    expect(after('daily', '2026-11-12')).toBeNull()
    expect(after('every_3_days', '2026-11-10')).toBeNull()
    expect(after('every_3_days', '2026-11-09')).toBe('2026-11-12')
    expect(after('weekly', '2026-11-06')).toBeNull()
    expect(after('weekly', '2026-11-05')).toBe('2026-11-12')
  })

  it('names the next digest time on the local clock', () => {
    const now = at('2026-11-12T10:00:00Z')
    expect(nextDigestAt(now, london).toISOString()).toBe('2026-11-13T08:00:00.000Z')
    expect(nextDigestAt(at('2026-11-12T07:00:00Z'), london).toISOString()).toBe(
      '2026-11-12T08:00:00.000Z',
    )
    const weekly = { ...london, frequency: 'weekly' as const, lastSentOn: '2026-11-10' }
    expect(nextDigestAt(now, weekly).toISOString()).toBe('2026-11-17T08:00:00.000Z')
  })
})

describe('digest contents', () => {
  it('groups by category in Inbox order, dating items when they span days', () => {
    const day1 = at('2026-11-10T09:00:00Z')
    const day2 = at('2026-11-12T09:00:00Z')
    const sections = digestSections(
      [
        { type: 'project_approved', title: 'A', body: null, link: '/a', createdAt: day1 },
        { type: 'new_interest', title: 'B', body: 'b', link: null, createdAt: day2 },
        { type: 'task_done', title: 'C', body: null, link: '/c', createdAt: null },
      ],
      'Europe/London',
    )
    expect(sections).toEqual([
      {
        category: 'needs_action',
        heading: 'Needs action',
        items: [{ title: 'B', detail: 'Thu 12 Nov · b', href: '/inbox' }],
      },
      {
        category: 'update',
        heading: 'Updates',
        items: [
          { title: 'A', detail: 'Tue 10 Nov', href: '/a' },
          { title: 'C', detail: null, href: '/c' },
        ],
      },
    ])
    const oneDay = digestSections(
      [{ type: 'mention', title: 'M', body: 'x', link: '/m', createdAt: day1 }],
      'Europe/London',
    )
    expect(oneDay[0].items[0].detail).toBe('x')
    expect(digestSubject(1, 'daily')).toBe('Catalyse: your daily digest of 1 notification')
    expect(digestSubject(4, 'every_3_days')).toBe(
      'Catalyse: your three-day digest of 4 notifications',
    )
    expect(digestSubject(2, 'weekly')).toBe('Catalyse: your weekly digest of 2 notifications')
  })
})
