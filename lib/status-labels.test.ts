import { describe, it, expect } from 'vitest'
import {
  interestHistoryLabel,
  interestStatusVariant,
  suggestionOutline,
  suggestionStatusVariant,
  workStatusBadge,
} from './status-labels'

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

describe('workStatusBadge', () => {
  it('reads every kind of work not yet under way as a grey To do', () => {
    for (const status of ['not_started', 'blocked', 'ready']) {
      expect(workStatusBadge(status, false)).toEqual({ label: 'To do', variant: 'neutral' })
    }
    expect(workStatusBadge('open', true)).toEqual({ label: 'To do', variant: 'neutral' })
  })

  it('reads handed-in work as a blue In review, tasks and Quick Tasks alike', () => {
    expect(workStatusBadge('under_review', false)).toEqual({ label: 'In review', variant: 'info' })
    expect(workStatusBadge('under_review', true)).toEqual({ label: 'In review', variant: 'info' })
  })

  it('shows work sent back as Changes requested while it is under way again', () => {
    expect(workStatusBadge('in_progress', false, true)).toEqual({
      label: 'Changes requested',
      variant: 'attention',
    })
    expect(workStatusBadge('under_review', true, true).label).toBe('In review')
  })

  it('falls back to the raw status in grey', () => {
    expect(workStatusBadge('mystery', false)).toEqual({ label: 'mystery', variant: 'neutral' })
  })
})

describe('interest and suggestion colours', () => {
  it('colours waiting blue, yes green and every ending grey', () => {
    expect(interestStatusVariant('pending')).toBe('info')
    expect(interestStatusVariant('invited')).toBe('info')
    expect(interestStatusVariant('accepted')).toBe('success')
    expect(interestStatusVariant('withdrawn')).toBe('neutral')
    expect(suggestionStatusVariant('on_hold')).toBe('info')
    expect(suggestionStatusVariant('active')).toBe('success')
    expect(suggestionStatusVariant('declined')).toBe('neutral')
  })

  it('outlines a suggestion for its suggester while an admin has yet to decide', () => {
    expect(suggestionOutline('pending')).toBe(true)
    expect(suggestionOutline('on_hold')).toBe(true)
    expect(suggestionOutline('accepted')).toBe(false)
  })
})
