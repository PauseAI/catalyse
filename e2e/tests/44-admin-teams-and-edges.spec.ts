import { test, expect, getAlert } from '../fixtures'
import { fake } from '../fake'
import { navigateToAdminTeams } from '../actions/teams'

test.describe('Admin team management', () => {
  test('The add-team dialog refuses a Luma URL that is not a URL', async ({
    adminPage,
    baseUrl,
  }) => {
    await navigateToAdminTeams(baseUrl, adminPage)
    await adminPage.getByRole('button', { name: 'Add Team' }).click()
    await adminPage.getByLabel('Team Name').fill(fake.teamName())
    await adminPage.getByLabel('Luma calendar URL').fill('not a url')
    await adminPage.getByRole('button', { name: /^Add/ }).last().click()
    await expect(getAlert(adminPage)).toContainText('Enter a full address', { timeout: 10_000 })
  })

  test('Admin adds a team from the dialog, then deletes it', async ({
    adminPage,
    baseUrl,
    snap,
  }) => {
    const name = fake.teamName()
    await navigateToAdminTeams(baseUrl, adminPage)
    await adminPage.getByRole('button', { name: 'Add Team' }).click()
    const dialog = adminPage.locator('div').filter({
      has: adminPage.getByRole('heading', { name: 'Add Team' }),
    })
    const submit = dialog.getByRole('button', { name: /^Add/ }).last()
    await expect(submit).toBeDisabled()
    await adminPage.getByLabel('Team Name').fill(name)
    await adminPage.getByLabel('Description').fill('Made in an e2e test.')
    await adminPage.getByLabel('Luma calendar URL').fill('https://luma.com/e2e-team')
    await snap(adminPage, 'add team dialog')
    await submit.click()
    await expect(getAlert(adminPage)).toContainText('Team added', { timeout: 10_000 })

    const item = adminPage.getByText(name, { exact: true })
    await expect(item).toBeVisible({ timeout: 10_000 })
    // The row is the nearest ancestor that also holds the row's own buttons.
    const row = adminPage
      .locator('*')
      .filter({ has: item })
      .filter({ has: adminPage.getByRole('button', { name: 'Delete' }) })
      .last()
    await expect(row.getByRole('link', { name: 'Manage' })).toBeVisible()

    await row.getByRole('button', { name: 'Delete' }).click()
    await expect(adminPage.getByRole('heading', { name: 'Confirm Delete' })).toBeVisible()
    await snap(adminPage, 'confirm delete')
    await adminPage.getByRole('button', { name: 'Delete', exact: true }).last().click()
    await expect(getAlert(adminPage)).toContainText('Deleted', { timeout: 10_000 })
    await expect(item).toBeHidden({ timeout: 10_000 })
  })
})

test.describe('Edges', () => {
  test('An unknown page shows the not-found screen', async ({ volunteer, baseUrl, snap }) => {
    await volunteer.page.goto(`${baseUrl}/no-such-page`)
    await expect(volunteer.page.getByRole('heading', { name: 'Page Not Found' })).toBeVisible({
      timeout: 10_000,
    })
    await snap(volunteer.page, 'not found')
  })

  test('An unknown volunteer id says so rather than breaking', async ({ volunteer, baseUrl }) => {
    await volunteer.page.goto(`${baseUrl}/volunteers/999999`)
    await expect(volunteer.page.getByText('Volunteer not found.')).toBeVisible({
      timeout: 10_000,
    })
  })

  test('A visitor can read the privacy page without signing in', async ({ browser, baseUrl }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    try {
      await page.goto(`${baseUrl}/privacy`)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })
      // Signed out: the header offers a login, in the bar or behind the phone menu.
      const menu = page.getByRole('button', { name: 'Open menu' })
      if (await menu.isVisible()) await menu.click()
      await expect(page.getByRole('link', { name: 'Login' })).toBeVisible()
    } finally {
      await context.close()
    }
  })
})
