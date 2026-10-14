import { test, expect, getAlert } from '../fixtures'
import type { Page } from '@playwright/test'
import { submitBugReportViaApi } from '../actions/bugs'
import { selectFilterDropdown } from '../actions/ui'
import { fake } from '../fake'

const BUG_STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  wont_fix: "Won't fix",
}

async function navigateToBugsPage(baseUrl: string, adminPage: Page): Promise<void> {
  await adminPage.goto(`${baseUrl}/admin/bugs`)
  await expect(
    adminPage.getByRole('heading', { name: 'Bug Reports & Feedback', level: 1 }),
  ).toBeVisible({ timeout: 10_000 })
  await expect(adminPage.getByText('Loading...')).not.toBeVisible({ timeout: 10_000 })
}

// The Resolved / Won't fix sections are collapsed by default; expand before asserting on cards inside them.
async function expandBugSection(adminPage: Page, sectionLabel: string): Promise<void> {
  const header = adminPage.getByRole('button', { name: new RegExp(`^${sectionLabel}: \\d+`) })
  await expect(header).toBeVisible({ timeout: 10_000 })
  await header.click()
}

async function updateReportStatus(
  adminPage: Page,
  reportTitle: string,
  status: string,
  resolutionNotes?: string,
): Promise<void> {
  const card = adminPage.locator('.card').filter({ hasText: reportTitle })
  await expect(card).toBeVisible({ timeout: 10_000 })
  await card.click()
  await expect(adminPage.getByRole('heading', { name: reportTitle, level: 1 })).toBeVisible({
    timeout: 10_000,
  })
  await selectFilterDropdown(adminPage, 'Status', BUG_STATUS_LABELS[status] ?? status)
  if (resolutionNotes) {
    await adminPage.getByLabel('Resolution Notes').fill(resolutionNotes)
  }
  await adminPage.getByRole('button', { name: 'Update', exact: true }).click()
  await expect(getAlert(adminPage)).toContainText('Report updated!', { timeout: 10_000 })

  // The /bugs/[id] detail page (introduced alongside the comment threads) doesn't redirect
  // back to the list on save — admins land back on /admin/bugs via this link, same as a user
  // would.
  await adminPage.getByRole('link', { name: 'Back to Bug Reports' }).click()
  await expect(
    adminPage.getByRole('heading', { name: 'Bug Reports & Feedback', level: 1 }),
  ).toBeVisible({ timeout: 10_000 })
}

test.describe('Bug Report Management', () => {
  test('Admin views the bug reports list', async ({ adminPage, volunteer, baseUrl }) => {
    const title = fake.bugTitle()

    await submitBugReportViaApi(
      baseUrl,
      volunteer.page,
      title,
      'A test bug report for admin management e2e tests',
    )

    await navigateToBugsPage(baseUrl, adminPage)
    const card = adminPage.locator('.card').filter({ hasText: title })
    await expect(card).toBeVisible({ timeout: 10_000 })
    await expect(card).toContainText(title)
  })

  test('Admin sees bug reports grouped into sections by status', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    const title = fake.bugTitle()

    await submitBugReportViaApi(
      baseUrl,
      volunteer.page,
      title,
      'A bug report used for section grouping testing in e2e',
    )

    await navigateToBugsPage(baseUrl, adminPage)
    const openSection = adminPage
      .getByTestId('bugs-section-open')
      .locator('.card')
      .filter({ hasText: title })
    await expect(openSection).toBeVisible({ timeout: 10_000 })

    const inProgressSection = adminPage.getByTestId('bugs-section-in_progress')
    if (await inProgressSection.count()) {
      await expect(inProgressSection.locator('.card').filter({ hasText: title })).not.toBeVisible({
        timeout: 10_000,
      })
    }
  })

  test('Admin moves a bug report to in_progress', async ({ adminPage, volunteer, baseUrl }) => {
    const title = fake.bugTitle()

    await submitBugReportViaApi(
      baseUrl,
      volunteer.page,
      title,
      'A bug report that will be moved to in_progress status',
    )

    await navigateToBugsPage(baseUrl, adminPage)
    await updateReportStatus(adminPage, title, 'in_progress')

    const card = adminPage.locator('.card').filter({ hasText: title })
    await expect(card).toBeVisible({ timeout: 10_000 })
    await expect(card).toContainText('In progress')
  })

  test('Admin resolves a bug report with resolution notes', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    const title = fake.bugTitle()
    const notes = fake.resolutionNotes()

    await submitBugReportViaApi(
      baseUrl,
      volunteer.page,
      title,
      'A bug report that will be resolved with resolution notes',
    )

    await navigateToBugsPage(baseUrl, adminPage)
    await updateReportStatus(adminPage, title, 'resolved', notes)

    await expandBugSection(adminPage, 'Resolved')
    const card = adminPage.locator('.card').filter({ hasText: title })
    await expect(card).toBeVisible({ timeout: 10_000 })
    await expect(card).toContainText('resolved')

    await card.click()
    await expect(adminPage.getByRole('heading', { name: title, level: 1 })).toBeVisible({
      timeout: 10_000,
    })
    await expect(adminPage.getByLabel('Resolution Notes')).toHaveValue(notes)
  })

  test('Admin exports bug reports as markdown', async ({ adminPage, volunteer, baseUrl }) => {
    const title = fake.bugTitle()
    const description = 'A bug report used for export e2e testing'

    await submitBugReportViaApi(baseUrl, volunteer.page, title, description)

    await navigateToBugsPage(baseUrl, adminPage)
    await expect(adminPage.locator('.card').filter({ hasText: title })).toBeVisible({
      timeout: 10_000,
    })

    const [download] = await Promise.all([
      adminPage.waitForEvent('download'),
      adminPage.getByRole('button', { name: 'Export as Markdown' }).click(),
    ])

    expect(download.suggestedFilename()).toMatch(/^bug-reports-\d{4}-\d{2}-\d{2}\.md$/)
    const stream = await download.createReadStream()
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(chunk as Buffer)
    const content = Buffer.concat(chunks).toString('utf-8')

    expect(content).toContain('# Bug Reports')
    expect(content).toContain(title)
    expect(content).toContain(description)
  })

  test('Admin marks a bug report as wont_fix', async ({ adminPage, volunteer, baseUrl }) => {
    const title = fake.bugTitle()

    await submitBugReportViaApi(
      baseUrl,
      volunteer.page,
      title,
      'A bug report that will be marked as wont_fix by admin',
    )

    await navigateToBugsPage(baseUrl, adminPage)
    await updateReportStatus(adminPage, title, 'wont_fix')

    await expandBugSection(adminPage, "Won't fix")
    const card = adminPage.locator('.card').filter({ hasText: title })
    await expect(card).toBeVisible({ timeout: 10_000 })
    await expect(card).toContainText("Won't fix")
  })
})
