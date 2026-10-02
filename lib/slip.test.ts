import { describe, expect, it } from 'vitest'
import {
  deadlineSlip,
  deadlineStanding,
  lateText,
  movedSlip,
  movedText,
  pinConflictSlip,
} from './slip'

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

describe('slip wording', () => {
  it('says late, on the day or to spare', () => {
    expect(lateText(1)).toBe('1 day late')
    expect(lateText(0)).toBe('on the day')
    expect(lateText(-3)).toBe('3 days to spare')
  })

  it('names the deadline alongside the gap', () => {
    expect(
      deadlineSlip({ deadline: day('2026-09-30'), daysLate: 2 }, false, day('2026-09-20')),
    ).toBe('2 days late (Deadline 30 Sept 2026)')
    expect(
      deadlineSlip({ deadline: day('2026-09-30'), daysLate: 0 }, false, day('2026-09-20')),
    ).toBe('On the day (Deadline 30 Sept 2026)')
    expect(deadlineSlip({ deadline: null, daysLate: null }, false)).toBeNull()
  })

  it('calls unfinished work past its deadline overdue, whatever the plan says', () => {
    const today = day('2026-09-25')
    // The plan ended before the deadline, but the deadline has passed and it is not done.
    expect(deadlineStanding({ deadline: day('2026-09-17'), daysLate: -3 }, false, today)).toEqual({
      text: '8 days overdue',
      late: true,
      days: 8,
    })
    expect(deadlineSlip({ deadline: day('2026-09-17'), daysLate: -3 }, false, today)).toBe(
      '8 days overdue (Deadline 17 Sept 2026)',
    )
    // Done: it is judged by the plan, as before.
    expect(deadlineStanding({ deadline: day('2026-09-17'), daysLate: -3 }, true, today)).toEqual({
      text: '3 days to spare',
      late: false,
      days: -3,
    })
    // Off the timeline: overdue when past, nothing to compare before that.
    expect(
      deadlineStanding({ deadline: day('2026-09-30'), daysLate: null }, false, today),
    ).toBeNull()
    expect(
      deadlineStanding({ deadline: day('2026-09-20'), daysLate: null }, false, today),
    ).toMatchObject({
      text: '5 days overdue',
    })
    expect(deadlineStanding({ deadline: null, daysLate: null }, false)).toBeNull()
  })

  it('says how far the finish moved from the original plan', () => {
    const baseline = { start: day('2026-10-10'), end: day('2026-10-12') }
    expect(movedSlip({ baseline, end: day('2026-10-15'), finishVarianceDays: 3 })).toBe(
      'Finish moved 3 days later since the original plan (12 Oct 2026 → 15 Oct 2026)',
    )
    expect(movedSlip({ baseline, end: day('2026-10-12'), finishVarianceDays: 0 })).toBeNull()
    expect(
      movedSlip({ baseline: null, end: day('2026-10-12'), finishVarianceDays: null }),
    ).toBeNull()
    expect(movedText(-1)).toBe('1 day earlier')
  })

  it('reads a key-date conflict as the prep overrunning it', () => {
    // Key date pinned 12 Oct, prep ends 14 Oct: earliest permitted start 15 Oct, three days on.
    expect(pinConflictSlip({ pinConflictDays: 3, isAnchor: true }, 'Book venue')).toBe(
      '“Book venue” finishes 2 days after the key date.',
    )
    expect(pinConflictSlip({ pinConflictDays: 1, isAnchor: true }, undefined)).toBe(
      'The work before it finishes on the key date itself.',
    )
    expect(pinConflictSlip({ pinConflictDays: 2, isAnchor: false }, 'Book venue')).toBe(
      'Starts 2 days too early for “Book venue”. Move it, or clear its start date to follow it.',
    )
    expect(pinConflictSlip({ pinConflictDays: null, isAnchor: false }, undefined)).toBeNull()
  })
})
