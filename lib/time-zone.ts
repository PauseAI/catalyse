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

/** One formatter per zone: building them is the costly part of reading a wall clock. */
const wallClockFormats = new Map<string, Intl.DateTimeFormat>()

function wallClock(instant: Date, timeZone: string): Record<string, string> {
  let format = wallClockFormats.get(timeZone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    wallClockFormats.set(timeZone, format)
  }
  return Object.fromEntries(format.formatToParts(instant).map((p) => [p.type, p.value]))
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
 * The instant `date` at `hour`:00 is on the wall clock in `timeZone`. An hour the clocks repeat
 * gives its first pass; an hour they skip gives the first instant after it.
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
  // The offsets either side of any clock change that day give every instant the wall time can be.
  const candidates = [...new Set([offsetAt(wall - DAY_MS), offsetAt(wall + DAY_MS)])]
    .map((offset) => wall - offset)
    .sort((a, b) => a - b)
  const target = `${date}T${hour}`
  const exact = candidates.find((t) => {
    const l = localTime(new Date(t), timeZone)
    return `${l.date}T${l.hour}` === target
  })
  if (exact !== undefined) return new Date(exact)
  const after = candidates.find((t) => {
    const l = localTime(new Date(t), timeZone)
    return l.date > date || (l.date === date && l.hour > hour)
  })
  return new Date(after ?? candidates[candidates.length - 1])
}

/** An hour of the day as the panel shows it: "08:00". */
export const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`

/** A zone's name as people read it: "America/New York". */
export const zoneLabel = (zone: string) => zone.replace(/_/g, ' ')

/** A day on the local clock, "Thu 12 Nov", or with `withTime` a moment, "Thu 12 Nov, 08:00". */
export function formatLocalDay(at: Date, timeZone: string, withTime = false): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : {}),
  }).format(at)
}
