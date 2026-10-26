import { InferRouterOutputs } from '@orpc/server'
import { FilterOption } from '@/components/FilterDropdown'
import { AppRouter } from '@/server/router'
import { OTHER_COUNTRY, enabledCountryOptions, type CountryEntry } from './countries'

export type LocalGroupOption =
  InferRouterOutputs<AppRouter>['localGroups']['list']['groups'][number]

export const NO_LOCAL_GROUP = '__none__'

export function buildLocalGroupOptionsForCountry(
  country: string,
  groups: Pick<LocalGroupOption, 'name' | 'country'>[],
): FilterOption[] {
  const countryGroups = groups.filter((g) => g.country === country)
  return [
    { value: '', label: 'Select…' },
    ...countryGroups.map((g) => ({ value: g.name, label: g.name })),
    { value: NO_LOCAL_GROUP, label: "None of these, I'll enter my city" },
  ]
}

/** The countries a person can say they live in, keeping `current` should it be disabled. */
export function countryOptions(
  countries: readonly CountryEntry[],
  current?: string | null,
): FilterOption[] {
  return [
    { value: '', label: 'Select…' },
    ...enabledCountryOptions(countries, current),
    { value: OTHER_COUNTRY, label: 'Other' },
  ]
}

/**
 * A volunteer's location as one line, the same on their directory card and their profile:
 * town, local group and country, each once, e.g. "Manchester · United Kingdom".
 */
export function volunteerLocation(
  v: { location: string | null; localGroup: string | null; country: string | null },
  countryLabel: (code: string | null) => string,
): string {
  const parts = [v.location, v.localGroup, countryLabel(v.country)].filter((p): p is string =>
    Boolean(p),
  )
  return [...new Set(parts)].join(' · ')
}

/**
 * The parts of a project's location line, e.g. ['Remote'] or ['London'], with its chapter's name
 * first when given (for a global admin, who sees every chapter). Join with ' · ' and prefix with
 * 📍 to render.
 */
export function projectLocationParts(
  reach: string,
  localGroup: string | null | undefined,
  chapterName?: string | null,
): string[] {
  const parts = chapterName ? [chapterName] : []
  if (reach === 'REMOTE') parts.push('Remote')
  if (localGroup) parts.push(localGroup)
  return parts
}
