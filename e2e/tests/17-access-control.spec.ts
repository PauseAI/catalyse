import { test, expect, getAlert, dismissCookieConsentScript } from '../fixtures'
import { proposeProject, adminCreateProjectViaApi, adminApproveProject } from '../actions/projects'
import { fake } from '../fake'

test.describe('Access Control', () => {
  test('Unauthenticated user cannot access the dashboard', async ({ browser, baseUrl }) => {
    const context = await browser.newContext()
    await context.addInitScript(dismissCookieConsentScript)
    const page = await context.newPage()
    try {
      await page.goto(`${baseUrl}/dashboard`)
      await page.waitForURL(/\/login/, { timeout: 10_000 })
      expect(page.url()).toContain('/login')
    } finally {
      await context.close()
    }
  })

  test('Non-admin cannot access admin triage', async ({ volunteer, baseUrl }) => {
    await volunteer.page.goto(`${baseUrl}/admin/triage`)
    await volunteer.page.waitForURL(/\/projects/, { timeout: 10_000 })
    await expect(volunteer.page.getByText('That page is for admins.')).toBeVisible({
      timeout: 10_000,
    })
  })

  test("Non-owner cannot update another volunteer's project", async ({ volunteer, baseUrl }) => {
    const projectId = await adminCreateProjectViaApi(
      baseUrl,
      fake.projectTitle(),
      'Test project for access control',
    )

    await volunteer.page.goto(`${baseUrl}/projects/${projectId}/edit`)
    await expect(getAlert(volunteer.page)).toContainText(
      'You do not have permission to edit this project.',
      { timeout: 10_000 },
    )
    await expect(volunteer.page.getByLabel('Project Title')).toBeDisabled()
  })

  test("Non-owner cannot delete another volunteer's project", async ({ volunteer, baseUrl }) => {
    const projectId = await adminCreateProjectViaApi(
      baseUrl,
      fake.projectTitle(),
      'Test project for delete access control',
    )

    await volunteer.page.goto(`${baseUrl}/projects/${projectId}/edit`)
    await expect(getAlert(volunteer.page)).toContainText(
      'You do not have permission to edit this project.',
      { timeout: 10_000 },
    )
    await expect(volunteer.page.getByRole('button', { name: 'Delete project' })).not.toBeVisible()
  })

  test('Admin can update any project', async ({ adminPage, volunteer, baseUrl }) => {
    const originalTitle = fake.projectTitle()
    const projectId = await proposeProject(
      baseUrl,
      volunteer.page,
      originalTitle,
      'Project for admin update access control test',
    )
    await adminApproveProject(baseUrl, adminPage, originalTitle)

    const newTitle = fake.projectTitle()
    await adminPage.goto(`${baseUrl}/projects/${projectId}/edit`)
    await expect(adminPage.getByRole('heading', { name: 'Edit Project' })).toBeVisible({
      timeout: 10_000,
    })

    const titleField = adminPage.getByLabel('Project Title')
    await titleField.fill(newTitle)
    await Promise.all([
      adminPage.waitForResponse((resp) => resp.url().includes('/api/rpc/projects/update')),
      titleField.blur(),
    ])

    await adminPage.goto(`${baseUrl}/projects/${projectId}`)
    await expect(adminPage.getByRole('heading', { level: 1 })).toContainText(newTitle, {
      timeout: 10_000,
    })
  })
})
