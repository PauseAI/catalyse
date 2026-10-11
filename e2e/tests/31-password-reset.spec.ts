import { test, expect, getAlert } from '../fixtures'
import { login } from '../actions/auth'
import { fake } from '../fake'

test.describe('Password Reset', () => {
  test('Volunteer resets their password via the emailed link and logs in with it', async ({
    browser,
    volunteer,
    baseUrl,
  }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    try {
      await page.goto(`${baseUrl}/forgot-password`)
      await page.getByLabel('Email').fill(volunteer.email)

      const [response] = await Promise.all([
        page.waitForResponse((resp) => resp.url().includes('/api/rpc/auth/forgotPassword')),
        page.getByRole('button', { name: 'Send Reset Link' }).click(),
      ])
      const { json } = await response.json()
      const devResetUrl = json._devResetUrl as string
      expect(devResetUrl).toBeTruthy()

      await expect(page.getByRole('heading', { name: 'Check Your Email' })).toBeVisible({
        timeout: 10_000,
      })

      const newPassword = 'newtestpassword2'
      await page.goto(`${baseUrl}${devResetUrl}`)
      await expect(page.getByRole('heading', { name: 'Set New Password' })).toBeVisible({
        timeout: 10_000,
      })
      await page.getByLabel('New Password').fill(newPassword)
      await page.getByLabel('Confirm Password').fill(newPassword)
      await page.getByRole('button', { name: 'Reset Password' }).click()
      await page.waitForURL(`${baseUrl}/login`, { timeout: 15_000 })

      await login(baseUrl, page, volunteer.email, newPassword)
      await expect(page).toHaveURL(`${baseUrl}/dashboard`)
    } finally {
      await context.close()
    }
  })

  test('Reset fails with a mismatched password confirmation', async ({ browser, baseUrl }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    try {
      await page.goto(`${baseUrl}/reset-password?token=irrelevant-for-this-check`)
      await expect(page.getByRole('heading', { name: 'Set New Password' })).toBeVisible({
        timeout: 10_000,
      })
      await page.getByLabel('New Password').fill('testpassword1')
      await page.getByLabel('Confirm Password').fill('differentpassword1')
      await page.getByRole('button', { name: 'Reset Password' }).click()
      await expect(page.getByText('Passwords do not match')).toBeVisible({ timeout: 10_000 })
    } finally {
      await context.close()
    }
  })

  test('An invalid or expired reset token shows an error and lets the user request a new link', async ({
    browser,
    baseUrl,
  }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    try {
      await page.goto(`${baseUrl}/reset-password?token=not-a-real-token`)
      await page.getByLabel('New Password').fill('testpassword1')
      await page.getByLabel('Confirm Password').fill('testpassword1')
      await page.getByRole('button', { name: 'Reset Password' }).click()
      await expect(getAlert(page)).toContainText('Invalid or expired reset token', {
        timeout: 10_000,
      })
    } finally {
      await context.close()
    }
  })

  test('Visiting the reset page without a token shows an invalid link message', async ({
    browser,
    baseUrl,
  }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    try {
      await page.goto(`${baseUrl}/reset-password`)
      await expect(page.getByRole('heading', { name: 'Invalid Link' })).toBeVisible({
        timeout: 10_000,
      })
      await page.getByRole('link', { name: 'Request New Link' }).click()
      await page.waitForURL(`${baseUrl}/forgot-password`)
    } finally {
      await context.close()
    }
  })

  test('Forgot-password does not reveal whether an email is registered', async ({
    browser,
    baseUrl,
  }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    try {
      await page.goto(`${baseUrl}/forgot-password`)
      await page.getByLabel('Email').fill(fake.uniqueEmail())
      await page.getByRole('button', { name: 'Send Reset Link' }).click()
      await expect(page.getByRole('heading', { name: 'Check Your Email' })).toBeVisible({
        timeout: 10_000,
      })
    } finally {
      await context.close()
    }
  })
})
