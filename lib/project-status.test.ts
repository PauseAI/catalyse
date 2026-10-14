import { describe, it, expect } from 'vitest'
import {
  projectStatusLabel,
  projectStatusOutline,
  isSeekingOwner,
  proposerDisplay,
  ADVERTISABLE_STATUSES,
  SEEKING_OWNER_SQL,
  ADVERTISABLE_STATUSES_SQL,
  ORG_PROPOSER_NAME,
} from './project-status'

describe('projectStatusLabel', () => {
  it('uses the configured label, humanising unknown statuses', () => {
    expect(projectStatusLabel('in_progress')).toBe('In progress')
    expect(projectStatusLabel('some_new_state')).toBe('some new state')
  })
})

describe('projectStatusOutline', () => {
  it('fills a proposal in review for an admin and outlines it for everyone else', () => {
    expect(projectStatusOutline('pending_review', true)).toBe(false)
    expect(projectStatusOutline('pending_review', false)).toBe(true)
    expect(projectStatusOutline('in_progress', false)).toBe(false)
  })
})

describe('isSeekingOwner', () => {
  it('is true only for an unowned, live, unfinished project', () => {
    expect(isSeekingOwner({ status: 'ready', assigneeId: null })).toBe(true)
    expect(isSeekingOwner({ status: 'on_hold', assigneeId: null })).toBe(true)
    expect(isSeekingOwner({ status: 'ready', assigneeId: 3 })).toBe(false)
    expect(isSeekingOwner({ status: 'pending_review', assigneeId: null })).toBe(false)
    expect(isSeekingOwner({ status: 'completed', assigneeId: null })).toBe(false)
  })
})

describe('status sets', () => {
  it('advertisable excludes unapproved and terminal statuses', () => {
    expect(ADVERTISABLE_STATUSES).toEqual(['ready', 'in_progress', 'on_hold'])
    expect(SEEKING_OWNER_SQL).toBe(
      "(assignee_id IS NULL AND status IN ('ready', 'in_progress', 'on_hold'))",
    )
    expect(ADVERTISABLE_STATUSES_SQL).toBe(
      "status NOT IN ('draft', 'pending_review', 'needs_discussion', 'completed', 'archived')",
    )
  })
})

describe('proposerDisplay', () => {
  it('attributes org projects to the organisation with no profile link', () => {
    expect(proposerDisplay({ isOrgProposed: true, proposedBy: { name: 'Ann' } })).toEqual({
      name: ORG_PROPOSER_NAME,
      volunteerId: null,
    })
  })
  it('names the proposer from an object or a string', () => {
    expect(proposerDisplay({ proposedBy: { name: 'Ann' }, proposedById: 4 })).toEqual({
      name: 'Ann',
      volunteerId: 4,
    })
    expect(proposerDisplay({ proposedBy: 'Bob' })).toEqual({ name: 'Bob', volunteerId: null })
  })
  it('returns null with nobody to attribute to', () => {
    expect(proposerDisplay({ proposedBy: null })).toBeNull()
  })
})
