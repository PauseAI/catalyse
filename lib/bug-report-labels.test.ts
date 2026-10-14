import { describe, it, expect } from 'vitest'
import { bugStatusLabel, bugReportPagePath, BUG_STATUS_VARIANT } from './bug-report-labels'

describe('bugStatusLabel', () => {
  it('maps known statuses to labels and passes unknown ones through', () => {
    expect(bugStatusLabel('wont_fix')).toBe("Won't Fix")
    expect(bugStatusLabel('mystery')).toBe('mystery')
    expect(BUG_STATUS_VARIANT.open).toBe('neutral')
  })
})

describe('bugReportPagePath', () => {
  it('reduces any URL to its same-origin path and query', () => {
    expect(bugReportPagePath('https://evil.example/projects/3?x=1#frag')).toBe('/projects/3?x=1')
    expect(bugReportPagePath('/dashboard')).toBe('/dashboard')
  })

  it('returns null for URLs that do not reduce to a path', () => {
    expect(bugReportPagePath('mailto:someone@example.com')).toBeNull()
    expect(bugReportPagePath('http://[bad')).toBeNull()
  })
})
