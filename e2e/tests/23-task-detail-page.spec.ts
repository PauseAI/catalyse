import {
  test,
  expect,
  readAdminToken,
  getAlert,
  confirmVolunteerEmail,
  approveVolunteer,
} from '../fixtures'
import { fake } from '../fake'
import { createApiClient } from '../client'
import type { RouterClient } from '@orpc/server'
import type { appRouter } from '@/server/router'

async function createAdminProject(
  adminApi: RouterClient<typeof appRouter>,
  description: string,
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
      isSeekingHelp: false,
      tasks: [{ title: 'Seed task' }],
    },
  })
  const projectId = (created.body as { id: number }).id

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

test.describe('Task Detail Page', () => {
  test('Volunteer claims an open task from its own detail page', async ({ volunteer, baseUrl }) => {
    const adminApi = createApiClient(baseUrl, readAdminToken(baseUrl))
    const projectId = await createAdminProject(adminApi, 'Task detail claim test')
    const taskCreated = await adminApi.projects.createTask({
      body: { projectId, title: 'Claim me from the detail page' },
    })
    const taskId = (taskCreated.body as { id: number }).id

    await volunteer.page.goto(`${baseUrl}/projects/${projectId}/tasks/${taskId}`)
    await expect(
      volunteer.page.getByRole('heading', { name: 'Claim me from the detail page', level: 1 }),
    ).toBeVisible({ timeout: 10_000 })

    // Not on the project yet: the claim asks the owner and holds the task meanwhile.
    await volunteer.page.getByRole('button', { name: 'Claim' }).click()
    await expect(getAlert(volunteer.page)).toContainText('Requested. The task is held for you', {
      timeout: 10_000,
    })
    await expect(
      volunteer.page.getByText('Held for you until the owner accepts you onto the project.', {
        exact: true,
      }),
    ).toBeVisible({ timeout: 10_000 })
    await expect(volunteer.page.getByRole('button', { name: 'Claim' })).not.toBeVisible()
  })

  test('Owner edits a task’s title, description, hours, and deadline from its detail page', async ({
    adminPage,
    baseUrl,
  }) => {
    const adminApi = createApiClient(baseUrl, readAdminToken(baseUrl))
    const projectId = await createAdminProject(adminApi, 'Task detail edit test')
    const taskCreated = await adminApi.projects.createTask({
      body: { projectId, title: 'Original title' },
    })
    const taskId = (taskCreated.body as { id: number }).id

    await adminPage.goto(`${baseUrl}/projects/${projectId}/tasks/${taskId}`)
    await expect(adminPage.getByRole('heading', { name: 'Original title', level: 1 })).toBeVisible({
      timeout: 10_000,
    })

    await adminPage.getByRole('button', { name: 'Edit', exact: true }).click()
    await adminPage.getByLabel('Task title').fill('Edited title')
    await adminPage.getByLabel('Description').fill('Edited description')
    await adminPage.getByLabel('Effort (hours of work)').fill('4')
    await adminPage.getByLabel('Deadline (optional)').fill('2099-01-01')
    await adminPage.getByRole('button', { name: 'Save Changes' }).click()

    await expect(getAlert(adminPage)).toContainText('Task updated!', { timeout: 10_000 })
    await expect(adminPage.getByRole('heading', { name: 'Edited title', level: 1 })).toBeVisible({
      timeout: 10_000,
    })
    await expect(adminPage.locator('p').filter({ hasText: 'Edited description' })).toBeVisible()
    await expect(adminPage.getByText('About 4 hours of work')).toBeVisible()
  })

  test('Admin unassigns a volunteer from an in-progress task via the task menu', async ({
    adminPage,
    baseUrl,
  }) => {
    const adminApi = createApiClient(baseUrl, readAdminToken(baseUrl))
    const projectId = await createAdminProject(adminApi, 'Task unassign test')
    const taskCreated = await adminApi.projects.createTask({
      body: { projectId, title: 'Unassign me' },
    })
    const taskId = (taskCreated.body as { id: number }).id
    const targetVolunteer = await signupApprovedVolunteer(baseUrl)

    await adminApi.projects.assignTask({
      body: { projectId, taskId, assigneeId: targetVolunteer.id },
    })

    await adminPage.goto(`${baseUrl}/projects/${projectId}#tasks`)
    await expect(adminPage.getByText('Unassign me')).toBeVisible({ timeout: 10_000 })

    const taskItem = adminPage.locator('li').filter({ hasText: 'Unassign me' })
    await taskItem.getByRole('button', { name: 'Task actions for Unassign me' }).click()
    await adminPage.getByRole('menuitem', { name: 'Unassign' }).click()

    await expect(getAlert(adminPage)).toContainText('Task unassigned!', { timeout: 10_000 })
    await expect(taskItem.getByLabel(`Assigned to ${targetVolunteer.name}`)).not.toBeVisible()
  })

  test('Posting a task comment and using its permalink scrolls to and highlights it', async ({
    adminPage,
    baseUrl,
  }) => {
    await adminPage.context().grantPermissions(['clipboard-read', 'clipboard-write'])

    const adminApi = createApiClient(baseUrl, readAdminToken(baseUrl))
    const projectId = await createAdminProject(adminApi, 'Task comment permalink test')
    const taskCreated = await adminApi.projects.createTask({
      body: { projectId, title: 'Task with a comment' },
    })
    const taskId = (taskCreated.body as { id: number }).id

    await adminPage.goto(`${baseUrl}/projects/${projectId}/tasks/${taskId}`)
    await expect(
      adminPage.getByRole('heading', { name: 'Task with a comment', level: 1 }),
    ).toBeVisible({ timeout: 10_000 })

    await adminPage.getByLabel('Add a comment').fill('This is a permalink test comment')
    await adminPage.getByRole('button', { name: 'Post Comment' }).click()

    const commentItem = adminPage
      .locator('li')
      .filter({ hasText: 'This is a permalink test comment' })
    await expect(commentItem).toBeVisible({ timeout: 10_000 })
    const commentDomId = await commentItem.getAttribute('id')
    if (!commentDomId) throw new Error('Comment element has no id attribute')

    await commentItem.getByRole('button', { name: 'Copy link to this comment' }).click()
    await expect(getAlert(adminPage)).toContainText('Link copied!', { timeout: 10_000 })
    const clipboardText = await adminPage.evaluate(() => navigator.clipboard.readText())
    expect(clipboardText).toBe(`${baseUrl}/projects/${projectId}/tasks/${taskId}#${commentDomId}`)

    // Open the permalink in a genuinely fresh page — a same-tab goto() to a URL differing
    // only by hash is treated as a fragment navigation (no real reload), which wouldn't
    // exercise the real scenario: someone opening a pasted link in a new tab.
    const permalinkPage = await adminPage.context().newPage()
    await permalinkPage.goto(clipboardText)

    // The highlight is added and then removed again ~2s later, so this polls for the class
    // directly rather than a single-point-in-time check, to catch it reliably within that window.
    async function classesOf(): Promise<string> {
      return permalinkPage.evaluate(
        (id) => document.getElementById(id)?.className ?? '',
        commentDomId,
      )
    }
    let sawHighlight = false
    for (let i = 0; i < 30 && !sawHighlight; i++) {
      if ((await classesOf()).includes('ring-2')) sawHighlight = true
      else await permalinkPage.waitForTimeout(100)
    }
    expect(sawHighlight).toBe(true)

    let highlightCleared = false
    for (let i = 0; i < 30 && !highlightCleared; i++) {
      if (!(await classesOf()).includes('ring-2')) highlightCleared = true
      else await permalinkPage.waitForTimeout(100)
    }
    expect(highlightCleared).toBe(true)

    await permalinkPage.close()
  })
})
