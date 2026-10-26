import type { FilterOption } from '@/components/FilterDropdown'

/** A row of the Country table, as `countries.list` returns it. */
export interface CountryEntry {
  code: string
  name: string
  enabled: boolean
}

/** Signup's answer for someone whose country is not listed; it places them in the holding pool. */
export const OTHER_COUNTRY = 'Other'

/** How a stored country is shown: its name, or the value itself when it is not listed. */
export function countryName(countries: readonly CountryEntry[], code: string): string {
  return countries.find((c) => c.code === code)?.name ?? code
}

/**
 * The enabled countries as picker options. A disabled `current` value is kept, so a picker
 * showing someone's existing country still reads it.
 */
export function enabledCountryOptions(
  countries: readonly CountryEntry[],
  current?: string | null,
): FilterOption[] {
  return countries
    .filter((c) => c.enabled || c.code === current)
    .map((c) => ({ value: c.code, label: c.name }))
}
