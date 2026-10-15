import { describe, expect, it } from 'vitest'
import { helperSummary, leadAndHelpers } from './helper-summary'

describe('helperSummary', () => {
  it('says how many help and how many more are wanted', () => {
    expect(helperSummary(0, null)).toBeNull()
    expect(helperSummary(0, 2)).toBe('2 helpers wanted')
    expect(helperSummary(0, 1)).toBe('1 helper wanted')
    expect(helperSummary(3, 5)).toBe('3 helpers (2 more wanted)')
    expect(helperSummary(1, 1)).toBe('1 helper')
    // Fewer wanted than are helping, after the number was lowered: no "more wanted".
    expect(helperSummary(3, 2)).toBe('3 helpers')
    expect(helperSummary(2, null)).toBe('2 helpers')
  })
})

describe('leadAndHelpers', () => {
  it('names the lead beside the helpers, or alone when there are none', () => {
    expect(leadAndHelpers('Sam', 3, 5)).toBe('Lead: Sam · 3 helpers (2 more wanted)')
    expect(leadAndHelpers('Sam', 0, null)).toBe('Sam')
  })
})
