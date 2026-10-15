import { describe, expect, it } from 'vitest'
import { lateness, latenessLabel } from './lateness'

const today = new Date('2026-10-14T15:00:00Z')
const day = (iso: string) => new Date(`${iso}T00:00:00Z`)

describe('lateness', () => {
  it('counts late from a passed deadline', () => {
    expect(lateness({ deadline: day('2026-10-11'), done: false }, today)).toEqual({
      kind: 'late',
      days: 3,
    })
  })

  it('counts late from a plan that ended, with or without a deadline', () => {
    expect(lateness({ deadline: null, pastPlanDays: 2, done: false }, today)).toEqual({
      kind: 'late',
      days: 2,
    })
    expect(lateness({ deadline: day('2026-10-30'), pastPlanDays: 2, done: false }, today)).toEqual({
      kind: 'late',
      days: 2,
    })
  })

  it('counts from whichever passed first', () => {
    expect(lateness({ deadline: day('2026-10-13'), pastPlanDays: 5, done: false }, today)).toEqual({
      kind: 'late',
      days: 5,
    })
    expect(lateness({ deadline: day('2026-10-04'), pastPlanDays: 5, done: false }, today)).toEqual({
      kind: 'late',
      days: 10,
    })
  })

  it('is due soon within three days, the deadline day included', () => {
    expect(lateness({ deadline: day('2026-10-14'), done: false }, today)).toEqual({
      kind: 'due_soon',
      days: 0,
    })
    expect(lateness({ deadline: '2026-10-17T00:00:00Z', done: false }, today)).toEqual({
      kind: 'due_soon',
      days: 3,
    })
    expect(lateness({ deadline: day('2026-10-18'), done: false }, today)).toBeNull()
  })

  it('is nothing for done work, or work with no deadline and a plan still running', () => {
    expect(lateness({ deadline: day('2026-10-01'), pastPlanDays: 9, done: true }, today)).toBeNull()
    expect(lateness({ deadline: null, pastPlanDays: null, done: false }, today)).toBeNull()
  })

  it('counts from now when no day is given', () => {
    expect(lateness({ deadline: day('2000-01-01'), done: false })?.kind).toBe('late')
  })
})

describe('latenessLabel', () => {
  it('words each case', () => {
    expect(latenessLabel({ kind: 'late', days: 1 })).toBe('1 day late')
    expect(latenessLabel({ kind: 'late', days: 3 })).toBe('3 days late')
    expect(latenessLabel({ kind: 'due_soon', days: 0 })).toBe('Due today')
    expect(latenessLabel({ kind: 'due_soon', days: 1 })).toBe('Due tomorrow')
    expect(latenessLabel({ kind: 'due_soon', days: 2 })).toBe('Due in 2 days')
  })
})
