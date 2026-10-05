import { test, expect, createApprovedVolunteerNamed } from '../fixtures'
import {
  adminCreateProjectViaApi,
  proposeProject,
  adminApproveProject,
  transferProjectOwnership,
} from '../actions/projects'
import { goToInbox, inboxButton } from '../actions/dashboard'
import { createApiClient } from '../client'
import { fake } from '../fake'

test.describe('Inbox', () => {
  test('An applicant shows in the badge and the popover, and is accepted from the Inbox', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    const title = fake.projectTitle()
    const projectId = await adminCreateProjectViaApi(baseUrl, title, 'Inbox e2e project')
    await transferProjectOwnership(baseUrl, adminPage, projectId, volunteer.name)
    const applicant = await createApprovedVolunteerNamed(baseUrl, fake.person().name)
    const applied = await createApiClient(baseUrl, applicant.token).projects.expressInterest({
      body: { projectId, interestType: 'want_to_contribute' },
    })
    expect(applied.status).toBe(200)

    const page = volunteer.page
    await page.goto(`${baseUrl}/projects`)
    // The applicant is waiting on the owner, so the badge counts it.
    await expect(inboxButton(page)).toHaveText('Inbox, waiting for you: 1', { timeout: 10_000 })

    await inboxButton(page).click()
    const popover = page.getByRole('dialog', { name: 'Recent notifications' })
    await expect(popover).toContainText(`${applicant.name} asked to help out`, {
      timeout: 10_000,
    })
    await popover.getByRole('link', { name: 'Open inbox →' }).click()
    await expect(page).toHaveURL(`${baseUrl}/inbox`)

    // The Inbox opens on Needs action, where it can be answered in place.
    const row = page
      .getByRole('listitem')
      .filter({ hasText: `${applicant.name} asked to help out` })
    await row.getByRole('button', { name: 'Accept' }).click()
    await expect(row).toHaveCount(0, { timeout: 10_000 })
    await expect(inboxButton(page)).toHaveText('Inbox', { timeout: 10_000 })

    const owner = createApiClient(
      baseUrl,
      await page.evaluate(() => localStorage.getItem('authToken')),
    )
    const project = await owner.projects.getById({ body: { id: projectId } })
    const interests = (project.body as { interests: { status: string }[] }).interests
    expect(interests.map((i) => i.status)).toEqual(['accepted'])
  })

  test('An update is listed under All, and is read once seen', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    const title = fake.projectTitle()
    await proposeProject(baseUrl, volunteer.page, title, 'Inbox update e2e project')
    await adminApproveProject(baseUrl, adminPage, title)

    await goToInbox(baseUrl, volunteer.page)
    const updates = volunteer.page.getByRole('region', { name: 'Updates' })
    await expect(updates).toContainText(`Approved: '${title}'`, { timeout: 10_000 })
    await expect(
      volunteer.page.getByRole('group', { name: 'Show' }).getByRole('button', { name: /^Updates/ }),
    ).toHaveText('Updates', { timeout: 10_000 })
  })
})
