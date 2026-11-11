import {
  CATEGORY_LABELS,
  NOTIFICATION_CATEGORIES,
  categoryOf,
  type NotificationCategory,
} from './notification-categories'
import { addLocalDays, daysBetween, formatLocalDay, localTime, zonedInstant } from './time-zone'

export const DIGEST_FREQUENCIES = ['daily', 'every_3_days', 'weekly'] as const
export type DigestFrequency = (typeof DIGEST_FREQUENCIES)[number]

/** Days that must pass between one person's digests. */
export const DIGEST_PERIOD_DAYS: Record<DigestFrequency, number> = {
  daily: 1,
  every_3_days: 3,
  weekly: 7,
}

export const DIGEST_FREQUENCY_LABELS: Record<DigestFrequency, string> = {
  daily: 'Daily',
  every_3_days: 'Every 3 days',
  weekly: 'Weekly',
}

const SUBJECT_WORDS: Record<DigestFrequency, string> = {
  daily: 'daily',
  every_3_days: 'three-day',
  weekly: 'weekly',
}

export const DEFAULT_DIGEST_HOUR = 8

export type DigestSchedule = {
  timeZone: string
  hour: number
  frequency: DigestFrequency
  /** The local day of their last digest, or null before their first. */
  lastSentOn: string | null
}

/**
 * The local day whose digest is due at `now`, or null. A digest goes in the hour starting at
 * the person's local hour today: when the clocks skip that hour, the hour after it, and when
 * they repeat it, the first time round only. Their period must have passed since the last one.
 */
export function digestDueOn(now: Date, s: DigestSchedule): string | null {
  const today = localTime(now, s.timeZone).date
  const slot = zonedInstant(today, s.hour, s.timeZone).getTime()
  if (now.getTime() < slot || now.getTime() >= slot + 60 * 60_000) return null
  if (s.lastSentOn && daysBetween(s.lastSentOn, today) < DIGEST_PERIOD_DAYS[s.frequency]) {
    return null
  }
  return today
}

/** When the next digest can go, if there is anything new for it by then. */
export function nextDigestAt(now: Date, s: DigestSchedule): Date {
  const today = localTime(now, s.timeZone).date
  let day = now < zonedInstant(today, s.hour, s.timeZone) ? today : addLocalDays(today, 1)
  if (s.lastSentOn) {
    const earliest = addLocalDays(s.lastSentOn, DIGEST_PERIOD_DAYS[s.frequency])
    if (daysBetween(day, earliest) > 0) day = earliest
  }
  return zonedInstant(day, s.hour, s.timeZone)
}

export type DigestItem = {
  type: string
  title: string
  body: string | null
  link: string | null
  createdAt: Date | null
}

export type DigestSection = {
  category: NotificationCategory
  heading: string
  items: { title: string; detail: string | null; href: string }[]
}

/**
 * The items under their Inbox categories, in the Inbox's order, oldest first within each. When
 * they span more than one local day, each says which day it came.
 */
export function digestSections(items: DigestItem[], timeZone: string): DigestSection[] {
  const days = new Set(items.map((i) => (i.createdAt ? localTime(i.createdAt, timeZone).date : '')))
  const dated = days.size > 1
  return NOTIFICATION_CATEGORIES.map((category) => ({
    category,
    heading: CATEGORY_LABELS[category],
    items: items
      .filter((i) => categoryOf(i.type) === category)
      .map((i) => {
        const day = dated && i.createdAt ? formatLocalDay(i.createdAt, timeZone) : null
        return {
          title: i.title,
          detail: [day, i.body].filter(Boolean).join(' · ') || null,
          href: i.link ?? '/inbox',
        }
      }),
  })).filter((s) => s.items.length > 0)
}

export function digestSubject(count: number, frequency: DigestFrequency): string {
  return `Catalyse: your ${SUBJECT_WORDS[frequency]} digest of ${count} ${count === 1 ? 'notification' : 'notifications'}`
}
