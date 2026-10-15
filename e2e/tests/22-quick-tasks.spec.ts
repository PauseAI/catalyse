import { test, expect, getAlert, readAdminToken } from '../fixtures'
import { createApiClient } from '../client'
import { fake } from '../fake'
import { selectFilterDropdown } from '../actions/ui'

test.describe('Quick Tasks: self-serve', () => {
  test('Volunteer browses and claims an open Quick Task', async ({ volunteer, baseUrl }) => {
    const adminApi = createApiClient(baseUrl, readAdminToken(baseUrl))
    const taskTitle = fake.quickTaskTitle()
    const created = await adminApi.quickTasks.create({
      body: { title: taskTitle, description: 'Browse and claim test' },
    })
    expect(created.status).toBe(200)

    await volunteer.page.goto(`${baseUrl}/quick-tasks`)
    await expect(volunteer.page.getByRole('heading', { name: 'Browse Quick Tasks' })).toBeVisible({
      timeout: 10_000,
    })

    // The same title appears in both lists while the two queries settle, so each assertion
    // says which list it means rather than racing them.
    const browsePool = volunteer.page.getByRole('region', { name: 'Browse Quick Tasks' })
    const myTasks = volunteer.page.getByRole('region', { name: 'My Quick Tasks' })

    const browseCard = browsePool.getByRole('article').filter({ hasText: taskTitle })
    await expect(browseCard).toBeVisible({ timeout: 10_000 })
    await browseCard.getByRole('button', { name: 'Claim', exact: true }).click()

    await expect(getAlert(volunteer.page)).toContainText('Task claimed. Submit it for review', {
      timeout: 10_000,
    })

    // Moves out of the browse pool into "My Quick Tasks" — same title, now with a status
    // badge and no Claim button, proving it's no longer the open/unclaimed browse card.
    const claimedCard = myTasks.getByRole('article').filter({ hasText: taskTitle })
    await expect(claimedCard.getByRole('status')).toContainText('In progress', { timeout: 10_000 })
    await expect(claimedCard.getByRole('button', { name: 'Claim', exact: true })).not.toBeVisible()
    await expect(browseCard).toHaveCount(0, { timeout: 10_000 })
  })

  test('Volunteer views an unclaimed Quick Task detail page and claims from there', async ({
    volunteer,
    baseUrl,
  }) => {
    const adminApi = createApiClient(baseUrl, readAdminToken(baseUrl))
    const taskTitle = fake.quickTaskTitle()
    const created = await adminApi.quickTasks.create({
      body: { title: taskTitle, description: 'Detail-page claim test' },
    })
    const taskId = (created.body as { id: number }).id

    await volunteer.page.goto(`${baseUrl}/quick-tasks/${taskId}`)
    await expect(volunteer.page.getByRole('heading', { name: taskTitle, level: 1 })).toBeVisible({
      timeout: 10_000,
    })
    await volunteer.page.getByRole('button', { name: 'Claim', exact: true }).click()

    await expect(getAlert(volunteer.page)).toContainText('Task claimed. Submit it for review', {
      timeout: 10_000,
    })
    await expect(volunteer.page.getByRole('button', { name: 'Submit work' })).toBeVisible({
      timeout: 10_000,
    })
  })

  test('Admin flags a project task as a Quick Task; it appears in the browse pool and links back to the project', async ({
    volunteer,
    baseUrl,
  }) => {
    const adminApi = createApiClient(baseUrl, readAdminToken(baseUrl))
    const taskTitle = `Quick-flagged ${fake.quickTaskTitle()}`
    const projectCreated = await adminApi.admin.projects.create({
      body: {
        title: fake.projectTitle(),
        description: 'Featured task test project',
        projectType: null,
        estimatedDuration: null,
        timeCommitmentHoursPerWeek: null,
        urgency: 'medium',
        collaborationLink: null,
        country: null,
        localGroup: null,
        isSeekingHelp: true,
        tasks: [{ title: 'Seed task' }],
      },
    })
    const projectId = (projectCreated.body as { id: number }).id

    const taskCreated = await adminApi.projects.createTask({
      body: { projectId, title: taskTitle, featuredAsQuickTask: true },
    })
    const taskId = (taskCreated.body as { id: number }).id

    await volunteer.page.goto(`${baseUrl}/quick-tasks`)
    const card = volunteer.page.getByRole('article').filter({ hasText: taskTitle })
    await expect(card).toBeVisible({ timeout: 10_000 })
    await expect(card).toContainText('Part of:')

    // Task title links into the task's own page in the project, not a separate Quick Task page.
    await expect(card.getByRole('link', { name: taskTitle })).toHaveAttribute(
      'href',
      `/projects/${projectId}/tasks/${taskId}`,
    )

    // Claiming from Quick Tasks when not on the project asks the owner to accept the
    // volunteer, and holds the task for them meanwhile.
    await card.getByRole('button', { name: 'Claim', exact: true }).click()
    await expect(getAlert(volunteer.page)).toContainText('Requested. The task is held for you', {
      timeout: 10_000,
    })

    // A claimed project task is not a QuickTask row, so it never lands in "My Quick
    // Tasks" — the volunteer is taken to the task itself rather than left on a page where
    // what they just claimed has silently disappeared.
    await expect(volunteer.page).toHaveURL(`${baseUrl}/projects/${projectId}/tasks/${taskId}`, {
      timeout: 10_000,
    })

    const project = await adminApi.projects.getById({ body: { id: projectId } })
    expect(project.status).toBe(200)
    const interests = (
      project.body as {
        interests: { volunteerId: number; status: string; message: string | null }[]
      }
    ).interests
    const request = interests.find((i) => i.volunteerId && i.status === 'pending')
    expect(request?.message).toContain(taskTitle)
  })

  test('A superadmin sees a featured project task on the Quick Tasks admin page', async ({
    adminPage,
    baseUrl,
  }) => {
    const adminApi = createApiClient(baseUrl, readAdminToken(baseUrl))
    const taskTitle = `Admin-visible-flagged ${fake.quickTaskTitle()}`
    const projectCreated = await adminApi.admin.projects.create({
      body: {
        title: fake.projectTitle(),
        description: 'Admin visibility test project',
        projectType: null,
        estimatedDuration: null,
        timeCommitmentHoursPerWeek: null,
        urgency: 'medium',
        collaborationLink: null,
        country: null,
        localGroup: null,
        isSeekingHelp: true,
        tasks: [{ title: 'Seed task' }],
      },
    })
    const projectId = (projectCreated.body as { id: number }).id

    const taskCreated = await adminApi.projects.createTask({
      body: { projectId, title: taskTitle, featuredAsQuickTask: true },
    })
    const taskId = (taskCreated.body as { id: number }).id

    // Regression: the admin Quick Tasks page only ever queried real QuickTask rows
    // (quickTasks.list), never project tasks flagged featuredAsQuickTask — so a task
    // flagged this way was invisible here even though it correctly appeared in the
    // volunteer-facing browse pool.
    await adminPage.goto(`${baseUrl}/quick-tasks`)
    await expect(adminPage.getByRole('heading', { name: 'Quick Tasks', level: 1 })).toBeVisible({
      timeout: 10_000,
    })
    await expect(
      adminPage.getByRole('heading', { name: 'Featured project tasks', level: 2 }),
    ).toBeVisible({ timeout: 10_000 })

    const card = adminPage.getByRole('article').filter({ hasText: taskTitle })
    await expect(card).toBeVisible({ timeout: 10_000 })
    await expect(card.getByRole('link', { name: taskTitle })).toHaveAttribute(
      'href',
      `/projects/${projectId}/tasks/${taskId}`,
    )
    await expect(card.getByRole('status')).toContainText('Not started')
  })

  test('Admin unassigns a volunteer from a Quick Task via the inline action', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    const adminApi = createApiClient(baseUrl, readAdminToken(baseUrl))
    const taskTitle = fake.quickTaskTitle()
    await adminApi.quickTasks.create({
      body: { title: taskTitle, description: 'Unassign test' },
    })

    await adminPage.goto(`${baseUrl}/quick-tasks`)
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

    await taskCard.getByRole('button', { name: 'Unassign', exact: true }).click()
    await expect(getAlert(adminPage)).toContainText('Assignee removed', { timeout: 10_000 })
    await expect(taskCard.getByRole('status')).toContainText('Open', { timeout: 10_000 })
  })
})
