import { describe, it, expect } from 'vitest'
import {
  volunteerLocation,
  buildLocalGroupOptionsForCountry,
  countryOptions,
  projectLocationParts,
  NO_LOCAL_GROUP,
} from './filter-options'
import { countryName } from './countries'

const countries = [
  { code: 'Austria', name: 'Austria', enabled: false },
  { code: 'UK', name: 'United Kingdom', enabled: true },
]
const label = (code: string | null) => (code ? countryName(countries, code) : '')

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

describe('countryOptions', () => {
  it('offers the enabled countries between a placeholder and Other, keeping a disabled current one', () => {
    expect(countryOptions(countries)).toEqual([
      { value: '', label: 'Select…' },
      { value: 'UK', label: 'United Kingdom' },
      { value: 'Other', label: 'Other' },
    ])
    expect(countryOptions(countries, 'Austria').map((o) => o.value)).toEqual([
      '',
      'Austria',
      'UK',
      'Other',
    ])
  })
})

describe('countryName', () => {
  it('resolves codes to names and falls back to the raw value', () => {
    expect(countryName(countries, 'UK')).toBe('United Kingdom')
    expect(countryName(countries, 'Narnia')).toBe('Narnia')
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
    expect(
      volunteerLocation({ location: 'Manchester', localGroup: null, country: 'UK' }, label),
    ).toBe('Manchester · United Kingdom')
    expect(
      volunteerLocation({ location: 'Leeds', localGroup: 'Leeds', country: 'UK' }, label),
    ).toBe('Leeds · United Kingdom')
    expect(volunteerLocation({ location: null, localGroup: null, country: null }, label)).toBe('')
  })
})
