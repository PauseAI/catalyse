import { describe, it, expect } from 'vitest'
import { ASK_TO_TAKE, CLAIM_TASK, claimLabel } from './action-labels'

describe('claimLabel', () => {
  it('offers to claim the task to anyone on the project', () => {
    expect(claimLabel({ onProject: true, invited: false })).toBe(CLAIM_TASK)
    expect(CLAIM_TASK).toBe('Claim task')
  })

  it('offers to claim the task to someone invited, since claiming accepts the invite', () => {
    expect(claimLabel({ onProject: false, invited: true })).toBe(CLAIM_TASK)
  })

  it('asks the owner for anyone else, applied or not', () => {
    expect(claimLabel({ onProject: false, invited: false })).toBe(ASK_TO_TAKE)
    expect(ASK_TO_TAKE).toBe('Ask to take this')
  })
})
