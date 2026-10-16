/** Every country a person can say they are in, and so a national chapter can be made for:
 * the stored value and how it is shown. */
export const COUNTRIES = [
  { value: 'Australia', label: 'Australia' },
  { value: 'Belgium', label: 'Belgium' },
  { value: 'Canada', label: 'Canada' },
  { value: 'Czech Republic', label: 'Czech Republic' },
  { value: 'France', label: 'France' },
  { value: 'Germany', label: 'Germany' },
  { value: 'Ghana', label: 'Ghana' },
  { value: 'Italy', label: 'Italy' },
  { value: 'Kenya', label: 'Kenya' },
  { value: 'Netherlands', label: 'Netherlands' },
  { value: 'Nigeria', label: 'Nigeria' },
  { value: 'Poland', label: 'Poland' },
  { value: 'Romania', label: 'Romania' },
  { value: 'Serbia', label: 'Serbia' },
  { value: 'Spain', label: 'Spain' },
  { value: 'Sweden', label: 'Sweden' },
  { value: 'Switzerland', label: 'Switzerland' },
  { value: 'UK', label: 'United Kingdom' },
  { value: 'US', label: 'United States' },
] as const

export type Country = (typeof COUNTRIES)[number]['value']

/** Signup's answer for someone whose country is not listed; it places them in the holding pool. */
export const OTHER_COUNTRY = 'Other'

export function isCountry(value: string): value is Country {
  return COUNTRIES.some((c) => c.value === value)
}

/** How a stored country is shown: its label, or the value itself when it is not listed. */
export function countryName(country: string): string {
  return COUNTRIES.find((c) => c.value === country)?.label ?? country
}
