import { test, expect, getAlert } from '../fixtures'
import { goToInbox } from '../actions/dashboard'
import { fake } from '../fake'
import {
  proposeProject,
  adminApproveProject,
  adminCreateProjectViaApi,
  transferProjectOwnership,
  joinProject,
} from '../actions/projects'
import { selectFilterDropdown } from '../actions/ui'

// Creates an org project that immediately accepts interest (is_seeking_help = true by default)
async function setupSeekingProject(baseUrl: string): Promise<number> {
  return adminCreateProjectViaApi(baseUrl, fake.projectTitle(), 'Project seeking volunteers')
}

test.describe('Project Interests and Assignment', () => {
  test('Volunteer expresses interest to contribute', async ({ volunteer, baseUrl }) => {
    const projectId = await setupSeekingProject(baseUrl)

    await volunteer.page.goto(`${baseUrl}/projects/${projectId}`)
    await expect(volunteer.page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })

    // Helping out is selected by default.
    await joinProject(volunteer.page)

    await expect(getAlert(volunteer.page)).toContainText(
      "You'll get a notification when they reply",
      { timeout: 10_000 },
    )
    await expect(volunteer.page.getByRole('button', { name: 'Join this project' })).not.toBeVisible(
      {
        timeout: 10_000,
      },
    )
    await expect(volunteer.page.getByLabel('interest status')).toContainText('Request sent', {
      timeout: 10_000,
    })
  })

  test('Volunteer expresses interest to own / lead', async ({ volunteer, baseUrl }) => {
    const projectId = await setupSeekingProject(baseUrl)

    await volunteer.page.goto(`${baseUrl}/projects/${projectId}`)
    await expect(volunteer.page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })

    await joinProject(volunteer.page, { lead: true })

    await expect(getAlert(volunteer.page)).toContainText(
      "You'll get a notification when they reply",
      { timeout: 10_000 },
    )
    await expect(
      volunteer.page.getByRole('group', { name: 'Status' }).getByLabel('interest status'),
    ).toContainText('Request to lead sent', { timeout: 10_000 })
  })

  test('Accepting a want-to-own interest promotes the volunteer to Owner, not a duplicate volunteer row', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    const projectId = await setupSeekingProject(baseUrl)

    await volunteer.page.goto(`${baseUrl}/projects/${projectId}`)
    await joinProject(volunteer.page, { lead: true })
    await expect(getAlert(volunteer.page)).toContainText(
      "You'll get a notification when they reply",
      { timeout: 10_000 },
    )

    await adminPage.goto(`${baseUrl}/projects/${projectId}#people`)
    const interestCard = adminPage.locator('.interest-card').filter({ hasText: volunteer.name })
    await expect(interestCard).toBeVisible({ timeout: 10_000 })
    await interestCard.getByRole('button', { name: 'Accept' }).click()
    await expect(getAlert(adminPage)).toContainText('Accepted. They', { timeout: 10_000 })

    // Volunteer now appears once, as Owner — not also listed below in Volunteers
    await expect(
      adminPage
        .getByRole('region', { name: 'People on this project' })
        .getByRole('link', { name: volunteer.name }),
    ).toBeVisible({ timeout: 10_000 })
    await expect(
      adminPage.locator('.interest-card').filter({ hasText: volunteer.name }),
    ).toHaveCount(0)
  })

  test("Volunteer's message is hidden once their interest is accepted", async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    const projectId = await setupSeekingProject(baseUrl)
    const applicantMessage = fake.feedbackText()

    await volunteer.page.goto(`${baseUrl}/projects/${projectId}`)
    await joinProject(volunteer.page, { message: applicantMessage })
    await expect(getAlert(volunteer.page)).toContainText(
      "You'll get a notification when they reply",
      { timeout: 10_000 },
    )

    await adminPage.goto(`${baseUrl}/projects/${projectId}#people`)
    const interestCard = adminPage.locator('.interest-card').filter({ hasText: volunteer.name })
    await expect(interestCard).toContainText(applicantMessage, { timeout: 10_000 })

    await interestCard.getByRole('button', { name: 'Accept' }).click()
    await expect(getAlert(adminPage)).toContainText('Accepted. They', { timeout: 10_000 })
    await expect(interestCard).not.toContainText(applicantMessage, { timeout: 10_000 })
  })

  test('Project owner accepts a pending interest; volunteer receives a notification', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    const projectId = await setupSeekingProject(baseUrl)

    // Volunteer expresses interest
    await volunteer.page.goto(`${baseUrl}/projects/${projectId}`)
    await joinProject(volunteer.page)
    await expect(getAlert(volunteer.page)).toContainText(
      "You'll get a notification when they reply",
      { timeout: 10_000 },
    )

    // Admin (managing the project) accepts the interest
    await adminPage.goto(`${baseUrl}/projects/${projectId}#people`)
    await expect(adminPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })
    const interestCard = adminPage.locator('.interest-card').filter({ hasText: volunteer.name })
    await expect(interestCard).toBeVisible({ timeout: 10_000 })
    await interestCard.getByRole('button', { name: 'Accept' }).click()
    await expect(getAlert(adminPage)).toContainText('Accepted. They', { timeout: 10_000 })

    // Interest status updates to accepted
    await expect(
      adminPage.locator('.interest-card').filter({ hasText: volunteer.name }),
    ).toContainText('Accepted', { timeout: 10_000 })

    // Volunteer receives a notification
    await goToInbox(baseUrl, volunteer.page)
    await expect(
      volunteer.page.locator('strong').filter({ hasText: 'Accepted: your interest in' }),
    ).toBeVisible({
      timeout: 10_000,
    })
  })

  test('Project owner declines a pending interest', async ({ adminPage, volunteer, baseUrl }) => {
    const projectId = await setupSeekingProject(baseUrl)
    const declineMessage = fake.feedbackText()

    // Volunteer expresses interest
    await volunteer.page.goto(`${baseUrl}/projects/${projectId}`)
    await joinProject(volunteer.page)
    await expect(getAlert(volunteer.page)).toContainText(
      "You'll get a notification when they reply",
      { timeout: 10_000 },
    )

    // Admin declines with a response message via the decline modal
    await adminPage.goto(`${baseUrl}/projects/${projectId}#people`)
    await expect(adminPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })
    const interestCard = adminPage.locator('.interest-card').filter({ hasText: volunteer.name })
    await expect(interestCard).toBeVisible({ timeout: 10_000 })
    await interestCard.getByRole('button', { name: 'Decline' }).click()
    const declineDialog = adminPage.getByRole('dialog', { name: 'Decline Volunteer' })
    await expect(declineDialog).toBeVisible({ timeout: 10_000 })
    await declineDialog.getByLabel('Optional message for the volunteer').fill(declineMessage)
    await declineDialog.getByRole('button', { name: 'Decline' }).click()
    await expect(getAlert(adminPage)).toContainText('Declined. They', { timeout: 10_000 })

    // Interest status updates to declined
    await expect(
      adminPage.locator('.interest-card').filter({ hasText: volunteer.name }),
    ).toContainText('Applied, declined', { timeout: 10_000 })
  })

  test('Volunteer withdraws their pending interest', async ({ volunteer, baseUrl }) => {
    const projectId = await setupSeekingProject(baseUrl)

    // Express interest first
    await volunteer.page.goto(`${baseUrl}/projects/${projectId}`)
    await joinProject(volunteer.page)
    await expect(getAlert(volunteer.page)).toContainText(
      "You'll get a notification when they reply",
      { timeout: 10_000 },
    )
    await expect(volunteer.page.getByRole('button', { name: 'Withdraw request' })).toBeVisible({
      timeout: 10_000,
    })

    await volunteer.page.getByRole('button', { name: 'Withdraw request' }).click()
    await volunteer.page.getByRole('dialog').getByRole('button', { name: 'Withdraw' }).click()
    await expect(getAlert(volunteer.page)).toContainText('Request withdrawn', {
      timeout: 10_000,
    })

    // The Join button comes back
    await expect(volunteer.page.getByRole('button', { name: 'Join this project' })).toBeVisible({
      timeout: 10_000,
    })
  })

  test('Admin adds a volunteer to a project straight away', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    const projectId = await setupSeekingProject(baseUrl)

    await adminPage.goto(`${baseUrl}/projects/${projectId}#people`)
    await expect(adminPage.getByRole('heading', { name: 'Volunteers' })).toBeVisible({
      timeout: 10_000,
    })
    await selectFilterDropdown(adminPage, 'Volunteer to invite', volunteer.name)
    await adminPage.getByRole('button', { name: 'Add now', exact: true }).click()
    await expect(getAlert(adminPage)).toContainText('Added to the project.', { timeout: 10_000 })

    // Volunteer's interest record appears as accepted, labeled as a role
    // rather than a pending request since they were assigned directly
    const assignedCard = adminPage.locator('.interest-card').filter({ hasText: volunteer.name })
    await expect(assignedCard).toContainText('Accepted', { timeout: 10_000 })
    await expect(assignedCard).toContainText('Helper')
    await expect(assignedCard).not.toContainText('wants to help')

    // Volunteer receives an assignment notification
    await goToInbox(baseUrl, volunteer.page)
    await expect(
      volunteer.page.locator('strong').filter({ hasText: "Assigned: you're on" }),
    ).toBeVisible({ timeout: 10_000 })
  })

  test('A volunteer is invited, and is on the project only once they accept', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    const projectId = await setupSeekingProject(baseUrl)

    await adminPage.goto(`${baseUrl}/projects/${projectId}#people`)
    await selectFilterDropdown(adminPage, 'Volunteer to invite', volunteer.name)
    await adminPage.getByLabel('Note with the invite (optional)').fill('Could you do the leaflets?')
    await adminPage.getByRole('button', { name: 'Invite', exact: true }).click()
    await expect(getAlert(adminPage)).toContainText('Invite sent', { timeout: 10_000 })
    const card = adminPage.locator('.interest-card').filter({ hasText: volunteer.name })
    await expect(card).toContainText('Invited by', { timeout: 10_000 })
    await expect(card.getByRole('button', { name: 'Cancel invite' })).toBeVisible()

    // The volunteer answers from the Inbox.
    await goToInbox(baseUrl, volunteer.page)
    const row = volunteer.page.getByRole('listitem').filter({ hasText: 'Invited: help on' })
    await expect(row).toContainText('Could you do the leaflets?', { timeout: 10_000 })
    await row.getByRole('button', { name: 'Accept' }).click()
    await expect(getAlert(volunteer.page)).toContainText('Answer sent', { timeout: 10_000 })

    await adminPage.reload()
    await expect(card).toContainText('Helper', { timeout: 10_000 })
    await expect(card.getByRole('button', { name: `Remove ${volunteer.name}` })).toBeVisible()
  })

  test('Owner removes an already-accepted volunteer', async ({ adminPage, volunteer, baseUrl }) => {
    const projectId = await setupSeekingProject(baseUrl)

    await adminPage.goto(`${baseUrl}/projects/${projectId}#people`)
    await selectFilterDropdown(adminPage, 'Volunteer to invite', volunteer.name)
    await adminPage.getByRole('button', { name: 'Add now', exact: true }).click()
    await expect(getAlert(adminPage)).toContainText('Added to the project.', { timeout: 10_000 })

    const volunteerCard = adminPage.locator('.interest-card').filter({ hasText: volunteer.name })
    await expect(volunteerCard).toBeVisible({ timeout: 10_000 })

    await volunteerCard.getByRole('button', { name: `Remove ${volunteer.name}` }).click()
    const removeDialog = adminPage.getByRole('dialog', { name: /^Remove .+ from this project\?$/ })
    await expect(removeDialog).toBeVisible({ timeout: 10_000 })
    await removeDialog.getByRole('button', { name: 'Remove' }).click()
    await expect(getAlert(adminPage)).toContainText(`Removed ${volunteer.name}.`, {
      timeout: 10_000,
    })
    await expect(volunteerCard).toContainText('Added, removed', { timeout: 10_000 })
    await expect(
      volunteerCard.getByRole('button', { name: `Remove ${volunteer.name}` }),
    ).toHaveCount(0)

    // The volunteer is told they were removed, not declined.
    await goToInbox(baseUrl, volunteer.page)
    await expect(
      volunteer.page.locator('strong').filter({ hasText: "Removed: you're no longer on" }),
    ).toBeVisible({ timeout: 10_000 })
  })

  test('Non-participant can read a project comment thread but cannot post', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    const projectId = await setupSeekingProject(baseUrl)
    const commentText = `admin note ${Date.now()}`

    // Admin posts a comment on the project
    await adminPage.goto(`${baseUrl}/projects/${projectId}#discussion`)
    await expect(adminPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })
    await adminPage.getByLabel('Add a comment').fill(commentText)
    await adminPage.getByRole('button', { name: 'Post Comment' }).click()
    await expect(adminPage.getByText(commentText)).toBeVisible({ timeout: 10_000 })

    // A non-participant volunteer can read the thread but has no post form
    await volunteer.page.goto(`${baseUrl}/projects/${projectId}#discussion`)
    await expect(volunteer.page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })
    await expect(volunteer.page.getByText(commentText)).toBeVisible({ timeout: 10_000 })
    // The Discussion is on the Overview, and the link scrolls to it.
    await expect(volunteer.page.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(volunteer.page.locator('#discussion')).toBeInViewport()
    await expect(volunteer.page.getByLabel('Add a comment')).not.toBeVisible({ timeout: 5_000 })
    await expect(volunteer.page.getByRole('button', { name: 'Post Comment' })).not.toBeVisible({
      timeout: 5_000,
    })
  })

  test('Accepted helper can post in the project comment thread', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    const projectId = await setupSeekingProject(baseUrl)

    // Volunteer expresses interest to contribute
    await volunteer.page.goto(`${baseUrl}/projects/${projectId}`)
    await joinProject(volunteer.page)
    await expect(getAlert(volunteer.page)).toContainText(
      "You'll get a notification when they reply",
      { timeout: 10_000 },
    )

    // Admin accepts the interest, making the volunteer a participant
    await adminPage.goto(`${baseUrl}/projects/${projectId}#people`)
    const interestCard = adminPage.locator('.interest-card').filter({ hasText: volunteer.name })
    await expect(interestCard).toBeVisible({ timeout: 10_000 })
    await interestCard.getByRole('button', { name: 'Accept' }).click()
    await expect(getAlert(adminPage)).toContainText('Accepted. They', { timeout: 10_000 })

    // The accepted helper can now post a comment
    const commentText = `helper comment ${Date.now()}`
    // The page is already at this address, where the Discussion loaded before the accept, so
    // reload it.
    await volunteer.page.goto(`${baseUrl}/projects/${projectId}#discussion`)
    await volunteer.page.reload()
    await expect(volunteer.page.getByLabel('Add a comment')).toBeVisible({ timeout: 10_000 })
    await volunteer.page.getByLabel('Add a comment').fill(commentText)
    await volunteer.page.getByRole('button', { name: 'Post Comment' }).click()
    await expect(volunteer.page.getByText(commentText)).toBeVisible({ timeout: 10_000 })
  })

  test('Posting a comment notifies other participants but not the author', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    const title = fake.projectTitle()
    const projectId = await adminCreateProjectViaApi(baseUrl, title, 'Notify-on-comment test')
    // Admin is the creator; make the volunteer the owner (assignee)
    await transferProjectOwnership(baseUrl, adminPage, projectId, volunteer.name)

    // Owner (volunteer) posts a comment
    const commentText = `owner update ${Date.now()}`
    await volunteer.page.goto(`${baseUrl}/projects/${projectId}#discussion`)
    await expect(volunteer.page.getByLabel('Add a comment')).toBeVisible({ timeout: 10_000 })
    await volunteer.page.getByLabel('Add a comment').fill(commentText)
    await volunteer.page.getByRole('button', { name: 'Post Comment' }).click()
    await expect(volunteer.page.getByText(commentText)).toBeVisible({ timeout: 10_000 })

    // Admin (the project creator) receives a comment notification
    await goToInbox(baseUrl, adminPage)
    await expect(
      adminPage.locator('strong').filter({ hasText: `New comment on "${title}"` }),
    ).toBeVisible({
      timeout: 10_000,
    })

    // The author (volunteer) is NOT notified of their own comment
    await goToInbox(baseUrl, volunteer.page)
    await expect(
      volunteer.page.locator('strong').filter({ hasText: `New comment on "${title}"` }),
    ).not.toBeVisible({ timeout: 5_000 })
  })

  test('Volunteer cannot express interest in their own project', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    const title = fake.projectTitle()
    const projectId = await proposeProject(
      baseUrl,
      volunteer.page,
      title,
      'Project owned by the volunteer',
    )
    await adminApproveProject(baseUrl, adminPage, title)
    await transferProjectOwnership(baseUrl, adminPage, projectId, volunteer.name)

    await volunteer.page.goto(`${baseUrl}/projects/${projectId}`)
    await expect(volunteer.page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })

    // The Join button is hidden for the project owner
    await expect(volunteer.page.getByRole('button', { name: 'Join this project' })).not.toBeVisible(
      {
        timeout: 5_000,
      },
    )
    await expect(
      volunteer.page.getByRole('heading', { name: 'Interested in this project?' }),
    ).not.toBeVisible({ timeout: 5_000 })
  })
})
