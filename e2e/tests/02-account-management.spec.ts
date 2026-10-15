import { test, expect, getAlert, dismissCookieConsentScript } from '../fixtures'
import { login } from '../actions/auth'

test.describe('Account Management', () => {
  test('Volunteer changes their password', async ({ browser, volunteer, baseUrl }) => {
    const newPassword = 'newpassword1'

    await volunteer.page.goto(`${baseUrl}/settings?tab=account`)
    await expect(volunteer.page.getByRole('heading', { name: 'Change password' })).toBeVisible({
      timeout: 10_000,
    })

    await volunteer.page.getByLabel('Current password').fill(volunteer.password)
    await volunteer.page.getByLabel('New password', { exact: true }).fill(newPassword)
    await volunteer.page.getByLabel('Confirm new password').fill(newPassword)
    await volunteer.page.getByRole('button', { name: 'Change password' }).click()

    await expect(getAlert(volunteer.page)).toBeVisible({ timeout: 10_000 })
    await expect(getAlert(volunteer.page)).toContainText('successfully')

    const ctx2 = await browser.newContext()
    await ctx2.addInitScript(dismissCookieConsentScript)
    const page2 = await ctx2.newPage()
    try {
      await login(baseUrl, page2, volunteer.email, newPassword)
      await expect(page2).toHaveURL(`${baseUrl}/dashboard`)
    } finally {
      await ctx2.close()
    }
  })

  test('Change password fails with wrong current password', async ({ volunteer, baseUrl }) => {
    await volunteer.page.goto(`${baseUrl}/settings?tab=account`)
    await expect(volunteer.page.getByRole('heading', { name: 'Change password' })).toBeVisible({
      timeout: 10_000,
    })

    await volunteer.page.getByLabel('Current password').fill('wrongpassword123')
    await volunteer.page.getByLabel('New password', { exact: true }).fill('newpassword1')
    await volunteer.page.getByLabel('Confirm new password').fill('newpassword1')
    await volunteer.page.getByRole('button', { name: 'Change password' }).click()

    await expect(getAlert(volunteer.page)).toBeVisible({ timeout: 10_000 })
    await expect(getAlert(volunteer.page)).not.toContainText('successfully')
  })

  test('Volunteer deletes their account', async ({ browser, volunteer, baseUrl }) => {
    await volunteer.page.goto(`${baseUrl}/settings?tab=account`)
    await expect(volunteer.page.getByRole('button', { name: 'Delete my account' })).toBeVisible({
      timeout: 10_000,
    })

    await volunteer.page.getByRole('button', { name: 'Delete my account' }).click()
    await expect(volunteer.page.locator('#deleteModal')).toBeVisible({ timeout: 10_000 })

    await volunteer.page.getByLabel('Enter your password').fill(volunteer.password)
    await volunteer.page.getByLabel('Confirm your password').fill(volunteer.password)
    await volunteer.page.getByRole('button', { name: 'Permanently delete account' }).click()

    await expect(getAlert(volunteer.page)).toBeVisible({ timeout: 10_000 })

    const ctx2 = await browser.newContext()
    await ctx2.addInitScript(dismissCookieConsentScript)
    const page2 = await ctx2.newPage()
    try {
      await page2.goto(`${baseUrl}/login`)
      await page2.getByLabel('Email', { exact: true }).fill(volunteer.email)
      await page2.getByLabel('Password').fill(volunteer.password)
      await page2.getByRole('button', { name: 'Login' }).click()
      await expect(getAlert(page2)).toBeVisible({ timeout: 10_000 })
    } finally {
      await ctx2.close()
    }
  })
})
