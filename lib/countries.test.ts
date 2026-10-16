import { describe, expect, it } from 'vitest'
import { OTHER_COUNTRY, isCountry } from './countries'

describe('isCountry', () => {
  it('accepts a listed value and refuses labels, Other and the Remote pseudo-country', () => {
    expect(isCountry('UK')).toBe(true)
    expect(isCountry('United Kingdom')).toBe(false)
    expect(isCountry(OTHER_COUNTRY)).toBe(false)
    expect(isCountry('Remote')).toBe(false)
  })
})
