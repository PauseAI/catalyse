import { test, expect, confirmVolunteerEmail, approveVolunteer } from '../fixtures'
import { submitBugReportViaApi } from '../actions/bugs'
import { goToInbox } from '../actions/dashboard'
import { createApiClient } from '../client'
import { fake } from '../fake'

async function signupApprovedVolunteer(
  baseUrl: string,
): Promise<{ id: number; token: string; name: string }> {
  const person = fake.person()
  const api = createApiClient(baseUrl)
  const signup = await api.auth.signup({
    body: {
      name: person.name,
      email: person.email,
      password: 'testpassword1',
      bio: 'e2e test bio, at least twenty characters long',
      country: 'UK',
      availabilityHoursPerWeek: 5,
      applicationMessage: 'e2e test application message',
      consentMakeProfileVisibleInDirectory: true,
      consentContactableByProjectOwners: true,
    },
  })
  const { id, token, emailVerificationToken } = signup.body as {
    id: number
    token: string
    emailVerificationToken?: string
  }
  if (emailVerificationToken) await confirmVolunteerEmail(baseUrl, emailVerificationToken)
  await approveVolunteer(baseUrl, id, token)
  return { id, token, name: person.name }
}

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

  test('A volunteer who is not the reporter cannot view or comment on someone else’s bug report', async ({
    baseUrl,
  }) => {
    const reporter = await signupApprovedVolunteer(baseUrl)
    const reporterApi = createApiClient(baseUrl, reporter.token)
    const created = await reporterApi.bugReports.create({
      body: { title: fake.bugTitle(), description: 'A private bug report from another volunteer' },
    })
    const reportId = (created.body as { id: number }).id

    const other = await signupApprovedVolunteer(baseUrl)
    const otherApi = createApiClient(baseUrl, other.token)

    const getResult = await otherApi.bugReports.getById({ body: { id: reportId } })
    expect(getResult.status).toBe(404)

    const listResult = await otherApi.bugReportComments.list({ body: { bugReportId: reportId } })
    expect(listResult.status).toBe(404)

    const addResult = await otherApi.bugReportComments.add({
      body: { bugReportId: reportId, content: 'Trying to comment on someone else’s report' },
    })
    expect([403, 404]).toContain(addResult.status)
  })

  test('An anonymous request to create a bug report is rejected', async ({ baseUrl }) => {
    const api = createApiClient(baseUrl)
    const result = await api.bugReports.create({
      body: { title: 'Anonymous attempt', description: 'Should be rejected without a login' },
    })
    expect(result.status).toBe(401)
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
