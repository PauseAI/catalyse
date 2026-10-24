'use client'

import { useQuery } from '@tanstack/react-query'
import { countryName, enabledCountryOptions } from '@/lib/countries'
import { countryOptions } from '@/lib/filter-options'
import { orpc } from '@/lib/orpc'

/**
 * The Country table, fetched once a page load: it changes only when a global admin toggles a
 * country, whose page refetches it. Until it arrives a stored country shows as its code.
 */
export function useCountries() {
  const { data } = useQuery({ ...orpc.countries.list.queryOptions(), staleTime: Infinity })
  const countries = data ?? []
  return {
    countries,
    loaded: data !== undefined,
    /** How a stored country is shown; blank for none. */
    label: (code: string | null | undefined) => (code ? countryName(countries, code) : ''),
    /** The enabled countries, keeping `current`. */
    enabled: (current?: string | null) => enabledCountryOptions(countries, current),
    /** What someone can say they live in: Select…, the enabled countries, and Other. */
    options: (current?: string | null) => countryOptions(countries, current),
  }
}
