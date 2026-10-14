import { test, expect } from '../fixtures'
import { proposeProject, adminApproveProject, transferProjectOwnership } from '../actions/projects'
import { goToInbox } from '../actions/dashboard'
import { Page } from '@playwright/test'
import { fake } from '../fake'

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
    'Setup description for owner management',
  )
  await adminApproveProject(baseUrl, adminPage, title)
  await transferProjectOwnership(baseUrl, adminPage, projectId, volunteer.name)
  return projectId
}

test.describe('Project Management (Owner)', () => {
  test('Project owner edits project details', async ({ adminPage, volunteer, baseUrl }) => {
    const projectId = await setupOwnedProject(baseUrl, adminPage, volunteer)

    const newTitle = fake.projectTitle()
    const newDescription = 'Updated project description set by the owner'
    const collaborationLink = 'https://docs.example.com/e2e-project'

    await volunteer.page.goto(`${baseUrl}/projects/${projectId}/edit`)
    await expect(volunteer.page.getByRole('heading', { name: 'Edit Project' })).toBeVisible({
      timeout: 10_000,
    })

    // Fields autosave on blur, one request per field, so wait for each save before
    // leaving the page rather than only the last.
    for (const [label, value] of [
      ['Project Title', newTitle],
      ['Description', newDescription],
      ['Collaboration Doc / Link', collaborationLink],
    ] as const) {
      const field = volunteer.page.getByLabel(label)
      await field.fill(value)
      await Promise.all([
        volunteer.page.waitForResponse((resp) => resp.url().includes('/api/rpc/projects/update')),
        field.blur(),
      ])
    }

    await volunteer.page.goto(`${baseUrl}/projects/${projectId}`)
    await expect(volunteer.page.getByRole('heading', { level: 1 })).toContainText(newTitle, {
      timeout: 10_000,
    })
    await expect(volunteer.page.getByText(newDescription)).toBeVisible({ timeout: 10_000 })
    await expect(volunteer.page.getByRole('link', { name: 'Open Project Doc' })).toBeVisible({
      timeout: 10_000,
    })
  })

  test('Project owner adds a required skill to the project', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    const projectId = await setupOwnedProject(baseUrl, adminPage, volunteer)

    await volunteer.page.goto(`${baseUrl}/projects/${projectId}/edit`)
    await expect(volunteer.page.getByRole('heading', { name: 'Edit Project' })).toBeVisible({
      timeout: 10_000,
    })

    // Skills commit immediately on selection now, not via a save button.
    await Promise.all([
      volunteer.page.waitForResponse((resp) => resp.url().includes('/api/rpc/projects/update')),
      volunteer.page
        .locator('label.skill-option')
        .filter({ hasText: /^\s*Web Development\s*$/ })
        .click(),
    ])

    await volunteer.page.goto(`${baseUrl}/projects/${projectId}`)
    await expect(volunteer.page.getByText('Web Development')).toBeVisible({ timeout: 10_000 })
  })

  test('Project owner posts a progress update', async ({ adminPage, volunteer, baseUrl }) => {
    const projectId = await setupOwnedProject(baseUrl, adminPage, volunteer)
    const updateText = fake.progressUpdate()

    await volunteer.page.goto(`${baseUrl}/projects/${projectId}#discussion`)
    await expect(volunteer.page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })

    await volunteer.page.getByLabel('Add a comment').fill(updateText)
    await volunteer.page.getByRole('button', { name: 'Post comment' }).click()

    await expect(volunteer.page.getByText(updateText)).toBeVisible({ timeout: 10_000 })
  })

  test('Project owner and admin exchange comments in a back-and-forth thread', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    const projectId = await setupOwnedProject(baseUrl, adminPage, volunteer)
    const adminComment = `admin update ${Date.now()}`
    const volunteerReply = `volunteer reply ${Date.now()}`

    // Admin posts the opening comment
    await adminPage.goto(`${baseUrl}/projects/${projectId}#discussion`)
    await expect(adminPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })
    await adminPage.getByLabel('Add a comment').fill(adminComment)
    await adminPage.getByRole('button', { name: 'Post comment' }).click()
    await expect(adminPage.getByText(adminComment)).toBeVisible({ timeout: 10_000 })

    // Owner sees admin's comment and replies
    await volunteer.page.goto(`${baseUrl}/projects/${projectId}#discussion`)
    await expect(volunteer.page.getByText(adminComment)).toBeVisible({ timeout: 10_000 })
    await volunteer.page.getByLabel('Add a comment').fill(volunteerReply)
    await volunteer.page.getByRole('button', { name: 'Post comment' }).click()
    await expect(volunteer.page.getByText(volunteerReply)).toBeVisible({ timeout: 10_000 })

    // Admin reloads and sees both messages in the thread
    await adminPage.reload()
    await expect(adminPage.getByText(adminComment)).toBeVisible({ timeout: 10_000 })
    await expect(adminPage.getByText(volunteerReply)).toBeVisible({ timeout: 10_000 })
  })

  test('Discussion: owner replies with an @mention, edits the reply, then deletes it', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    const projectId = await setupOwnedProject(baseUrl, adminPage, volunteer)
    const question = `admin question ${Date.now()}`
    const page = volunteer.page

    await adminPage.goto(`${baseUrl}/projects/${projectId}#discussion`)
    await adminPage.getByLabel('Add a comment').fill(question)
    await adminPage.getByRole('button', { name: 'Post comment' }).click()
    await expect(adminPage.getByText(question)).toBeVisible({ timeout: 10_000 })

    // The admin has commented, so the owner can mention them.
    await page.goto(`${baseUrl}/projects/${projectId}#discussion`)
    await expect(page.getByText(question)).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: 'Reply' }).click()
    const replyBox = page.getByLabel('Write a reply')
    await replyBox.fill('Answered, ')
    await replyBox.pressSequentially('@')
    await page.getByRole('option').first().click()
    await page.getByRole('button', { name: 'Reply' }).last().click()
    await expect(page.getByText('Answered,')).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: 'Edit' }).click()
    await page.getByLabel('Edit comment').fill('Answered in the doc')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Answered in the doc')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('(edited)')).toBeVisible()

    await page.getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByText('Comment removed')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Answered in the doc')).toHaveCount(0)

    await goToInbox(baseUrl, adminPage)
    await expect(adminPage.getByText(/mentioned you on/).first()).toBeVisible({ timeout: 10_000 })
  })
})
