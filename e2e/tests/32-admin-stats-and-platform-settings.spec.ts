import { test, expect } from '../fixtures'
import { createApiClient } from '../client'

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

  test('A plain admin (not super admin) cannot access platform settings', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    // Make the volunteer a plain (non-super) admin via the invite flow — accepting an
    // admin invite grants isAdmin without isSuperAdmin, which is keyed off ADMIN_EMAILS.
    // Navigate first: a brand new page is about:blank, and localStorage is inaccessible there.
    await adminPage.goto(`${baseUrl}/dashboard`)
    const adminToken = await adminPage.evaluate(() => localStorage.getItem('authToken'))
    const inviteResult = await createApiClient(baseUrl, adminToken).admin.admins.invite({
      body: { email: volunteer.email },
    })
    expect(inviteResult.status).toBe(200)
    const inviteToken = (inviteResult.body as { _dev_invite_token?: string })._dev_invite_token
    expect(inviteToken).toBeTruthy()

    await volunteer.page.goto(`${baseUrl}/dashboard`)
    const volunteerToken = await volunteer.page.evaluate(() => localStorage.getItem('authToken'))
    const acceptResult = await createApiClient(baseUrl, volunteerToken).admin.admins.acceptInvite({
      body: { inviteToken: inviteToken! },
    })
    expect(acceptResult.status).toBe(200)

    await volunteer.page.goto(`${baseUrl}/admin/platform-settings`)
    await expect(volunteer.page).not.toHaveURL(`${baseUrl}/admin/platform-settings`, {
      timeout: 10_000,
    })
  })
})
