import { test, expect, readAdminToken, confirmVolunteerEmail, approveVolunteer } from '../fixtures'
import { fake } from '../fake'
import { createApiClient } from '../client'
import { goToInbox } from '../actions/dashboard'
import type { RouterClient } from '@orpc/server'
import type { appRouter } from '@/server/router'

async function createAdminProject(
  adminApi: RouterClient<typeof appRouter>,
  description: string,
  opts?: { isSeekingHelp?: boolean },
): Promise<number> {
  const created = await adminApi.admin.projects.create({
    body: {
      title: fake.projectTitle(),
      description,
      projectType: null,
      estimatedDuration: null,
      timeCommitmentHoursPerWeek: null,
      urgency: 'medium',
      collaborationLink: null,
      country: null,
      localGroup: null,
      isSeekingHelp: opts?.isSeekingHelp ?? false,
      tasks: [{ title: 'Seed task' }],
    },
  })
  const projectId = (created.body as { id: number }).id

  // Remove the seed task used only to satisfy the "at least one task" requirement at
  // creation — callers add their own tasks afterward and assert on the exact task list.
  const detail = await adminApi.projects.getById({ body: { id: projectId } })
  const seedTaskId = (detail.body as { tasks: { id: number }[] }).tasks[0].id
  await adminApi.projects.deleteTask({ body: { projectId, taskId: seedTaskId } })

  return projectId
}

async function signupApprovedVolunteer(
  baseUrl: string,
): Promise<{ id: number; token: string; name: string }> {
  const person = fake.person()
  const api = createApiClient(baseUrl)
  const signup = await api.auth.signup({
    body: {
      name: person.name,
      email: person.email,
      password: 'testpassword1',
      bio: 'e2e test bio, at least twenty characters long',
      country: 'UK',
      availabilityHoursPerWeek: 5,
      applicationMessage: 'e2e test application message',
      consentMakeProfileVisibleInDirectory: true,
      consentContactableByProjectOwners: true,
    },
  })
  const { id, token, emailVerificationToken } = signup.body as {
    id: number
    token: string
    emailVerificationToken?: string
  }
  if (emailVerificationToken) await confirmVolunteerEmail(baseUrl, emailVerificationToken)
  await approveVolunteer(baseUrl, id, token)
  return { id, token, name: person.name }
}

test.describe('Task Reordering', () => {
  test('Owner sees drag handles on tasks, a volunteer does not', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    const adminToken = readAdminToken(baseUrl)
    const adminApi = createApiClient(baseUrl, adminToken)

    const projectId = await createAdminProject(adminApi, 'Drag handle visibility test')

    await adminApi.projects.createTask({ body: { projectId, title: 'Task A' } })
    await adminApi.projects.createTask({ body: { projectId, title: 'Task B' } })

    await adminPage.goto(`${baseUrl}/projects/${projectId}#tasks`)
    await expect(adminPage.getByText('Task A')).toBeVisible({ timeout: 10_000 })
    await expect(adminPage.getByTitle('Drag to reorder').first()).toBeVisible({ timeout: 10_000 })

    await volunteer.page.goto(`${baseUrl}/projects/${projectId}#tasks`)
    await expect(volunteer.page.getByText('Task A')).toBeVisible({ timeout: 10_000 })
    await expect(volunteer.page.getByTitle('Drag to reorder')).toHaveCount(0)
  })

  test('Reordered tasks persist their order after reload', async ({ adminPage, baseUrl }) => {
    const adminToken = readAdminToken(baseUrl)
    const adminApi = createApiClient(baseUrl, adminToken)

    const projectId = await createAdminProject(adminApi, 'Reorder persistence test')

    const taskA = await adminApi.projects.createTask({ body: { projectId, title: 'First' } })
    const taskB = await adminApi.projects.createTask({ body: { projectId, title: 'Second' } })
    const taskC = await adminApi.projects.createTask({ body: { projectId, title: 'Third' } })
    const idA = (taskA.body as { id: number }).id
    const idB = (taskB.body as { id: number }).id
    const idC = (taskC.body as { id: number }).id

    // Reorder to Third, First, Second
    const reorder = await adminApi.projects.reorderTasks({
      body: {
        projectId,
        items: [
          { id: idC, sortOrder: 1 },
          { id: idA, sortOrder: 2 },
          { id: idB, sortOrder: 3 },
        ],
      },
    })
    expect(reorder.status).toBe(200)

    await adminPage.goto(`${baseUrl}/projects/${projectId}#tasks`)
    await expect(adminPage.getByText('Third')).toBeVisible({ timeout: 10_000 })

    const taskTitles = await adminPage.locator('ul > li > span.flex-1').allTextContents()
    expect(taskTitles).toEqual(['Third', 'First', 'Second'])
  })

  test('Assigning a task keeps its priority position instead of sinking below open tasks', async ({
    adminPage,
    baseUrl,
  }) => {
    const adminToken = readAdminToken(baseUrl)
    const adminApi = createApiClient(baseUrl, adminToken)
    const projectId = await createAdminProject(adminApi, 'Assign keeps order test')

    await adminApi.projects.createTask({ body: { projectId, title: 'First' } })
    const taskB = await adminApi.projects.createTask({ body: { projectId, title: 'Second' } })
    await adminApi.projects.createTask({ body: { projectId, title: 'Third' } })
    const idB = (taskB.body as { id: number }).id

    const volunteer = await signupApprovedVolunteer(baseUrl)
    const assign = await adminApi.projects.assignTask({
      body: { projectId, taskId: idB, assigneeId: volunteer.id },
    })
    expect(assign.status).toBe(200)

    await adminPage.goto(`${baseUrl}/projects/${projectId}#tasks`)
    await expect(adminPage.getByText('Third')).toBeVisible({ timeout: 10_000 })
    const taskTitles = await adminPage.locator('ul > li > span.flex-1').allTextContents()
    expect(taskTitles).toEqual(['First', 'Second', 'Third'])
  })

  test('A volunteer cannot reorder tasks via the API', async ({ baseUrl }) => {
    const adminToken = readAdminToken(baseUrl)
    const adminApi = createApiClient(baseUrl, adminToken)

    const projectId = await createAdminProject(adminApi, 'Reorder permission test')
    const taskCreated = await adminApi.projects.createTask({
      body: { projectId, title: 'Solo task' },
    })
    const taskId = (taskCreated.body as { id: number }).id

    const person = fake.person()
    const api = createApiClient(baseUrl)
    const signup = await api.auth.signup({
      body: {
        name: person.name,
        email: person.email,
        password: 'testpassword1',
        bio: 'e2e test bio, at least twenty characters long',
        country: 'UK',
        availabilityHoursPerWeek: 5,
        applicationMessage: 'e2e test application message',
        consentMakeProfileVisibleInDirectory: true,
        consentContactableByProjectOwners: true,
      },
    })
    const {
      id: volId,
      token: volToken,
      emailVerificationToken,
    } = signup.body as { id: number; token: string; emailVerificationToken?: string }
    if (emailVerificationToken) await confirmVolunteerEmail(baseUrl, emailVerificationToken)
    await approveVolunteer(baseUrl, volId, volToken)
    const volApi = createApiClient(baseUrl, volToken)

    const reorder = await volApi.projects.reorderTasks({
      body: { projectId, items: [{ id: taskId, sortOrder: 1 }] },
    })
    expect(reorder.status).toBe(403)
  })
})

test.describe('Task Assignment', () => {
  test('Owner assigns a volunteer directly to an open task; assignee shows on the task', async ({
    adminPage,
    baseUrl,
  }) => {
    const adminToken = readAdminToken(baseUrl)
    const adminApi = createApiClient(baseUrl, adminToken)
    const projectId = await createAdminProject(adminApi, 'Direct task assignment test')
    await adminApi.projects.createTask({ body: { projectId, title: 'Assign me' } })

    const volunteer = await signupApprovedVolunteer(baseUrl)

    await adminPage.goto(`${baseUrl}/projects/${projectId}#tasks`)
    await expect(adminPage.getByText('Assign me')).toBeVisible({ timeout: 10_000 })

    const taskItem = adminPage.locator('li').filter({ hasText: 'Assign me' })
    await taskItem.getByRole('button', { name: 'Task actions for Assign me' }).click()
    await adminPage.getByLabel('Assign volunteer to Assign me', { exact: true }).click()
    const searchInput = adminPage.locator(
      `input[type="search"][aria-label="Assign volunteer to Assign me"]`,
    )
    await searchInput.fill(volunteer.name)
    await adminPage.getByRole('option', { name: volunteer.name, exact: true }).click()
    await adminPage.getByRole('menu').getByRole('button', { name: 'Assign', exact: true }).click()

    await expect(adminPage.getByText('Task assigned!')).toBeVisible({ timeout: 10_000 })
    await expect(taskItem.getByLabel(`Assigned to ${volunteer.name}`)).toBeVisible({
      timeout: 10_000,
    })
  })

  test('Assigned volunteer receives an in-app notification', async ({ adminPage, baseUrl }) => {
    const adminToken = readAdminToken(baseUrl)
    const adminApi = createApiClient(baseUrl, adminToken)
    const projectId = await createAdminProject(adminApi, 'Task assignment notification test')
    const taskCreated = await adminApi.projects.createTask({
      body: { projectId, title: 'Notify me' },
    })
    const taskId = (taskCreated.body as { id: number }).id

    const volunteer = await signupApprovedVolunteer(baseUrl)
    const assign = await adminApi.projects.assignTask({
      body: { projectId, taskId, assigneeId: volunteer.id },
    })
    expect(assign.status).toBe(200)

    const context = await adminPage.context().browser()!.newContext()
    await context.addInitScript((token: string) => {
      localStorage.setItem('authToken', token)
    }, volunteer.token)
    const volPage = await context.newPage()

    await goToInbox(baseUrl, volPage)
    await expect(volPage.getByText(/assigned/i).first()).toBeVisible({ timeout: 10_000 })

    await context.close()
  })

  test('A volunteer cannot assign a task via the API', async ({ baseUrl }) => {
    const adminToken = readAdminToken(baseUrl)
    const adminApi = createApiClient(baseUrl, adminToken)
    const projectId = await createAdminProject(adminApi, 'Task assignment permission test')
    const taskCreated = await adminApi.projects.createTask({
      body: { projectId, title: 'Solo task' },
    })
    const taskId = (taskCreated.body as { id: number }).id

    const volunteer = await signupApprovedVolunteer(baseUrl)
    const other = await signupApprovedVolunteer(baseUrl)
    const volApi = createApiClient(baseUrl, volunteer.token)

    const assign = await volApi.projects.assignTask({
      body: { projectId, taskId, assigneeId: other.id },
    })
    expect(assign.status).toBe(403)
  })

  test('Interested volunteers are grouped first in the assign dropdown', async ({
    adminPage,
    baseUrl,
  }) => {
    const adminToken = readAdminToken(baseUrl)
    const adminApi = createApiClient(baseUrl, adminToken)
    const projectId = await createAdminProject(adminApi, 'Interested volunteer grouping test', {
      isSeekingHelp: true,
    })
    await adminApi.projects.createTask({ body: { projectId, title: 'Group test task' } })

    const interested = await signupApprovedVolunteer(baseUrl)
    const other = await signupApprovedVolunteer(baseUrl)
    const interestedApi = createApiClient(baseUrl, interested.token)
    await interestedApi.projects.expressInterest({
      body: { projectId, interestType: 'want_to_contribute' },
    })

    await adminPage.goto(`${baseUrl}/projects/${projectId}#tasks`)
    await expect(adminPage.getByText('Group test task')).toBeVisible({ timeout: 10_000 })

    const taskItem = adminPage.locator('li').filter({ hasText: 'Group test task' })
    await taskItem.getByRole('button', { name: 'Task actions for Group test task' }).click()
    await adminPage.getByLabel('Assign volunteer to Group test task', { exact: true }).click()
    const listbox = adminPage.getByRole('listbox')
    await expect(listbox).toBeVisible({ timeout: 10_000 })
    const optionTexts = await listbox.locator('div').allTextContents()
    const interestedHeaderIndex = optionTexts.indexOf('Interested in this project')
    const interestedNameIndex = optionTexts.indexOf(interested.name)
    const otherNameIndex = optionTexts.indexOf(other.name)
    expect(interestedHeaderIndex).toBeGreaterThanOrEqual(0)
    expect(interestedNameIndex).toBeGreaterThan(interestedHeaderIndex)
    expect(otherNameIndex).toBeGreaterThan(interestedNameIndex)
  })
})

test.describe('Task Deadlines', () => {
  test('Owner sets estimated hours and a deadline when creating a task', async ({
    adminPage,
    baseUrl,
  }) => {
    const adminToken = readAdminToken(baseUrl)
    const adminApi = createApiClient(baseUrl, adminToken)
    const projectId = await createAdminProject(adminApi, 'Task deadline creation test')

    const futureDeadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    const deadlineValue = futureDeadline.toISOString().slice(0, 10)

    await adminPage.goto(`${baseUrl}/projects/${projectId}#tasks`)
    await adminPage.getByRole('button', { name: 'Add Task' }).click()
    await adminPage.getByLabel('Task title').fill('Task with deadline')
    await adminPage.getByLabel('Effort (hours of work)').fill('4')
    await adminPage.getByLabel('Deadline (optional)').fill(deadlineValue)
    await adminPage.getByRole('button', { name: 'Create Task' }).click()

    await expect(adminPage.getByText('Task added!')).toBeVisible({ timeout: 10_000 })
    const taskItem = adminPage.locator('li').filter({ hasText: 'Task with deadline' })
    await expect(taskItem.getByText('~4h')).toBeVisible({ timeout: 10_000 })
    await expect(taskItem.getByText(/^Deadline /)).toBeVisible({ timeout: 10_000 })
    await expect(taskItem.getByText('Overdue')).toHaveCount(0)
  })

  test('A task with a past deadline shows an Overdue badge; a completed one does not', async ({
    adminPage,
    baseUrl,
  }) => {
    const adminToken = readAdminToken(baseUrl)
    const adminApi = createApiClient(baseUrl, adminToken)
    const projectId = await createAdminProject(adminApi, 'Overdue badge test')

    const pastDeadline = new Date(Date.now() - 24 * 60 * 60 * 1000)

    await adminApi.projects.createTask({
      body: { projectId, title: 'Overdue task', deadline: pastDeadline },
    })
    const doneTask = await adminApi.projects.createTask({
      body: { projectId, title: 'Overdue but done task', deadline: pastDeadline },
    })
    const doneTaskId = (doneTask.body as { id: number }).id
    await adminApi.projects.updateTask({
      body: { projectId, taskId: doneTaskId, data: { status: 'completed' } },
    })

    await adminPage.goto(`${baseUrl}/projects/${projectId}#tasks`)
    const overdueItem = adminPage.locator('li').filter({ hasText: 'Overdue task' })
    await expect(overdueItem.getByText('Overdue', { exact: true })).toBeVisible({
      timeout: 10_000,
    })

    const doneItem = adminPage.locator('li').filter({ hasText: 'Overdue but done task' })
    await expect(doneItem.getByText('Overdue', { exact: true })).toHaveCount(0)
  })
})
