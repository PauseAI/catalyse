import { MAX_DATA_URL_LENGTH } from './profile-picture'

/**
 * A ceiling on every string and array any procedure accepts, applied to the raw input before
 * its own schema runs. A schema may set a tighter limit with its own message; this is the
 * backstop for the fields nobody thought to bound.
 */
export const DEFAULT_MAX_STRING = 2000
export const MAX_ARRAY_ITEMS = 1000

/** Fields, by name, that legitimately carry more than the default. */
const LONGER_FIELDS: Record<string, number> = {
  description: 20_000,
  applicationMessage: 5000,
  // A Google ID token, whose length grows with the claims in it.
  credential: 8192,
  // Whole import files, parsed and bounded again by their own schemas.
  file: 2_000_000,
  csv: 2_000_000,
  // A profile picture as a data URL, bounded by its own schema.
  picture: MAX_DATA_URL_LENGTH,
}

/** The first limit the input breaks, as a message for the caller, or null if it breaks none. */
export function inputLimitViolation(input: unknown, field = 'input'): string | null {
  if (typeof input === 'string') {
    const max = LONGER_FIELDS[field] ?? DEFAULT_MAX_STRING
    return input.length > max ? `${field} must be ${max} characters or fewer` : null
  }
  if (Array.isArray(input)) {
    if (input.length > MAX_ARRAY_ITEMS) {
      return `${field} must have ${MAX_ARRAY_ITEMS} items or fewer`
    }
    for (const item of input) {
      const violation = inputLimitViolation(item, field)
      if (violation) return violation
    }
    return null
  }
  if (input && typeof input === 'object') {
    for (const [key, value] of Object.entries(input)) {
      const violation = inputLimitViolation(value, key)
      if (violation) return violation
    }
  }
  return null
}
