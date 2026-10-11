import { plural } from './plural'

/**
 * A task's helpers in a few words: "3 helpers (2 more wanted)", "2 helpers wanted", "1 helper".
 * Null when it has none and seeks none. Kept free of server imports so client components can use
 * it.
 */
export function helperSummary(count: number, wanted: number | null): string | null {
  const more = wanted === null ? 0 : Math.max(0, wanted - count)
  if (count === 0) return more > 0 ? `${plural(more, 'helper')} wanted` : null
  return more > 0 ? `${plural(count, 'helper')} (${more} more wanted)` : plural(count, 'helper')
}

/** "Lead: Sam · 3 helpers (2 more wanted)", or just the lead's name when nobody helps or is sought. */
export function leadAndHelpers(leadName: string, count: number, wanted: number | null): string {
  const helpers = helperSummary(count, wanted)
  return helpers ? `Lead: ${leadName} · ${helpers}` : leadName
}
