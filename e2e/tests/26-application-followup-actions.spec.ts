import {
  test,
  expect,
  getAlert,
  rejectVolunteer,
  requestMoreInfo,
  reopenApplication,
  readAdminToken,
} from '../fixtures'
import { Client } from 'pg'
import { login } from '../actions/auth'
import { fake } from '../fake'
import { createApiClient } from '../client'
import { IS_LOCAL, parallelIndexFromBaseUrl, workerDbUrl } from '../config'

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
      await page.getByRole('link', { name: 'Update Application' }).click()
      await page.waitForURL(/\/settings/, { timeout: 10_000 })

      await expect(page.getByText('Could you tell us more about your availability?')).toBeVisible({
        timeout: 10_000,
      })
      await page.getByLabel('Your Application').fill('Updated: I can commit 10 hours per week.')
      await page.getByRole('button', { name: 'Resubmit for Review' }).click()
      await expect(getAlert(page)).toContainText('Application resubmitted for review', {
        timeout: 10_000,
      })

      // Once resubmitted, the editable application panel is gone (locked pending admin review)
      await expect(page.getByLabel('Your Application')).not.toBeVisible({ timeout: 5_000 })
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
      await page.getByRole('button', { name: 'Resubmit for Review' }).click()
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

  test('Admin UI: Request More Info and Reopen buttons drive the same flow', async ({
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

    await adminPage.getByRole('button', { name: 'Request More Info' }).click()
    const requestInfoModal = adminPage.getByRole('dialog')
    await expect(requestInfoModal).toBeVisible({ timeout: 5_000 })
    await requestInfoModal.getByRole('button', { name: 'Request Info' }).click()
    await expect(getAlert(adminPage)).toContainText('More information requested', {
      timeout: 10_000,
    })
    await expect(adminPage).toHaveURL(/\/admin\/applications$/, { timeout: 10_000 })

    // needs_info doesn't block approve/reject — admin can still act if the applicant never responds
    await rejectVolunteer(baseUrl, volunteerId, 'Rejected for this test')
    await adminPage.goto(`${baseUrl}/admin/applications/${volunteerId}`)
    await adminPage.getByRole('button', { name: 'Reopen Application' }).click()
    const reopenModal = adminPage.getByRole('dialog')
    await expect(reopenModal).toBeVisible({ timeout: 5_000 })
    await reopenModal.getByRole('button', { name: 'Reopen' }).click()
    await expect(getAlert(adminPage)).toContainText('Application reopened', { timeout: 10_000 })
    await expect(adminPage).toHaveURL(/\/admin\/applications$/, { timeout: 10_000 })
  })

  test('An anonymised rejection blocks reapplying until an admin allows it, and the admin sees the history', async ({
    adminPage,
    baseUrl,
    snap,
  }) => {
    test.skip(!IS_LOCAL, 'backdates the rejection directly in the worker database')
    test.setTimeout(90_000)

    // A rejected application, with the notes and message the admin would leave.
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
    expect(signup.status, JSON.stringify(signup.body)).toBe(200)
    const { id } = signup.body as { id: number }
    const adminNotes = `not this time: ${fake.note()}`
    await rejectVolunteer(baseUrl, id, adminNotes)

    // The retention period has passed: backdate the rejection in the worker's schema.
    const dbUrl = new URL(workerDbUrl(parallelIndexFromBaseUrl(baseUrl)))
    const db = new Client({ connectionString: dbUrl.toString() })
    await db.connect()
    try {
      await db.query(`SET search_path TO "${dbUrl.searchParams.get('schema')}"`)
      await db.query(
        `UPDATE volunteers SET rejected_at = now() - interval '30 days' WHERE id = $1`,
        [id],
      )
    } finally {
      await db.end()
    }
    const admin = createApiClient(baseUrl, readAdminToken(baseUrl)!)
    const ran = await admin.admin.cronRuns.run({ body: { jobName: 'applications-anonymisation' } })
    expect(ran.status, JSON.stringify(ran.body)).toBe(200)

    // The same email is turned away.
    const again = await api.auth.signup({
      body: {
        name: fake.personName(),
        email: person.email,
        password: 'testpassword1',
        bio: 'e2e test bio, at least twenty characters long',
        country: 'UK',
        availabilityHoursPerWeek: 5,
        applicationMessage: 'trying again after a rejection',
        consentMakeProfileVisibleInDirectory: true,
        consentContactableByProjectOwners: true,
      },
    })
    expect(again.status).toBe(400)
    expect((again.body as { message: string }).message).toMatch(/previously rejected/i)

    // The admin finds it under the anonymised rejections and allows a reapplication.
    await adminPage.goto(`${baseUrl}/admin/applications`)
    await adminPage.getByRole('button', { name: /Rejected – Anonymised: [1-9]/ }).click()
    const row = adminPage
      .locator('article, li, div')
      .filter({ hasText: adminNotes })
      .filter({
        has: adminPage.getByRole('button', { name: 'Allow Reapply' }),
      })
    await expect(row.first()).toBeVisible({ timeout: 10_000 })
    await snap(adminPage, 'anonymised rejection')
    await row.first().getByRole('button', { name: 'Allow Reapply' }).click()
    await expect(adminPage.getByText(/Reapplication allowed since/)).toBeVisible({
      timeout: 10_000,
    })

    // Now the signup goes through, and the admin's card carries the prior rejection.
    const reapplied = await api.auth.signup({
      body: {
        name: fake.personName(),
        email: person.email,
        password: 'testpassword1',
        bio: 'e2e test bio, at least twenty characters long',
        country: 'UK',
        availabilityHoursPerWeek: 5,
        applicationMessage: 'trying again after a rejection',
        consentMakeProfileVisibleInDirectory: true,
        consentContactableByProjectOwners: true,
      },
    })
    expect(reapplied.status, JSON.stringify(reapplied.body)).toBe(200)

    await adminPage.goto(`${baseUrl}/admin/applications`)
    const card = adminPage
      .getByRole('article')
      .filter({ hasText: 'trying again after a rejection' })
    await expect(card).toBeVisible({ timeout: 10_000 })
    await expect(card.getByText('Previously rejected')).toBeVisible()
    await expect(card.getByText(adminNotes)).toBeVisible()
    await snap(adminPage, 'reapplicant with history')
  })
})
