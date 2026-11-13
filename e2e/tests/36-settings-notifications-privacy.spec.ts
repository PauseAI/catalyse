import { test, expect, getAlert, readAdminToken } from '../fixtures'
import { selectFilterDropdown } from '../actions/ui'
import { adminCreateProjectViaApi } from '../actions/projects'
import { createApiClient } from '../client'
import { fake } from '../fake'

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

  test('a preset fills in the choices, and editing one shows Custom', async ({
    volunteer,
    baseUrl,
    snap,
  }) => {
    const page = volunteer.page
    await page.goto(`${baseUrl}/settings?tab=notifications`)
    const presets = page.getByRole('radiogroup', { name: 'Preset' })
    const preset = (name: RegExp) => presets.getByRole('radio', { name })
    await expect(preset(/^Custom/)).toBeVisible({ timeout: 10_000 })
    await presets.locator('label', { hasText: /^Recommended/ }).click()
    const approved = page.getByRole('radiogroup', { name: 'Your project proposal is approved' })
    await expect(approved.getByRole('radio', { name: 'Digest' })).toBeChecked()
    await expect(
      page
        .getByRole('radiogroup', { name: 'A volunteer sends you a message' })
        .getByRole('radio', { name: 'Email' }),
    ).toBeChecked()
    await snap(page, 'recommended preset')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(getAlert(page)).toBeVisible({ timeout: 10_000 })

    await page.reload()
    await expect(preset(/^Recommended/)).toBeChecked({ timeout: 10_000 })
    await approved.getByText('Email', { exact: true }).click()
    await expect(preset(/^Custom/)).toBeChecked()
  })

  test('role sections open for roles held, and stay closed and muted otherwise', async ({
    volunteer,
    baseUrl,
    snap,
  }) => {
    const page = volunteer.page
    await page.goto(`${baseUrl}/settings?tab=notifications`)
    const lead = page.getByRole('button', { name: /If you lead a project/ })
    await expect(lead).toHaveAttribute('aria-expanded', 'false', { timeout: 10_000 })
    await expect(page.getByText(/You don't have this role right now/).first()).toBeVisible()
    await expect(
      page.getByRole('radiogroup', { name: 'Someone offers to help on a project you run' }),
    ).toBeHidden()
    // Closed is still settable ahead of time.
    await lead.click()
    await expect(lead).toHaveAttribute('aria-expanded', 'true')
    await snap(page, 'no roles')

    // Leading a project opens its section.
    const token = await page.evaluate(() => localStorage.getItem('authToken'))
    const me = (await createApiClient(baseUrl, token).auth.me()).body as { id: number }
    const projectId = await adminCreateProjectViaApi(baseUrl, fake.projectTitle(), 'A project')
    await createApiClient(baseUrl, readAdminToken(baseUrl)).projects.assign({
      body: { projectId, volunteerId: me.id, interestType: 'want_to_own' },
    })
    await page.reload()
    await expect(page.getByRole('button', { name: /If you lead a project/ })).toHaveAttribute(
      'aria-expanded',
      'true',
      { timeout: 10_000 },
    )
    await expect(
      page.getByRole('radiogroup', { name: 'Someone offers to help on a project you run' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: /If you lead a team/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await snap(page, 'project lead')
  })

  test('the digest comes as often, when and where the volunteer chooses', async ({
    volunteer,
    baseUrl,
  }) => {
    const page = volunteer.page
    await page.goto(`${baseUrl}/settings?tab=notifications`)
    await expect(page.getByText(/^Next digest: /)).toBeVisible({ timeout: 10_000 })
    await page
      .getByRole('radiogroup', { name: 'Digest frequency' })
      .getByText('Every 3 days')
      .click()
    await selectFilterDropdown(page, 'Digest time', '18:00')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(getAlert(page)).toBeVisible({ timeout: 10_000 })
    await page.reload()
    await expect(
      page.getByRole('radiogroup', { name: 'Digest frequency' }).getByRole('radio', {
        name: 'Every 3 days',
      }),
    ).toBeChecked({ timeout: 10_000 })
    await expect(page.getByText(/^Next digest: .* 18:00 /)).toBeVisible()
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
