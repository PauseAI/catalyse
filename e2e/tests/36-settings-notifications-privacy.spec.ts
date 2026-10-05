import { test, expect, getAlert } from '../fixtures'
import { selectFilterDropdown } from '../actions/ui'

// 27-remote-eligibility.spec.ts covers the notify_remote_projects checkbox and its effect on
// match alerts. 18-gdpr-privacy.spec.ts covers directory visibility and the contact request
// end-to-end via another volunteer's search. This file covers what neither exercises: the email
// digest dropdown itself, and the directory checkbox saving.

test.describe('Settings: Notifications tab', () => {
  test('Email digest preference persists after save and reload', async ({ volunteer, baseUrl }) => {
    await volunteer.page.goto(`${baseUrl}/settings?tab=notifications`)
    await expect(volunteer.page.getByLabel('Keep me in the loop about new projects')).toBeVisible({
      timeout: 10_000,
    })

    await selectFilterDropdown(
      volunteer.page,
      'Keep me in the loop about new projects',
      'Send me a fortnightly digest',
    )
    await volunteer.page.getByRole('button', { name: 'Save Changes' }).click()
    await expect(getAlert(volunteer.page)).toBeVisible({ timeout: 10_000 })

    await volunteer.page.reload()
    await expect(volunteer.page.getByLabel('Keep me in the loop about new projects')).toContainText(
      'Send me a fortnightly digest',
      { timeout: 10_000 },
    )
  })
})

test.describe('Settings: Privacy & Data tab', () => {
  test('Directory visibility persists, and there is no owner-contact choice to make', async ({
    volunteer,
    baseUrl,
  }) => {
    await volunteer.page.goto(`${baseUrl}/settings?tab=privacy`)
    const listed = volunteer.page.getByLabel('Show me in the volunteer directory')
    await expect(listed).toBeVisible({ timeout: 10_000 })
    // People on your projects can always reach you, so neither old checkbox is offered.
    await expect(volunteer.page.getByText(/Allow project owners to contact me/)).toHaveCount(0)
    await expect(volunteer.page.getByText(/Share my contact info directly/)).toHaveCount(0)

    const wasListed = await listed.isChecked()
    await volunteer.page.locator('label:has(#consent_make_profile_visible_in_directory)').click()
    await volunteer.page.getByRole('button', { name: 'Save Changes' }).click()
    await expect(getAlert(volunteer.page)).toBeVisible({ timeout: 10_000 })
    await volunteer.page.reload()
    await expect(volunteer.page.getByLabel('Show me in the volunteer directory')).toBeChecked({
      checked: !wasListed,
      timeout: 10_000,
    })
  })
})
