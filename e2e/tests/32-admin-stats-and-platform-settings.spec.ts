import { test, expect } from '../fixtures'
import { createApiClient } from '../client'
import { ensureChapter, makeChapterStaff } from '../actions/chapters'

test.describe('Admin Landing Page Stats', () => {
  test('Admin landing page shows volunteer/project/interest stat tiles and admin nav groups', async ({
    adminPage,
    baseUrl,
  }) => {
    await adminPage.goto(`${baseUrl}/admin`)
    await expect(adminPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })

    await expect(adminPage.getByRole('heading', { name: 'Volunteers' })).toBeVisible({
      timeout: 10_000,
    })
    await expect(adminPage.getByText('Total registered')).toBeVisible()
    await expect(adminPage.getByText('Joined last 30 days')).toBeVisible()
    await expect(adminPage.getByText('Approved')).toBeVisible()
    await expect(adminPage.getByText('Under review')).toBeVisible()
    await expect(adminPage.getByText('Needs info')).toBeVisible()

    await expect(adminPage.getByText('Seeking help')).toBeVisible()
    await expect(adminPage.getByText('In progress')).toBeVisible()
    await expect(adminPage.getByText('Completed')).toBeVisible()

    await expect(adminPage.getByRole('heading', { name: 'Volunteer interest' })).toBeVisible()
    await expect(adminPage.getByText('Total interests')).toBeVisible()
    await expect(adminPage.getByText('Pending response')).toBeVisible()

    await expect(adminPage.getByRole('link', { name: 'Manage applications' })).toBeVisible()
    await expect(adminPage.getByRole('link', { name: 'Triage queue' })).toBeVisible()
    await expect(adminPage.getByRole('link', { name: 'Platform settings' })).toBeVisible()
  })

  test('A non-admin visiting /admin is redirected away', async ({ volunteer, baseUrl }) => {
    await volunteer.page.goto(`${baseUrl}/admin`)
    await expect(volunteer.page).not.toHaveURL(`${baseUrl}/admin`, { timeout: 10_000 })
  })
})

test.describe('Admin Platform Settings', () => {
  test('Super admin toggles application approval requirement and it persists on reload', async ({
    adminPage,
    baseUrl,
  }) => {
    await adminPage.goto(`${baseUrl}/admin/platform-settings`)
    await expect(adminPage.getByRole('heading', { name: 'Platform settings' })).toBeVisible({
      timeout: 10_000,
    })

    const toggle = adminPage.getByRole('checkbox', { name: 'Require application approval' })
    await expect(toggle).toBeVisible({ timeout: 10_000 })
    const wasChecked = await toggle.isChecked()

    // The visible switch is a decorative sibling of the sr-only input, so a plain click on
    // the input is reported as intercepted even though the label's native click still works.
    await toggle.click({ force: true })
    await expect(adminPage.getByText('Settings saved')).toBeVisible({ timeout: 10_000 })
    await expect(toggle).toBeChecked({ checked: !wasChecked })

    await adminPage.reload()
    await expect(toggle).toBeChecked({ checked: !wasChecked, timeout: 10_000 })

    // Restore original state so this test doesn't leak into others that assume approval is on.
    await toggle.click({ force: true })
    await expect(adminPage.getByText('Settings saved')).toBeVisible({ timeout: 10_000 })
  })

  test('A chapter deputy cannot open platform settings', async ({ volunteer, baseUrl }) => {
    // Navigate first: a brand new page is about:blank, and localStorage is inaccessible there.
    await volunteer.page.goto(`${baseUrl}/dashboard`)
    const volunteerToken = await volunteer.page.evaluate(() => localStorage.getItem('authToken'))
    const me = await createApiClient(baseUrl, volunteerToken).auth.me()
    await makeChapterStaff(baseUrl, me.body.id, await ensureChapter(baseUrl, 'UK'), 'DEPUTY')

    await volunteer.page.goto(`${baseUrl}/admin/platform-settings`)
    await expect(volunteer.page).not.toHaveURL(`${baseUrl}/admin/platform-settings`, {
      timeout: 10_000,
    })
    await expect(volunteer.page.getByText('That page is for global admins.')).toBeVisible()
  })
})
