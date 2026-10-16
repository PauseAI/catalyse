import { describe, it, expect } from 'vitest'
import { calculateMatchScore, matchGradeLabel, MATCH_GRADES } from './matching'

describe('calculateMatchScore', () => {
  it('scores the overlap with required skills only', () => {
    const score = calculateMatchScore(new Set([1, 2, 9]), [
      { id: 1, isRequired: true },
      { id: 2, isRequired: true },
      { id: 3, isRequired: true },
      { id: 9, isRequired: false },
    ])
    expect(score).toEqual({
      requiredMatchPercent: 67,
      matchedRequiredCount: 2,
      totalRequired: 3,
      overallScore: 67,
    })
  })

  it('treats a project with no required skills as a full match', () => {
    expect(calculateMatchScore(new Set(), [{ id: 1, isRequired: null }]).overallScore).toBe(100)
  })
})

describe('matchGradeLabel', () => {
  it('picks the highest grade reached, or null for no overlap', () => {
    expect(MATCH_GRADES[0].minMatched).toBeGreaterThan(MATCH_GRADES[1].minMatched)
    expect(matchGradeLabel(6)).toBe('Excellent match')
    expect(matchGradeLabel(5)).toBe('Great match')
    expect(matchGradeLabel(2)).toBe('Good match')
    expect(matchGradeLabel(1)).toBe('Partial match')
    expect(matchGradeLabel(0)).toBeNull()
  })
})
