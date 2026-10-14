import {
  test,
  expect,
  getAlert,
  rejectVolunteer,
  requestMoreInfo,
  reopenApplication,
} from '../fixtures'
import { login } from '../actions/auth'
import { fake } from '../fake'
import { createApiClient } from '../client'

test.describe('Application follow-up actions', () => {
  test('Admin requests more info; applicant logs in, edits, and resubmits', async ({
    adminPage,
    browser,
    baseUrl,
  }) => {
    const person = fake.person()
    const signupResult = await createApiClient(baseUrl).auth.signup({
      body: {
        name: person.name,
        email: person.email,
        password: 'testpassword1',
        bio: 'e2e test bio, at least twenty characters long',
        country: 'UK',
        availabilityHoursPerWeek: 5,
        applicationMessage: 'I would like to help with outreach.',
        consentMakeProfileVisibleInDirectory: true,
        consentContactableByProjectOwners: true,
      },
    })
    expect(signupResult.status).toBe(200)
    const { id: volunteerId } = signupResult.body

    await requestMoreInfo(baseUrl, volunteerId, 'Could you tell us more about your availability?')

    // Card now shows in the Needs Info section
    await adminPage.goto(`${baseUrl}/admin/applications`)
    await expect(adminPage.getByRole('heading', { name: 'Applications' })).toBeVisible({
      timeout: 10_000,
    })
    await expect(adminPage.getByRole('article').filter({ hasText: person.name })).toBeVisible({
      timeout: 10_000,
    })

    // Applicant follows the emailed login link (email prefilled), no token needed
    const context = await browser.newContext()
    const page = await context.newPage()
    try {
      await page.goto(`${baseUrl}/login?email=${encodeURIComponent(person.email)}`)
      await expect(page.getByLabel('Email', { exact: true })).toHaveValue(person.email)
      await page.getByLabel('Password').fill('testpassword1')
      await page.getByRole('button', { name: 'Login' }).click()
      await page.waitForURL(`${baseUrl}/dashboard`, { timeout: 15_000 })

      // Dashboard flags the needs-info state with a link into Settings
      await expect(
        page.getByText('We need a bit more information before we can review your application.'),
      ).toBeVisible({ timeout: 10_000 })
      await page.getByRole('link', { name: 'Update application' }).click()
      await page.waitForURL(/\/settings/, { timeout: 10_000 })

      await expect(page.getByText('Could you tell us more about your availability?')).toBeVisible({
        timeout: 10_000,
      })
      await page.getByLabel('Your application').fill('Updated: I can commit 10 hours per week.')
      await page.getByRole('button', { name: 'Resubmit for review' }).click()
      await expect(getAlert(page)).toContainText('Application resubmitted for review', {
        timeout: 10_000,
      })

      // Once resubmitted, the editable application panel is gone (locked pending admin review)
      await expect(page.getByLabel('Your application')).not.toBeVisible({ timeout: 5_000 })
      await expect(page.getByText(/awaiting review/i)).toBeVisible()
    } finally {
      await context.close()
    }

    // Status is back to under review, with the applicant's update applied
    await adminPage.goto(`${baseUrl}/admin/applications`)
    const card = adminPage.getByRole('article').filter({ hasText: person.name })
    await expect(card).toBeVisible({ timeout: 10_000 })
    await expect(card.getByText('Updated: I can commit 10 hours per week.')).toBeVisible()
  })

  test('Login page prefills email from the query param', async ({ browser, baseUrl }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    try {
      await page.goto(`${baseUrl}/login?email=someone%40example.com`)
      await expect(page.getByLabel('Email', { exact: true })).toHaveValue('someone@example.com')
    } finally {
      await context.close()
    }
  })

  test('Admin reopens a rejected application; applicant can resubmit and it leaves the Rejected tab', async ({
    adminPage,
    browser,
    baseUrl,
  }) => {
    const person = fake.person()
    const signupResult = await createApiClient(baseUrl).auth.signup({
      body: {
        name: person.name,
        email: person.email,
        password: 'testpassword1',
        bio: 'e2e test bio, at least twenty characters long',
        country: 'UK',
        availabilityHoursPerWeek: 5,
        applicationMessage: 'I would like to help with outreach.',
        consentMakeProfileVisibleInDirectory: true,
        consentContactableByProjectOwners: true,
      },
    })
    const { id: volunteerId } = signupResult.body
    await rejectVolunteer(baseUrl, volunteerId, 'Needs more experience')
    await reopenApplication(
      baseUrl,
      volunteerId,
      'We would love to hear more about your recent experience.',
    )

    // No longer in the Rejected section
    await adminPage.goto(`${baseUrl}/admin/applications`)
    await expect(adminPage.getByRole('heading', { name: 'Applications' })).toBeVisible({
      timeout: 10_000,
    })
    await expect(
      adminPage
        .getByTestId('applications-section-rejected')
        .getByRole('article')
        .filter({ hasText: person.name }),
    ).not.toBeVisible({ timeout: 5_000 })

    const context = await browser.newContext()
    const page = await context.newPage()
    try {
      await login(baseUrl, page, person.email, 'testpassword1')
      await page.goto(`${baseUrl}/settings`)
      await expect(
        page.getByText('We would love to hear more about your recent experience.'),
      ).toBeVisible({ timeout: 10_000 })
      await page.getByRole('button', { name: 'Resubmit for review' }).click()
      await expect(getAlert(page)).toContainText('Application resubmitted for review', {
        timeout: 10_000,
      })
    } finally {
      await context.close()
    }

    await adminPage.goto(`${baseUrl}/admin/applications`)
    await expect(adminPage.getByRole('article').filter({ hasText: person.name })).toBeVisible({
      timeout: 10_000,
    })
  })

  test('Admin UI: Request more info and Reopen buttons drive the same flow', async ({
    adminPage,
    baseUrl,
  }) => {
    const person = fake.person()
    const signupResult = await createApiClient(baseUrl).auth.signup({
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
    const { id: volunteerId } = signupResult.body

    await adminPage.goto(`${baseUrl}/admin/applications/${volunteerId}`)
    await expect(adminPage.getByRole('heading', { name: person.name })).toBeVisible({
      timeout: 10_000,
    })

    await adminPage.getByRole('button', { name: 'Request more info' }).click()
    const requestInfoModal = adminPage.getByRole('dialog')
    await expect(requestInfoModal).toBeVisible({ timeout: 5_000 })
    await requestInfoModal.getByRole('button', { name: 'Request info' }).click()
    await expect(getAlert(adminPage)).toContainText('More information requested', {
      timeout: 10_000,
    })
    await expect(adminPage).toHaveURL(/\/admin\/applications$/, { timeout: 10_000 })

    // needs_info doesn't block approve/reject — admin can still act if the applicant never responds
    await rejectVolunteer(baseUrl, volunteerId, 'Rejected for this test')
    await adminPage.goto(`${baseUrl}/admin/applications/${volunteerId}`)
    await adminPage.getByRole('button', { name: 'Reopen application' }).click()
    const reopenModal = adminPage.getByRole('dialog')
    await expect(reopenModal).toBeVisible({ timeout: 5_000 })
    await reopenModal.getByRole('button', { name: 'Reopen' }).click()
    await expect(getAlert(adminPage)).toContainText('Application reopened', { timeout: 10_000 })
    await expect(adminPage).toHaveURL(/\/admin\/applications$/, { timeout: 10_000 })
  })

  test.skip('Anonymised rejection blocks reapplication until an admin allows it', async () => {
    // Scenario:
    // 1. Person signs up, admin rejects them.
    // 2. After 7 days the anonymisation job runs, creating an AnonymisedEmail row for the
    //    email hash and wiping the volunteer's PII.
    // 3. The same email attempting to sign up again is rejected with "previously rejected".
    // 4. Admin opens the Rejected - Anonymised list and clicks "Allow reapply" on that row.
    // 5. The same email can now sign up successfully.
    //
    // Skipped: triggering anonymisation requires backdating rejected_at by 7 days,
    // which needs a test-only seed endpoint that doesn't yet exist (same limitation as
    // the skipped "Re-applicant shows full prior rejection history" test in
    // 01-auth-signup-login.spec.ts).
  })
})
