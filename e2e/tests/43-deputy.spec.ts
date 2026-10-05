import { test, expect, createApprovedVolunteerNamed, dismissCookieConsentScript } from '../fixtures'
import { adminCreateProjectViaApi, transferProjectOwnership } from '../actions/projects'
import { createApiClient } from '../client'
import { fake } from '../fake'

test.describe('Deputy', () => {
  test('The owner makes a helper a deputy, who then manages tasks but not people', async ({
    adminPage,
    volunteer,
    browser,
    baseUrl,
  }) => {
    const title = fake.projectTitle()
    const projectId = await adminCreateProjectViaApi(baseUrl, title, 'Deputy e2e project')
    await transferProjectOwnership(baseUrl, adminPage, projectId, volunteer.name)

    const helper = await createApprovedVolunteerNamed(baseUrl, fake.person().name)
    const helperApi = createApiClient(baseUrl, helper.token)
    expect(
      (
        await helperApi.projects.expressInterest({
          body: { projectId, interestType: 'want_to_contribute' },
        })
      ).status,
    ).toBe(200)

    await volunteer.page.goto(`${baseUrl}/projects`)
    const ownerToken = await volunteer.page.evaluate(() => localStorage.getItem('authToken'))
    const ownerApi = createApiClient(baseUrl, ownerToken)
    const project = await ownerApi.projects.getById({ body: { id: projectId } })
    const interest = (project.body as { interests: { id: number }[] }).interests[0]
    expect(
      (
        await ownerApi.projects.respondToInterest({
          body: { projectId, interestId: interest.id, status: 'accepted' },
        })
      ).status,
    ).toBe(200)
    expect(
      (await ownerApi.projects.createTask({ body: { projectId, title: 'A task to run' } })).status,
    ).toBe(200)

    const page = volunteer.page
    await page.goto(`${baseUrl}/projects/${projectId}#people`)
    const row = page.getByRole('listitem').filter({ hasText: helper.name })
    await row.getByRole('button', { name: 'Make deputy' }).click()
    await page
      .getByRole('dialog', { name: `Make ${helper.name} a deputy?` })
      .getByRole('button', { name: 'Make deputy' })
      .click()
    await expect(row.getByRole('button', { name: 'Remove deputy' })).toBeVisible({
      timeout: 10_000,
    })

    const context = await browser.newContext()
    await context.addInitScript((token: string) => {
      localStorage.setItem('authToken', token)
    }, helper.token)
    await context.addInitScript(dismissCookieConsentScript)
    const deputyPage = await context.newPage()
    await deputyPage.goto(`${baseUrl}/projects/${projectId}#tasks`)
    await expect(deputyPage.getByLabel('Task actions for A task to run')).toBeVisible({
      timeout: 10_000,
    })
    await deputyPage.goto(`${baseUrl}/projects/${projectId}#people`)
    await deputyPage.reload()
    await expect(deputyPage.getByRole('button', { name: 'Step down' })).toBeVisible({
      timeout: 10_000,
    })
    await expect(deputyPage.getByRole('button', { name: 'Make deputy' })).toHaveCount(0)
    await context.close()
  })
})
