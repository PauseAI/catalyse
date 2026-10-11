import { test, expect, readAdminToken } from '../fixtures'
import { fake } from '../fake'
import { createApiClient } from '../client'
import type { RouterClient } from '@orpc/server'
import type { appRouter } from '../../server/router'

type Api = RouterClient<typeof appRouter>

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

async function makeProject(api: Api, opts: { startDate?: Date } = {}): Promise<number> {
  const created = await api.admin.projects.create({
    body: {
      title: fake.projectTitle(),
      description: 'Import/export fixture',
      projectType: null,
      estimatedDuration: null,
      timeCommitmentHoursPerWeek: null,
      urgency: 'medium',
      collaborationLink: null,
      country: null,
      localGroup: null,
      remoteEligibility: 'NONE',
      isSeekingHelp: false,
      skillIds: [],
      skillRequiredMap: {},
      startDate: opts.startDate ?? null,
      tasks: [{ title: 'Seed task' }],
    },
  })
  expect(created.status, JSON.stringify(created.body)).toBe(200)
  return (created.body as { id: number }).id
}

async function addTask(
  api: Api,
  projectId: number,
  opts: { title?: string; startDate?: Date | null; durationDays?: number | null } = {},
): Promise<number> {
  const res = await api.projects.createTask({
    body: {
      projectId,
      title: opts.title ?? fake.quickTaskTitle(),
      startDate: opts.startDate ?? null,
      durationDays: opts.durationDays ?? null,
    },
  })
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return (res.body as { id: number }).id
}

type ExportPayload = {
  _meta: { baseHash: string }
  project: { id: number; title: string; description: string | null; status: string }
  tasks: Array<{
    id?: number
    ref?: string
    title: string
    description: string | null
    status: string
    assigneeEmail: string | null
    deadline: string | null
    startDate: string | null
    durationDays: number | null
    featuredAsQuickTask: boolean
    dependsOn: Array<{ on: number | string; lagDays?: number }>
  }>
}

async function exportProject(api: Api, projectId: number): Promise<ExportPayload> {
  const res = await api.projects.exportPlan({ body: { projectId } })
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body as ExportPayload
}

async function listTasks(api: Api, projectId: number) {
  const res = await api.projects.listTasks({ body: { projectId } })
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body as {
    tasks: { id: number; title: string; durationDays: number | null }[]
    dependencies: { predecessorId: number; successorId: number; lagDays: number }[]
  }
}

test.describe('Project import / export', () => {
  test('the import page shows the diff and applies it after confirming a deletion', async ({
    baseUrl,
    adminPage,
  }) => {
    const api = createApiClient(baseUrl, readAdminToken(baseUrl))
    const projectId = await makeProject(api, { startDate: day('2026-12-01') })
    await addTask(api, projectId, { title: 'Stays' })
    const drop = await addTask(api, projectId, { title: 'Goes away' })

    const file = await exportProject(api, projectId)
    file.tasks = file.tasks.filter((t) => t.id !== drop)

    await adminPage.goto(`${baseUrl}/projects/${projectId}/import`)
    await adminPage.getByLabel('Export file').setInputFiles({
      name: 'plan.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(file)),
    })

    await expect(adminPage.getByRole('heading', { name: /Tasks to delete \(1\)/ })).toBeVisible()

    // The deletion is the only change, so nothing to apply until its box is ticked.
    const confirmButton = adminPage.getByRole('button', { name: 'Confirm import' })
    await expect(confirmButton).toBeDisabled()
    await adminPage.getByText('Delete Goes away').click()
    await expect(confirmButton).toBeEnabled()

    await confirmButton.click()
    await adminPage.getByRole('button', { name: 'Apply changes' }).click()

    await expect(adminPage).toHaveURL(`${baseUrl}/projects/${projectId}`)

    const { tasks } = await listTasks(api, projectId)
    expect(tasks.map((t) => t.title)).not.toContain('Goes away')
  })

  test('the import page accepts pasted JSON', async ({ baseUrl, adminPage }) => {
    const api = createApiClient(baseUrl, readAdminToken(baseUrl))
    const projectId = await makeProject(api, { startDate: day('2027-01-05') })

    const file = await exportProject(api, projectId)
    file.tasks.push({
      title: 'Pasted task',
      description: null,
      status: 'open',
      assigneeEmail: null,
      deadline: null,
      startDate: '2027-01-06',
      durationDays: 2,
      featuredAsQuickTask: false,
      dependsOn: [],
    })

    await adminPage.goto(`${baseUrl}/projects/${projectId}/import`)
    await adminPage.getByLabel('Paste export JSON').fill(JSON.stringify(file))
    await adminPage.getByRole('button', { name: 'Preview pasted JSON' }).click()

    await expect(adminPage.getByRole('heading', { name: /New tasks \(1\)/ })).toBeVisible()
    await adminPage.getByRole('button', { name: 'Confirm import' }).click()
    await adminPage.getByRole('button', { name: 'Apply changes' }).click()

    await expect(adminPage).toHaveURL(`${baseUrl}/projects/${projectId}`)
    const { tasks } = await listTasks(api, projectId)
    expect(tasks.map((t) => t.title)).toContain('Pasted task')
  })

  test('the import page offers the authoring rules for an AI assistant', async ({
    baseUrl,
    adminPage,
  }) => {
    const api = createApiClient(baseUrl, readAdminToken(baseUrl))
    const projectId = await makeProject(api, { startDate: day('2027-02-01') })

    await adminPage.goto(`${baseUrl}/projects/${projectId}/import`)
    await expect(
      adminPage.getByRole('heading', { name: 'Editing this file with an AI assistant' }),
    ).toBeVisible()

    // Collapsed by default; most imports are a round trip that needs no instructions.
    await expect(adminPage.getByText('Identity — the rule most often got wrong')).toHaveCount(0)
    await adminPage.getByRole('button', { name: 'Read' }).click()
    await expect(adminPage.getByText('Identity — the rule most often got wrong')).toBeVisible()
    await expect(adminPage.getByRole('button', { name: 'Copy instructions' })).toBeVisible()
  })

  test('the JSON Schema is served, and describes the file the importer accepts', async ({
    baseUrl,
    request,
  }) => {
    const res = await request.get(`${baseUrl}/api/project-import/schema`)
    expect(res.status()).toBe(200)

    const schema = (await res.json()) as {
      type: string
      required?: string[]
      properties: Record<string, unknown>
    }
    expect(schema.type).toBe('object')
    expect(schema.required).toEqual(expect.arrayContaining(['project', 'tasks']))
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining(['_meta', 'project', 'tasks']),
    )
  })

  test('the sidebar opens export, instructions and import in one modal', async ({
    baseUrl,
    adminPage,
  }) => {
    const api = createApiClient(baseUrl, readAdminToken(baseUrl))
    const projectId = await makeProject(api, { startDate: day('2027-04-01') })

    await adminPage.goto(`${baseUrl}/projects/${projectId}`)
    await adminPage.getByRole('button', { name: 'Export / Import' }).click()

    const modal = adminPage.getByRole('dialog')
    await expect(modal.getByRole('heading', { name: 'Export and import' })).toBeVisible()
    // All three steps of the round trip, without leaving the project.
    await expect(modal.getByRole('button', { name: 'Download export' })).toBeVisible()
    await expect(
      modal.getByRole('heading', { name: 'Editing this file with an AI assistant' }),
    ).toBeVisible()
    await expect(modal.getByLabel('Paste export JSON')).toBeVisible()
  })

  test('an import can be applied from the modal without leaving the project', async ({
    baseUrl,
    adminPage,
  }) => {
    const api = createApiClient(baseUrl, readAdminToken(baseUrl))
    const projectId = await makeProject(api, { startDate: day('2027-04-15') })
    await addTask(api, projectId, { title: 'Existing' })

    const file = await exportProject(api, projectId)
    file.tasks.push({
      title: 'Added from the modal',
      description: null,
      status: 'open',
      assigneeEmail: null,
      deadline: null,
      startDate: '2027-04-20',
      durationDays: 2,
      featuredAsQuickTask: false,
      dependsOn: [],
    })

    await adminPage.goto(`${baseUrl}/projects/${projectId}`)
    await adminPage.getByRole('button', { name: 'Export / Import' }).click()

    const modal = adminPage.getByRole('dialog')
    await modal.getByLabel('Paste export JSON').fill(JSON.stringify(file))
    await modal.getByRole('button', { name: 'Preview pasted JSON' }).click()
    await expect(modal.getByRole('heading', { name: /New tasks \(1\)/ })).toBeVisible()

    await modal.getByRole('button', { name: 'Confirm import' }).click()
    await adminPage.getByRole('button', { name: 'Apply changes' }).click()

    // The modal closes onto the project rather than navigating away.
    await expect(adminPage.getByRole('dialog')).toHaveCount(0)
    await expect(adminPage).toHaveURL(`${baseUrl}/projects/${projectId}`)
    const { tasks } = await listTasks(api, projectId)
    expect(tasks.map((t) => t.title)).toContain('Added from the modal')
  })

  test('an export points back at its own documentation', async ({ baseUrl }) => {
    const api = createApiClient(baseUrl, readAdminToken(baseUrl))
    const projectId = await makeProject(api, { startDate: day('2027-03-01') })

    const file = await exportProject(api, projectId)
    const meta = file._meta as { docs?: string; schema?: string }
    // APP_URL is set in the e2e environment, so both links are present and absolute.
    expect(meta.docs).toContain(`/projects/${projectId}/import`)
    expect(meta.schema).toContain('/api/project-import/schema')

    // The top-level key is the one editors key off, and it must survive a round trip.
    expect((file as { $schema?: string }).$schema).toContain('/api/project-import/schema')
    const preview = await api.projects.previewImport({
      body: { projectId, file: JSON.stringify(file) },
    })
    expect(preview.status, JSON.stringify(preview.body)).toBe(200)
    const diff = preview.body as { tasks: { op: string }[]; project: { op: string } }
    expect(diff.project.op).toBe('noop')
    expect(diff.tasks.every((t) => t.op === 'noop')).toBe(true)
  })
})
