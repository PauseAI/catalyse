import { test, expect } from '../fixtures'
import { submitBugReportViaApi } from '../actions/bugs'
import { goToInbox } from '../actions/dashboard'
import { createApiClient } from '../client'
import { fake } from '../fake'

test.describe('Bug Report Detail Page', () => {
  test('Reporter and admin exchange comments on a bug report; reporter is notified of the reply', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    const title = fake.bugTitle()

    const reportId = await submitBugReportViaApi(
      baseUrl,
      volunteer.page,
      title,
      'A bug report to exercise its own comment thread',
    )

    await volunteer.page.goto(`${baseUrl}/bugs/${reportId}`)
    await expect(volunteer.page.getByRole('heading', { name: title, level: 1 })).toBeVisible({
      timeout: 10_000,
    })

    await volunteer.page.getByLabel('Add a comment').fill('Any update on this?')
    await volunteer.page.getByRole('button', { name: 'Post comment' }).click()
    await expect(volunteer.page.getByText('Any update on this?')).toBeVisible({ timeout: 10_000 })

    await adminPage.goto(`${baseUrl}/admin/bugs`)
    await expect(
      adminPage.getByRole('heading', { name: 'Bug Reports & Feedback', level: 1 }),
    ).toBeVisible({ timeout: 10_000 })
    await adminPage.locator('.card').filter({ hasText: title }).click()
    await expect(adminPage.getByRole('heading', { name: title, level: 1 })).toBeVisible({
      timeout: 10_000,
    })
    await expect(adminPage.getByText('Any update on this?')).toBeVisible({ timeout: 10_000 })

    await adminPage.getByLabel('Add a comment').fill('Looking into it now')
    await adminPage.getByRole('button', { name: 'Post comment' }).click()
    await expect(adminPage.getByText('Looking into it now')).toBeVisible({ timeout: 10_000 })

    await goToInbox(baseUrl, volunteer.page)
    await expect(
      volunteer.page
        .locator('strong')
        .filter({ hasText: `New reply on your bug report: ${title}` }),
    ).toBeVisible({ timeout: 10_000 })
    await volunteer.page
      .getByRole('listitem')
      .filter({ hasText: `New reply on your bug report: ${title}` })
      .getByRole('link', { name: 'Open' })
      .click()
    await expect(volunteer.page.getByText('Looking into it now')).toBeVisible({ timeout: 10_000 })
  })

  test('A javascript: pageUrl is never rendered as a clickable link', async ({
    volunteer,
    baseUrl,
  }) => {
    await volunteer.page.goto(`${baseUrl}/dashboard`)
    const volApi = createApiClient(
      baseUrl,
      await volunteer.page.evaluate(() => localStorage.getItem('authToken')),
    )
    const title = fake.bugTitle()
    const created = await volApi.bugReports.create({
      body: {
        title,
        description: 'Reported from a page with a malicious pageUrl',
        pageUrl: 'javascript:alert(document.cookie)',
      },
    })
    expect(created.status).toBe(200)
    const reportId = (created.body as { id: number }).id

    await volunteer.page.goto(`${baseUrl}/bugs/${reportId}`)
    await expect(volunteer.page.getByRole('heading', { name: title, level: 1 })).toBeVisible({
      timeout: 10_000,
    })
    await expect(volunteer.page.getByText('javascript:alert(document.cookie)')).toBeVisible()
    await expect(volunteer.page.getByRole('link', { name: /javascript:/ })).toHaveCount(0)
  })

  test('An external-origin pageUrl is reduced to a same-origin path, not a cross-origin link', async ({
    volunteer,
    baseUrl,
  }) => {
    await volunteer.page.goto(`${baseUrl}/dashboard`)
    const volApi = createApiClient(
      baseUrl,
      await volunteer.page.evaluate(() => localStorage.getItem('authToken')),
    )
    const title = fake.bugTitle()
    const created = await volApi.bugReports.create({
      body: {
        title,
        description: 'Reported with a spoofed external pageUrl',
        pageUrl: 'https://evil.example.com/steal?x=1',
      },
    })
    expect(created.status).toBe(200)
    const reportId = (created.body as { id: number }).id

    await volunteer.page.goto(`${baseUrl}/bugs/${reportId}`)
    await expect(volunteer.page.getByRole('heading', { name: title, level: 1 })).toBeVisible({
      timeout: 10_000,
    })
    const pageUrlLink = volunteer.page.getByRole('link', { name: '/steal?x=1' })
    await expect(pageUrlLink).toBeVisible()
    await expect(pageUrlLink).toHaveAttribute('href', '/steal?x=1')
  })
})
