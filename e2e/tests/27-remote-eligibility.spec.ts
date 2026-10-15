import { test, expect, getAlert } from '../fixtures'
import { fake } from '../fake'
import { selectFilterDropdown } from '../actions/ui'
import { openNewProjectForm } from '../actions/projects'

test.describe('Project form & settings: remote eligibility', () => {
  test('Admin can mark a project remote-eligible and it persists', async ({
    adminPage,
    baseUrl,
  }) => {
    const title = fake.projectTitle()

    await adminPage.goto(`${baseUrl}/admin/projects/new`)
    await openNewProjectForm(adminPage)

    await adminPage.getByLabel('Project Title').fill(title)
    await adminPage.getByLabel('Description').fill('e2e test project description')
    await selectFilterDropdown(
      adminPage,
      'Select remote eligibility',
      'Yes - remote OK, from any country',
    )
    await adminPage.locator('#new-task-title').fill('Initial task')
    await adminPage.getByRole('button', { name: 'Add Task' }).click()
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
    await expect(adminPage.getByLabel('Select remote eligibility')).toContainText(
      'Yes - remote OK, from any country',
    )
  })

  test('Volunteer can opt in to remote-friendly project alerts outside their country', async ({
    volunteer,
    baseUrl,
  }) => {
    await volunteer.page.goto(`${baseUrl}/settings?tab=notifications`)
    const checkbox = volunteer.page.getByLabel(/Also alert me about remote-friendly projects/)
    await expect(checkbox).toBeVisible({ timeout: 10_000 })
    await expect(checkbox).not.toBeChecked()

    // The checkbox input is visually hidden behind a decorative custom-checkbox span
    // (see components/Checkbox.tsx), so click the wrapping label instead of the input.
    await volunteer.page.locator('label:has(#notify_remote_projects)').click()
    await expect(checkbox).toBeChecked()
    await volunteer.page.getByRole('button', { name: 'Save Changes' }).click()
    await expect(getAlert(volunteer.page)).toBeVisible({ timeout: 10_000 })

    await volunteer.page.reload()
    await expect(
      volunteer.page.getByLabel(/Also alert me about remote-friendly projects/),
    ).toBeChecked({ timeout: 10_000 })
  })
})
