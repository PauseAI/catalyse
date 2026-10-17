import { test, expect, getAlert, createApprovedVolunteer, signedInPage } from '../fixtures'

test.describe('Choosing a chapter', () => {
  test('A volunteer whose country has no chapter joins one from the prompt, and leaves the admin list', async ({
    browser,
    baseUrl,
    adminPage,
    snap,
  }) => {
    const vol = await createApprovedVolunteer(baseUrl, { country: 'Other' })
    const pool = adminPage.getByRole('region', { name: /^No national chapter/ })
    await adminPage.goto(`${baseUrl}/admin/required-actions`)
    await expect(pool.getByRole('link', { name: vol.name })).toBeVisible({ timeout: 10_000 })
    await snap(adminPage, 'outstanding actions')

    const page = await signedInPage(browser, vol.token)
    try {
      await page.goto(`${baseUrl}/dashboard`)
      const dialog = page.getByRole('dialog', { name: 'Join a national chapter' })
      await expect(dialog).toBeVisible({ timeout: 10_000 })
      await dialog.getByRole('button', { name: 'Select chapter' }).click()
      await page.getByRole('option', { name: 'United Kingdom' }).click()
      await snap(page, 'chapter chosen')
      await dialog.getByRole('button', { name: 'Join' }).click()
      await expect(getAlert(page)).toContainText('You joined United Kingdom', { timeout: 10_000 })
      await expect(dialog).toBeHidden()
    } finally {
      await page.context().close()
    }

    await adminPage.reload()
    await expect(pool).toBeVisible({ timeout: 10_000 })
    await expect(pool.getByRole('link', { name: vol.name })).toHaveCount(0)
  })
})
