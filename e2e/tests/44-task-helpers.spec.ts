import {
  test,
  expect,
  createApprovedVolunteerNamed,
  dismissCookieConsentScript,
  readAdminToken,
} from '../fixtures'
import { adminCreateProjectViaApi } from '../actions/projects'
import { createApiClient } from '../client'
import { fake } from '../fake'

type Interest = { id: number; volunteerName: string; status: string }

async function acceptIntoProject(
  adminApi: ReturnType<typeof createApiClient>,
  projectId: number,
  volunteerName: string,
): Promise<void> {
  const project = await adminApi.projects.getById({ body: { id: projectId } })
  const interest = (project.body as { interests: Interest[] }).interests.find(
    (i) => i.volunteerName === volunteerName && i.status === 'pending',
  )
  if (!interest) throw new Error(`No pending interest from ${volunteerName}`)
  expect(
    (
      await adminApi.projects.respondToInterest({
        body: { projectId, interestId: interest.id, status: 'accepted' },
      })
    ).status,
  ).toBe(200)
}

test.describe('Task helpers', () => {
  test('a member joins as a helper, a full slot blocks another, and removing one frees it for someone else', async ({
    volunteer,
    browser,
    baseUrl,
  }) => {
    const adminApi = createApiClient(baseUrl, readAdminToken(baseUrl))
    const title = fake.projectTitle()
    const projectId = await adminCreateProjectViaApi(baseUrl, title, 'Task helpers e2e project')
    const createdTask = await adminApi.projects.createTask({
      body: { projectId, title: 'Flyer the neighbourhood' },
    })
    expect(createdTask.status).toBe(200)
    const taskId = (createdTask.body as { id: number }).id
    expect(
      (
        await adminApi.projects.updateTask({
          body: { projectId, taskId, data: { helpersWanted: 1 } },
        })
      ).status,
    ).toBe(200)

    const lead = volunteer
    await lead.page.goto(`${baseUrl}/dashboard`)
    const leadToken = await lead.page.evaluate(() => localStorage.getItem('authToken'))
    const leadApi = createApiClient(baseUrl, leadToken)
    expect(
      (
        await leadApi.projects.expressInterest({
          body: { projectId, interestType: 'want_to_contribute' },
        })
      ).status,
    ).toBe(200)
    await acceptIntoProject(adminApi, projectId, lead.name)

    const helperA = await createApprovedVolunteerNamed(baseUrl, fake.person().name)
    expect(
      (
        await createApiClient(baseUrl, helperA.token).projects.expressInterest({
          body: { projectId, interestType: 'want_to_contribute' },
        })
      ).status,
    ).toBe(200)
    await acceptIntoProject(adminApi, projectId, helperA.name)

    const helperB = await createApprovedVolunteerNamed(baseUrl, fake.person().name)
    expect(
      (
        await createApiClient(baseUrl, helperB.token).projects.expressInterest({
          body: { projectId, interestType: 'want_to_contribute' },
        })
      ).status,
    ).toBe(200)
    await acceptIntoProject(adminApi, projectId, helperB.name)

    const taskUrl = `${baseUrl}/projects/${projectId}/tasks/${taskId}`

    const leadPage = lead.page
    await leadPage.goto(taskUrl)
    await leadPage.getByRole('button', { name: 'Claim task' }).click()
    await expect(leadPage.getByText('1 helper wanted')).toBeVisible({ timeout: 10_000 })

    const helperAContext = await browser.newContext()
    await helperAContext.addInitScript((t: string) => {
      localStorage.setItem('authToken', t)
    }, helperA.token)
    await helperAContext.addInitScript(dismissCookieConsentScript)
    const helperAPage = await helperAContext.newPage()

    const helperBContext = await browser.newContext()
    await helperBContext.addInitScript((t: string) => {
      localStorage.setItem('authToken', t)
    }, helperB.token)
    await helperBContext.addInitScript(dismissCookieConsentScript)
    const helperBPage = await helperBContext.newPage()

    await helperAPage.goto(taskUrl)
    await expect(helperAPage.getByText('1 helper wanted')).toBeVisible()
    await helperAPage.getByRole('button', { name: 'Join as helper' }).click()
    await expect(helperAPage.getByText('1 helper', { exact: true })).toBeVisible({
      timeout: 10_000,
    })
    await expect(helperAPage.getByRole('button', { name: 'Stop helping' })).toBeVisible()

    // The slot is taken: another member has no way to join.
    await helperBPage.goto(taskUrl)
    await expect(helperBPage.getByText('1 helper', { exact: true })).toBeVisible()
    await expect(helperBPage.getByRole('button', { name: 'Join as helper' })).toHaveCount(0)

    // The lead removes the helper, freeing the slot.
    await leadPage.reload()
    await leadPage.getByRole('button', { name: `Remove ${helperA.name}` }).click()
    await leadPage
      .getByRole('dialog', { name: `Remove ${helperA.name}?` })
      .getByRole('button', { name: 'Remove' })
      .click()
    await expect(leadPage.getByText('1 helper wanted')).toBeVisible({ timeout: 10_000 })

    // The removed helper cannot rejoin, even though the slot is free again.
    await helperAPage.reload()
    await expect(helperAPage.getByRole('button', { name: 'Join as helper' })).toHaveCount(0)

    // The other member takes the free slot instead.
    await helperBPage.reload()
    await helperBPage.getByRole('button', { name: 'Join as helper' }).click()
    await expect(helperBPage.getByText('1 helper', { exact: true })).toBeVisible({
      timeout: 10_000,
    })

    await helperAContext.close()
    await helperBContext.close()
  })
})
