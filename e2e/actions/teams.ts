import { type Page, expect } from '@playwright/test'
import { getAlert } from '../fixtures'
import { selectFilterDropdown } from './ui'

export async function suggestTeam(
  baseUrl: string,
  page: Page,
  name: string,
  description?: string,
): Promise<void> {
  await page.goto(`${baseUrl}/suggest-team`)
  await page.getByRole('heading', { name: 'Suggest a team', level: 1 }).waitFor({ timeout: 10_000 })
  await page.getByLabel('Team name').fill(name)
  if (description) await page.getByLabel(/^Description/).fill(description)
  await page.getByRole('button', { name: 'Submit suggestion' }).click()
  await page.getByText('Suggestion submitted!').waitFor({ timeout: 10_000 })
}

export async function navigateToAdminTeams(baseUrl: string, adminPage: Page): Promise<void> {
  await adminPage.goto(`${baseUrl}/admin/teams`)
  await adminPage.getByRole('heading', { name: 'Teams', level: 1 }).waitFor({ timeout: 10_000 })
  await adminPage.getByText('Loading…').waitFor({ state: 'hidden', timeout: 10_000 })
}

export async function navigateToAdminTeamDetail(
  baseUrl: string,
  adminPage: Page,
  teamId: number,
): Promise<void> {
  await adminPage.goto(`${baseUrl}/admin/teams/${teamId}`)
  await adminPage.getByRole('heading', { name: 'Team Details', level: 2 }).waitFor({
    timeout: 10_000,
  })
}

export async function adminReviewTeamSuggestion(
  adminPage: Page,
  teamName: string,
  action: 'accept' | 'merge' | 'on_hold' | 'decline',
  opts: {
    editName?: string
    leaderName?: string
    mergeTarget?: string
    adminNotes?: string
  } = {},
): Promise<void> {
  const card = adminPage.getByRole('article').filter({ hasText: teamName })
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
      await adminPage.getByLabel('Team name').fill(opts.editName)
    }
    if (opts.leaderName !== undefined) {
      await selectFilterDropdown(adminPage, 'Select team leader', opts.leaderName)
    }
  }

  if (action === 'merge' && opts.mergeTarget) {
    await selectFilterDropdown(adminPage, 'Select existing team to merge into', opts.mergeTarget)
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

export async function applyToJoinTeam(
  baseUrl: string,
  page: Page,
  teamName: string,
): Promise<void> {
  await page.goto(`${baseUrl}/teams`)
  await page.getByRole('heading', { name: 'Teams', level: 1 }).waitFor({ timeout: 10_000 })
  const card = page.getByRole('article').filter({ hasText: teamName })
  await card.getByRole('button', { name: 'Apply to join' }).click()
  await expect(getAlert(page)).toBeVisible({ timeout: 10_000 })
}

export async function leaveTeam(baseUrl: string, page: Page, teamName: string): Promise<void> {
  await page.goto(`${baseUrl}/teams`)
  await page.getByRole('heading', { name: 'Teams', level: 1 }).waitFor({ timeout: 10_000 })
  const card = page.getByRole('article').filter({ hasText: teamName })
  await card.getByRole('link', { name: 'View team' }).click()
  await page.getByRole('button', { name: 'Leave' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Leave' }).click()
  await expect(getAlert(page)).toBeVisible({ timeout: 10_000 })
}

export async function adminAssignMemberDirectly(
  adminPage: Page,
  volunteerName: string,
): Promise<void> {
  await selectFilterDropdown(adminPage, 'Select volunteer to add', volunteerName)
  await adminPage.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(getAlert(adminPage)).toBeVisible({ timeout: 10_000 })
}

function memberRow(adminPage: Page, volunteerName: string) {
  return adminPage
    .locator('div.flex.items-center.justify-between.gap-3')
    .filter({ hasText: volunteerName })
}

export async function adminToggleMemberLeader(
  adminPage: Page,
  volunteerName: string,
): Promise<void> {
  const row = memberRow(adminPage, volunteerName)
  await row.getByRole('button', { name: /Make leader|Demote/ }).click()
  await expect(getAlert(adminPage)).toBeVisible({ timeout: 10_000 })
}

export async function adminRemoveMember(adminPage: Page, volunteerName: string): Promise<void> {
  const row = memberRow(adminPage, volunteerName)
  await row.getByRole('button', { name: 'Remove' }).click()
  await expect(getAlert(adminPage)).toBeVisible({ timeout: 10_000 })
}

export async function adminReviewJoinRequest(
  adminPage: Page,
  volunteerName: string,
  action: 'accept' | 'decline',
): Promise<void> {
  const row = memberRow(adminPage, volunteerName)
  await row.getByRole('button', { name: action === 'accept' ? 'Accept' : 'Decline' }).click()
  await expect(getAlert(adminPage)).toBeVisible({ timeout: 10_000 })
}
