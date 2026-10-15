import { test, expect, dismissCookieConsentScript } from '../fixtures'
import { openBugReportForm, fillAndSubmitBugReport } from '../actions/bugs'
import { goToInbox } from '../actions/dashboard'
import { fake } from '../fake'

test.describe('Bug Reporting', () => {
  test('Logged-in volunteer submits a bug report; reporter and admin are each notified in their own panel', async ({
    adminPage,
    volunteer,
    baseUrl,
    snap,
  }) => {
    test.setTimeout(60_000)
    const title = fake.bugTitle()

    await volunteer.page.goto(`${baseUrl}/dashboard`)
    await expect(
      volunteer.page.getByRole('heading', { level: 1, name: 'Home', exact: true }),
    ).toBeVisible({
      timeout: 10_000,
    })

    await openBugReportForm(volunteer.page)
    await snap(volunteer.page, 'report dialog open')
    await fillAndSubmitBugReport(volunteer.page, {
      title,
      description: 'This is a test bug report submitted via the e2e test suite',
      category: 'Bug',
      severity: 'high',
    })

    const dialog = volunteer.page.getByRole('dialog', { name: 'Report an issue' })
    await expect(dialog.getByRole('heading', { name: 'Thank you!' })).toBeVisible({
      timeout: 10_000,
    })

    await goToInbox(baseUrl, volunteer.page)
    await expect(
      volunteer.page.locator('strong').filter({ hasText: 'Bug report submitted' }),
    ).toBeVisible({ timeout: 10_000 })

    await adminPage.goto(`${baseUrl}/admin`)
    await expect(adminPage.locator('strong').filter({ hasText: `New bug: ${title}` })).toBeVisible({
      timeout: 10_000,
    })
  })

  test('Anonymous visitor has no way to submit a bug report', async ({ browser, baseUrl }) => {
    const context = await browser.newContext()
    await context.addInitScript(dismissCookieConsentScript)
    const page = await context.newPage()
    try {
      await page.goto(`${baseUrl}/`)
      await expect(
        page.getByRole('button', { name: 'Report a bug or give feedback' }),
      ).not.toBeVisible()
    } finally {
      await context.close()
    }
  })

  test('Bug report submission fails with a too-short description', async ({
    volunteer,
    baseUrl,
  }) => {
    await volunteer.page.goto(`${baseUrl}/dashboard`)
    await expect(
      volunteer.page.getByRole('heading', { level: 1, name: 'Home', exact: true }),
    ).toBeVisible({
      timeout: 10_000,
    })

    await openBugReportForm(volunteer.page)
    await fillAndSubmitBugReport(volunteer.page, {
      title: 'Validation test',
      description: 'too short', // 9 characters — below the API minimum of 10
    })

    const dialog = volunteer.page.getByRole('dialog', { name: 'Report an issue' })
    await expect(dialog.locator('[aria-invalid="true"]')).toBeVisible({ timeout: 10_000 })
  })
})
