import { test, expect, getAlert, readAdminToken, createApprovedVolunteer } from '../fixtures'
import type { Page } from '@playwright/test'
import { createSkillViaApi } from '../actions/skills'
import type { SkillInfo } from '../actions/skills'
import { goToInbox } from '../actions/dashboard'
import { fake } from '../fake'
import { selectFilterDropdown } from '../actions/ui'
import { createApiClient } from '../client'

// API-equivalent of driving the create-quick-task dialog, for tests that need "an open quick
// task exists" purely as setup for testing claim/assign/complete/comment flows — the
// create-dialog UI flow itself is already proven end-to-end by "Admin creates a quick task"
// below.
async function createOpenQuickTaskViaApi(baseUrl: string, skill: SkillInfo): Promise<string> {
  const taskTitle = fake.quickTaskTitle()
  const adminApi = createApiClient(baseUrl, readAdminToken(baseUrl))
  const result = await adminApi.quickTasks.create({
    body: {
      title: taskTitle,
      description: 'E2E test task description',
      skillId: skill.id,
      estimatedHours: 2,
    },
  })
  if (result.status !== 200)
    throw new Error(`Quick task creation failed: ${JSON.stringify(result.body)}`)
  return taskTitle
}

async function assignQuickTask(
  baseUrl: string,
  adminPage: Page,
  taskTitle: string,
  volunteerName: string,
): Promise<void> {
  await adminPage.goto(`${baseUrl}/quick-tasks`)
  await expect(adminPage.getByRole('heading', { name: 'Quick tasks', level: 1 })).toBeVisible({
    timeout: 10_000,
  })

  const taskCard = adminPage.getByRole('article').filter({ hasText: taskTitle })
  await expect(taskCard).toBeVisible({ timeout: 10_000 })
  await taskCard.getByText(taskTitle, { exact: true }).click()
  await selectFilterDropdown(adminPage, `Assign volunteer to ${taskTitle}`, volunteerName, taskCard)
  await taskCard.getByRole('button', { name: 'Assign', exact: true }).click()
  await expect(getAlert(adminPage)).toBeVisible({ timeout: 10_000 })
}

/** The volunteer's row for a task in Home's "My work". */
function myWorkRow(volunteerPage: Page, taskTitle: string) {
  return volunteerPage
    .getByRole('region', { name: 'My work' })
    .getByRole('listitem')
    .filter({ hasText: taskTitle })
}

/** Opens a claimed Quick Task from Home, landing on its own page. */
async function openFromHome(baseUrl: string, volunteerPage: Page, taskTitle: string) {
  await volunteerPage.goto(`${baseUrl}/dashboard`)
  const row = myWorkRow(volunteerPage, taskTitle)
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.getByRole('link', { name: taskTitle }).click()
  await expect(volunteerPage.getByRole('heading', { level: 1, name: taskTitle })).toBeVisible({
    timeout: 10_000,
  })
}

async function submitQuickTask(
  baseUrl: string,
  volunteerPage: Page,
  taskTitle: string,
): Promise<void> {
  await openFromHome(baseUrl, volunteerPage, taskTitle)
  await volunteerPage.getByRole('button', { name: 'Submit work' }).click()
  const dialog = volunteerPage.getByRole('dialog', { name: 'Submit your work' })
  await dialog.getByLabel('What did you do?').fill('Done, notes in the doc')
  await dialog.getByRole('button', { name: 'Submit work' }).click()
  await expect(getAlert(volunteerPage)).toContainText('Submitted. An admin will review it', {
    timeout: 10_000,
  })
}

test.describe('Quick Tasks (admin)', () => {
  test('Admin creates a quick task', async ({ adminPage, baseUrl }) => {
    const skill = await createSkillViaApi(baseUrl)
    const taskTitle = fake.quickTaskTitle()

    await adminPage.goto(`${baseUrl}/quick-tasks`)
    await expect(adminPage.getByRole('heading', { name: 'Quick tasks', level: 1 })).toBeVisible({
      timeout: 10_000,
    })

    await adminPage.getByRole('button', { name: 'Create task' }).click()
    const createDialog = adminPage.getByRole('dialog', { name: 'Create quick task' })
    await expect(createDialog).toBeVisible({ timeout: 10_000 })

    await createDialog.getByLabel('Title').fill(taskTitle)
    await createDialog.getByLabel('Description').fill('E2E test task description')
    await selectFilterDropdown(adminPage, 'Skill being tested', skill.optionLabel, createDialog)
    await createDialog.getByLabel('Estimated hours').fill('2')
    await createDialog.getByRole('button', { name: 'Create task' }).click()

    await expect(getAlert(adminPage)).toContainText('Task created!', { timeout: 10_000 })

    // Task appears in the list with status 'open'
    const taskCard = adminPage.getByRole('article').filter({ hasText: taskTitle })
    await expect(taskCard).toBeVisible({ timeout: 10_000 })
    await expect(taskCard.getByRole('status')).toContainText('To do')
  })

  test('Admin assigns a quick task to a volunteer; task status becomes assigned and volunteer receives a notification', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    const skill = await createSkillViaApi(baseUrl)
    const taskTitle = await createOpenQuickTaskViaApi(baseUrl, skill)

    await adminPage.goto(`${baseUrl}/quick-tasks`)
    await expect(adminPage.getByRole('heading', { name: 'Quick tasks', level: 1 })).toBeVisible({
      timeout: 10_000,
    })

    // Expand the card to reveal the inline assign dropdown
    const taskCard = adminPage.getByRole('article').filter({ hasText: taskTitle })
    await expect(taskCard).toBeVisible({ timeout: 10_000 })
    await taskCard.getByText(taskTitle, { exact: true }).click()
    await selectFilterDropdown(
      adminPage,
      `Assign volunteer to ${taskTitle}`,
      volunteer.name,
      taskCard,
    )
    await taskCard.getByRole('button', { name: 'Assign', exact: true }).click()

    await expect(getAlert(adminPage)).toContainText('Task assigned!', { timeout: 10_000 })
    await expect(taskCard.getByRole('status')).toContainText('In progress', { timeout: 10_000 })

    // Volunteer receives an assignment notification
    await goToInbox(baseUrl, volunteer.page)
    await expect(
      volunteer.page.locator('strong').filter({ hasText: 'Assigned: Quick Task' }),
    ).toBeVisible({ timeout: 10_000 })
  })

  test('Admin posts a comment on a quick task and it appears in the thread', async ({
    adminPage,
    baseUrl,
  }) => {
    const skill = await createSkillViaApi(baseUrl)
    const taskTitle = await createOpenQuickTaskViaApi(baseUrl, skill)
    const commentText = `comment ${Date.now()}`

    await adminPage.goto(`${baseUrl}/quick-tasks`)
    await expect(adminPage.getByRole('heading', { name: 'Quick tasks', level: 1 })).toBeVisible({
      timeout: 10_000,
    })

    const taskCard = adminPage.getByRole('article').filter({ hasText: taskTitle })
    await expect(taskCard).toBeVisible({ timeout: 10_000 })
    await taskCard.getByText(taskTitle, { exact: true }).click()

    await taskCard.getByLabel('Add a comment').fill(commentText)
    await taskCard.getByRole('button', { name: 'Post comment' }).click()

    await expect(taskCard.getByText(commentText)).toBeVisible({ timeout: 10_000 })
  })

  test('Admin and assignee exchange comments on a quick task in a back-and-forth thread', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    const skill = await createSkillViaApi(baseUrl)
    const taskTitle = await createOpenQuickTaskViaApi(baseUrl, skill)
    await assignQuickTask(baseUrl, adminPage, taskTitle, volunteer.name)
    const adminComment = `admin note ${Date.now()}`
    const volunteerReply = `volunteer reply ${Date.now()}`

    // Admin expands the task and posts the first comment
    await adminPage.goto(`${baseUrl}/quick-tasks`)
    const adminCard = adminPage.getByRole('article').filter({ hasText: taskTitle })
    await expect(adminCard).toBeVisible({ timeout: 10_000 })
    await adminCard.getByText(taskTitle, { exact: true }).click()
    await adminCard.getByLabel('Add a comment').fill(adminComment)
    await adminCard.getByRole('button', { name: 'Post comment' }).click()
    await expect(adminCard.getByText(adminComment)).toBeVisible({ timeout: 10_000 })

    // Assignee opens the task from Home, sees the admin's comment and replies
    await openFromHome(baseUrl, volunteer.page, taskTitle)
    await expect(volunteer.page.getByText(adminComment)).toBeVisible({ timeout: 10_000 })
    await volunteer.page.getByLabel('Add a comment').fill(volunteerReply)
    await volunteer.page.getByRole('button', { name: 'Post comment' }).click()
    await expect(volunteer.page.getByText(volunteerReply)).toBeVisible({ timeout: 10_000 })

    // Admin reloads and sees both messages in the thread
    await adminPage.goto(`${baseUrl}/quick-tasks`)
    const refreshedCard = adminPage.getByRole('article').filter({ hasText: taskTitle })
    await expect(refreshedCard).toBeVisible({ timeout: 10_000 })
    await refreshedCard.getByText(taskTitle, { exact: true }).click()
    await expect(refreshedCard.getByText(adminComment)).toBeVisible({ timeout: 10_000 })
    await expect(refreshedCard.getByText(volunteerReply)).toBeVisible({ timeout: 10_000 })
  })

  test('Volunteer views their assigned quick task on the dashboard', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    const skill = await createSkillViaApi(baseUrl)
    const taskTitle = await createOpenQuickTaskViaApi(baseUrl, skill)
    await assignQuickTask(baseUrl, adminPage, taskTitle, volunteer.name)

    // Home's "My work" lists the assigned task with its status
    await volunteer.page.goto(`${baseUrl}/dashboard`)
    const row = myWorkRow(volunteer.page, taskTitle)
    await expect(row).toBeVisible({ timeout: 10_000 })
    await expect(row).toContainText('In progress')
  })

  test('Volunteer submits a completed quick task; task status becomes submitted and admin receives a notification', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    const skill = await createSkillViaApi(baseUrl)
    const taskTitle = await createOpenQuickTaskViaApi(baseUrl, skill)
    await assignQuickTask(baseUrl, adminPage, taskTitle, volunteer.name)

    // Volunteer opens the task from Home and submits it
    await submitQuickTask(baseUrl, volunteer.page, taskTitle)

    // Task status changes to 'under_review' on the admin page
    await adminPage.goto(`${baseUrl}/quick-tasks`)
    await expect(adminPage.getByRole('heading', { name: 'Quick tasks', level: 1 })).toBeVisible({
      timeout: 10_000,
    })
    const adminTaskCard = adminPage.getByRole('article').filter({ hasText: taskTitle })
    await expect(adminTaskCard.getByRole('status')).toContainText('In review', {
      timeout: 10_000,
    })

    // Admin receives a notification (admins are also volunteers and can view their dashboard)
    await goToInbox(baseUrl, adminPage)
    await expect(
      adminPage.locator('strong').filter({ hasText: `Submitted for review: '${taskTitle}'` }),
    ).toBeVisible({ timeout: 10_000 })
  })

  test('Admin reviews a quick task as excellent; task becomes completed and a skill endorsement is auto-created for the volunteer', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    const skill = await createSkillViaApi(baseUrl)
    const taskTitle = await createOpenQuickTaskViaApi(baseUrl, skill)
    await assignQuickTask(baseUrl, adminPage, taskTitle, volunteer.name)
    await submitQuickTask(baseUrl, volunteer.page, taskTitle)

    // Admin opens the review modal
    await adminPage.goto(`${baseUrl}/quick-tasks`)
    await expect(adminPage.getByRole('heading', { name: 'Quick tasks', level: 1 })).toBeVisible({
      timeout: 10_000,
    })

    const taskCard = adminPage.getByRole('article').filter({ hasText: taskTitle })
    await expect(taskCard).toBeVisible({ timeout: 10_000 })
    await taskCard.getByText(taskTitle, { exact: true }).click()
    await expect(taskCard.getByRole('button', { name: 'Review', exact: true })).toBeVisible({
      timeout: 10_000,
    })
    await taskCard.getByRole('button', { name: 'Review', exact: true }).click()

    const reviewDialog = adminPage.getByRole('dialog', { name: 'Review task' })
    await expect(reviewDialog).toBeVisible({ timeout: 10_000 })
    await reviewDialog.getByRole('radio', { name: /Excellent/ }).click()
    await reviewDialog.getByLabel("Feedback to volunteer (they'll see this)").fill('Great work!')
    await reviewDialog.getByRole('button', { name: 'Accept' }).click()

    await expect(getAlert(adminPage)).toContainText('Accepted. The task is done.', {
      timeout: 10_000,
    })

    // Task status becomes 'completed'
    await expect(taskCard.getByRole('status')).toContainText('Done', { timeout: 10_000 })

    // Volunteer receives a feedback notification
    await goToInbox(baseUrl, volunteer.page)
    await expect(
      volunteer.page.locator('strong').filter({ hasText: 'Reviewed: your Quick Task' }),
    ).toBeVisible({ timeout: 10_000 })

    // Skill endorsement is auto-created; navigate to admin volunteer detail via the task card link
    await taskCard.getByRole('link', { name: volunteer.name }).click()
    await expect(
      adminPage.getByRole('heading', { name: 'Verified Skills (Endorsed)', level: 3 }),
    ).toBeVisible({ timeout: 10_000 })
    await expect(adminPage.locator('#endorsements')).toContainText(skill.name, { timeout: 10_000 })
  })

  test('Admin reviews a quick task as needs_improvement; task becomes completed and no skill endorsement is created', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    const skill = await createSkillViaApi(baseUrl)
    const taskTitle = await createOpenQuickTaskViaApi(baseUrl, skill)
    await assignQuickTask(baseUrl, adminPage, taskTitle, volunteer.name)
    await submitQuickTask(baseUrl, volunteer.page, taskTitle)

    // Admin opens the review modal
    await adminPage.goto(`${baseUrl}/quick-tasks`)
    await expect(adminPage.getByRole('heading', { name: 'Quick tasks', level: 1 })).toBeVisible({
      timeout: 10_000,
    })

    const taskCard = adminPage.getByRole('article').filter({ hasText: taskTitle })
    await expect(taskCard).toBeVisible({ timeout: 10_000 })
    await taskCard.getByText(taskTitle, { exact: true }).click()
    await expect(taskCard.getByRole('button', { name: 'Review', exact: true })).toBeVisible({
      timeout: 10_000,
    })
    await taskCard.getByRole('button', { name: 'Review', exact: true }).click()

    const reviewDialog = adminPage.getByRole('dialog', { name: 'Review task' })
    await expect(reviewDialog).toBeVisible({ timeout: 10_000 })
    await reviewDialog.getByRole('radio', { name: /Needs improvement/ }).click()
    await reviewDialog
      .getByLabel("Feedback to volunteer (they'll see this)")
      .fill('Please try again.')
    await reviewDialog.getByRole('button', { name: 'Accept' }).click()

    await expect(getAlert(adminPage)).toContainText('Accepted. The task is done.', {
      timeout: 10_000,
    })

    // Task status becomes 'completed'
    await expect(taskCard.getByRole('status')).toContainText('Done', { timeout: 10_000 })

    // Volunteer receives a feedback notification
    await goToInbox(baseUrl, volunteer.page)
    await expect(
      volunteer.page.locator('strong').filter({ hasText: 'Reviewed: your Quick Task' }),
    ).toBeVisible({ timeout: 10_000 })

    // No skill endorsement created; navigate to admin volunteer detail to confirm
    await taskCard.getByRole('link', { name: volunteer.name }).click()
    await expect(
      adminPage.getByRole('heading', { name: 'Verified Skills (Endorsed)', level: 3 }),
    ).toBeVisible({ timeout: 10_000 })
    await expect(adminPage.locator('#endorsements')).not.toContainText(skill.name, {
      timeout: 10_000,
    })
  })

  test('Admin deletes a quick task; task disappears from the list', async ({
    adminPage,
    baseUrl,
  }) => {
    const skill = await createSkillViaApi(baseUrl)
    const taskTitle = await createOpenQuickTaskViaApi(baseUrl, skill)

    await adminPage.goto(`${baseUrl}/quick-tasks`)
    await expect(adminPage.getByRole('heading', { name: 'Quick tasks', level: 1 })).toBeVisible({
      timeout: 10_000,
    })

    const taskCard = adminPage.getByRole('article').filter({ hasText: taskTitle })
    await expect(taskCard).toBeVisible({ timeout: 10_000 })
    await taskCard.getByText(taskTitle, { exact: true }).click()
    await expect(taskCard.getByRole('button', { name: 'Delete', exact: true })).toBeVisible({
      timeout: 10_000,
    })

    await taskCard.getByRole('button', { name: 'Delete', exact: true }).click()
    await adminPage.getByRole('dialog').getByRole('button', { name: 'Delete task' }).click()

    await expect(getAlert(adminPage)).toContainText('Task deleted', { timeout: 10_000 })
    await expect(taskCard).not.toBeVisible({ timeout: 10_000 })
  })

  test('Deep-linking to ?id= auto-expands the matching task card', async ({
    adminPage,
    baseUrl,
  }) => {
    const skill = await createSkillViaApi(baseUrl)
    const taskTitle = await createOpenQuickTaskViaApi(baseUrl, skill)

    await adminPage.goto(`${baseUrl}/quick-tasks`)
    await expect(adminPage.getByRole('heading', { name: 'Quick tasks', level: 1 })).toBeVisible({
      timeout: 10_000,
    })

    // Get the task ID from the card's DOM id attribute (card has id="task-N")
    const taskCard = adminPage.getByRole('article').filter({ hasText: taskTitle })
    await expect(taskCard).toBeVisible({ timeout: 10_000 })
    const cardId = await taskCard.getAttribute('id')
    const taskId = parseInt(cardId!.replace('task-', ''), 10)

    // Navigate directly to the deep-link — card should be expanded without clicking
    await adminPage.goto(`${baseUrl}/quick-tasks#task-${taskId}`)
    await expect(adminPage.getByRole('heading', { name: 'Quick tasks', level: 1 })).toBeVisible({
      timeout: 10_000,
    })
    await adminPage.getByText('Loading…').waitFor({ state: 'hidden', timeout: 10_000 })

    const deepLinkCard = adminPage.locator(`#task-${taskId}`)
    await expect(deepLinkCard).toBeVisible({ timeout: 10_000 })
    // Card is expanded — action buttons are visible without clicking the header
    await expect(deepLinkCard.getByRole('button', { name: 'Edit', exact: true })).toBeVisible({
      timeout: 10_000,
    })
  })

  test('Quick task comments are hidden from non-assignee volunteers once claimed', async ({
    baseUrl,
  }) => {
    const adminToken = readAdminToken(baseUrl)
    expect(adminToken).toBeTruthy()
    const adminApi = createApiClient(baseUrl, adminToken)

    // Admin creates a quick task and assigns it to a specific volunteer
    const created = await adminApi.quickTasks.create({
      body: { title: `Iso task ${Date.now()}`, description: 'isolation test description' },
    })
    expect(created.status).toBe(200)
    const workItemId = (created.body as { id: number }).id

    const assignee = await createApprovedVolunteer(baseUrl)
    const assignResult = await adminApi.quickTasks.assign({
      body: { id: workItemId, volunteerId: assignee.id },
    })
    expect(assignResult.status).toBe(200)

    const commentText = `admin-only ${Date.now()}`
    const added = await adminApi.workItemComments.add({
      body: { workItemId, content: commentText },
    })
    expect(added.status).toBe(200)

    // Admin can read the thread
    const adminList = await adminApi.workItemComments.list({ body: { workItemId } })
    expect(adminList.status).toBe(200)
    expect(
      (adminList.body as { feed: { type: string; content?: string }[] }).feed.some(
        (c) => c.type === 'comment' && c.content === commentText,
      ),
    ).toBe(true)

    // A fresh, approved volunteer who is not the assignee
    const outsider = await createApprovedVolunteer(baseUrl)
    const volApi = createApiClient(baseUrl, outsider.token)

    // Cannot read the thread (work item not visible) or post to it
    const volList = await volApi.workItemComments.list({ body: { workItemId } })
    expect(volList.status).toBe(404)
    const volAdd = await volApi.workItemComments.add({
      body: { workItemId, content: 'should be rejected' },
    })
    expect(volAdd.status).toBe(403)
  })

  test('An open, unclaimed quick task is visible to any approved volunteer', async ({
    baseUrl,
  }) => {
    const adminToken = readAdminToken(baseUrl)
    expect(adminToken).toBeTruthy()
    const adminApi = createApiClient(baseUrl, adminToken)

    const created = await adminApi.quickTasks.create({
      body: { title: `Open task ${Date.now()}`, description: 'open browse test' },
    })
    expect(created.status).toBe(200)
    const workItemId = (created.body as { id: number }).id

    const outsider = await createApprovedVolunteer(baseUrl)
    const volApi = createApiClient(baseUrl, outsider.token)

    const result = await volApi.quickTasks.get({ body: { id: workItemId } })
    expect(result.status).toBe(200)

    const available = await volApi.quickTasks.available()
    expect(available.status).toBe(200)
    expect(
      (available.body as { kind: string; id: number }[]).some(
        (t) => t.kind === 'quick' && t.id === workItemId,
      ),
    ).toBe(true)
  })
})
