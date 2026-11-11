import { test, expect, getAlert } from '../fixtures'
import { selectFilterDropdown } from '../actions/ui'

// 18-gdpr-privacy.spec.ts covers directory visibility and the contact request end-to-end via
// another volunteer's search. This file covers what it does not exercise: the email digest
// dropdown itself, and the directory checkbox saving.

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
    await volunteer.page.getByRole('button', { name: 'Save changes' }).click()
    await expect(getAlert(volunteer.page)).toBeVisible({ timeout: 10_000 })

    await volunteer.page.reload()
    await expect(volunteer.page.getByLabel('Keep me in the loop about new projects')).toContainText(
      'Send me a fortnightly digest',
      { timeout: 10_000 },
    )
  })
})

test.describe('Settings: email for each notification', () => {
  test('a volunteer chooses how each notification reaches them, and it persists', async ({
    volunteer,
    baseUrl,
    snap,
  }) => {
    const page = volunteer.page
    await page.goto(`${baseUrl}/settings?tab=notifications`)
    const approved = page.getByRole('radiogroup', { name: 'Your project proposal is approved' })
    await expect(approved.getByRole('radio', { name: 'Email' })).toBeChecked({ timeout: 10_000 })
    // Staff-only types are not offered to a volunteer, and calls are fixed for now.
    await expect(page.getByText('A new volunteer signs up')).toHaveCount(0)
    await expect(page.getByRole('radiogroup', { name: 'A coordinator posts a call' })).toHaveCount(
      0,
    )
    await expect(page.getByText(/while call emails move to a mail service/)).toBeVisible()

    const setAll = page.getByRole('radiogroup', { name: 'Set all Updates' })
    await setAll.getByText('Digest', { exact: true }).click()
    await approved.getByText('In app', { exact: true }).click()
    const mention = page.getByRole('radiogroup', { name: 'Someone mentions you in a comment' })
    await mention.getByText('Email', { exact: true }).click()
    await snap(page, 'choices made')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(getAlert(page)).toBeVisible({ timeout: 10_000 })

    await page.reload()
    await expect(approved.getByRole('radio', { name: 'In app' })).toBeChecked({ timeout: 10_000 })
    await expect(
      page
        .getByRole('radiogroup', { name: "You're assigned a task" })
        .getByRole('radio', { name: 'Digest' }),
    ).toBeChecked()
    await expect(mention.getByRole('radio', { name: 'Email' })).toBeChecked()
  })

  test('an admin also sees the notifications only staff get', async ({ adminPage, baseUrl }) => {
    await adminPage.goto(`${baseUrl}/settings?tab=notifications`)
    await expect(
      adminPage.getByRole('radiogroup', { name: 'A new volunteer signs up' }),
    ).toBeVisible({ timeout: 10_000 })
  })
})

test.describe('Settings: Privacy & data tab', () => {
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
    await volunteer.page.getByRole('button', { name: 'Save changes' }).click()
    await expect(getAlert(volunteer.page)).toBeVisible({ timeout: 10_000 })
    await volunteer.page.reload()
    await expect(volunteer.page.getByLabel('Show me in the volunteer directory')).toBeChecked({
      checked: !wasListed,
      timeout: 10_000,
    })
  })
})
