import { InferRouterOutputs } from '@orpc/server'
import { FilterOption } from '@/components/FilterDropdown'
import { AppRouter } from '@/server/router'
import { COUNTRIES, OTHER_COUNTRY } from './countries'

export type LocalGroupOption =
  InferRouterOutputs<AppRouter>['localGroups']['list']['groups'][number]

export const BASE_LOCATION_OPTIONS: FilterOption[] = [
  { value: '', label: 'Any country' },
  { value: 'Remote', label: 'Remote' },
  ...COUNTRIES,
  { value: OTHER_COUNTRY, label: 'Other' },
]

export function buildLocationOptions(
  groups: Pick<LocalGroupOption, 'name' | 'country'>[],
): FilterOption[] {
  const result: FilterOption[] = []
  for (const option of BASE_LOCATION_OPTIONS) {
    result.push(option)
    if (!option.indent && option.value) {
      const countryGroups = groups.filter((g) => g.country === option.value)
      for (const g of countryGroups) {
        result.push({
          value: `${option.value}:${g.name}`,
          label: `${option.label} - ${g.name}`,
          indent: true,
        })
      }
    }
  }
  return result
}

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

/** The countries a person can say they live in. */
export const COUNTRY_OPTIONS: FilterOption[] = [
  { value: '', label: 'Select…' },
  ...COUNTRIES,
  { value: OTHER_COUNTRY, label: 'Other' },
]

// Stored country values are short codes/names (e.g. "UK"); this resolves the
// display label (e.g. "United Kingdom") so raw values are never shown in the UI.
// Falls back to the raw value for anything not in BASE_LOCATION_OPTIONS.
export function countryLabel(value: string | null | undefined): string {
  if (!value) return ''
  return BASE_LOCATION_OPTIONS.find((o) => o.value === value)?.label ?? value
}

/**
 * A volunteer's location as one line, the same on their directory card and their profile:
 * town, local group and country, each once, e.g. "Manchester · United Kingdom".
 */
export function volunteerLocation(v: {
  location: string | null
  localGroup: string | null
  country: string | null
}): string {
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
