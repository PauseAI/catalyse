import { test, expect } from '../fixtures'
import { createApprovedVolunteerNamed, readAdminToken } from '../fixtures'
import { createApiClient } from '../client'
import { adminCreateProjectViaApi, transferProjectOwnership } from '../actions/projects'
import { fake } from '../fake'

// A volunteer who opts out of the public directory
// (consentMakeProfileVisibleInDirectory = false) is still visible to people with a
// legitimate need: any admin, and an owner of a project the volunteer is involved in.
test.describe('Directory-hidden volunteer access', () => {
  test('Admin sees a hidden volunteer in the directory, badged, and can open the profile', async ({
    adminPage,
    baseUrl,
  }) => {
    const hidden = await createApprovedVolunteerNamed(baseUrl, fake.personName(), { hidden: true })

    await adminPage.goto(`${baseUrl}/volunteers`)
    await expect(
      adminPage.getByRole('heading', { name: 'Volunteer Directory', level: 1 }),
    ).toBeVisible({ timeout: 10_000 })
    await expect(adminPage.locator('#volunteersList .loading')).not.toBeVisible({ timeout: 10_000 })
    await adminPage.getByLabel('Search').fill(hidden.name)

    const card = adminPage.locator('#volunteersList .card').filter({ hasText: hidden.name })
    await expect(card).toBeVisible({ timeout: 10_000 })
    await expect(card.getByText('Hidden')).toBeVisible()

    await adminPage.goto(`${baseUrl}/volunteers/${hidden.id}`)
    await expect(adminPage.locator('#profileContent')).toBeVisible({ timeout: 10_000 })
    await expect(adminPage.locator('#volunteerName')).toHaveText(hidden.name)
  })

  test('An unrelated volunteer cannot see or open a hidden profile', async ({
    volunteer,
    baseUrl,
  }) => {
    const hidden = await createApprovedVolunteerNamed(baseUrl, fake.personName(), { hidden: true })

    await volunteer.page.goto(`${baseUrl}/volunteers`)
    await expect(volunteer.page.locator('#volunteersList .loading')).not.toBeVisible({
      timeout: 10_000,
    })
    await volunteer.page.getByLabel('Search').fill(hidden.name)
    await expect(
      volunteer.page.locator('#volunteersList .card').filter({ hasText: hidden.name }),
    ).toHaveCount(0)

    await volunteer.page.goto(`${baseUrl}/volunteers/${hidden.id}`)
    await expect(volunteer.page.getByText('Volunteer not found.')).toBeVisible({ timeout: 10_000 })
    await expect(volunteer.page.locator('#profileContent')).toHaveCount(0)
  })

  test('A project owner opens a hidden applicant profile from the interests list before accepting', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    // The volunteer fixture is the (non-admin) project owner.
    const projectId = await adminCreateProjectViaApi(
      baseUrl,
      fake.projectTitle(),
      'Owner assesses a hidden applicant',
    )
    await transferProjectOwnership(baseUrl, adminPage, projectId, volunteer.name)

    const applicant = await createApprovedVolunteerNamed(baseUrl, fake.personName(), {
      hidden: true,
    })
    const applicantApi = createApiClient(baseUrl, applicant.token)
    const expressed = await applicantApi.projects.expressInterest({
      body: { projectId, interestType: 'want_to_contribute' },
    })
    expect(expressed.status).toBe(200)

    await volunteer.page.goto(`${baseUrl}/projects/${projectId}#people`)
    await expect(volunteer.page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })

    const card = volunteer.page.locator('.interest-card').filter({ hasText: applicant.name })
    await expect(card).toBeVisible({ timeout: 10_000 })
    // The interest is still pending — the owner can view the profile to decide.
    await card.getByRole('link', { name: applicant.name }).click()

    await expect(volunteer.page).toHaveURL(new RegExp(`/volunteers/${applicant.id}(\\?|$)`), {
      timeout: 10_000,
    })
    await expect(volunteer.page.locator('#profileContent')).toBeVisible({ timeout: 10_000 })
    await expect(volunteer.page.locator('#volunteerName')).toHaveText(applicant.name)
  })

  test('A project owner can open the profile of a hidden volunteer holding a task on their project', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    const adminApi = createApiClient(baseUrl, readAdminToken(baseUrl))
    const projectId = await adminCreateProjectViaApi(
      baseUrl,
      fake.projectTitle(),
      'Owner assesses a hidden task holder',
    )
    await transferProjectOwnership(baseUrl, adminPage, projectId, volunteer.name)

    const taskHolder = await createApprovedVolunteerNamed(baseUrl, fake.personName(), {
      hidden: true,
    })
    const task = await adminApi.projects.createTask({
      body: { projectId, title: 'Task held by a hidden volunteer' },
    })
    expect(task.status).toBe(200)
    const taskId = (task.body as { id: number }).id
    const assigned = await adminApi.projects.updateTask({
      body: { projectId, taskId, data: { status: 'in_progress', assigneeId: taskHolder.id } },
    })
    expect(assigned.status).toBe(200)

    // Owner reaches the hidden profile directly (task holders aren't in the interests list).
    await volunteer.page.goto(`${baseUrl}/volunteers/${taskHolder.id}`)
    await expect(volunteer.page.locator('#profileContent')).toBeVisible({ timeout: 10_000 })
    await expect(volunteer.page.locator('#volunteerName')).toHaveText(taskHolder.name)

    // A bystander volunteer still can't.
    const bystander = await createApprovedVolunteerNamed(baseUrl, fake.personName())
    const bystanderApi = createApiClient(baseUrl, bystander.token)
    const denied = await bystanderApi.volunteers.getById({ params: { id: taskHolder.id } })
    expect(denied.status).toBe(404)
  })
})
