import { test, expect } from '../fixtures'
import { fake } from '../fake'
import { selectFilterDropdown } from '../actions/ui'
import { openNewProjectForm } from '../actions/projects'

test.describe('Project form: where a project happens', () => {
  test('Admin marks a project remote and it persists', async ({ adminPage, baseUrl }) => {
    const title = fake.projectTitle()

    await adminPage.goto(`${baseUrl}/admin/projects/new`)
    await openNewProjectForm(adminPage)

    await adminPage.getByLabel('Project title').fill(title)
    await adminPage.getByLabel('Description').fill('e2e test project description')
    await selectFilterDropdown(adminPage, 'Select where the project happens', 'Remote')
    await adminPage.locator('#new-task-title').fill('Initial task')
    await adminPage.getByRole('button', { name: 'Add task' }).click()
    await adminPage.waitForURL(/\/projects\/\d+\/edit/, { timeout: 15_000 })
    const id = Number(new URL(adminPage.url()).pathname.split('/')[2])
    await expect(adminPage.locator('input[id^="task-title-"][value="Initial task"]')).toBeVisible({
      timeout: 10_000,
    })
    await adminPage.getByRole('button', { name: 'Publish', exact: true }).click()
    await adminPage
      .getByRole('dialog')
      .getByRole('button', { name: 'Publish', exact: true })
      .click()

    await adminPage.waitForURL(`${baseUrl}/projects/${id}`, { timeout: 15_000 })
    await expect(adminPage.locator('#projectContent')).toBeVisible({ timeout: 10_000 })

    await adminPage.goto(`${baseUrl}/projects/${id}/edit`)
    await expect(adminPage.getByRole('heading', { name: 'Edit Project' })).toBeVisible({
      timeout: 10_000,
    })
    await expect(adminPage.getByLabel('Select where the project happens')).toContainText('Remote')
  })
})
