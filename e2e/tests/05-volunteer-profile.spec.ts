import { test, expect, getAlert, dismissCookieConsentScript } from '../fixtures'
import { Page } from '@playwright/test'
import { fake } from '../fake'
import { selectFilterDropdown } from '../actions/ui'
import { adminAddGroup, navigateToAdminLocalGroups } from '../actions/local-groups'
import { createApiClient } from '../client'

async function getVolunteerId(page: Page, baseUrl: string): Promise<number> {
  const token = await page.evaluate(() => localStorage.getItem('authToken'))
  const api = createApiClient(baseUrl, token)
  const result = await api.auth.me()
  return (result.body as { id: number }).id
}

async function setCheckbox(page: Page, id: string, checked: boolean) {
  const isChecked = await page.locator(`#${id}`).isChecked()
  if (isChecked !== checked) {
    await page.locator(`label:has(#${id})`).click()
  }
}

test.describe('Volunteer Profile', () => {
  test('Profile update refuses more hours per week than signup allows', async ({
    volunteer,
    baseUrl,
  }) => {
    await volunteer.page.goto(`${baseUrl}/profile`)
    await volunteer.page.getByLabel('Hours per week').fill('100')
    await volunteer.page.getByRole('button', { name: 'Save changes' }).click()
    await expect(getAlert(volunteer.page)).toContainText(/40 hours/, { timeout: 10_000 })
  })

  test('Volunteer updates their profile', async ({ volunteer, baseUrl }) => {
    const uniqueName = fake.personName()

    await volunteer.page.goto(`${baseUrl}/profile`)
    await expect(volunteer.page.getByLabel('Your name')).toBeVisible({ timeout: 10_000 })

    await volunteer.page.getByLabel('Your name').fill(uniqueName)
    await volunteer.page.getByLabel('About you').fill('Bio text for e2e test')
    await volunteer.page.getByLabel('Hours per week').fill('10')
    await volunteer.page.getByRole('button', { name: 'Save changes' }).click()

    await expect(getAlert(volunteer.page)).toBeVisible({ timeout: 10_000 })
    await expect(getAlert(volunteer.page)).toContainText('Profile updated!')

    const volunteerId = await getVolunteerId(volunteer.page, baseUrl)
    await volunteer.page.goto(`${baseUrl}/volunteers/${volunteerId}`)
    await expect(volunteer.page.locator('#profileContent')).toBeVisible({ timeout: 10_000 })
    await expect(volunteer.page.locator('#volunteerName')).toContainText(uniqueName)
    await expect(volunteer.page.locator('#volunteerBio')).toContainText('Bio text for e2e test')
    await expect(volunteer.page.locator('#availabilityText')).toContainText('10 hours/week')
  })

  test('Volunteer adds skills to their profile', async ({ volunteer, baseUrl }) => {
    await volunteer.page.goto(`${baseUrl}/profile`)
    const skillOption = volunteer.page.locator('.skill-option').filter({ hasText: 'Fundraising' })
    await expect(skillOption).toBeVisible({ timeout: 10_000 })
    await skillOption.click()

    await volunteer.page.getByRole('button', { name: 'Save changes' }).click()
    await expect(getAlert(volunteer.page)).toBeVisible({ timeout: 10_000 })
    await expect(getAlert(volunteer.page)).toContainText('Profile updated!')

    const volunteerId = await getVolunteerId(volunteer.page, baseUrl)
    await volunteer.page.goto(`${baseUrl}/volunteers/${volunteerId}`)
    await expect(volunteer.page.locator('#profileContent')).toBeVisible({ timeout: 10_000 })
    await expect(volunteer.page.locator('#volunteerSkills')).toContainText('Fundraising')
  })

  test('Volunteer sets profile visibility to hidden', async ({ volunteer, baseUrl }) => {
    const uniqueName = fake.personName()

    // First make the volunteer visible so we can confirm the transition
    await volunteer.page.goto(`${baseUrl}/settings`)
    await expect(volunteer.page.getByLabel('Your name')).toBeVisible({ timeout: 10_000 })
    await volunteer.page.getByLabel('Your name').fill(uniqueName)
    await volunteer.page.getByRole('tab', { name: 'Privacy & data' }).click()
    await setCheckbox(volunteer.page, 'consent_make_profile_visible_in_directory', true)
    await volunteer.page.getByRole('button', { name: 'Save changes' }).click()
    await expect(getAlert(volunteer.page)).toBeVisible({ timeout: 10_000 })

    await volunteer.page.goto(`${baseUrl}/volunteers`)
    await expect(volunteer.page.locator('#volunteersList .loading')).not.toBeVisible({
      timeout: 10_000,
    })
    await volunteer.page.getByLabel('Search').fill(uniqueName)
    await expect(
      volunteer.page.locator('#volunteersList .card').filter({ hasText: uniqueName }),
    ).toBeVisible({ timeout: 10_000 })

    // Now hide the profile
    await volunteer.page.goto(`${baseUrl}/settings?tab=privacy`)
    await expect(volunteer.page.locator('#consent_make_profile_visible_in_directory')).toBeVisible({
      timeout: 10_000,
    })
    await setCheckbox(volunteer.page, 'consent_make_profile_visible_in_directory', false)
    await volunteer.page.getByRole('button', { name: 'Save changes' }).click()
    await expect(getAlert(volunteer.page)).toBeVisible({ timeout: 10_000 })

    await volunteer.page.goto(`${baseUrl}/volunteers`)
    await expect(volunteer.page.locator('#volunteersList .loading')).not.toBeVisible({
      timeout: 10_000,
    })
    await volunteer.page.getByLabel('Search').fill(uniqueName)
    await expect(
      volunteer.page.locator('#volunteersList .card').filter({ hasText: uniqueName }),
    ).not.toBeVisible({ timeout: 10_000 })
  })

  test('Volunteer sets profile visibility to visible', async ({ volunteer, baseUrl }) => {
    const uniqueName = fake.personName()

    // First hide the volunteer so we can confirm the transition
    await volunteer.page.goto(`${baseUrl}/settings`)
    await expect(volunteer.page.getByLabel('Your name')).toBeVisible({ timeout: 10_000 })
    await volunteer.page.getByLabel('Your name').fill(uniqueName)
    await volunteer.page.getByRole('tab', { name: 'Privacy & data' }).click()
    await setCheckbox(volunteer.page, 'consent_make_profile_visible_in_directory', false)
    await volunteer.page.getByRole('button', { name: 'Save changes' }).click()
    await expect(getAlert(volunteer.page)).toBeVisible({ timeout: 10_000 })

    await volunteer.page.goto(`${baseUrl}/volunteers`)
    await expect(volunteer.page.locator('#volunteersList .loading')).not.toBeVisible({
      timeout: 10_000,
    })
    await volunteer.page.getByLabel('Search').fill(uniqueName)
    await expect(
      volunteer.page.locator('#volunteersList .card').filter({ hasText: uniqueName }),
    ).not.toBeVisible({ timeout: 10_000 })

    // Now make the profile visible
    await volunteer.page.goto(`${baseUrl}/settings?tab=privacy`)
    await expect(volunteer.page.locator('#consent_make_profile_visible_in_directory')).toBeVisible({
      timeout: 10_000,
    })
    await setCheckbox(volunteer.page, 'consent_make_profile_visible_in_directory', true)
    await volunteer.page.getByRole('button', { name: 'Save changes' }).click()
    await expect(getAlert(volunteer.page)).toBeVisible({ timeout: 10_000 })

    await volunteer.page.goto(`${baseUrl}/volunteers`)
    await expect(volunteer.page.locator('#volunteersList .loading')).not.toBeVisible({
      timeout: 10_000,
    })
    await volunteer.page.getByLabel('Search').fill(uniqueName)
    await expect(
      volunteer.page.locator('#volunteersList .card').filter({ hasText: uniqueName }),
    ).toBeVisible({ timeout: 10_000 })
  })

  test('Volunteer updates email digest preference', async ({ volunteer, baseUrl }) => {
    await volunteer.page.goto(`${baseUrl}/settings`)
    await volunteer.page.getByRole('tab', { name: 'Notifications' }).click()
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
    await expect(getAlert(volunteer.page)).toContainText('Profile updated!')

    await volunteer.page.reload()
    await expect(volunteer.page.getByLabel('Keep me in the loop about new projects')).toBeVisible({
      timeout: 10_000,
    })
    await expect(volunteer.page.getByLabel('Keep me in the loop about new projects')).toContainText(
      'Send me a fortnightly digest',
    )
  })

  test("Volunteer views another volunteer's public profile", async ({
    browser,
    volunteer,
    baseUrl,
  }) => {
    const vol2 = fake.person()

    const signupResult = await createApiClient(baseUrl).auth.signup({
      body: {
        name: vol2.name,
        email: vol2.email,
        password: 'testpassword1',
        bio: 'e2e test bio, at least twenty characters long',
        country: 'UK',
        availabilityHoursPerWeek: 5,
        applicationMessage: 'e2e test application message',
        consentMakeProfileVisibleInDirectory: true,
        consentContactableByProjectOwners: true,
      },
    })
    if (signupResult.status !== 200)
      throw new Error(`Second volunteer signup failed: ${JSON.stringify(signupResult.body)}`)
    const { token: vol2Token } = signupResult.body

    const ctx2 = await browser.newContext()
    await ctx2.addInitScript((token: string) => {
      localStorage.setItem('authToken', token)
    }, vol2Token)
    await ctx2.addInitScript(dismissCookieConsentScript)
    const page2 = await ctx2.newPage()

    try {
      // Set up profile with a skill and consent_make_profile_visible_in_directory=true
      await page2.goto(`${baseUrl}/settings`)
      const skillOption = page2.locator('.skill-option').filter({ hasText: 'Fundraising' })
      await expect(skillOption).toBeVisible({ timeout: 10_000 })
      await skillOption.click()
      await page2.getByRole('tab', { name: 'Privacy & data' }).click()
      await setCheckbox(page2, 'consent_make_profile_visible_in_directory', true)
      await page2.getByRole('button', { name: 'Save changes' }).click()
      await expect(getAlert(page2)).toBeVisible({ timeout: 10_000 })

      const vol2Id = await getVolunteerId(page2, baseUrl)

      // View the second volunteer's profile as the first volunteer
      await volunteer.page.goto(`${baseUrl}/volunteers/${vol2Id}`)
      await expect(volunteer.page.locator('#profileContent')).toBeVisible({ timeout: 10_000 })

      await expect(volunteer.page.locator('#volunteerName')).toContainText(vol2.name)
      await expect(volunteer.page.locator('#volunteerSkills')).toContainText('Fundraising')
      // Endorsements section only appears if there are endorsements; not present for fresh volunteer
      await expect(volunteer.page.locator('#endorsementsSection')).not.toBeVisible()
      // Someone they don't work with can ask to connect, and never sees their login address.
      const contact = volunteer.page.locator('#contactInfo')
      await expect(contact.getByRole('button', { name: 'Request contact' })).toBeVisible()
      await expect(contact.getByRole('button', { name: 'Message' })).toHaveCount(0)
      await expect(contact).not.toContainText(vol2.email)
    } finally {
      await ctx2.close()
    }
  })

  test('Volunteer sets location: selects country with local groups, picks group, city stays hidden unless "None of these"', async ({
    volunteer,
    adminPage,
    baseUrl,
  }) => {
    const groupName = fake.localGroupName()

    // Create a UK local group via admin so the volunteer can select it
    await navigateToAdminLocalGroups(baseUrl, adminPage)
    await adminAddGroup(adminPage, 'United Kingdom', groupName)

    await volunteer.page.goto(`${baseUrl}/profile`)
    await expect(volunteer.page.getByLabel('Your name')).toBeVisible({ timeout: 10_000 })

    // Country is required at signup, so the volunteer's profile already has "United Kingdom"
    // set — the local group dropdown is visible immediately, city input stays hidden.
    await expect(volunteer.page.getByLabel('Select local group', { exact: true })).toBeVisible({
      timeout: 5_000,
    })
    await expect(volunteer.page.getByLabel('City / area')).not.toBeVisible()

    // Pick "None of these" — city input should appear
    await selectFilterDropdown(
      volunteer.page,
      'Select local group',
      "None of these, I'll enter my city",
    )
    await expect(volunteer.page.getByLabel('City / area')).toBeVisible({ timeout: 5_000 })

    // Switch to the real group — city input should disappear again
    await selectFilterDropdown(volunteer.page, 'Select local group', groupName)
    await expect(volunteer.page.getByLabel('City / area')).not.toBeVisible()

    // Save and verify
    await volunteer.page.getByRole('button', { name: 'Save changes' }).click()
    await expect(getAlert(volunteer.page)).toContainText('Profile updated!', { timeout: 10_000 })
  })

  test('Volunteer sets location: country with no local groups skips dropdown, city input appears directly', async ({
    volunteer,
    baseUrl,
  }) => {
    await volunteer.page.goto(`${baseUrl}/profile`)
    await expect(volunteer.page.getByLabel('Your name')).toBeVisible({ timeout: 10_000 })

    // Select Germany — no local groups exist for it, so dropdown should be skipped
    await selectFilterDropdown(volunteer.page, 'Select country', 'Germany')
    await expect(volunteer.page.getByLabel('Select local group', { exact: true })).not.toBeVisible()
    await expect(volunteer.page.getByLabel('City / area')).toBeVisible({ timeout: 5_000 })

    // Fill city and save
    await volunteer.page.getByLabel('City / area').fill('Berlin')
    await volunteer.page.getByRole('button', { name: 'Save changes' }).click()
    await expect(getAlert(volunteer.page)).toContainText('Profile updated!', { timeout: 10_000 })

    // Reload and verify city persisted
    await volunteer.page.goto(`${baseUrl}/profile`)
    await expect(volunteer.page.getByLabel('Your name')).toBeVisible({ timeout: 10_000 })
    await expect(volunteer.page.getByLabel('City / area')).toBeVisible({ timeout: 5_000 })
    await expect(volunteer.page.getByLabel('City / area')).toHaveValue('Berlin')
  })
})
