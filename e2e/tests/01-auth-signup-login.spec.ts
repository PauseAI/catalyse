import {
  test,
  expect,
  getAlert,
  confirmVolunteerEmail,
  rejectVolunteer,
  dismissCookieConsentScript,
} from '../fixtures'
import { signup, login } from '../actions/auth'
import { selectFilterDropdown } from '../actions/ui'
import { fake } from '../fake'
import { createApiClient } from '../client'

test.describe('Authentication: Signup & Login', () => {
  test('Visitor signs up successfully', async ({ browser, baseUrl }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    try {
      const person = fake.person()
      await signup(baseUrl, page, person.name, person.email, 'testpassword1')
      await expect(page.getByRole('heading', { name: 'Application received' })).toBeVisible({
        timeout: 10_000,
      })
    } finally {
      await context.close()
    }
  })

  test('Visitor logs in successfully', async ({ browser, volunteer, baseUrl }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    try {
      await login(baseUrl, page, volunteer.email, volunteer.password)
      await expect(page).toHaveURL(`${baseUrl}/dashboard`)
    } finally {
      await context.close()
    }
  })

  test('Login fails with wrong password', async ({ browser, volunteer, baseUrl }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    try {
      await page.goto(`${baseUrl}/login`)
      await page.getByLabel('Email', { exact: true }).fill(volunteer.email)
      await page.getByLabel('Password').fill('wrongpassword')
      await page.getByRole('button', { name: 'Login' }).click()
      await expect(getAlert(page)).toBeVisible({ timeout: 10_000 })
      await expect(page).toHaveURL(`${baseUrl}/login`)
    } finally {
      await context.close()
    }
  })

  test('Login fails with unknown email', async ({ browser, baseUrl }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    try {
      await page.goto(`${baseUrl}/login`)
      await page.getByLabel('Email', { exact: true }).fill(fake.uniqueEmail())
      await page.getByLabel('Password').fill('testpassword1')
      await page.getByRole('button', { name: 'Login' }).click()
      await expect(getAlert(page)).toBeVisible({ timeout: 10_000 })
    } finally {
      await context.close()
    }
  })

  test('Signup fails when email is already registered', async ({ browser, volunteer, baseUrl }) => {
    const context = await browser.newContext()
    await context.addInitScript(dismissCookieConsentScript)
    const page = await context.newPage()
    try {
      await page.goto(`${baseUrl}/signup`)
      await page.getByLabel('Your Name').fill('Duplicate User')
      await page.getByLabel('Email', { exact: true }).fill(volunteer.email)
      await page.getByLabel('Password', { exact: true }).fill('testpassword1')
      await page.getByLabel('Confirm Password').fill('testpassword1')
      await page.getByRole('button', { name: 'Next: About you' }).click()
      await page.getByLabel('Your Application').fill('e2e test application message')
      await page.getByLabel('About You').fill('e2e test bio, at least twenty characters long')
      await page.getByLabel('Hours per Week').fill('5')
      await selectFilterDropdown(page, 'Select country', 'United Kingdom')
      await page.getByRole('button', { name: 'Next: Skills and privacy' }).click()
      await page.getByRole('button', { name: 'Submit Application' }).click()
      await expect(getAlert(page)).toContainText('Email already registered', { timeout: 10_000 })
    } finally {
      await context.close()
    }
  })

  test('Signup fails with a short password', async ({ browser, baseUrl }) => {
    const context = await browser.newContext()
    await context.addInitScript(dismissCookieConsentScript)
    const page = await context.newPage()
    try {
      await page.goto(`${baseUrl}/signup`)
      const person = fake.person()
      await page.getByLabel('Your Name').fill(person.name)
      await page.getByLabel('Email', { exact: true }).fill(person.email)
      // Remove HTML minlength so the browser doesn't intercept before the JS handler runs
      await page.evaluate(() => {
        document.querySelector('#password')?.removeAttribute('minlength')
        document.querySelector('#password_confirm')?.removeAttribute('minlength')
      })
      await page.getByLabel('Password', { exact: true }).fill('abc')
      await page.getByLabel('Confirm Password').fill('abc')
      // The account step checks the password before moving on.
      await page.getByRole('button', { name: 'Next: About you' }).click()
      await expect(getAlert(page)).toContainText('at least 8 characters', { timeout: 10_000 })
      await expect(page.getByRole('heading', { level: 2, name: 'Account' })).toBeVisible()
    } finally {
      await context.close()
    }
  })

  test('Admin approves a pending application; volunteer can then access the platform', async ({
    adminPage,
    browser,
    baseUrl,
  }) => {
    const person = fake.person()

    const api = createApiClient(baseUrl)
    const signupResult = await api.auth.signup({
      body: {
        name: person.name,
        email: person.email,
        password: 'testpassword1',
        applicationMessage: 'I want to contribute to AI safety',
        bio: 'e2e test bio, at least twenty characters long',
        country: 'UK',
        availabilityHoursPerWeek: 5,
        consentMakeProfileVisibleInDirectory: true,
        consentContactableByProjectOwners: true,
      },
    })
    expect(signupResult.status).toBe(200)
    const { pending, emailVerificationToken } = signupResult.body
    expect(pending).toBe(true)

    if (emailVerificationToken) {
      await confirmVolunteerEmail(baseUrl, emailVerificationToken)
    }

    await adminPage.goto(`${baseUrl}/admin/applications`)
    await expect(adminPage.getByRole('heading', { name: 'Applications' })).toBeVisible({
      timeout: 10_000,
    })

    const card = adminPage.getByRole('article').filter({ hasText: person.name })
    await expect(card).toBeVisible({ timeout: 20_000 })
    await card.getByRole('button', { name: 'Start Review' }).click()
    await expect(adminPage).toHaveURL(/\/admin\/applications\/\d+/, { timeout: 10_000 })
    await adminPage.getByRole('button', { name: 'Approve' }).click()
    await expect(adminPage.getByRole('dialog')).toBeVisible({ timeout: 5_000 })
    await adminPage.getByRole('dialog').getByRole('button', { name: 'Approve' }).click()
    await expect(getAlert(adminPage)).toContainText('Application approved', { timeout: 10_000 })
    await expect(adminPage).toHaveURL(/\/admin\/applications$/, { timeout: 10_000 })

    // Approved volunteer can log in and reach dashboard without pending banner
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    try {
      await login(baseUrl, page, person.email, 'testpassword1')
      await expect(page).toHaveURL(`${baseUrl}/dashboard`)
      await expect(page.getByText('Your account is pending approval')).not.toBeVisible()

      // Approval is announced once, in a dialog that points at the next step.
      const welcome = page.getByRole('dialog', { name: /You're approved/ })
      await expect(welcome).toBeVisible({ timeout: 10_000 })
      // The dialog closes at once; the read is saved in the background, so wait for it
      // before reloading.
      const markedRead = page.waitForResponse(
        (resp) => resp.url().includes('/api/rpc/notifications/markRead') && resp.ok(),
      )
      await welcome.getByRole('button', { name: 'Not now' }).click()
      await expect(welcome).not.toBeVisible()
      await markedRead
      await page.reload()
      await expect(page.getByRole('heading', { level: 1, name: 'Home', exact: true })).toBeVisible({
        timeout: 10_000,
      })
      await expect(welcome).not.toBeVisible()
    } finally {
      await ctx.close()
    }
  })

  test('Logged-in user visiting login page is redirected to dashboard', async ({
    volunteer,
    baseUrl,
  }) => {
    await volunteer.page.goto(`${baseUrl}/login`)
    await expect(volunteer.page).toHaveURL(`${baseUrl}/dashboard`, { timeout: 10_000 })
  })

  test('Resend confirmation email button appears on pending screen and sends email', async ({
    browser,
    baseUrl,
  }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    try {
      const person = fake.person()
      await signup(baseUrl, page, person.name, person.email, 'testpassword1')
      await expect(page.getByRole('heading', { name: 'Application received' })).toBeVisible({
        timeout: 10_000,
      })
      await page.getByRole('button', { name: 'Resend confirmation email' }).click()
      await expect(page.getByText(/Email sent!/)).toBeVisible({ timeout: 5_000 })
    } finally {
      await context.close()
    }
  })

  test('Admin can start review; application moves to Under Review tab', async ({
    adminPage,
    baseUrl,
  }) => {
    const person = fake.person()
    await createApiClient(baseUrl).auth.signup({
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

    await adminPage.goto(`${baseUrl}/admin/applications`)
    await expect(adminPage.getByRole('heading', { name: 'Applications' })).toBeVisible({
      timeout: 10_000,
    })

    const card = adminPage.getByRole('article').filter({ hasText: person.name })
    await expect(card).toBeVisible({ timeout: 20_000 })
    await card.getByRole('button', { name: 'Start Review' }).click()
    await expect(adminPage).toHaveURL(/\/admin\/applications\/\d+/, { timeout: 10_000 })
    await adminPage.goto(`${baseUrl}/admin/applications`)
    await expect(adminPage.getByRole('heading', { name: 'Applications' })).toBeVisible({
      timeout: 10_000,
    })

    // Card stays visible in "mine" filter (UNDER_REVIEW by me is still "mine")
    const mineCard = adminPage.getByRole('article').filter({ hasText: person.name })
    await expect(mineCard.getByRole('button', { name: 'Continue Review' })).toBeVisible({
      timeout: 5_000,
    })
    await expect(mineCard.getByText(/Reviewer:/)).toBeVisible()

    // Card also appears in "others" tab when viewed by a different reviewer (not tested here),
    // confirm it's absent from the Under Review by Others section
    const othersCard = adminPage
      .getByTestId('applications-section-others')
      .getByRole('article')
      .filter({ hasText: person.name })
    await expect(othersCard).not.toBeVisible({ timeout: 5_000 })
  })

  test('Admin can reject application with notes; notes visible on Rejected tab card', async ({
    adminPage,
    baseUrl,
  }) => {
    const person = fake.person()
    await createApiClient(baseUrl).auth.signup({
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

    await adminPage.goto(`${baseUrl}/admin/applications`)
    await expect(adminPage.getByRole('heading', { name: 'Applications' })).toBeVisible({
      timeout: 10_000,
    })

    const card = adminPage.getByRole('article').filter({ hasText: person.name })
    await expect(card).toBeVisible({ timeout: 20_000 })
    await card.getByRole('button', { name: 'Start Review' }).click()
    await expect(adminPage).toHaveURL(/\/admin\/applications\/\d+/, { timeout: 10_000 })

    await adminPage.getByPlaceholder('Notes visible only to admins…').fill('Spam account')
    await adminPage
      .getByPlaceholder('Optional message to applicant…')
      .fill('Your application did not meet our requirements.')
    await adminPage.getByRole('button', { name: 'Reject' }).click()

    const modal = adminPage.getByRole('dialog')
    await expect(modal).toBeVisible({ timeout: 5_000 })
    await modal.getByRole('button', { name: 'Reject' }).click()

    await expect(getAlert(adminPage)).toContainText('Application rejected', { timeout: 10_000 })
    await expect(adminPage).toHaveURL(/\/admin\/applications$/, { timeout: 10_000 })

    // Notes visible on Rejected section
    const rejectedCard = adminPage
      .getByTestId('applications-section-rejected')
      .getByRole('article')
      .filter({ hasText: person.name })
    await expect(rejectedCard).toBeVisible({ timeout: 5_000 })
    await expect(rejectedCard.getByText('Spam account')).toBeVisible()
    await expect(
      rejectedCard.getByText('Your application did not meet our requirements.'),
    ).toBeVisible()
  })

  test('Rejected application shows anonymisation countdown', async ({ adminPage, baseUrl }) => {
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
    expect(signupResult.status).toBe(200)
    const { id: volunteerId } = signupResult.body

    // Reject via API using the same helper pattern as approveVolunteer
    await rejectVolunteer(baseUrl, volunteerId, 'Test rejection')

    await adminPage.goto(`${baseUrl}/admin/applications`)
    await expect(adminPage.getByRole('heading', { name: 'Applications' })).toBeVisible({
      timeout: 10_000,
    })
    const card = adminPage
      .getByTestId('applications-section-rejected')
      .getByRole('article')
      .filter({ hasText: person.name })
    await expect(card).toBeVisible({ timeout: 20_000 })
    await expect(card.getByText(/will be anonymised on/i)).toBeVisible()
    await expect(card.getByText('Test rejection')).toBeVisible()
  })

  test('Google signup: application message and profile fields saved and visible to admin', async ({
    adminPage,
    browser,
    baseUrl,
  }) => {
    // Name comes from the Google account and isn't user-editable during signup (the field
    // is read-only) — the dev stub always reports "Stub User" since it doesn't send one.
    const googleName = 'Stub User'
    const applicationMessage = 'I want to help pause AI development because of safety concerns'

    const context = await browser.newContext()
    await context.addInitScript(dismissCookieConsentScript)
    const page = await context.newPage()
    try {
      await page.goto(`${baseUrl}/signup`)

      // Stub button only appears in dev/test (no GOOGLE_CLIENT_ID configured)
      await expect(page.getByRole('button', { name: /Sign up with Google/ })).toBeVisible({
        timeout: 10_000,
      })
      await page.getByRole('button', { name: /Sign up with Google/ }).click()

      // Google identity verified (no account created yet); application form appears
      await expect(page.getByLabel('Your Application')).toBeVisible({ timeout: 10_000 })
      await expect(page.getByLabel('Your Name')).toHaveValue(googleName)
      await expect(page.getByLabel('Your Name')).toBeDisabled()

      await page.getByLabel('Your Application').fill(applicationMessage)
      await page.getByLabel('About You').fill('e2e test bio, at least twenty characters long')
      await page.getByLabel('Hours per Week').fill('5')
      await selectFilterDropdown(page, 'Select country', 'United Kingdom')
      await page.getByRole('button', { name: 'Next: Skills and privacy' }).click()
      await page.getByRole('button', { name: 'Submit Application' }).click()

      await expect(page.getByRole('heading', { name: 'Application received' })).toBeVisible({
        timeout: 10_000,
      })
    } finally {
      await context.close()
    }

    // Admin can see the application message on the applications list
    await adminPage.goto(`${baseUrl}/admin/applications`)
    await expect(adminPage.getByRole('heading', { name: 'Applications' })).toBeVisible({
      timeout: 10_000,
    })
    const card = adminPage.getByRole('article').filter({ hasText: googleName })
    await expect(card).toBeVisible({ timeout: 20_000 })
    await expect(card.getByText(applicationMessage)).toBeVisible()
  })
})
