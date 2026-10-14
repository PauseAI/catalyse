import { type Page } from '@playwright/test'
import { selectFilterDropdown } from './ui'
import { createApiClient } from '../client'
import { BASE_LOCATION_OPTIONS } from '../../lib/filter-options'

export async function submitLocalGroupSuggestion(
  baseUrl: string,
  page: Page,
  country: string,
  name: string,
): Promise<void> {
  await page.goto(`${baseUrl}/suggest-local-group`)
  await page.getByRole('heading', { name: 'Suggest a local group', level: 1 }).waitFor({
    timeout: 10_000,
  })
  await selectFilterDropdown(page, 'Select country/group', country)
  await page.getByLabel('Local group name').fill(name)
  await page.getByRole('button', { name: 'Submit suggestion' }).click()
  await page.getByText('Suggestion submitted!').waitFor({ timeout: 10_000 })
}

// API-equivalent of submitLocalGroupSuggestion, for tests that need "a pending suggestion
// exists" purely as setup for testing the admin review flow — the submission form itself is
// already proven end-to-end by the first two tests in 19-local-group-suggestions.spec.ts.
// `country` takes the same display label the UI dropdown shows (e.g. "United Kingdom") —
// it's translated to the underlying option value (e.g. "UK") the API actually expects.
export async function submitLocalGroupSuggestionViaApi(
  baseUrl: string,
  volunteerPage: Page,
  country: string,
  name: string,
): Promise<void> {
  const countryValue = BASE_LOCATION_OPTIONS.find((o) => o.label === country)?.value ?? country

  // localStorage is only readable once the page has loaded a real origin — a fresh
  // volunteer.page fixture starts at about:blank, where evaluate throws a SecurityError.
  if (volunteerPage.url() === 'about:blank') await volunteerPage.goto(baseUrl)
  const token = await volunteerPage.evaluate(() => localStorage.getItem('authToken'))
  const api = createApiClient(baseUrl, token)
  const result = await api.localGroupSuggestions.create({
    body: { country: countryValue, name },
  })
  if (result.status !== 200)
    throw new Error(`Local group suggestion creation failed: ${JSON.stringify(result.body)}`)
}

export async function navigateToAdminLocalGroups(baseUrl: string, adminPage: Page): Promise<void> {
  await adminPage.goto(`${baseUrl}/admin/local-groups`)
  await adminPage
    .getByRole('heading', { name: 'Local Groups', level: 1 })
    .waitFor({ timeout: 10_000 })
  await adminPage.getByText('Loading…').waitFor({ state: 'hidden', timeout: 10_000 })
}

export async function adminAddGroup(adminPage: Page, country: string, name: string): Promise<void> {
  await adminPage.getByRole('button', { name: 'Add local group' }).click()
  await adminPage
    .getByRole('heading', { name: 'Add local group', level: 2 })
    .waitFor({ timeout: 10_000 })
  await selectFilterDropdown(adminPage, 'Select country/group', country)
  await adminPage.getByLabel('Group name').fill(name)
  await adminPage.getByRole('button', { name: 'Add group' }).click()
  await adminPage
    .getByRole('heading', { name: 'Add local group', level: 2 })
    .waitFor({ state: 'hidden', timeout: 10_000 })
}

export async function adminEditGroup(
  adminPage: Page,
  groupName: string,
  opts: { newName?: string; newCountry?: string } = {},
): Promise<void> {
  const card = adminPage.getByRole('article').filter({ hasText: groupName })
  await card.getByRole('button', { name: 'Edit', exact: true }).click()
  await adminPage
    .getByRole('heading', { name: 'Edit Local Group', level: 2 })
    .waitFor({ timeout: 10_000 })
  if (opts.newCountry !== undefined) {
    await selectFilterDropdown(adminPage, 'Select country/group', opts.newCountry)
  }
  if (opts.newName !== undefined) {
    await adminPage.getByLabel('Group name').fill(opts.newName)
  }
  await adminPage.getByRole('button', { name: 'Save changes' }).click()
  await adminPage
    .getByRole('heading', { name: 'Edit Local Group', level: 2 })
    .waitFor({ state: 'hidden', timeout: 10_000 })
}

export async function adminDeleteItem(adminPage: Page, itemName: string): Promise<void> {
  const card = adminPage.getByRole('article').filter({ hasText: itemName })
  await card.getByRole('button', { name: 'Delete' }).click()
  await adminPage
    .getByRole('heading', { name: 'Confirm Delete', level: 2 })
    .waitFor({ timeout: 10_000 })
  // Modal Delete button is last in DOM (rendered after all article buttons)
  await adminPage.getByRole('button', { name: 'Delete' }).last().click()
  await adminPage
    .getByRole('heading', { name: 'Confirm Delete', level: 2 })
    .waitFor({ state: 'hidden', timeout: 10_000 })
}

export async function adminReviewSuggestion(
  adminPage: Page,
  groupName: string,
  action: 'accept' | 'merge' | 'on_hold' | 'decline',
  opts: {
    editName?: string
    editCountry?: string
    mergeTarget?: string
    adminNotes?: string
  } = {},
): Promise<void> {
  const card = adminPage.getByRole('article').filter({ hasText: groupName })
  await card.getByRole('button', { name: /Review/i }).click()

  await adminPage.getByRole('heading', { name: 'Review Suggestion', level: 2 }).waitFor({
    timeout: 10_000,
  })

  const actionLabel = { accept: 'Accept', merge: 'Merge', on_hold: 'On hold', decline: 'Decline' }[
    action
  ]
  await adminPage.getByRole('radio', { name: new RegExp(actionLabel) }).click({ force: true })

  if (action === 'accept') {
    if (opts.editName !== undefined) {
      await adminPage.getByLabel('Group name').fill(opts.editName)
    }
    if (opts.editCountry !== undefined) {
      await adminPage.getByLabel('Country').fill(opts.editCountry)
    }
  }

  if (action === 'merge' && opts.mergeTarget) {
    await selectFilterDropdown(adminPage, 'Select existing group to merge into', opts.mergeTarget)
  }

  if ((action === 'on_hold' || action === 'decline') && opts.adminNotes) {
    await adminPage.getByLabel('Note for volunteer').fill(opts.adminNotes)
  }

  await adminPage.getByRole('button', { name: 'Confirm' }).click()
  await adminPage.getByRole('heading', { name: 'Review Suggestion', level: 2 }).waitFor({
    state: 'hidden',
    timeout: 10_000,
  })
}
