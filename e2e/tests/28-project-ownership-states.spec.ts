import {
  test,
  expect,
  readAdminToken,
  createApprovedVolunteer,
  dismissCookieConsentScript,
} from '../fixtures'
import { fake } from '../fake'
import { createApiClient } from '../client'
import { removeProjectOwner } from '../actions/projects'
import { createSkillViaApi } from '../actions/skills'
import { selectFilterDropdown } from '../actions/ui'

// Whether a project wants an owner is derived from (status, assignee), never stored, and
// `ready` is the status for "approved but nobody owns it yet". These tests pin the two
// halves of that: assigning or removing an owner moves the project between `ready` and
// `in_progress`, and what each state advertises to volunteers stays in step.

async function createOrgProject(
  baseUrl: string,
  opts: { isSeekingHelp?: boolean; skillIds?: number[]; title?: string } = {},
): Promise<{ id: number; title: string }> {
  const title = opts.title ?? fake.projectTitle()
  const adminApi = createApiClient(baseUrl, readAdminToken(baseUrl))
  const created = await adminApi.admin.projects.create({
    body: {
      title,
      description: 'e2e ownership-state project description',
      projectType: null,
      estimatedDuration: null,
      timeCommitmentHoursPerWeek: null,
      urgency: 'medium',
      collaborationLink: null,
      country: null,
      localGroup: null,
      isSeekingHelp: opts.isSeekingHelp ?? false,
      ...(opts.skillIds
        ? {
            skillIds: opts.skillIds,
            skillRequiredMap: Object.fromEntries(opts.skillIds.map((id) => [id, true])),
          }
        : {}),
      tasks: [{ title: 'Initial task' }],
    },
  })
  if (created.status !== 200)
    throw new Error(`Project creation failed: ${JSON.stringify(created.body)}`)
  return { id: (created.body as { id: number }).id, title }
}

async function getProject(baseUrl: string, token: string, id: number) {
  const result = await createApiClient(baseUrl, token).projects.getById({ body: { id } })
  expect(result.status).toBe(200)
  return result.body as {
    status: string
    ownerId: number | null
    isSeekingOwner: boolean
    isSeekingHelp: boolean
  }
}

test.describe('Project ownership states', () => {
  test('An org project with no owner starts Ready and seeking an owner', async ({ baseUrl }) => {
    const adminToken = readAdminToken(baseUrl)
    const { id } = await createOrgProject(baseUrl)

    const project = await getProject(baseUrl, adminToken, id)
    expect(project.status).toBe('ready')
    expect(project.ownerId).toBeNull()
    expect(project.isSeekingOwner).toBe(true)
  })

  // Regression: assigning someone as owner used to create the accepted interest and clear
  // the stored is_seeking_owner flag without ever setting assignee_id, leaving the project
  // ownerless *and* no longer advertising for one.
  test('Assigning a volunteer as owner sets the owner and starts the project', async ({
    baseUrl,
  }) => {
    const adminToken = readAdminToken(baseUrl)
    const { id } = await createOrgProject(baseUrl)
    const volunteer = await createApprovedVolunteer(baseUrl)

    const assigned = await createApiClient(baseUrl, adminToken).projects.assign({
      body: { projectId: id, volunteerId: volunteer.id, interestType: 'want_to_own' },
    })
    expect(assigned.status).toBe(200)

    const project = await getProject(baseUrl, adminToken, id)
    expect(project.ownerId).toBe(volunteer.id)
    expect(project.status).toBe('in_progress')
    expect(project.isSeekingOwner).toBe(false)
  })

  test('Accepting a want_to_own interest sets the owner and starts the project', async ({
    baseUrl,
  }) => {
    const adminToken = readAdminToken(baseUrl)
    const adminApi = createApiClient(baseUrl, adminToken)
    const { id } = await createOrgProject(baseUrl)
    const volunteer = await createApprovedVolunteer(baseUrl)

    const interest = await createApiClient(baseUrl, volunteer.token).projects.expressInterest({
      body: { projectId: id, interestType: 'want_to_own' },
    })
    expect(interest.status).toBe(200)

    const withInterest = await adminApi.projects.getById({ body: { id } })
    const interestId = (
      withInterest.body as { interests: { id: number; volunteerId: number }[] }
    ).interests.find((i) => i.volunteerId === volunteer.id)!.id
    const accepted = await adminApi.projects.respondToInterest({
      body: { projectId: id, interestId, status: 'accepted' },
    })
    expect(accepted.status).toBe(200)

    const project = await getProject(baseUrl, adminToken, id)
    expect(project.ownerId).toBe(volunteer.id)
    expect(project.status).toBe('in_progress')
    expect(project.isSeekingOwner).toBe(false)
  })

  // Regression: removing the owner left the project In progress with nobody on it and no
  // "seeking owner" flag, so nothing browsing for a project to lead could ever find it.
  test('Removing the owner keeps the status and re-advertises the project for an owner', async ({
    adminPage,
    baseUrl,
  }) => {
    const adminToken = readAdminToken(baseUrl)
    const { id, title } = await createOrgProject(baseUrl)
    const volunteer = await createApprovedVolunteer(baseUrl)

    await createApiClient(baseUrl, adminToken).projects.assign({
      body: { projectId: id, volunteerId: volunteer.id, interestType: 'want_to_own' },
    })

    await adminPage.goto(`${baseUrl}/projects/${id}`)
    await expect(adminPage.getByLabel('project status')).toContainText('In progress', {
      timeout: 10_000,
    })

    await removeProjectOwner(baseUrl, adminPage, id)

    // The work is still where it was; a Seeking owner flag says it needs a lead.
    await expect(adminPage.getByText('• Seeking owner')).toBeVisible({ timeout: 10_000 })
    await expect(adminPage.getByLabel('project status')).toContainText('In progress')
    const project = await getProject(baseUrl, adminToken, id)
    expect(project.ownerId).toBeNull()
    expect(project.isSeekingOwner).toBe(true)

    // And it is findable again by someone filtering for projects that need a lead.
    await adminPage.goto(`${baseUrl}/projects`)
    await selectFilterDropdown(adminPage, 'Needs filter', 'Seeking owner')
    await expect(adminPage.getByRole('link', { name: title })).toBeVisible({ timeout: 10_000 })
  })

  // An ownerless project still has someone behind it. Org-proposed ones are filed by an
  // admin on the organisation's behalf, so they are attributed to the org rather than to
  // that admin personally.
  test('The People tab names the proposer: the org, or the volunteer who proposed it', async ({
    adminPage,
    baseUrl,
  }) => {
    const { id: orgProjectId } = await createOrgProject(baseUrl)
    const proposedBy = () =>
      adminPage
        .getByRole('region', { name: 'People on this project' })
        .locator('p')
        .filter({ hasText: 'Proposed by' })

    await adminPage.goto(`${baseUrl}/projects/${orgProjectId}#people`)
    await expect(proposedBy()).toContainText('PauseAI', { timeout: 10_000 })

    // A volunteer proposal is attributed to the volunteer, linked to their profile.
    const volunteer = await createApprovedVolunteer(baseUrl)
    const proposed = await createApiClient(baseUrl, volunteer.token).projects.create({
      body: {
        title: fake.projectTitle(),
        description: 'e2e proposer-attribution project description',
        projectType: null,
        estimatedDuration: null,
        timeCommitmentHoursPerWeek: null,
        urgency: 'medium',
        collaborationLink: null,
        country: null,
        localGroup: null,
        isSeekingHelp: true,
        tasks: [{ title: 'Initial task' }],
      },
    })
    expect(proposed.status).toBe(200)
    const proposedId = (proposed.body as { id: number }).id

    await adminPage.goto(`${baseUrl}/projects/${proposedId}#people`)
    await expect(
      proposedBy().getByRole('link', { name: volunteer.name, exact: true }),
    ).toHaveAttribute('href', `/volunteers/${volunteer.id}`, { timeout: 10_000 })
  })

  // A card says who owns a project, or that it is seeking an owner; who filed it is on the
  // project's People tab.
  test('Browse cards never name the proposer, for admins or volunteers', async ({
    adminPage,
    browser,
    baseUrl,
  }) => {
    const { id, title } = await createOrgProject(baseUrl)

    await adminPage.goto(`${baseUrl}/projects`)
    const adminCard = adminPage.locator('.card').filter({ hasText: title })
    await expect(adminCard).toBeVisible({ timeout: 10_000 })
    await expect(adminCard).not.toContainText('Proposed by')
    await expect(adminCard).toContainText('Seeking owner')

    const volunteer = await createApprovedVolunteer(baseUrl)
    const ctx = await browser.newContext()
    await ctx.addInitScript((token: string) => {
      localStorage.setItem('authToken', token)
    }, volunteer.token)
    await ctx.addInitScript(dismissCookieConsentScript)
    const volunteerPage = await ctx.newPage()
    try {
      await volunteerPage.goto(`${baseUrl}/projects`)
      const volunteerCard = volunteerPage.locator('.card').filter({ hasText: title })
      await expect(volunteerCard).toBeVisible({ timeout: 10_000 })
      await expect(volunteerCard).toContainText('Seeking owner')
      await expect(volunteerCard).not.toContainText('Proposer:')

      // Same in the project page's header: the empty state, not a name.
      await volunteerPage.goto(`${baseUrl}/projects/${id}`)
      await expect(volunteerPage.getByText('No owner yet', { exact: true })).toBeVisible({
        timeout: 10_000,
      })
      await expect(volunteerPage.getByText('Proposer:')).toBeHidden()
    } finally {
      await ctx.close()
    }
  })

  // Regression: an owned project used to be able to sit in the retired `seeking_owner`
  // status with the flag cleared, and the card suppressed the status badge for exactly
  // that status — so the card rendered no status at all.
  test('An owned project shows its status and is excluded from the Seeking owner filter', async ({
    adminPage,
    baseUrl,
  }) => {
    const adminToken = readAdminToken(baseUrl)
    const { id, title } = await createOrgProject(baseUrl)
    const volunteer = await createApprovedVolunteer(baseUrl)
    await createApiClient(baseUrl, adminToken).projects.assign({
      body: { projectId: id, volunteerId: volunteer.id, interestType: 'want_to_own' },
    })

    await adminPage.goto(`${baseUrl}/projects`)
    await selectFilterDropdown(adminPage, 'Needs filter', 'Seeking owner')
    await expect(adminPage.getByRole('link', { name: title })).toBeHidden({ timeout: 10_000 })

    await adminPage.goto(`${baseUrl}/projects/${id}`)
    await expect(adminPage.getByLabel('project status')).toContainText('In progress', {
      timeout: 10_000,
    })
    await expect(adminPage.getByText('Seeking owner')).toBeHidden()
  })

  // Regression: setOutcome completes a project directly, and used to do it without
  // clearing isSeekingHelp — unlike projects.update, the other route to `completed`. A
  // finished project then kept its "Seeking help" badge and its place in the "Looking for
  // People" group. Driven through the API because the UI's outcome panel only appears once
  // the project is already completed, which is the path that always cleared the flag.
  test('Recording an outcome stops the project advertising for help', async ({
    adminPage,
    baseUrl,
  }) => {
    const adminToken = readAdminToken(baseUrl)
    const adminApi = createApiClient(baseUrl, adminToken)
    const { id, title } = await createOrgProject(baseUrl, { isSeekingHelp: true })
    const volunteer = await createApprovedVolunteer(baseUrl)
    await adminApi.projects.assign({
      body: { projectId: id, volunteerId: volunteer.id, interestType: 'want_to_own' },
    })

    const recorded = await adminApi.admin.projects.setOutcome({
      body: { id, outcome: 'successful', outcomeNotes: 'Delivered in full' },
    })
    expect(recorded.status).toBe(200)

    const project = await getProject(baseUrl, adminToken, id)
    expect(project.status).toBe('completed')
    expect(project.isSeekingHelp).toBe(false)
    expect(project.isSeekingOwner).toBe(false)

    await adminPage.goto(`${baseUrl}/projects`)
    await selectFilterDropdown(adminPage, 'Needs filter', 'Looking for people')
    await expect(adminPage.getByRole('link', { name: title })).toBeHidden({ timeout: 10_000 })
  })

  // Regression: "Suggested for You" matched on the seeking flags alone. Every project is
  // created with isSeekingHelp true, so proposals were recommended to volunteers before an
  // admin had reviewed them.
  test('A proposal awaiting review is not suggested to matching volunteers', async ({
    baseUrl,
  }) => {
    // A skill of its own, so no other test's project competes for Home's few match slots.
    const skillIds = [(await createSkillViaApi(baseUrl)).id]

    // A volunteer who proposes a project, and a second who matches its skills.
    const proposer = await createApprovedVolunteer(baseUrl)
    const title = fake.projectTitle()
    const proposed = await createApiClient(baseUrl, proposer.token).projects.create({
      body: {
        title,
        description: 'Proposal that should stay private until reviewed',
        projectType: null,
        estimatedDuration: null,
        timeCommitmentHoursPerWeek: null,
        urgency: 'medium',
        collaborationLink: null,
        country: null,
        localGroup: null,
        isSeekingHelp: true,
        skillIds,
        skillRequiredMap: Object.fromEntries(skillIds.map((id) => [id, true])),
        tasks: [{ title: 'Initial task' }],
      },
    })
    expect(proposed.status).toBe(200)
    const projectId = (proposed.body as { id: number }).id

    const matcher = await createApprovedVolunteer(baseUrl)
    const matcherApi = createApiClient(baseUrl, matcher.token)
    const updated = await matcherApi.volunteers.updateMe({ body: { skillIds } })
    expect(updated.status).toBe(200)

    const beforeReview = await matcherApi.dashboard.get()
    expect(beforeReview.status).toBe(200)
    type Home = { find: { matches: { items: { id: number }[] } } }
    const suggestedBefore = (beforeReview.body as Home).find.matches.items
    expect(suggestedBefore.map((p) => p.id)).not.toContain(projectId)

    // Once approved it goes live as `ready`, and the same volunteer should now see it.
    const approved = await createApiClient(baseUrl, readAdminToken(baseUrl)).admin.projects.review({
      body: { id: projectId, status: 'approved' },
    })
    expect(approved.status).toBe(200)

    const afterReview = await matcherApi.dashboard.get()
    expect(afterReview.status).toBe(200)
    const suggestedAfter = (afterReview.body as Home).find.matches.items
    expect(suggestedAfter.map((p) => p.id)).toContain(projectId)
  })
})
