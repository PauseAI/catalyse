import { test, expect, readAdminToken, createApprovedVolunteer } from '../fixtures'
import { fake } from '../fake'
import { createApiClient } from '../client'
import {
  suggestTeam,
  navigateToAdminTeams,
  navigateToAdminTeamDetail,
  adminReviewTeamSuggestion,
  applyToJoinTeam,
  leaveTeam,
  adminAssignMemberDirectly,
  adminToggleMemberLeader,
  adminRemoveMember,
  adminReviewJoinRequest,
} from '../actions/teams'

interface TeamMemberBody {
  id: number
  name: string
  role: 'member' | 'leader'
}
interface TeamBody {
  id: number
  name: string
  members: TeamMemberBody[]
}

function adminApi(baseUrl: string) {
  return createApiClient(baseUrl, readAdminToken(baseUrl))
}

async function getTeamByName(baseUrl: string, name: string): Promise<TeamBody> {
  const result = await adminApi(baseUrl).admin.teams.list()
  if (result.status !== 200) throw new Error(`Failed to list teams: ${JSON.stringify(result.body)}`)
  const team = (result.body as { teams: TeamBody[] }).teams.find((t) => t.name === name)
  if (!team) throw new Error(`Team not found: ${name}`)
  return team
}

async function createTeamViaApi(baseUrl: string, name: string): Promise<TeamBody> {
  const created = await adminApi(baseUrl).admin.teams.create({
    body: { name, description: null, lumaUrl: null, docUrl: null },
  })
  if (created.status !== 200)
    throw new Error(`Team creation failed: ${JSON.stringify(created.body)}`)
  return getTeamByName(baseUrl, name)
}

async function volunteerToken(
  baseUrl: string,
  page: import('@playwright/test').Page,
): Promise<string> {
  // Reading localStorage throws on about:blank (no navigation yet) — make sure the page
  // has actually loaded the app's origin first.
  if (!page.url().startsWith(baseUrl)) {
    await page.goto(baseUrl)
  }
  const token = await page.evaluate(() => localStorage.getItem('authToken'))
  if (!token) throw new Error('Volunteer has no auth token in localStorage')
  return token
}

async function getMyId(baseUrl: string, token: string): Promise<number> {
  const result = await createApiClient(baseUrl, token).auth.me()
  if (result.status !== 200) throw new Error(`auth.me failed: ${JSON.stringify(result.body)}`)
  return (result.body as { id: number }).id
}

test.describe('Teams', () => {
  test('Volunteer suggests a team and sees it pending', async ({ volunteer, baseUrl }) => {
    const teamName = fake.teamName()
    await suggestTeam(baseUrl, volunteer.page, teamName, 'We do the things')

    const item = volunteer.page.getByRole('article').filter({ hasText: teamName })
    await expect(item).toBeVisible({ timeout: 10_000 })
    await expect(item).toContainText('Applied')
  })

  test('Admin accepts a suggestion; suggester becomes leader by default', async ({
    volunteer,
    adminPage,
    baseUrl,
  }) => {
    const teamName = fake.teamName()
    await suggestTeam(baseUrl, volunteer.page, teamName)

    const token = await volunteerToken(baseUrl, volunteer.page)
    const suggesterId = await getMyId(baseUrl, token)

    await navigateToAdminTeams(baseUrl, adminPage)
    await adminReviewTeamSuggestion(adminPage, teamName, 'accept')

    const team = await getTeamByName(baseUrl, teamName)
    expect(team.members).toHaveLength(1)
    expect(team.members[0]).toMatchObject({ id: suggesterId, role: 'leader' })
  })

  test('Admin accepts a suggestion but assigns a different volunteer as leader', async ({
    volunteer,
    adminPage,
    baseUrl,
  }) => {
    const teamName = fake.teamName()
    await suggestTeam(baseUrl, volunteer.page, teamName)
    const chosenLeader = await createApprovedVolunteer(baseUrl)

    await navigateToAdminTeams(baseUrl, adminPage)
    await adminReviewTeamSuggestion(adminPage, teamName, 'accept', {
      leaderName: chosenLeader.name,
    })

    const team = await getTeamByName(baseUrl, teamName)
    expect(team.members).toHaveLength(1)
    expect(team.members[0]).toMatchObject({ id: chosenLeader.id, role: 'leader' })
  })

  test('Admin merges a team suggestion into an existing team', async ({
    volunteer,
    adminPage,
    baseUrl,
  }) => {
    const existingTeamName = fake.teamName()
    await createTeamViaApi(baseUrl, existingTeamName)

    const suggestedName = fake.teamName()
    await suggestTeam(baseUrl, volunteer.page, suggestedName)
    const token = await volunteerToken(baseUrl, volunteer.page)
    const suggesterId = await getMyId(baseUrl, token)

    await navigateToAdminTeams(baseUrl, adminPage)
    await adminReviewTeamSuggestion(adminPage, suggestedName, 'merge', {
      mergeTarget: existingTeamName,
    })

    // Merging doesn't create a second team under the suggested name, and the suggester
    // ends up a (regular, non-leader) member of the team they were merged into.
    await expect(async () => {
      const result = await adminApi(baseUrl).admin.teams.list()
      const teams = (result.body as { teams: TeamBody[] }).teams
      const names = teams.map((t) => t.name)
      expect(names).not.toContain(suggestedName)
      const existing = teams.find((t) => t.name === existingTeamName)
      expect(existing?.members.find((m) => m.id === suggesterId)?.role).toBe('member')
    }).toPass({ timeout: 10_000 })
  })

  test('Admin declines a team suggestion', async ({ volunteer, adminPage, baseUrl }) => {
    const teamName = fake.teamName()
    await suggestTeam(baseUrl, volunteer.page, teamName)

    await navigateToAdminTeams(baseUrl, adminPage)
    await adminReviewTeamSuggestion(adminPage, teamName, 'decline', {
      adminNotes: 'Not right now',
    })

    const item = volunteer.page.getByRole('article').filter({ hasText: teamName })
    await volunteer.page.goto(`${baseUrl}/suggest-team`)
    await expect(item).toContainText('Declined', { timeout: 10_000 })
  })

  test('Volunteer applies to join a team; admin accepts and they become a member', async ({
    volunteer,
    adminPage,
    baseUrl,
  }) => {
    const teamName = fake.teamName()
    const team = await createTeamViaApi(baseUrl, teamName)

    await applyToJoinTeam(baseUrl, volunteer.page, teamName)
    const pendingCard = volunteer.page.getByRole('article').filter({ hasText: teamName })
    await expect(pendingCard.getByRole('button', { name: 'Application Pending' })).toBeVisible({
      timeout: 10_000,
    })

    await navigateToAdminTeamDetail(baseUrl, adminPage, team.id)
    await adminReviewJoinRequest(adminPage, volunteer.name, 'accept')

    await volunteer.page.goto(`${baseUrl}/teams`)
    const memberCard = volunteer.page.getByRole('article').filter({ hasText: teamName })
    await expect(memberCard.getByRole('link', { name: 'View team' })).toBeVisible({
      timeout: 10_000,
    })
  })

  test('Volunteer applies to join a team; admin declines and they can re-apply', async ({
    volunteer,
    adminPage,
    baseUrl,
  }) => {
    const teamName = fake.teamName()
    const team = await createTeamViaApi(baseUrl, teamName)

    await applyToJoinTeam(baseUrl, volunteer.page, teamName)

    await navigateToAdminTeamDetail(baseUrl, adminPage, team.id)
    await adminReviewJoinRequest(adminPage, volunteer.name, 'decline')

    await volunteer.page.goto(`${baseUrl}/teams`)
    const card = volunteer.page.getByRole('article').filter({ hasText: teamName })
    await expect(card.getByRole('button', { name: 'Apply to Join' })).toBeVisible({
      timeout: 10_000,
    })
  })

  test('Volunteer leaves a team', async ({ volunteer, baseUrl }) => {
    const teamName = fake.teamName()
    const team = await createTeamViaApi(baseUrl, teamName)

    const token = await volunteerToken(baseUrl, volunteer.page)
    const myId = await getMyId(baseUrl, token)
    const assignResult = await adminApi(baseUrl).teams.assignMember({
      body: { teamId: team.id, volunteerId: myId },
    })
    if (assignResult.status !== 200)
      throw new Error(`assignMember failed: ${JSON.stringify(assignResult.body)}`)

    await leaveTeam(baseUrl, volunteer.page, teamName)

    await volunteer.page.goto(`${baseUrl}/teams`)
    const card = volunteer.page.getByRole('article').filter({ hasText: teamName })
    await expect(card.getByRole('button', { name: 'Apply to Join' })).toBeVisible({
      timeout: 10_000,
    })
  })

  test('Admin assigns a volunteer directly to a team, bypassing the application flow', async ({
    adminPage,
    baseUrl,
  }) => {
    const teamName = fake.teamName()
    const team = await createTeamViaApi(baseUrl, teamName)
    const recruit = await createApprovedVolunteer(baseUrl)

    await navigateToAdminTeamDetail(baseUrl, adminPage, team.id)
    await adminAssignMemberDirectly(adminPage, recruit.name)

    await expect(adminPage.getByText(recruit.name)).toBeVisible({ timeout: 10_000 })
    const updated = await getTeamByName(baseUrl, teamName)
    expect(updated.members.map((m) => m.id)).toContain(recruit.id)
  })

  test('Admin promotes a member to leader and can demote them back', async ({
    adminPage,
    baseUrl,
  }) => {
    const teamName = fake.teamName()
    const team = await createTeamViaApi(baseUrl, teamName)
    const member = await createApprovedVolunteer(baseUrl)
    await adminApi(baseUrl).teams.assignMember({
      body: { teamId: team.id, volunteerId: member.id },
    })

    await navigateToAdminTeamDetail(baseUrl, adminPage, team.id)
    await adminToggleMemberLeader(adminPage, member.name)

    await expect(async () => {
      const updated = await getTeamByName(baseUrl, teamName)
      expect(updated.members.find((m) => m.id === member.id)?.role).toBe('leader')
    }).toPass({ timeout: 10_000 })

    await adminToggleMemberLeader(adminPage, member.name)
    await expect(async () => {
      const updated = await getTeamByName(baseUrl, teamName)
      expect(updated.members.find((m) => m.id === member.id)?.role).toBe('member')
    }).toPass({ timeout: 10_000 })
  })

  test('Admin removes a member from a team', async ({ adminPage, baseUrl }) => {
    const teamName = fake.teamName()
    const team = await createTeamViaApi(baseUrl, teamName)
    const member = await createApprovedVolunteer(baseUrl)
    await adminApi(baseUrl).teams.assignMember({
      body: { teamId: team.id, volunteerId: member.id },
    })

    await navigateToAdminTeamDetail(baseUrl, adminPage, team.id)
    await adminRemoveMember(adminPage, member.name)

    await expect(async () => {
      const updated = await getTeamByName(baseUrl, teamName)
      expect(updated.members.map((m) => m.id)).not.toContain(member.id)
    }).toPass({ timeout: 10_000 })
  })
})
