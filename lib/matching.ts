export interface ProjectSkillRow {
  id: number
  isRequired: boolean | null
}

export interface MatchScore {
  requiredMatchPercent: number
  matchedRequiredCount: number
  totalRequired: number
  overallScore: number
}

export interface GradeConfig {
  label: string
  /** Minimum number of the project's required skills the volunteer must match to reach this grade. */
  minMatched: number
  /** Whether volunteers at this grade should receive immediate skill-match email alerts. */
  notifiable: boolean
}

/**
 * Grade thresholds ordered from highest to lowest.
 *
 * `minMatched` is the count of a project's *required* skills that overlap with the
 * volunteer's skills — e.g. a project with 8 required skills where the volunteer has 5
 * of them scores `matchedRequiredCount = 5`, landing at "Great match".
 *
 * Grades are intentionally based on absolute overlap count (not percentage) so that
 * shallow projects (2 required skills) don't generate "Excellent match" noise.
 *
 * Must remain sorted descending by minMatched — matchGradeLabel uses find() and
 * takes the first match.
 */
export const MATCH_GRADES: GradeConfig[] = (
  [
    { label: 'Excellent match', minMatched: 6, notifiable: true },
    { label: 'Great match', minMatched: 4, notifiable: true },
    { label: 'Good match', minMatched: 2, notifiable: true },
    { label: 'Partial match', minMatched: 1, notifiable: false },
  ] satisfies GradeConfig[]
).sort((a, b) => b.minMatched - a.minMatched)

export function calculateMatchScore(
  volunteerSkillIds: Set<number>,
  projectSkills: ProjectSkillRow[],
): MatchScore {
  const required = projectSkills.filter((s) => s.isRequired)

  const requiredIds = new Set(required.map((s) => s.id))

  const matchedRequired = new Set([...volunteerSkillIds].filter((id) => requiredIds.has(id)))

  const requiredScore = requiredIds.size > 0 ? (matchedRequired.size / requiredIds.size) * 100 : 100

  return {
    requiredMatchPercent: Math.round(requiredScore),
    matchedRequiredCount: matchedRequired.size,
    totalRequired: requiredIds.size,
    overallScore: Math.round(requiredScore),
  }
}

/** Returns the label for the highest grade the volunteer qualifies for, or null if no match. */
export function matchGradeLabel(matchedRequired: number): string | null {
  return MATCH_GRADES.find((g) => matchedRequired >= g.minMatched)?.label ?? null
}
