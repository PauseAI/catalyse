import { describe, expect, it } from 'vitest'
import { interestOutline, latenessOutline, statusOutline } from './status-emphasis'

const owner = { isAssignee: false, canReview: true }
const assignee = { isAssignee: true, canReview: false }
const other = { isAssignee: false, canReview: false }

describe('statusOutline', () => {
  it('fills In review for whoever can accept it, and outlines it for the submitter', () => {
    expect(statusOutline('under_review', false, owner)).toBe(false)
    expect(statusOutline('under_review', false, assignee)).toBe(true)
  })

  it('fills Changes requested for the assignee, and outlines it for the reviewer', () => {
    expect(statusOutline('in_progress', true, assignee)).toBe(false)
    expect(statusOutline('in_progress', true, owner)).toBe(true)
  })

  it('always fills a status nobody waits on', () => {
    for (const status of ['ready', 'blocked', 'in_progress', 'completed', 'open']) {
      expect(statusOutline(status, false, other)).toBe(false)
    }
  })
})

describe('latenessOutline', () => {
  it('fills Late and Due soon for the assignee and whoever can replan', () => {
    expect(latenessOutline(assignee)).toBe(false)
    expect(latenessOutline(owner)).toBe(false)
    expect(latenessOutline(other)).toBe(true)
  })
})

describe('interestOutline', () => {
  it('fills a request or invite for the one who answers it', () => {
    expect(interestOutline('pending', true)).toBe(false)
    expect(interestOutline('pending', false)).toBe(true)
    expect(interestOutline('invited', true)).toBe(false)
    expect(interestOutline('invited', false)).toBe(true)
    expect(interestOutline('accepted', false)).toBe(false)
  })
})
