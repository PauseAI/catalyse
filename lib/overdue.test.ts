import { describe, expect, it } from 'vitest'
import { isOverdue } from './overdue'

describe('isOverdue', () => {
  const now = new Date('2026-09-25T15:00:00Z')

  it('is overdue from the day after the deadline until the work is done', () => {
    expect(isOverdue('2026-09-24T00:00:00Z', false, now)).toBe(true)
    // The deadline day itself is still in time.
    expect(isOverdue(new Date('2026-09-25T00:00:00Z'), false, now)).toBe(false)
    expect(isOverdue('2026-09-24T00:00:00Z', true, now)).toBe(false)
    expect(isOverdue(null, false, now)).toBe(false)
    expect(isOverdue('2000-01-01T00:00:00Z', false)).toBe(true)
  })
})
