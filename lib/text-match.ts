/** Case- and accent-insensitive substring match, e.g. "raphael" matches "Raphaël". */
export function textMatches(haystack: string, needle: string): boolean {
  const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  return fold(haystack).includes(fold(needle))
}
