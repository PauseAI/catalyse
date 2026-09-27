import { describe, expect, it } from 'vitest'
import { handedIn, isOverdue } from './overdue'

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

  it('treats work handed in for review as done', () => {
    expect(handedIn('under_review')).toBe(true)
    expect(handedIn('completed')).toBe(true)
    expect(handedIn('in_progress')).toBe(false)
    expect(handedIn('open')).toBe(false)
  })
})
