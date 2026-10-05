import { Page, expect } from '@playwright/test'

/** The Home page's greeting, which shows once the page has loaded. */
export const homeHeading = (page: Page) => page.getByRole('heading', { level: 1, name: /^Hi / })

/** The nav's Inbox item, which carries the needs-action count. */
export const inboxButton = (page: Page) =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Inbox/ })

/** Opens the Inbox showing every notification, whichever filter it would open on. */
export async function goToInbox(baseUrl: string, page: Page): Promise<void> {
  await page.goto(`${baseUrl}/inbox`)
  await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible({
    timeout: 10_000,
  })
  const all = page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'All' })
  await all.click()
  await expect(all).toHaveAttribute('aria-pressed', 'true')
}
