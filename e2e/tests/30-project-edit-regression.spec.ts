import { test, expect, getAlert } from '../fixtures'
import { proposeProject, adminApproveProject, transferProjectOwnership } from '../actions/projects'
import { Page } from '@playwright/test'
import { fake } from '../fake'

// Regression coverage for bug 12 (checkbox-only edit wiping the save) and bug 13 (tasks wiped
// on unrelated project edits). See TODO #141/#143/#144.

async function setupOwnedProject(
  baseUrl: string,
  adminPage: Page,
  volunteer: { page: Page; name: string },
): Promise<number> {
  const title = fake.projectTitle()
  const projectId = await proposeProject(
    baseUrl,
    volunteer.page,
    title,
    'Setup description for edit regression tests',
  )
  await adminApproveProject(baseUrl, adminPage, title)
  await transferProjectOwnership(baseUrl, adminPage, projectId, volunteer.name)
  return projectId
}

test.describe('Project Edit Regressions', () => {
  test('Toggling only the seeking-help checkbox persists on reload (bug 12)', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    const projectId = await setupOwnedProject(baseUrl, adminPage, volunteer)

    await volunteer.page.goto(`${baseUrl}/projects/${projectId}/edit`)
    await expect(volunteer.page.getByRole('heading', { name: 'Edit Project' })).toBeVisible({
      timeout: 10_000,
    })

    const checkbox = volunteer.page.getByLabel('Help / contributors')
    // The form renders disabled until the project's fields are seeded into it.
    await expect(checkbox).toBeEnabled({ timeout: 10_000 })
    const wasChecked = await checkbox.isChecked()

    // The input is sr-only behind a decorative box, so click the label text instead: a
    // forced click on the input lands on whatever the still-loading form has shifted under
    // that point, while a plain click waits for the layout to settle. Fields autosave on
    // change, so there's no separate save step.
    await Promise.all([
      volunteer.page.waitForResponse((resp) => resp.url().includes('/api/rpc/projects/update')),
      volunteer.page.getByText('Help / contributors').click(),
    ])
    await expect(checkbox).toBeChecked({ checked: !wasChecked })
    await volunteer.page.goto(`${baseUrl}/projects/${projectId}`)

    const badge = volunteer.page.getByText('• Seeking help')
    if (wasChecked) {
      await expect(badge).toBeHidden({ timeout: 10_000 })
    } else {
      await expect(badge).toBeVisible({ timeout: 10_000 })
    }

    // Reload to rule out stale client state masking a save that didn't actually persist.
    await volunteer.page.reload()
    if (wasChecked) {
      await expect(badge).toBeHidden({ timeout: 10_000 })
    } else {
      await expect(badge).toBeVisible({ timeout: 10_000 })
    }
  })

  test('Tasks survive an unrelated project field edit (bug 13)', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    const projectId = await setupOwnedProject(baseUrl, adminPage, volunteer)
    const taskTitle = `regression task ${fake.quickTaskTitle()}`

    // Add a task on the project detail page.
    await volunteer.page.goto(`${baseUrl}/projects/${projectId}#tasks`)
    await expect(volunteer.page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })
    await volunteer.page.getByRole('button', { name: 'Add task' }).click()
    await volunteer.page.getByLabel('Task title').fill(taskTitle)
    await volunteer.page.getByRole('button', { name: 'Create task' }).click()
    await expect(getAlert(volunteer.page)).toContainText('Task added!', { timeout: 10_000 })
    await expect(volunteer.page.getByText(taskTitle)).toBeVisible({ timeout: 10_000 })

    // Edit and save an unrelated project field.
    const newDescription = 'Updated description that should not touch the task list'
    await volunteer.page.goto(`${baseUrl}/projects/${projectId}/edit`)
    await expect(volunteer.page.getByRole('heading', { name: 'Edit Project' })).toBeVisible({
      timeout: 10_000,
    })
    const descriptionField = volunteer.page.getByLabel('Description')
    await descriptionField.fill(newDescription)
    await Promise.all([
      volunteer.page.waitForResponse((resp) => resp.url().includes('/api/rpc/projects/update')),
      descriptionField.blur(),
    ])
    await volunteer.page.goto(`${baseUrl}/projects/${projectId}#tasks`)

    // Task must still be there, both immediately and after a reload.
    await expect(volunteer.page.getByText(taskTitle)).toBeVisible({ timeout: 10_000 })
    await volunteer.page.reload()
    await expect(volunteer.page.getByText(taskTitle)).toBeVisible({ timeout: 10_000 })
  })
})
