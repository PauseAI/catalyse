import { test, expect, getAlert, readAdminToken } from '../fixtures'
import { createApiClient } from '../client'
import { fake } from '../fake'

type CreatedProject = { id: number; title: string }

async function adminCreateCountryProjectViaApi(
  baseUrl: string,
  title: string,
): Promise<CreatedProject> {
  const adminApi = createApiClient(baseUrl, readAdminToken(baseUrl))
  const created = await adminApi.admin.projects.create({
    body: {
      title,
      description: 'A repeatable program',
      projectType: null,
      estimatedDuration: null,
      timeCommitmentHoursPerWeek: null,
      urgency: 'medium',
      collaborationLink: 'https://example.test/doc',
      country: 'UK',
      localGroup: null,
      remoteEligibility: 'NONE',
      isSeekingHelp: true,
      skillIds: [],
      skillRequiredMap: {},
      tasks: [{ title: 'Initial task' }],
    },
  })
  if (created.status !== 200) {
    throw new Error(`Project creation failed: ${JSON.stringify(created.body)}`)
  }
  const { id } = created.body as { id: number }
  return { id, title }
}

async function adminSaveAsTemplateViaApi(
  baseUrl: string,
  projectId: number,
  title: string,
): Promise<number> {
  const adminApi = createApiClient(baseUrl, readAdminToken(baseUrl))
  const result = await adminApi.templates.saveAsTemplate({
    body: { projectId, title, description: null },
  })
  if (result.status !== 200) {
    throw new Error(`saveAsTemplate failed: ${JSON.stringify(result.body)}`)
  }
  return (result.body as { id: number }).id
}

async function instantiateViaApi(
  baseUrl: string,
  token: string | null,
  templateId: number,
): Promise<{ status: number; body: unknown }> {
  const api = createApiClient(baseUrl, token)
  return api.templates.instantiate({ body: { templateId } })
}

// Cleans up after tests so leftover drafts don't accumulate across re-runs sharing this same
// admin account, since the worker database is migrated, not recreated, between separate test
// invocations.
async function adminDeleteDraftViaApi(baseUrl: string, id: number): Promise<void> {
  const adminApi = createApiClient(baseUrl, readAdminToken(baseUrl))
  await adminApi.projects.deleteDraft({ body: { id } })
}

async function adminDrainOwnDraftsViaApi(baseUrl: string): Promise<void> {
  const adminApi = createApiClient(baseUrl, readAdminToken(baseUrl))
  const result = await adminApi.projects.myDrafts()
  if (result.status !== 200) return
  const drafts = result.body as Array<{ id: number }>
  for (const d of drafts) await adminDeleteDraftViaApi(baseUrl, d.id)
}

test.describe('Project templates', () => {
  test.beforeEach(async ({ baseUrl }) => {
    await adminDrainOwnDraftsViaApi(baseUrl)
  })

  test('Admin saves a project as a template, and it appears in the library', async ({
    adminPage,
    baseUrl,
  }) => {
    const sourceTitle = fake.projectTitle()
    const source = await adminCreateCountryProjectViaApi(baseUrl, sourceTitle)

    await adminPage.goto(`${baseUrl}/projects/${source.id}`)
    await adminPage.getByRole('button', { name: 'Save as template' }).click()
    const templateTitle = `${sourceTitle} template`
    const dialog = adminPage.getByRole('dialog')
    await dialog.getByLabel('Template title').fill(templateTitle)
    await dialog.getByRole('button', { name: 'Save template' }).click()
    await expect(getAlert(adminPage)).toContainText('Saved as template', { timeout: 10_000 })

    await adminPage.goto(`${baseUrl}/templates`)
    // Scoped to this template's own card — other templates from other tests sharing this
    // worker's database also say "Previously: UK", so an unscoped lookup is ambiguous.
    const templateCard = adminPage.locator('.bg-surface').filter({ hasText: templateTitle })
    await expect(templateCard).toBeVisible({ timeout: 10_000 })
    // The source project's country is shown as reference text, not applied anywhere yet.
    await expect(templateCard.getByText('Previously: UK')).toBeVisible()
  })

  test('Admin uses a template from the library; the new draft lands straight on its edit page with location, team, collaboration link and start date all blank', async ({
    adminPage,
    baseUrl,
  }) => {
    const source = await adminCreateCountryProjectViaApi(baseUrl, fake.projectTitle())
    const templateTitle = fake.projectTitle()
    await adminSaveAsTemplateViaApi(baseUrl, source.id, templateTitle)

    await adminPage.goto(`${baseUrl}/templates`)
    const templateCard = adminPage.locator('.bg-surface').filter({ hasText: templateTitle })
    const [response] = await Promise.all([
      adminPage.waitForResponse((resp) => resp.url().includes('/api/rpc/templates/instantiate')),
      templateCard.getByRole('button', { name: 'Use template' }).click(),
    ])
    if (!response.ok()) throw new Error(`instantiate failed: ${await response.text()}`)
    const { id: newProjectId } = (await response.json()).json as { id: number }

    // No wizard — lands directly on the new draft's own edit page.
    await adminPage.waitForURL(`${baseUrl}/projects/${newProjectId}/edit`, { timeout: 15_000 })
    await expect(adminPage.getByRole('heading', { name: 'Edit Project' })).toBeVisible({
      timeout: 10_000,
    })
    // Title defaults to the template's own title, with a hint to make it group-specific.
    await expect(adminPage.getByLabel('Project Title')).toHaveValue(templateTitle)
    await expect(adminPage.getByText(/adjust the title/i)).toBeVisible()

    const adminApi = createApiClient(baseUrl, readAdminToken(baseUrl))
    const projectResult = await adminApi.projects.getById({ body: { id: newProjectId } })
    if (projectResult.status !== 200) throw new Error('could not load new project')
    const p = projectResult.body as {
      country: string | null
      localGroup: string | null
      teamId: number | null
      collaborationLink: string | null
    }
    expect(p.country).toBeNull()
    expect(p.localGroup).toBeNull()
    expect(p.teamId).toBeNull()
    expect(p.collaborationLink).toBeNull()

    await adminDeleteDraftViaApi(baseUrl, newProjectId)
  })

  test('A template-originated draft publishes directly, skipping the admin triage queue', async ({
    adminPage,
    baseUrl,
  }) => {
    const source = await adminCreateCountryProjectViaApi(baseUrl, fake.projectTitle())
    const templateId = await adminSaveAsTemplateViaApi(baseUrl, source.id, fake.projectTitle())
    const created = await instantiateViaApi(baseUrl, readAdminToken(baseUrl), templateId)
    if (created.status !== 200) throw new Error(`instantiate failed: ${JSON.stringify(created)}`)
    const { id: newProjectId, title: newTitle } = created.body as { id: number; title: string }

    // Not in the volunteer-drafts triage queue, even while still a draft — it self-publishes.
    await adminPage.goto(`${baseUrl}/admin/triage`)
    // Wait for the page's own auth check to settle before navigating away again — leaving too
    // fast can interrupt the in-flight /api/auth/me fetch and clear the session token (see the
    // same caution in e2e/actions/projects.ts:adminCreateProject).
    await expect(adminPage.getByRole('heading', { name: 'Project Triage' })).toBeVisible({
      timeout: 10_000,
    })
    await expect(adminPage.locator('.card').filter({ hasText: newTitle })).not.toBeVisible({
      timeout: 5_000,
    })

    await adminPage.goto(`${baseUrl}/projects/${newProjectId}/edit`)
    // Copy matches the org-draft self-publish path, not "submit for review".
    await adminPage.getByRole('button', { name: 'Publish', exact: true }).click()
    const publishModal = adminPage.getByRole('dialog')
    await expect(publishModal.getByRole('heading', { name: 'Publish this project?' })).toBeVisible({
      timeout: 10_000,
    })
    await publishModal.getByRole('button', { name: 'Publish', exact: true }).click()

    await expect(getAlert(adminPage)).toContainText('Project published', { timeout: 10_000 })
    await adminPage.waitForURL(`${baseUrl}/projects/${newProjectId}`, { timeout: 10_000 })
    // Instantiating a template makes the admin its owner, so it goes live as In Progress.
    await expect(adminPage.getByLabel('project status')).toContainText('In Progress', {
      timeout: 10_000,
    })
  })
})

// The `volunteer` fixture doesn't expose an auth token directly — log in to get one.
