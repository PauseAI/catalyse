import { test, expect, getAlert } from '../fixtures'
import { goToInbox } from '../actions/dashboard'
import {
  submitLocalGroupSuggestion,
  submitLocalGroupSuggestionViaApi,
  navigateToAdminLocalGroups,
  adminReviewSuggestion,
  adminAddGroup,
  adminEditGroup,
  adminDeleteItem,
} from '../actions/local-groups'
import { selectFilterDropdown } from '../actions/ui'
import { openNewProjectForm } from '../actions/projects'
import { fake } from '../fake'

test.describe('Local Group Suggestions', () => {
  test('Volunteer submits a suggestion and sees it in their list', async ({
    volunteer,
    baseUrl,
  }) => {
    const groupName = fake.localGroupName()

    await submitLocalGroupSuggestion(baseUrl, volunteer.page, 'United Kingdom', groupName)

    const item = volunteer.page.getByRole('article').filter({ hasText: groupName })
    await expect(item).toBeVisible({ timeout: 10_000 })
    await expect(item).toContainText('United Kingdom')
    await expect(item).toContainText('Applied')
  })

  test('Submit button is disabled until name is filled (country prefills from profile)', async ({
    volunteer,
    baseUrl,
  }) => {
    await volunteer.page.goto(`${baseUrl}/suggest-local-group`)
    await volunteer.page
      .getByRole('heading', { name: 'Suggest a Local Group', level: 1 })
      .waitFor({ timeout: 10_000 })

    // Country is required at signup, so it's already prefilled from the volunteer's own
    // profile — only the group name is missing at this point.
    await expect(volunteer.page.getByLabel('Select country/group', { exact: true })).not.toHaveText(
      'Select…',
    )
    await expect(volunteer.page.getByRole('button', { name: 'Submit Suggestion' })).toBeDisabled()

    await volunteer.page.getByLabel('Local Group Name').fill('TestCity')
    await expect(volunteer.page.getByRole('button', { name: 'Submit Suggestion' })).toBeEnabled()
  })

  test('Admin sees pending suggestion', async ({ volunteer, adminPage, baseUrl }) => {
    const groupName = fake.localGroupName()

    await submitLocalGroupSuggestionViaApi(baseUrl, volunteer.page, 'United Kingdom', groupName)
    await navigateToAdminLocalGroups(baseUrl, adminPage)

    await expect(adminPage.getByRole('article').filter({ hasText: groupName })).toBeVisible({
      timeout: 10_000,
    })
  })

  test('Admin accepts a suggestion and it appears in the projects filter', async ({
    volunteer,
    adminPage,
    baseUrl,
  }) => {
    const groupName = fake.localGroupName()

    await submitLocalGroupSuggestionViaApi(baseUrl, volunteer.page, 'United Kingdom', groupName)
    await navigateToAdminLocalGroups(baseUrl, adminPage)
    await adminReviewSuggestion(adminPage, groupName, 'accept')

    await expect(getAlert(adminPage)).toContainText('accepted', { timeout: 10_000 })

    await volunteer.page.goto(`${baseUrl}/projects`)
    await volunteer.page.waitForLoadState('networkidle', { timeout: 15_000 })
    await selectFilterDropdown(
      volunteer.page,
      'Country/Group filter',
      `United Kingdom - ${groupName}`,
    )
    await expect(volunteer.page.getByLabel('Country/Group filter', { exact: true })).toContainText(
      `United Kingdom - ${groupName}`,
    )
  })

  test('Admin accepts a suggestion with adjusted name', async ({
    volunteer,
    adminPage,
    baseUrl,
  }) => {
    const original = fake.localGroupName()
    const adjusted = `${original} (Adjusted)`

    await submitLocalGroupSuggestionViaApi(baseUrl, volunteer.page, 'United Kingdom', original)
    await navigateToAdminLocalGroups(baseUrl, adminPage)
    await adminReviewSuggestion(adminPage, original, 'accept', { editName: adjusted })

    await expect(getAlert(adminPage)).toContainText('accepted', { timeout: 10_000 })

    await volunteer.page.goto(`${baseUrl}/projects`)
    await volunteer.page.waitForLoadState('networkidle', { timeout: 15_000 })
    await selectFilterDropdown(
      volunteer.page,
      'Country/Group filter',
      `United Kingdom - ${adjusted}`,
    )
    await expect(volunteer.page.getByLabel('Country/Group filter', { exact: true })).toContainText(
      `United Kingdom - ${adjusted}`,
    )
  })

  test('Accepted group appears in the propose-project country/local-group form', async ({
    volunteer,
    adminPage,
    baseUrl,
  }) => {
    const groupName = fake.localGroupName()

    await submitLocalGroupSuggestionViaApi(baseUrl, volunteer.page, 'United Kingdom', groupName)
    await navigateToAdminLocalGroups(baseUrl, adminPage)
    await adminReviewSuggestion(adminPage, groupName, 'accept')
    await expect(getAlert(adminPage)).toContainText('accepted', { timeout: 10_000 })

    await volunteer.page.goto(`${baseUrl}/suggest`)
    await openNewProjectForm(volunteer.page)
    await volunteer.page.waitForLoadState('networkidle', { timeout: 15_000 })

    await selectFilterDropdown(
      volunteer.page,
      'Select country/group',
      `United Kingdom - ${groupName}`,
    )
    await expect(volunteer.page.getByLabel('Select country/group', { exact: true })).toContainText(
      groupName,
    )
  })

  test('Admin merges a suggestion into an existing group', async ({
    volunteer,
    adminPage,
    baseUrl,
  }) => {
    const groupName = fake.localGroupName()

    await submitLocalGroupSuggestionViaApi(baseUrl, volunteer.page, 'United Kingdom', groupName)
    await navigateToAdminLocalGroups(baseUrl, adminPage)
    await adminReviewSuggestion(adminPage, groupName, 'merge', {
      mergeTarget: 'United Kingdom, London',
    })

    await expect(getAlert(adminPage)).toContainText('merged', { timeout: 10_000 })

    // Suggestion is removed from the pending list after merge
    await expect(adminPage.getByRole('article').filter({ hasText: groupName })).toBeHidden({
      timeout: 10_000,
    })
  })

  test('Admin puts a suggestion on hold', async ({ volunteer, adminPage, baseUrl }) => {
    const groupName = fake.localGroupName()
    const note = 'Reviewing similar groups in this area first'

    await submitLocalGroupSuggestionViaApi(baseUrl, volunteer.page, 'United Kingdom', groupName)
    await navigateToAdminLocalGroups(baseUrl, adminPage)
    await adminReviewSuggestion(adminPage, groupName, 'on_hold', { adminNotes: note })

    await expect(getAlert(adminPage)).toContainText('on hold', { timeout: 10_000 })

    await selectFilterDropdown(adminPage, 'Status filter', 'On Hold')
    await adminPage.getByText('Loading…').waitFor({ state: 'hidden', timeout: 10_000 })
    await expect(adminPage.getByRole('article').filter({ hasText: groupName })).toBeVisible({
      timeout: 10_000,
    })
  })

  test('Admin declines a suggestion', async ({ volunteer, adminPage, baseUrl }) => {
    const groupName = fake.localGroupName()
    const note = 'This area is covered by an existing group'

    await submitLocalGroupSuggestionViaApi(baseUrl, volunteer.page, 'United Kingdom', groupName)
    await navigateToAdminLocalGroups(baseUrl, adminPage)
    await adminReviewSuggestion(adminPage, groupName, 'decline', { adminNotes: note })

    await expect(getAlert(adminPage)).toContainText('declined', { timeout: 10_000 })

    await selectFilterDropdown(adminPage, 'Status filter', 'Declined')
    await adminPage.getByText('Loading…').waitFor({ state: 'hidden', timeout: 10_000 })
    const card = adminPage.getByRole('article').filter({ hasText: groupName })
    await expect(card).toBeVisible({ timeout: 10_000 })
    await expect(card).toContainText(note)
  })

  test('Admin re-reviews a declined suggestion and accepts it', async ({
    volunteer,
    adminPage,
    baseUrl,
  }) => {
    const groupName = fake.localGroupName()

    await submitLocalGroupSuggestionViaApi(baseUrl, volunteer.page, 'United Kingdom', groupName)
    await navigateToAdminLocalGroups(baseUrl, adminPage)
    await adminReviewSuggestion(adminPage, groupName, 'decline')
    await expect(getAlert(adminPage)).toContainText('declined', { timeout: 10_000 })

    await selectFilterDropdown(adminPage, 'Status filter', 'Declined')
    await adminPage.getByText('Loading…').waitFor({ state: 'hidden', timeout: 10_000 })

    const card = adminPage.getByRole('article').filter({ hasText: groupName })
    await expect(card.getByRole('button', { name: 'Re-review' })).toBeVisible({ timeout: 10_000 })

    await adminReviewSuggestion(adminPage, groupName, 'accept')
    await expect(getAlert(adminPage)).toContainText('accepted', { timeout: 10_000 })
  })

  test('Volunteer sees updated status after admin review', async ({
    volunteer,
    adminPage,
    baseUrl,
  }) => {
    const groupName = fake.localGroupName()

    await submitLocalGroupSuggestionViaApi(baseUrl, volunteer.page, 'United Kingdom', groupName)
    await navigateToAdminLocalGroups(baseUrl, adminPage)
    await adminReviewSuggestion(adminPage, groupName, 'decline')

    await volunteer.page.goto(`${baseUrl}/suggest-local-group`)
    await volunteer.page
      .getByRole('heading', { name: 'Suggest a Local Group', level: 1 })
      .waitFor({ timeout: 10_000 })

    await expect(volunteer.page.getByRole('article').filter({ hasText: groupName })).toContainText(
      'Declined',
      { timeout: 10_000 },
    )
  })

  test('Accepted-suggestion notification links to the new local group’s own page', async ({
    volunteer,
    adminPage,
    baseUrl,
  }) => {
    const groupName = fake.localGroupName()

    await submitLocalGroupSuggestionViaApi(baseUrl, volunteer.page, 'United Kingdom', groupName)
    await navigateToAdminLocalGroups(baseUrl, adminPage)
    await adminReviewSuggestion(adminPage, groupName, 'accept')
    await expect(getAlert(adminPage)).toContainText('accepted', { timeout: 10_000 })

    await goToInbox(baseUrl, volunteer.page)
    await expect(
      volunteer.page
        .locator('strong')
        .filter({ hasText: `Approved: your local group suggestion "${groupName}"` }),
    ).toBeVisible({ timeout: 10_000 })
    await volunteer.page
      .getByRole('listitem')
      .filter({ hasText: `Approved: your local group suggestion "${groupName}"` })
      .getByRole('link', { name: 'Open' })
      .click()

    await expect(volunteer.page).toHaveURL(/\/local-groups\/\d+$/)
    await expect(volunteer.page.getByRole('heading', { name: groupName, level: 1 })).toBeVisible({
      timeout: 10_000,
    })
    await expect(
      volunteer.page.getByRole('button', { name: 'Set as my local group' }),
    ).toBeVisible()
  })
})

test.describe('Admin Local Group Management', () => {
  test('Admin creates a group directly and it appears as Active', async ({
    adminPage,
    baseUrl,
  }) => {
    const groupName = fake.localGroupName()

    await navigateToAdminLocalGroups(baseUrl, adminPage)
    await adminAddGroup(adminPage, 'United Kingdom', groupName)

    await expect(getAlert(adminPage)).toContainText('added', { timeout: 10_000 })

    await selectFilterDropdown(adminPage, 'Status filter', 'Active')
    await adminPage.getByText('Loading…').waitFor({ state: 'hidden', timeout: 10_000 })
    const card = adminPage.getByRole('article').filter({ hasText: groupName })
    await expect(card).toBeVisible({ timeout: 10_000 })
    await expect(card).toContainText('Active')
    await expect(card).toContainText('United Kingdom')
  })

  test('Admin edits a group name', async ({ adminPage, baseUrl }) => {
    const groupName = fake.localGroupName()
    const updatedName = `${groupName} Updated`

    await navigateToAdminLocalGroups(baseUrl, adminPage)
    await adminAddGroup(adminPage, 'United Kingdom', groupName)
    await expect(getAlert(adminPage)).toContainText('added', { timeout: 10_000 })

    await selectFilterDropdown(adminPage, 'Status filter', 'Active')
    await adminPage.getByText('Loading…').waitFor({ state: 'hidden', timeout: 10_000 })

    await adminEditGroup(adminPage, groupName, { newName: updatedName })
    await expect(getAlert(adminPage)).toContainText('updated', { timeout: 10_000 })

    await expect(adminPage.getByRole('article').filter({ hasText: updatedName })).toBeVisible({
      timeout: 10_000,
    })
  })

  test('Admin deletes a group and it is removed from the list', async ({ adminPage, baseUrl }) => {
    const groupName = fake.localGroupName()

    await navigateToAdminLocalGroups(baseUrl, adminPage)
    await adminAddGroup(adminPage, 'United Kingdom', groupName)
    await expect(getAlert(adminPage)).toContainText('added', { timeout: 10_000 })

    await selectFilterDropdown(adminPage, 'Status filter', 'Active')
    await adminPage.getByText('Loading…').waitFor({ state: 'hidden', timeout: 10_000 })

    await adminDeleteItem(adminPage, groupName)
    await expect(getAlert(adminPage)).toContainText('Deleted', { timeout: 10_000 })

    await expect(adminPage.getByRole('article').filter({ hasText: groupName })).toBeHidden()
  })

  test('Directly-created group appears in the propose-project location dropdown', async ({
    volunteer,
    adminPage,
    baseUrl,
  }) => {
    const groupName = fake.localGroupName()

    await navigateToAdminLocalGroups(baseUrl, adminPage)
    await adminAddGroup(adminPage, 'United Kingdom', groupName)
    await expect(getAlert(adminPage)).toContainText('added', { timeout: 10_000 })

    await volunteer.page.goto(`${baseUrl}/suggest`)
    await openNewProjectForm(volunteer.page)
    await volunteer.page.waitForLoadState('networkidle', { timeout: 15_000 })

    await selectFilterDropdown(
      volunteer.page,
      'Select country/group',
      `United Kingdom - ${groupName}`,
    )
    await expect(volunteer.page.getByLabel('Select country/group', { exact: true })).toContainText(
      groupName,
    )
  })
})
