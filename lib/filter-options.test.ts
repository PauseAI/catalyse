import { describe, it, expect } from 'vitest'
import {
  volunteerLocation,
  buildLocalGroupOptionsForCountry,
  countryLabel,
  projectLocationParts,
  COUNTRY_OPTIONS,
  NO_LOCAL_GROUP,
} from './filter-options'

const groups = [
  { name: 'London', country: 'UK' },
  { name: 'Berlin', country: 'Germany' },
]

describe('buildLocalGroupOptionsForCountry', () => {
  it('lists the groups for that country between a placeholder and a none option', () => {
    expect(buildLocalGroupOptionsForCountry('UK', groups)).toEqual([
      { value: '', label: 'Select…' },
      { value: 'London', label: 'London' },
      { value: NO_LOCAL_GROUP, label: "None of these, I'll enter my city" },
    ])
  })
})

describe('countryLabel', () => {
  it('resolves codes to labels and falls back to the raw value', () => {
    expect(countryLabel('UK')).toBe('United Kingdom')
    expect(countryLabel('Narnia')).toBe('Narnia')
    expect(countryLabel(null)).toBe('')
    expect(COUNTRY_OPTIONS[0].value).toBe('')
    expect(COUNTRY_OPTIONS.some((o) => o.value === '')).toBe(true)
  })
})

describe('projectLocationParts', () => {
  it('builds the location line parts', () => {
    expect(projectLocationParts('LOCAL', 'London')).toEqual(['London'])
    expect(projectLocationParts('REMOTE', null, 'United Kingdom')).toEqual([
      'United Kingdom',
      'Remote',
    ])
    expect(projectLocationParts('COUNTRY_WIDE', null)).toEqual([])
  })
})

describe('volunteerLocation', () => {
  it('joins town, local group and country once each', () => {
    expect(volunteerLocation({ location: 'Manchester', localGroup: null, country: 'UK' })).toBe(
      'Manchester · United Kingdom',
    )
    expect(volunteerLocation({ location: 'Leeds', localGroup: 'Leeds', country: 'UK' })).toBe(
      'Leeds · United Kingdom',
    )
    expect(volunteerLocation({ location: null, localGroup: null, country: null })).toBe('')
  })
})
