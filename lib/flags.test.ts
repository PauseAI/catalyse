import { describe, it, expect } from 'vitest'
import { countryFlag } from './flags'

describe('countryFlag', () => {
  it('reads countries as the Country table stores them', () => {
    expect(countryFlag('UK')).toBe('🇬🇧')
    expect(countryFlag('United Kingdom')).toBe('🇬🇧')
    expect(countryFlag('US')).toBe('🇺🇸')
    expect(countryFlag('Germany')).toBe('🇩🇪')
    expect(countryFlag('Czech Republic')).toBe('🇨🇿')
    expect(countryFlag(' south korea ')).toBe('🇰🇷')
  })

  it('has no flag for the holding pool or a name that is no region', () => {
    expect(countryFlag('Other')).toBeNull()
    expect(countryFlag('Atlantis')).toBeNull()
    expect(countryFlag(null)).toBeNull()
    expect(countryFlag('')).toBeNull()
  })
})
