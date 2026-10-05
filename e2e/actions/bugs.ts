import { Page, expect } from '@playwright/test'
import { selectFilterDropdown } from './ui'
import { createApiClient } from '../client'

const SEVERITY_LABELS: Record<string, string> = {
  low: 'Low: minor inconvenience',
  medium: 'Medium: affects workflow',
  high: 'High: blocking',
  critical: 'Critical: site is broken',
}

export async function openBugReportForm(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Report a bug or give feedback' }).click()
  await expect(page.getByRole('dialog', { name: 'Report an Issue' })).toBeVisible({
    timeout: 10_000,
  })
}

export async function fillAndSubmitBugReport(
  page: Page,
  opts: {
    title: string
    description: string
    category?: string
    severity?: string
  },
): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Report an Issue' })
  if (opts.category) {
    await dialog.locator('.category-btn', { hasText: opts.category }).click()
  }
  await dialog.getByLabel('Title').fill(opts.title)
  await dialog.getByLabel('Details').fill(opts.description)
  if (opts.severity) {
    await selectFilterDropdown(
      page,
      'How urgent is this?',
      SEVERITY_LABELS[opts.severity] ?? opts.severity,
      dialog,
    )
  }
  await dialog.getByRole('button', { name: 'Submit Report' }).click()
}

export async function submitBugReport(
  baseUrl: string,
  page: Page,
  title: string,
  description: string,
): Promise<void> {
  await page.goto(`${baseUrl}/dashboard`)
  await expect(page.getByRole('heading', { level: 1, name: /^Hi / })).toBeVisible({
    timeout: 10_000,
  })
  await openBugReportForm(page)
  await fillAndSubmitBugReport(page, { title, description })
  await expect(
    page
      .getByRole('dialog', { name: 'Report an Issue' })
      .getByRole('heading', { name: 'Thank you!' }),
  ).toBeVisible({ timeout: 10_000 })
}

// API-equivalent of submitBugReport, for tests that need "a bug report exists" purely as setup
// for testing admin status/assignment changes — the report dialog itself is already proven
// end-to-end by 14-bug-reporting.spec.ts.
export async function submitBugReportViaApi(
  baseUrl: string,
  volunteerPage: Page,
  title: string,
  description: string,
): Promise<number> {
  // localStorage is only readable once the page has loaded a real origin — a fresh
  // volunteer.page fixture starts at about:blank, where evaluate throws a SecurityError.
  if (volunteerPage.url() === 'about:blank') await volunteerPage.goto(baseUrl)
  const token = await volunteerPage.evaluate(() => localStorage.getItem('authToken'))
  const api = createApiClient(baseUrl, token)
  const result = await api.bugReports.create({ body: { title, description } })
  if (result.status !== 200)
    throw new Error(`Bug report creation failed: ${JSON.stringify(result.body)}`)
  return (result.body as { id: number }).id
}
