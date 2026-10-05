import { describe, it, expect } from 'vitest'
import { interestHistoryLabel } from './status-labels'

describe('interestHistoryLabel', () => {
  it('says how someone came to the project and how they left it', () => {
    expect(interestHistoryLabel('applied', 'declined')).toBe('Applied, declined')
    expect(interestHistoryLabel('added', 'removed')).toBe('Added, removed')
    expect(interestHistoryLabel('applied', 'removed')).toBe('Applied, removed')
    expect(interestHistoryLabel('applied', 'withdrawn')).toBe('Applied, withdrew')
    expect(interestHistoryLabel('added', 'withdrawn')).toBe('Added, withdrew')
    expect(interestHistoryLabel('invited', 'declined')).toBe('Invited, declined')
    expect(interestHistoryLabel('invited', 'cancelled')).toBe('Invited, cancelled')
  })

  it('has nothing to say while they are waiting or on the project', () => {
    expect(interestHistoryLabel('applied', 'pending')).toBeNull()
    expect(interestHistoryLabel('added', 'accepted')).toBeNull()
    expect(interestHistoryLabel('invited', 'invited')).toBeNull()
  })
})
