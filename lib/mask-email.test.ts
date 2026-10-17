import { describe, it, expect } from 'vitest'
import { maskEmail } from './mask-email'

describe('maskEmail', () => {
  it('keeps the first and last letters and the domain', () => {
    expect(maskEmail('birchbenji@gmail.com')).toBe('b••••••••i@gmail.com')
    expect(maskEmail('sam@example.com')).toBe('s•m@example.com')
  })

  it('hides at least one letter of a short address, and all of a malformed one', () => {
    expect(maskEmail('ab@example.com')).toBe('a•@example.com')
    expect(maskEmail('a@example.com')).toBe('a•@example.com')
    expect(maskEmail('not-an-address')).toBe('•••')
  })
})
