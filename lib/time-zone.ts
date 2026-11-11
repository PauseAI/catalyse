/**
 * Wall-clock time in a person's IANA time zone, for sending their digest at their own hour.
 * Dates are `YYYY-MM-DD` strings of the local calendar day.
 */

/** Countries (as `Country.code`) that keep one time zone; any other falls back to UTC. */
const COUNTRY_TIME_ZONES: Record<string, string> = {
  Austria: 'Europe/Vienna',
  Belgium: 'Europe/Brussels',
  'Czech Republic': 'Europe/Prague',
  Denmark: 'Europe/Copenhagen',
  Finland: 'Europe/Helsinki',
  France: 'Europe/Paris',
  Germany: 'Europe/Berlin',
  Ghana: 'Africa/Accra',
  India: 'Asia/Kolkata',
  Ireland: 'Europe/Dublin',
  Italy: 'Europe/Rome',
  Japan: 'Asia/Tokyo',
  Kenya: 'Africa/Nairobi',
  Netherlands: 'Europe/Amsterdam',
  'New Zealand': 'Pacific/Auckland',
  Nigeria: 'Africa/Lagos',
  Norway: 'Europe/Oslo',
  Poland: 'Europe/Warsaw',
  Romania: 'Europe/Bucharest',
  Serbia: 'Europe/Belgrade',
  Singapore: 'Asia/Singapore',
  'South Korea': 'Asia/Seoul',
  Sweden: 'Europe/Stockholm',
  Switzerland: 'Europe/Zurich',
  UK: 'Europe/London',
}

/** The browser's own time zone, or null where it reports none. */
export function browserTimeZone(): string | null {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return zone && isTimeZone(zone) ? zone : null
}

export function isTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: name })
    return true
  } catch {
    return false
  }
}

export type TimeZoneSource = 'chosen' | 'country' | 'default'

/** The zone a person's digest follows: their own, else their chapter's country's, else UTC. */
export function effectiveTimeZone(
  own: string | null,
  chapterCountry: string | null,
): { timeZone: string; source: TimeZoneSource } {
  if (own && isTimeZone(own)) return { timeZone: own, source: 'chosen' }
  const fromCountry = chapterCountry ? COUNTRY_TIME_ZONES[chapterCountry] : undefined
  if (fromCountry) return { timeZone: fromCountry, source: 'country' }
  return { timeZone: 'UTC', source: 'default' }
}

function wallClock(instant: Date, timeZone: string): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  )
}

/** The local calendar day and hour of `instant` in `timeZone`. */
export function localTime(instant: Date, timeZone: string): { date: string; hour: number } {
  const p = wallClock(instant, timeZone)
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) }
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Whole days from local date `from` to `to`. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS)
}

export function addLocalDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

/**
 * The instant `date` at `hour`:00 is on the wall clock in `timeZone`. An hour the clocks skip
 * comes out as the first instant after it.
 */
export function zonedInstant(date: string, hour: number, timeZone: string): Date {
  const wall = Date.parse(`${date}T${String(hour).padStart(2, '0')}:00:00Z`)
  // How far the wall clock runs ahead of UTC at instant `t`, to the minute.
  const offsetAt = (t: number) => {
    const p = wallClock(new Date(t), timeZone)
    return (
      Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`) - (t - (t % 60_000))
    )
  }
  let t = wall - offsetAt(wall)
  t = wall - offsetAt(t)
  const landed = localTime(new Date(t), timeZone)
  if (landed.date === date && landed.hour < hour) t += 60 * 60_000
  return new Date(t)
}
