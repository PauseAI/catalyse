import { Page, expect } from '@playwright/test'
import { getAlert, readAdminToken } from '../fixtures'
import { createApiClient } from '../client'
import { selectFilterDropdown } from './ui'

import { PROJECT_STATUS_LABELS } from '../../lib/project-status'

const OUTCOME_LABELS: Record<string, string> = {
  successful: 'Successful',
  partial: 'Partial',
  not_completed: 'Not Completed',
  ongoing: 'Ongoing',
}

// The new-project form is tucked behind a "New Project" button once the volunteer/admin
// already has drafts — click through it if present, otherwise the form is already showing
// (either shown directly, or reached via an automatic redirect for a volunteer with no
// drafts yet). The drafts query is still loading when the page first renders, so neither
// is visible yet — wait for whichever one lands rather than checking immediately.
export async function openNewProjectForm(page: Page): Promise<void> {
  // The Button component renders as a link (not a button element) when given an href, so
  // match either role rather than assuming which one it picked.
  const newProjectButton = page
    .getByRole('link', { name: 'Propose a project' })
    .or(page.getByRole('button', { name: 'Propose a project' }))
  const titleField = page.getByLabel('Project Title')
  await Promise.race([
    newProjectButton.first().waitFor({ state: 'visible', timeout: 10_000 }),
    titleField.waitFor({ state: 'visible', timeout: 10_000 }),
  ]).catch(() => {})

  if (
    await newProjectButton
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    await newProjectButton.first().click()
  }
  await expect(titleField).toBeVisible({ timeout: 10_000 })
}

// A new proposal saves itself once a title is written, and only then has an id. Adding the first
// task works whether that has happened yet or not: it creates the draft if needed. The address
// moves to the edit page without a navigation, so wait for it, and for the task to appear.
async function addFirstTask(page: Page, taskTitle: string): Promise<number> {
  await page.locator('#new-task-title').fill(taskTitle)
  await page.getByRole('button', { name: 'Add Task' }).click()
  await page.waitForURL(/\/projects\/\d+\/edit/, { timeout: 15_000 })
  await expect(page.locator(`input[id^="task-title-"][value="${taskTitle}"]`)).toBeVisible({
    timeout: 10_000,
  })
  return Number(new URL(page.url()).pathname.split('/')[2])
}

// Waits for the draft a new proposal saves by itself, and returns its id.
async function waitForAutosavedDraft(page: Page, createPath: string): Promise<number> {
  const response = await page.waitForResponse((resp) => resp.url().includes(createPath))
  if (!response.ok()) throw new Error(`Draft save failed: ${await response.text()}`)
  const { id } = (await response.json()).json as { id: number }
  await page.waitForURL(new RegExp(`/projects/${id}/edit$`), { timeout: 15_000 })
  // The address moves without a navigation, so the page is still the proposal form; load
  // the edit page proper for whatever the test does next.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Edit Project' })).toBeVisible({
    timeout: 10_000,
  })
  return id
}

export async function proposeProject(
  baseUrl: string,
  page: Page,
  title: string,
  description: string,
  skillName?: string,
): Promise<number> {
  await page.goto(`${baseUrl}/suggest`)
  await openNewProjectForm(page)

  await page.getByLabel('Project Title').fill(title)
  await page.getByLabel('Description').fill(description)
  if (skillName) {
    await page
      .locator('label.skill-option')
      .filter({ hasText: new RegExp(`^\\s*${skillName}\\s*$`) })
      .click()
  }
  // A project has no tasks yet, so the add-task form is the only task input on the page.
  const id = await addFirstTask(page, 'Initial task')
  await page.getByRole('button', { name: 'Submit', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Submit draft for review?' })).toBeVisible({
    timeout: 10_000,
  })
  await page.getByRole('button', { name: 'Submit for Review' }).click()
  await page.waitForURL(`${baseUrl}/dashboard**`, { timeout: 15_000 })
  return id
}

export async function adminCreateProject(
  baseUrl: string,
  adminPage: Page,
  title: string,
  description: string,
): Promise<number> {
  await adminPage.goto(`${baseUrl}/admin/projects/new`)
  await openNewProjectForm(adminPage)

  await adminPage.getByLabel('Project Title').fill(title)
  await adminPage.getByLabel('Description').fill(description)
  const id = await addFirstTask(adminPage, 'Initial task')
  await adminPage.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(adminPage.getByRole('heading', { name: 'Publish this project?' })).toBeVisible({
    timeout: 10_000,
  })
  await adminPage.getByRole('dialog').getByRole('button', { name: 'Publish', exact: true }).click()

  await adminPage.waitForURL(`${baseUrl}/projects/${id}`, { timeout: 15_000 })
  // Wait for project content to render — this ensures auth has completed before we return,
  // so callers don't interrupt the in-flight /api/auth/me fetch and accidentally clear the token.
  await expect(adminPage.locator('#projectContent')).toBeVisible({ timeout: 10_000 })
  return id
}

// API-equivalent of adminCreateProject, for tests that need "a published org project exists"
// purely as setup for some other assertion and don't need to re-prove the create+publish UI
// flow itself — that's already covered end-to-end by 06-project-lifecycle.spec.ts. Produces
// the same resulting state (status ready, isSeekingHelp true, one task) without the form
// fill / Add Task / Publish / confirm-dialog round trip.
export async function adminCreateProjectViaApi(
  baseUrl: string,
  title: string,
  description: string,
): Promise<number> {
  const adminApi = createApiClient(baseUrl, readAdminToken(baseUrl))
  const created = await adminApi.admin.projects.create({
    body: {
      title,
      description,
      projectType: null,
      estimatedDuration: null,
      timeCommitmentHoursPerWeek: null,
      urgency: 'medium',
      collaborationLink: null,
      country: null,
      localGroup: null,
      remoteEligibility: 'NONE',
      isSeekingHelp: true,
      skillIds: [],
      skillRequiredMap: {},
      tasks: [{ title: 'Initial task' }],
    },
  })
  if (created.status !== 200)
    throw new Error(`Project creation failed: ${JSON.stringify(created.body)}`)
  return (created.body as { id: number }).id
}

export async function adminSaveProjectDraft(
  baseUrl: string,
  adminPage: Page,
  title: string,
): Promise<number> {
  await adminPage.goto(`${baseUrl}/admin/projects/new`)
  await openNewProjectForm(adminPage)

  const saved = waitForAutosavedDraft(adminPage, '/api/rpc/admin/projects/create')
  await adminPage.getByLabel('Project Title').fill(title)
  return saved
}

export async function volunteerSaveProjectDraft(
  baseUrl: string,
  page: Page,
  title: string,
): Promise<number> {
  await page.goto(`${baseUrl}/suggest`)
  await openNewProjectForm(page)

  const saved = waitForAutosavedDraft(page, '/api/rpc/projects/create')
  await page.getByLabel('Project Title').fill(title)
  return saved
}

export async function addTaskFromEditPage(
  baseUrl: string,
  page: Page,
  projectId: number,
  taskTitle: string,
): Promise<void> {
  if (!page.url().includes(`/projects/${projectId}/edit`)) {
    await page.goto(`${baseUrl}/projects/${projectId}/edit`)
  }
  await expect(page.getByRole('heading', { name: 'Edit Project' })).toBeVisible({
    timeout: 10_000,
  })
  // Existing tasks are also labeled "Task title" — target the add-task form's stable id.
  await page.locator('#new-task-title').fill(taskTitle)
  await page.getByRole('button', { name: 'Add Task' }).click()
  // Existing tasks render as editable inputs, so the title is a value, not a text node. The
  // add-task form still holds the title until the create succeeds, so exclude it.
  await expect(page.locator(`input[id^="task-title-"][value="${taskTitle}"]`)).toBeVisible({
    timeout: 10_000,
  })
}

// For a volunteer's own draft: submits it into the review queue.
export async function publishDraftFromEditPage(
  baseUrl: string,
  page: Page,
  projectId: number,
): Promise<void> {
  if (!page.url().includes(`/projects/${projectId}/edit`)) {
    await page.goto(`${baseUrl}/projects/${projectId}/edit`)
  }
  await page.getByRole('button', { name: 'Submit', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Submit draft for review?' })).toBeVisible({
    timeout: 10_000,
  })
  await page.getByRole('button', { name: 'Submit for Review' }).click()
}

// For an org-proposed draft: publishes it live, skipping review entirely.
export async function publishOrgDraftFromEditPage(
  baseUrl: string,
  page: Page,
  projectId: number,
): Promise<void> {
  if (!page.url().includes(`/projects/${projectId}/edit`)) {
    await page.goto(`${baseUrl}/projects/${projectId}/edit`)
  }
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Publish this project?' })).toBeVisible({
    timeout: 10_000,
  })
  await page.getByRole('dialog').getByRole('button', { name: 'Publish', exact: true }).click()
}

export async function deleteDraftFromEditPage(
  baseUrl: string,
  page: Page,
  projectId: number,
): Promise<void> {
  if (!page.url().includes(`/projects/${projectId}/edit`)) {
    await page.goto(`${baseUrl}/projects/${projectId}/edit`)
  }
  await page.getByRole('button', { name: 'Delete Draft', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Delete this draft?' })).toBeVisible({
    timeout: 10_000,
  })
  await page.getByRole('dialog').getByRole('button', { name: 'Delete Draft' }).click()
}

export async function adminApproveProject(
  baseUrl: string,
  adminPage: Page,
  projectTitle: string,
): Promise<void> {
  await adminPage.goto(`${baseUrl}/admin/triage`)

  const projectCard = adminPage.locator('.card').filter({ hasText: projectTitle })
  await expect(projectCard).toBeVisible({ timeout: 10_000 })
  await projectCard.getByRole('link', { name: 'Review' }).click()

  await expect(adminPage.getByRole('heading', { level: 2, name: 'Review Project' })).toBeVisible({
    timeout: 10_000,
  })
  await adminPage.getByRole('button', { name: 'Submit Review' }).click()

  await expect(
    adminPage.getByRole('heading', { level: 2, name: 'Review Project' }),
  ).not.toBeVisible({ timeout: 10_000 })
}

export async function adminRecordOutcome(
  baseUrl: string,
  adminPage: Page,
  projectId: number,
  outcome: string,
  notes: string,
): Promise<void> {
  await adminPage.goto(`${baseUrl}/projects/${projectId}`)
  await expect(
    adminPage.getByRole('heading', { level: 2, name: 'Record Project Outcome' }),
  ).toBeVisible({ timeout: 10_000 })

  await selectFilterDropdown(adminPage, 'Outcome', OUTCOME_LABELS[outcome] ?? outcome)
  await adminPage.getByLabel('Outcome Notes').fill(notes)
  await adminPage.getByRole('button', { name: 'Record Outcome' }).click()
  await expect(getAlert(adminPage)).toBeVisible({ timeout: 10_000 })
}

export async function transferProjectOwnership(
  baseUrl: string,
  adminPage: Page,
  projectId: number,
  volunteerName: string,
): Promise<void> {
  // Avoid reloading if already on the project page — a reload re-triggers auth
  // checks that can flakily redirect to login under parallel test load.
  if (!adminPage.url().includes(`/projects/${projectId}`)) {
    await adminPage.goto(`${baseUrl}/projects/${projectId}`)
  }
  await adminPage.getByRole('button', { name: 'Ownership actions' }).click()
  await expect(
    adminPage.getByRole('heading', { level: 3, name: 'Transfer Ownership' }),
  ).toBeVisible({ timeout: 10_000 })
  await selectFilterDropdown(adminPage, 'Transfer to', volunteerName)
  await adminPage.getByRole('menu').getByRole('button', { name: 'Transfer', exact: true }).click()
  await adminPage.getByRole('dialog').getByRole('button', { name: 'Transfer', exact: true }).click()
  await expect(getAlert(adminPage)).toBeVisible({ timeout: 10_000 })
}

export async function removeProjectOwner(
  baseUrl: string,
  adminPage: Page,
  projectId: number,
): Promise<void> {
  if (!adminPage.url().includes(`/projects/${projectId}`)) {
    await adminPage.goto(`${baseUrl}/projects/${projectId}`)
  }
  await adminPage.getByRole('button', { name: 'Ownership actions' }).click()
  await adminPage.getByRole('menuitem', { name: 'Remove ownership' }).click()
  await adminPage.getByRole('dialog').getByRole('button', { name: 'Remove ownership' }).click()
  await expect(getAlert(adminPage)).toBeVisible({ timeout: 10_000 })
}

export async function setProjectStatus(
  baseUrl: string,
  page: Page,
  projectId: number,
  status: string,
): Promise<void> {
  await page.goto(`${baseUrl}/projects/${projectId}`)
  await expect(page.getByRole('heading', { name: 'Status', exact: true })).toBeVisible({
    timeout: 10_000,
  })

  await selectFilterDropdown(page, 'project status', PROJECT_STATUS_LABELS[status] ?? status)
  await page.getByRole('button', { name: 'Confirm' }).click()
  await expect(getAlert(page)).toBeVisible({ timeout: 10_000 })
}

/** Asks to join the project on the open page, as a helper or its lead, with an optional note. */
export async function joinProject(
  page: Page,
  opts: { lead?: boolean; message?: string } = {},
): Promise<void> {
  await page.getByRole('button', { name: 'Join this project' }).click()
  const dialog = page.getByRole('dialog', { name: 'Join this project' })
  await expect(dialog.getByRole('radio', { name: 'Help out on the project' })).toBeChecked({
    timeout: 10_000,
  })
  if (opts.lead) await dialog.getByRole('radio', { name: 'Lead the project' }).click()
  if (opts.message) await dialog.getByLabel('Message (optional)').fill(opts.message)
  await dialog.getByRole('button', { name: 'Send request' }).click()
}
