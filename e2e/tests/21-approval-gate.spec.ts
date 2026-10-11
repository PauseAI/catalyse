import { test, expect } from '../fixtures'
import {
  readAdminToken,
  createPendingVolunteer,
  createApprovedVolunteer,
  dismissCookieConsentScript,
} from '../fixtures'
import { createApiClient } from '../client'
import { fake } from '../fake'

async function createAdminProject(
  adminApi: ReturnType<typeof createApiClient>,
  description: string,
  opts?: { isSeekingHelp?: boolean; tasks?: { title: string }[] },
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
      isSeekingHelp: opts?.isSeekingHelp ?? true,
      tasks: opts?.tasks ?? [{ title: 'Seed task' }],
    },
  })
  return (created.body as { id: number }).id
}

test.describe('Approval Gate', () => {
  test('A pending volunteer sent away from Projects is told why', async ({ browser, baseUrl }) => {
    const pending = await createPendingVolunteer(baseUrl)
    const ctx = await browser.newContext()
    await ctx.addInitScript((token: string) => {
      localStorage.setItem('authToken', token)
    }, pending.token)
    await ctx.addInitScript(dismissCookieConsentScript)
    try {
      const page = await ctx.newPage()
      await page.goto(`${baseUrl}/projects`)
      await page.waitForURL(/\/dashboard/, { timeout: 10_000 })
      await expect(
        page.getByText(
          "Your account is pending approval. You'll be able to browse and join projects",
        ),
      ).toBeVisible({ timeout: 10_000 })
    } finally {
      await ctx.close()
    }
  })

  test('Unapproved volunteer cannot propose a project', async ({ baseUrl }) => {
    const pending = await createPendingVolunteer(baseUrl)
    const api = createApiClient(baseUrl, pending.token)

    const result = await api.projects.create({
      body: {
        title: fake.projectTitle(),
        description: 'Should be blocked',
        tasks: [{ title: 'Initial task' }],
      },
    })

    expect(result.status).toBe(403)
  })

  test('Unapproved volunteer cannot express interest in a project', async ({ baseUrl }) => {
    const adminApi = createApiClient(baseUrl, readAdminToken(baseUrl))
    const projectId = await createAdminProject(adminApi, 'Interest gate test', {
      tasks: [{ title: 'Task' }],
    })

    const pending = await createPendingVolunteer(baseUrl)
    const api = createApiClient(baseUrl, pending.token)

    const result = await api.projects.expressInterest({
      body: { projectId, interestType: 'want_to_contribute' },
    })

    expect(result.status).toBe(403)
  })

  test('Unapproved volunteer cannot self-claim an open task', async ({ baseUrl }) => {
    const adminApi = createApiClient(baseUrl, readAdminToken(baseUrl))
    const projectId = await createAdminProject(adminApi, 'Task self-claim gate test')
    const taskCreated = await adminApi.projects.createTask({
      body: { projectId, title: 'Open task' },
    })
    const taskId = (taskCreated.body as { id: number }).id

    const pending = await createPendingVolunteer(baseUrl)
    const api = createApiClient(baseUrl, pending.token)

    const result = await api.projects.updateTask({
      body: {
        projectId,
        taskId,
        data: { assigneeId: pending.id },
      },
    })

    expect(result.status).toBe(403)
  })

  test('Unapproved volunteer cannot self-claim a Quick Task', async ({ baseUrl }) => {
    const adminApi = createApiClient(baseUrl, readAdminToken(baseUrl))
    const taskCreated = await adminApi.quickTasks.create({
      body: { title: fake.quickTaskTitle(), description: 'Quick Task self-claim gate test' },
    })
    const taskId = (taskCreated.body as { id: number }).id

    const pending = await createPendingVolunteer(baseUrl)
    const api = createApiClient(baseUrl, pending.token)

    const result = await api.quickTasks.claim({ body: { id: taskId } })

    expect(result.status).toBe(403)
  })

  test('Unapproved volunteer cannot browse or view an open Quick Task', async ({ baseUrl }) => {
    const adminApi = createApiClient(baseUrl, readAdminToken(baseUrl))
    const taskCreated = await adminApi.quickTasks.create({
      body: { title: fake.quickTaskTitle(), description: 'Quick Task view gate test' },
    })
    const taskId = (taskCreated.body as { id: number }).id

    const pending = await createPendingVolunteer(baseUrl)
    const api = createApiClient(baseUrl, pending.token)

    const availableResult = await api.quickTasks.available()
    expect(availableResult.status).toBe(403)

    const getResult = await api.quickTasks.get({ body: { id: taskId } })
    expect(getResult.status).toBe(403)

    // Even the lower-level, publicProcedure comment-thread endpoint must not leak it —
    // this is the endpoint canViewWorkItem's open-and-unclaimed carve-out actually gates.
    const commentsResult = await api.workItemComments.list({ body: { workItemId: taskId } })
    expect(commentsResult.status).toBe(404)
  })

  test('Unapproved volunteer cannot send a message', async ({ baseUrl }) => {
    const recipient = await createApprovedVolunteer(baseUrl)
    const pending = await createPendingVolunteer(baseUrl)
    const api = createApiClient(baseUrl, pending.token)

    const result = await api.messages.send({
      body: {
        recipientId: recipient.id,
        subject: 'Hello',
        message: 'Should be blocked',
      },
    })

    expect(result.status).toBe(403)
  })

  test('Unapproved volunteer cannot submit a local group suggestion', async ({ baseUrl }) => {
    const pending = await createPendingVolunteer(baseUrl)
    const api = createApiClient(baseUrl, pending.token)

    const result = await api.localGroupSuggestions.create({
      body: { name: fake.personName(), country: 'Canada' },
    })

    expect(result.status).toBe(403)
  })

  test('Admin cannot assign a project to an unapproved volunteer', async ({ baseUrl }) => {
    const adminApi = createApiClient(baseUrl, readAdminToken(baseUrl))
    const projectId = await createAdminProject(adminApi, 'Project assign gate test')
    const pending = await createPendingVolunteer(baseUrl)

    const result = await adminApi.projects.assign({
      body: { projectId, volunteerId: pending.id },
    })

    expect(result.status).toBe(400)
  })

  test('Admin cannot assign a task to an unapproved volunteer', async ({ baseUrl }) => {
    const adminApi = createApiClient(baseUrl, readAdminToken(baseUrl))
    const projectId = await createAdminProject(adminApi, 'Task assign gate test')
    const taskCreated = await adminApi.projects.createTask({
      body: { projectId, title: 'Assignable task' },
    })
    const taskId = (taskCreated.body as { id: number }).id
    const pending = await createPendingVolunteer(baseUrl)

    const result = await adminApi.projects.assignTask({
      body: { projectId, taskId, assigneeId: pending.id },
    })

    expect(result.status).toBe(400)
  })

  test('Admin cannot assign a quick task to an unapproved volunteer', async ({ baseUrl }) => {
    const adminApi = createApiClient(baseUrl, readAdminToken(baseUrl))
    const taskCreated = await adminApi.quickTasks.create({
      body: { title: fake.quickTaskTitle(), description: 'Quick task assign gate test' },
    })
    const taskId = (taskCreated.body as { id: number }).id
    const pending = await createPendingVolunteer(baseUrl)

    const result = await adminApi.quickTasks.assign({
      body: { id: taskId, volunteerId: pending.id },
    })

    expect(result.status).toBe(400)
  })

  test('Unapproved volunteers do not appear in the volunteer directory', async ({ baseUrl }) => {
    const pending = await createPendingVolunteer(baseUrl)
    const adminApi = createApiClient(baseUrl, readAdminToken(baseUrl))

    const result = await adminApi.volunteers.list({ body: { limit: 100 } })
    const ids = (result.body as { volunteers: { id: number }[] }).volunteers.map((v) => v.id)

    expect(ids).not.toContain(pending.id)
  })
})
