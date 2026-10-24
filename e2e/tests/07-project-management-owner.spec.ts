import { test, expect } from '../fixtures'
import { proposeProject, adminApproveProject, transferProjectOwnership } from '../actions/projects'
import { goToInbox } from '../actions/dashboard'
import { Page } from '@playwright/test'
import { fake } from '../fake'
import { postComment } from '../actions/ui'
import { createApiClient } from '../client'

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
      ['Project title', newTitle],
      ['Description', newDescription],
      ['Collaboration doc / link', collaborationLink],
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
    await expect(volunteer.page.getByRole('link', { name: 'Open project doc' })).toBeVisible({
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

    await postComment(volunteer.page, updateText)

    await expect(volunteer.page.getByText(updateText)).toBeVisible({ timeout: 10_000 })
  })

  test('Project owner and admin exchange comments in a back-and-forth thread', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    const projectId = await setupOwnedProject(baseUrl, adminPage, volunteer)
    const adminComment = `admin update: ${fake.note()}`
    const volunteerReply = `volunteer reply: ${fake.note()}`

    // Admin posts the opening comment
    await adminPage.goto(`${baseUrl}/projects/${projectId}#discussion`)
    await expect(adminPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })
    await postComment(adminPage, adminComment)
    await expect(adminPage.getByText(adminComment)).toBeVisible({ timeout: 10_000 })

    // Owner sees admin's comment and replies
    await volunteer.page.goto(`${baseUrl}/projects/${projectId}#discussion`)
    await expect(volunteer.page.getByText(adminComment)).toBeVisible({ timeout: 10_000 })
    await postComment(volunteer.page, volunteerReply)
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
    await postComment(adminPage, question)
    await expect(adminPage.getByText(question)).toBeVisible({ timeout: 10_000 })

    // The admin has commented, so the owner can mention them.
    await page.goto(`${baseUrl}/projects/${projectId}#discussion`)
    await expect(page.getByText(question)).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: /^Reply to / }).click()
    const replyBox = page.getByLabel(/^Write a reply to /)
    await replyBox.fill('Answered, ')
    await replyBox.pressSequentially('@')
    await page.getByRole('option').first().click()
    await page.getByRole('button', { name: 'Post reply' }).click()
    // The box holds the same words until the reply is saved (see postComment).
    await expect(replyBox).toBeHidden({ timeout: 10_000 })
    await expect(page.getByText('Answered,')).toBeVisible()

    await page.getByRole('button', { name: 'Edit' }).click()
    await page.getByLabel('Edit comment').fill('Answered in the doc')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByLabel('Edit comment')).toBeHidden({ timeout: 10_000 })
    await expect(page.getByText('Answered in the doc')).toBeVisible()
    await expect(page.getByText('(edited)')).toBeVisible()

    await page.getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByText('Comment removed')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Answered in the doc')).toHaveCount(0)

    await goToInbox(baseUrl, adminPage)
    await expect(adminPage.getByText(/mentioned you on/).first()).toBeVisible({ timeout: 10_000 })
  })

  test('Discussion: a reply nests under its comment, tells its author, and a long thread folds', async ({
    adminPage,
    volunteer,
    baseUrl,
    snap,
  }) => {
    const projectId = await setupOwnedProject(baseUrl, adminPage, volunteer)
    const page = volunteer.page
    const question = `Who can bring banners? ${fake.note()}`
    const answer = `I have two. ${fake.note()}`

    await adminPage.goto(`${baseUrl}/projects/${projectId}#discussion`)
    await postComment(adminPage, question)

    await page.goto(`${baseUrl}/projects/${projectId}#discussion`)
    const thread = page.getByRole('listitem').filter({ hasText: question })
    await thread.getByRole('button', { name: /^Reply to / }).click()
    const replyBox = page.getByLabel(/^Write a reply to /)
    await expect(replyBox).toBeFocused()
    await replyBox.fill(answer)
    await snap(page, 'reply box open')
    await page.getByRole('button', { name: 'Post reply' }).click()
    await expect(replyBox).toBeHidden({ timeout: 10_000 })
    const replies = thread.getByRole('list', { name: /^Replies to / })
    await expect(replies.getByText(answer)).toBeVisible()

    // The admin hears about it as a reply, and the link opens the discussion at it.
    const notice = `${volunteer.name} replied to your comment`
    await goToInbox(baseUrl, adminPage)
    await adminPage
      .getByRole('listitem')
      .filter({ hasText: notice })
      .getByRole('link', { name: 'Open' })
      .click()
    await expect(adminPage.getByText(answer)).toBeVisible({ timeout: 10_000 })

    // Past four replies the middle of the thread folds away until asked for.
    const ownerApi = createApiClient(
      baseUrl,
      await page.evaluate(() => localStorage.getItem('authToken')),
    )
    const listed = await ownerApi.workItemComments.list({ body: { workItemId: projectId } })
    const top = (listed.body as { feed: { id: number; content?: string }[] }).feed.find(
      (c) => c.content === question,
    )!
    for (const n of [2, 3, 4, 5]) {
      const added = await ownerApi.workItemComments.add({
        body: { workItemId: projectId, content: `Follow-up ${n}`, parentId: top.id },
      })
      expect(added.status).toBe(200)
    }
    await page.reload()
    const more = thread.getByRole('button', { name: 'Show 2 more replies' })
    await expect(more).toBeVisible({ timeout: 10_000 })
    await expect(replies.getByText('Follow-up 2')).toBeHidden()
    await snap(page, 'long thread folded')
    await more.click()
    await expect(replies.getByText('Follow-up 2')).toBeVisible()
    await expect(replies.getByText('Follow-up 3')).toBeVisible()
    await expect(more).toBeHidden()
  })
})
