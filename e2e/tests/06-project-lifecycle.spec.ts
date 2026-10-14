import { test, expect, getAlert, readAdminToken, createApprovedVolunteer } from '../fixtures'
import { goToInbox } from '../actions/dashboard'
import { fake } from '../fake'
import { createApiClient } from '../client'
import {
  proposeProject,
  adminCreateProject,
  adminApproveProject,
  adminSaveProjectDraft,
  setProjectStatus,
  adminRecordOutcome,
  transferProjectOwnership,
} from '../actions/projects'

test.describe('Project Lifecycle', () => {
  test('Volunteer proposes a project with tasks; admin approves; project moves to Ready', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    const title = fake.projectTitle()
    const projectId = await proposeProject(
      baseUrl,
      volunteer.page,
      title,
      'Test proposal description',
    )
    await adminApproveProject(baseUrl, adminPage, title)

    await volunteer.page.goto(`${baseUrl}/projects/${projectId}`)
    await expect(volunteer.page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })
    await expect(volunteer.page.getByLabel('project status')).toContainText('To do', {
      timeout: 10_000,
    })
  })

  test('Admin sends a proposed project back for discussion', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    const title = fake.projectTitle()
    const feedbackText = fake.feedbackText()
    const projectId = await proposeProject(
      baseUrl,
      volunteer.page,
      title,
      'Test proposal for discussion',
    )

    await adminPage.goto(`${baseUrl}/admin/triage`)
    const projectCard = adminPage.locator('.card').filter({ hasText: title })
    await expect(projectCard).toBeVisible({ timeout: 10_000 })
    await projectCard.getByRole('link', { name: 'Review' }).click()
    await expect(adminPage.getByRole('heading', { name: 'Review Project' })).toBeVisible({
      timeout: 10_000,
    })

    await adminPage.getByRole('radio', { name: /Ask for changes/ }).click()
    await adminPage.getByLabel('Message to Proposer').fill(feedbackText)
    await adminPage.getByRole('button', { name: 'Submit review' }).click()
    await expect(getAlert(adminPage)).toBeVisible({ timeout: 10_000 })

    // Project status becomes needs_discussion — visible in the triage "Needs changes" tab
    await adminPage.goto(`${baseUrl}/admin/triage`)
    await adminPage.getByRole('tab', { name: 'Needs changes' }).click()
    await expect(adminPage.locator('.card').filter({ hasText: title })).toBeVisible({
      timeout: 10_000,
    })

    // Proposer receives a notification needing action with the feedback message, and Home
    // lists the request as needing their attention.
    await goToInbox(baseUrl, volunteer.page)
    await expect(
      volunteer.page
        .getByRole('region', { name: 'Needs action' })
        .locator('p')
        .filter({ hasText: feedbackText }),
    ).toBeVisible({ timeout: 10_000 })
    await volunteer.page.goto(`${baseUrl}/dashboard`)
    await expect(
      volunteer.page.getByRole('region', { name: /^Needs your attention/ }),
    ).toContainText(`Changes requested on "${title}"`, { timeout: 10_000 })

    // The project page shows the request with a Resubmit button; resubmitting sends it
    // back to the triage queue.
    await volunteer.page.goto(`${baseUrl}/projects/${projectId}`)
    const banner = volunteer.page.getByRole('region', { name: /Changes requested/ })
    await expect(banner).toContainText(feedbackText, { timeout: 10_000 })
    await banner.getByRole('button', { name: 'Resubmit for review' }).click()
    await expect(getAlert(volunteer.page)).toContainText('resubmitted', { timeout: 10_000 })
    await expect(banner).toHaveCount(0)

    await adminPage.goto(`${baseUrl}/admin/triage`)
    await adminPage.getByRole('tab', { name: /^In review/ }).click()
    await expect(adminPage.locator('.card').filter({ hasText: title })).toBeVisible({
      timeout: 10_000,
    })
  })

  test('Discussion message and admin follow-up appear in the proposer comment thread', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    const title = fake.projectTitle()
    const feedbackText = fake.feedbackText()
    const projectId = await proposeProject(baseUrl, volunteer.page, title, 'Discussion thread test')

    // Admin sends it back for discussion with a message
    await adminPage.goto(`${baseUrl}/admin/triage`)
    const card = adminPage.locator('.card').filter({ hasText: title })
    await expect(card).toBeVisible({ timeout: 10_000 })
    await card.getByRole('link', { name: 'Review' }).click()
    await expect(adminPage.getByRole('heading', { name: 'Review Project' })).toBeVisible({
      timeout: 10_000,
    })
    await adminPage.getByRole('radio', { name: /Ask for changes/ }).click()
    await adminPage.getByLabel('Message to Proposer').fill(feedbackText)
    await adminPage.getByRole('button', { name: 'Submit review' }).click()
    await expect(getAlert(adminPage)).toBeVisible({ timeout: 10_000 })

    // Proposer sees the review message as a comment on their project
    await volunteer.page.goto(`${baseUrl}/projects/${projectId}#discussion`)
    await expect(volunteer.page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })
    await expect(volunteer.page.locator('#discussion').getByText(feedbackText)).toBeVisible({
      timeout: 10_000,
    })

    // Admin posts a follow-up reply via the triage modal thread
    const followUp = fake.feedbackText()
    await adminPage.goto(`${baseUrl}/admin/triage`)
    await adminPage.getByRole('tab', { name: 'Needs changes' }).click()
    const discussionCard = adminPage.locator('.card').filter({ hasText: title })
    await expect(discussionCard).toBeVisible({ timeout: 10_000 })
    await discussionCard.getByRole('link', { name: 'Review' }).click()
    await expect(adminPage.getByRole('heading', { name: 'Review Project' })).toBeVisible({
      timeout: 10_000,
    })
    // The Discussion is on the Overview, under the review form.
    await adminPage.getByLabel('Add a comment').fill(followUp)
    await adminPage.getByRole('button', { name: 'Post comment' }).click()
    await expect(getAlert(adminPage)).toContainText('Comment added', { timeout: 10_000 })

    // Proposer sees the follow-up too (the page is already at this address, so reload it)
    await volunteer.page.reload()
    await expect(volunteer.page.getByText(followUp)).toBeVisible({ timeout: 10_000 })
  })

  test('Admin creates an org-proposed project', async ({ adminPage, baseUrl }) => {
    const title = fake.projectTitle()
    await adminCreateProject(baseUrl, adminPage, title, 'Admin-created project description')

    // Org projects skip review, so this one is live immediately — but the admin didn't
    // claim it, so it goes live as Ready rather than In progress.
    await expect(adminPage.getByLabel('project status')).toContainText('To do', {
      timeout: 10_000,
    })

    // Project does not appear in the triage queue
    await adminPage.goto(`${baseUrl}/admin/triage`)
    await expect(adminPage.locator('.card').filter({ hasText: title })).not.toBeVisible({
      timeout: 5_000,
    })
  })

  test('Owner moves an `in_progress` project to completed', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    const title = fake.projectTitle()
    const projectId = await proposeProject(
      baseUrl,
      volunteer.page,
      title,
      'Project to be completed by owner',
    )
    await adminApproveProject(baseUrl, adminPage, title)

    // Admin assigns volunteer as owner from the Owner chip's picker
    await transferProjectOwnership(baseUrl, adminPage, projectId, volunteer.name)

    // Owner (volunteer) changes status to completed via the dropdown
    await setProjectStatus(baseUrl, volunteer.page, projectId, 'completed')

    // Project appears in the completed tab on the projects index
    await volunteer.page.goto(`${baseUrl}/projects`)
    await expect(
      volunteer.page.getByRole('heading', { name: 'Projects', exact: true }),
    ).toBeVisible({ timeout: 10_000 })
    await volunteer.page.getByRole('button', { name: 'Status filter' }).click()
    await volunteer.page.getByRole('option', { name: 'Completed' }).click()
    await expect(volunteer.page.getByRole('link', { name: title })).toBeVisible({ timeout: 10_000 })
  })

  test('Admin records a successful project outcome', async ({ adminPage, volunteer, baseUrl }) => {
    const title = fake.projectTitle()
    const outcomeNotes = fake.outcomeNotes()

    // Create project with a required skill
    const projectId = await proposeProject(
      baseUrl,
      volunteer.page,
      title,
      'Project for outcome recording',
      'Fundraising',
    )
    await adminApproveProject(baseUrl, adminPage, title)

    // Admin assigns volunteer as owner from the Owner chip's picker
    await transferProjectOwnership(baseUrl, adminPage, projectId, volunteer.name)

    // Set project to completed
    await setProjectStatus(baseUrl, adminPage, projectId, 'completed')

    // Admin records outcome as successful with notes
    await adminRecordOutcome(baseUrl, adminPage, projectId, 'successful', outcomeNotes)

    // Outcome is visible on the project detail
    await adminPage.goto(`${baseUrl}/projects/${projectId}`)
    await expect(adminPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })
    // dnd-kit's DndContext (used for task reordering) injects its own hidden
    // role="status" live region, so scope to the visible outcome banner.
    const outcomeDisplay = adminPage.getByRole('status').filter({ hasText: 'Outcome' })
    await expect(outcomeDisplay).toBeVisible({ timeout: 10_000 })
    await expect(outcomeDisplay).toContainText('Successful')
    await expect(outcomeDisplay).toContainText(outcomeNotes)
  })

  // SKIPPED: The app has no UI that displays a volunteer's endorsements — there is no profile
  // view, directory card, or project page that shows "endorsed via project_outcome". The only
  // way to verify this is via the admin API endpoint, which requires the volunteer's numeric ID.
  // Skip until endorsements become visible somewhere in the UI.
  test.skip('Required-skill endorsements are created for the project owner on a successful outcome', async () => {})
})

test.describe('Task requirements at project creation', () => {
  // The volunteer equivalent of this — saving a draft with no tasks, then trying to
  // publish it — is covered by "Publishing a draft with no tasks is rejected" in
  // 34-project-drafts.spec.ts.
  test('Publishing an org draft without any task shows a validation error', async ({
    adminPage,
    baseUrl,
  }) => {
    const projectId = await adminSaveProjectDraft(baseUrl, adminPage, fake.projectTitle())

    await adminPage.goto(`${baseUrl}/projects/${projectId}/edit`)
    await adminPage.getByRole('button', { name: 'Publish', exact: true }).click()

    // Refused before the confirm dialog opens.
    await expect(adminPage.getByText('Add at least one task before submitting.')).toBeVisible({
      timeout: 10_000,
    })
    await expect(adminPage.getByRole('heading', { name: 'Publish this project?' })).toHaveCount(0)
  })

  test('The API accepts a volunteer project proposal with no tasks', async ({ baseUrl }) => {
    const volunteer = await createApprovedVolunteer(baseUrl)
    const api = createApiClient(baseUrl, volunteer.token)

    const result = await api.projects.create({
      body: {
        title: fake.projectTitle(),
        description: 'Proposal with no tasks, sent directly to the API',
        projectType: null,
        estimatedDuration: null,
        timeCommitmentHoursPerWeek: null,
        urgency: 'medium',
        collaborationLink: null,
        country: null,
        localGroup: null,
        isSeekingHelp: true,
        tasks: [],
      },
    })

    expect(result.status).toBe(200)
  })

  test('The API rejects an org project with no tasks', async ({ baseUrl }) => {
    const adminApi = createApiClient(baseUrl, readAdminToken(baseUrl))

    const result = await adminApi.admin.projects.create({
      body: {
        title: fake.projectTitle(),
        description: 'Org project with no tasks, sent directly to the API',
        projectType: null,
        estimatedDuration: null,
        timeCommitmentHoursPerWeek: null,
        urgency: 'medium',
        collaborationLink: null,
        country: null,
        localGroup: null,
        isSeekingHelp: false,
        tasks: [],
      },
    })

    expect(result.status).toBe(400)
    expect(JSON.stringify(result.body)).toContain('At least one task is required')
  })
})
