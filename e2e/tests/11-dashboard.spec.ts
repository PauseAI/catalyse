import { test, expect, getAlert, createApprovedVolunteerNamed } from '../fixtures'
import {
  adminCreateProjectViaApi,
  proposeProject,
  transferProjectOwnership,
  askToJoinViaApi,
} from '../actions/projects'
import { homeHeading } from '../actions/dashboard'
import { createApiClient } from '../client'
import { fake } from '../fake'

test.describe('Home', () => {
  test('A new volunteer sees what to do first, with Find open', async ({ volunteer, baseUrl }) => {
    const page = volunteer.page
    await page.goto(`${baseUrl}/dashboard`)
    await expect(homeHeading(page)).toBeVisible({ timeout: 10_000 })

    await expect(page.getByRole('region', { name: 'Getting started' })).toBeVisible()
    await expect(page.getByText(/not working on anything yet/)).toBeVisible()
    // Nothing waits on them, so there is no section saying so.
    await expect(page.getByRole('region', { name: /Needs your attention/ })).toHaveCount(0)
    // Nothing of their own yet, so discovery is open.
    await expect(page.getByRole('button', { name: /Find something to do/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  test('A proposal shows among my projects, and in the Admin section for its reviewer', async ({
    adminPage,
    volunteer,
    baseUrl,
    snap,
  }) => {
    test.setTimeout(60_000)
    const title = fake.projectTitle()
    await proposeProject(baseUrl, volunteer.page, title, 'Dashboard sections e2e')

    const others = volunteer.page.getByRole('region', { name: /Other projects you're part of/ })
    const row = others.getByRole('listitem').filter({ hasText: title })
    await expect(row).toContainText('Proposed', { timeout: 10_000 })
    // A volunteer has no admin role.
    await expect(volunteer.page.getByRole('region', { name: /^Admin/ })).toHaveCount(0)
    await snap(volunteer.page, 'proposal among my projects')

    await adminPage.goto(`${baseUrl}/dashboard`)
    const admin = adminPage.getByRole('region', { name: /^Admin/ })
    const triage = admin.getByRole('link', { name: 'Proposals to triage' })
    await expect(triage).toBeVisible({ timeout: 10_000 })
    await snap(adminPage, 'admin section on home')
    await triage.click()
    await expect(adminPage).toHaveURL(`${baseUrl}/admin/triage`)
    await expect(adminPage.getByText(title)).toBeVisible({ timeout: 10_000 })
  })

  test('An applicant waiting on my project needs my attention until I answer', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    const title = fake.projectTitle()
    const projectId = await adminCreateProjectViaApi(baseUrl, title, 'Attention e2e project')
    await transferProjectOwnership(baseUrl, adminPage, projectId, volunteer.name)

    const applicant = await createApprovedVolunteerNamed(baseUrl, fake.person().name)
    await askToJoinViaApi(baseUrl, applicant.token, projectId)

    const page = volunteer.page
    await page.goto(`${baseUrl}/dashboard`)
    const attention = page.getByRole('region', { name: /Needs your attention/ })
    const item = attention.getByRole('listitem').filter({ hasText: title })
    await expect(item).toContainText(`${applicant.name} wants to help`, { timeout: 10_000 })
    // Find is folded: the owner has work of their own.
    await expect(page.getByRole('button', { name: /Find something to do/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await expect(
      page.getByRole('region', { name: /Projects you manage/ }).getByRole('link', { name: title }),
    ).toBeVisible()

    await item.getByRole('link', { name: /^Review:/ }).click()
    await expect(page).toHaveURL(`${baseUrl}/projects/${projectId}`)

    // Once answered, it leaves Home.
    const ownerApi = createApiClient(
      baseUrl,
      await page.evaluate(() => localStorage.getItem('authToken')),
    )
    const project = await ownerApi.projects.getById({ body: { id: projectId } })
    const interestId = (project.body as { interests: { id: number }[] }).interests[0].id
    const answered = await ownerApi.projects.respondToInterest({
      body: { projectId, interestId, status: 'accepted' },
    })
    expect(answered.status).toBe(200)
    await page.goto(`${baseUrl}/dashboard`)
    await expect(homeHeading(page)).toBeVisible({ timeout: 10_000 })
    await expect(attention.getByRole('listitem').filter({ hasText: title })).toHaveCount(0)
  })

  test('Work submitted on my project waits for me to accept it or ask for changes', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    test.setTimeout(90_000)
    const projectId = await adminCreateProjectViaApi(baseUrl, fake.projectTitle(), 'Review e2e')
    await transferProjectOwnership(baseUrl, adminPage, projectId, volunteer.name)

    const page = volunteer.page
    await page.goto(`${baseUrl}/dashboard`)
    await expect(homeHeading(page)).toBeVisible({ timeout: 10_000 })
    const ownerApi = createApiClient(
      baseUrl,
      await page.evaluate(() => localStorage.getItem('authToken')),
    )
    const taskTitle = `Review me ${fake.projectTitle()}`
    const project = await ownerApi.projects.getById({ body: { id: projectId } })
    const taskId = (project.body as { tasks: { id: number }[] }).tasks[0].id
    await ownerApi.projects.updateTask({ body: { projectId, taskId, data: { title: taskTitle } } })
    await ownerApi.projects.update({ body: { id: projectId, autoAcceptTasks: false } })

    const helper = await createApprovedVolunteerNamed(baseUrl, fake.person().name)
    const helperApi = createApiClient(baseUrl, helper.token)
    // On the project first, so the claim takes the task straight away.
    await ownerApi.projects.invite({ body: { projectId, volunteerId: helper.id } })
    await helperApi.projects.respondToInvite({ body: { projectId, accept: true } })
    await helperApi.projects.updateTask({
      body: { projectId, taskId, data: { assigneeId: helper.id } },
    })
    const submitted = await helperApi.projects.submitTask({
      body: { projectId, taskId, note: 'First draft', url: 'https://example.org/draft' },
    })
    expect(submitted.body).toMatchObject({ status: 'under_review' })

    await page.goto(`${baseUrl}/dashboard`)
    const attention = page.getByRole('region', { name: /Needs your attention/ })
    const item = attention.getByRole('listitem').filter({ hasText: taskTitle })
    await expect(item).toContainText('is submitted for review', { timeout: 10_000 })
    await item.getByRole('link', { name: /^Review:/ }).click()
    await expect(page).toHaveURL(`${baseUrl}/projects/${projectId}/tasks/${taskId}`)
    await expect(page.getByText('First draft')).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: 'Ask for changes' }).click()
    const ask = page.getByRole('dialog', { name: 'Ask for changes' })
    await ask.getByLabel('What needs changing?').fill('Add the sources')
    await ask.getByRole('button', { name: 'Send back' }).click()
    await expect(getAlert(page)).toContainText(`Sent back to ${helper.name}`, { timeout: 10_000 })

    await helperApi.projects.submitTask({ body: { projectId, taskId, note: 'With sources' } })
    await page.reload()
    await expect(page.getByText('With sources')).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: 'Accept', exact: true }).click()
    await expect(getAlert(page)).toContainText('Accepted. The task is done.', { timeout: 10_000 })

    await page.goto(`${baseUrl}/dashboard`)
    await expect(homeHeading(page)).toBeVisible({ timeout: 10_000 })
    await expect(attention.getByRole('listitem').filter({ hasText: taskTitle })).toHaveCount(0)
  })
})
