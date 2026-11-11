import {
  CATEGORY_LABELS,
  NOTIFICATION_CATEGORIES,
  categoryOf,
  type NotificationCategory,
} from './notification-categories'

/** The digest goes out with the daily cron run, which fires at this hour. */
export const DIGEST_HOUR_UTC = 8

/** How far back a digest reaches, so a missed run never mails a backlog of weeks. */
export const DIGEST_LOOKBACK_DAYS = 7

export type DigestItem = {
  type: string
  title: string
  body: string | null
  link: string | null
}

export type DigestSection = {
  category: NotificationCategory
  heading: string
  items: { title: string; body: string | null; href: string }[]
}

/** The items under their Inbox categories, in the Inbox's order, oldest first within each. */
export function digestSections(items: DigestItem[]): DigestSection[] {
  return NOTIFICATION_CATEGORIES.map((category) => ({
    category,
    heading: CATEGORY_LABELS[category],
    items: items
      .filter((i) => categoryOf(i.type) === category)
      .map((i) => ({ title: i.title, body: i.body, href: i.link ?? '/inbox' })),
  })).filter((s) => s.items.length > 0)
}

export function digestSubject(count: number): string {
  return `Catalyse: your daily digest of ${count} ${count === 1 ? 'notification' : 'notifications'}`
}
