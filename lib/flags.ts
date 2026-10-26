/** Country names and codes that are not the ISO 3166 code of the flag they should show. */
const ALIASES: Record<string, string> = {
  uk: 'GB',
  'united kingdom': 'GB',
  'czech republic': 'CZ',
}

let isoByName: Map<string, string> | null = null

/** Every ISO region code, keyed by its English name and by the code itself, lower-cased. */
function isoCodes(): Map<string, string> {
  if (isoByName) return isoByName
  const names = new Intl.DisplayNames(['en'], { type: 'region' })
  isoByName = new Map()
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b)
      const name = names.of(code)
      if (name && name !== code) {
        isoByName.set(name.toLowerCase(), code)
        isoByName.set(code.toLowerCase(), code)
      }
    }
  }
  for (const [name, code] of Object.entries(ALIASES)) isoByName.set(name, code)
  return isoByName
}

/**
 * The flag emoji for a country as the Country table stores it ("UK", "Germany"), or null for one
 * that names no ISO region, such as the holding pool's "Other".
 */
export function countryFlag(country: string | null | undefined): string | null {
  const code = country ? isoCodes().get(country.trim().toLowerCase()) : undefined
  if (!code) return null
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}
