import {
  test,
  expect,
  getAlert,
  readAdminToken,
  confirmVolunteerEmail,
  approveVolunteer,
  createApprovedVolunteer,
} from '../fixtures'
import { fake } from '../fake'
import { proposeProject, adminCreateProjectViaApi, adminApproveProject } from '../actions/projects'
import { Page } from '@playwright/test'
import { createApiClient } from '../client'
import { selectFilterDropdown } from '../actions/ui'

// Produces an in_progress project with one open task ("Initial task") proposed by the volunteer
async function setupInProgressProject(
  baseUrl: string,
  adminPage: Page,
  volunteer: { page: Page; name: string },
): Promise<number> {
  const title = fake.projectTitle()
  const id = await proposeProject(baseUrl, volunteer.page, title, 'Setup for task scenarios')
  await adminApproveProject(baseUrl, adminPage, title)
  return id
}

test.describe('Project Tasks', () => {
  // An owned project with an empty backlog is still owned, so it stays In Progress and
  // shows a derived "Needs Tasks" badge rather than moving to a status of its own. Get
  // there via the API (every project requires a task up front, so the only route is
  // deleting the last one), then check the badge clears as soon as a task is added.
  test('An owned project with no open tasks shows a Needs Tasks badge until one is added', async ({
    adminPage,
    baseUrl,
  }) => {
    const adminToken = readAdminToken(baseUrl)
    const adminApi = createApiClient(baseUrl, adminToken)

    const created = await adminApi.admin.projects.create({
      body: {
        title: fake.projectTitle(),
        description: 'Project for auto-promotion test',
        projectType: null,
        estimatedDuration: null,
        timeCommitmentHoursPerWeek: null,
        urgency: 'medium',
        collaborationLink: null,
        country: null,
        localGroup: null,
        isSeekingHelp: false,
        tasks: [{ title: 'Initial task' }],
      },
    })
    expect(created.status).toBe(200)
    const projectId = (created.body as { id: number }).id

    const detail = await adminApi.projects.getById({ body: { id: projectId } })
    const taskId = (detail.body as { tasks: { id: number }[] }).tasks[0].id
    const deleted = await adminApi.projects.deleteTask({ body: { projectId, taskId } })
    expect(deleted.status).toBe(200)

    const owner = await createApprovedVolunteer(baseUrl)
    const ownerApi = createApiClient(baseUrl, owner.token)
    const interest = await ownerApi.projects.expressInterest({
      body: { projectId, interestType: 'want_to_own' },
    })
    expect(interest.status).toBe(200)

    const withInterest = await adminApi.projects.getById({ body: { id: projectId } })
    const interestId = (
      withInterest.body as { interests: { id: number; volunteerId: number }[] }
    ).interests.find((i) => i.volunteerId === owner.id)!.id
    const accepted = await adminApi.projects.respondToInterest({
      body: { projectId, interestId, status: 'accepted' },
    })
    expect(accepted.status).toBe(200)

    await adminPage.goto(`${baseUrl}/projects/${projectId}#tasks`)
    // Accepting the owner started the work, empty backlog or not.
    await expect(adminPage.getByLabel('project status')).toContainText('In Progress', {
      timeout: 10_000,
    })
    await expect(adminPage.getByText('Needs Tasks')).toBeVisible({ timeout: 10_000 })

    await adminPage.getByRole('button', { name: 'Add Task' }).click()
    await adminPage.getByLabel('Task title').fill('First task')
    await adminPage.getByRole('button', { name: 'Create Task' }).click()
    await expect(getAlert(adminPage)).toContainText('Task added!', { timeout: 10_000 })

    await expect(adminPage.getByText('Needs Tasks')).toBeHidden({ timeout: 10_000 })
    await expect(adminPage.getByLabel('project status')).toContainText('In Progress')
  })

  test('An accepted project member can create a task, but a non-member cannot', async ({
    baseUrl,
  }) => {
    const adminToken = readAdminToken(baseUrl)
    const adminApi = createApiClient(baseUrl, adminToken)

    const created = await adminApi.admin.projects.create({
      body: {
        title: fake.projectTitle(),
        description: 'Member task-creation permission test',
        projectType: null,
        estimatedDuration: null,
        timeCommitmentHoursPerWeek: null,
        urgency: 'medium',
        collaborationLink: null,
        country: null,
        localGroup: null,
        isSeekingHelp: true,
        tasks: [{ title: 'Initial task' }],
      },
    })
    expect(created.status).toBe(200)
    const projectId = (created.body as { id: number }).id

    // A non-member has no manage rights and gets rejected.
    const outsider = await createApprovedVolunteer(baseUrl)
    const outsiderApi = createApiClient(baseUrl, outsider.token)
    const rejected = await outsiderApi.projects.createTask({
      body: { projectId, title: 'Should be rejected' },
    })
    expect(rejected.status).toBe(403)

    // A volunteer with an accepted interest is a project member and may add tasks.
    const member = await createApprovedVolunteer(baseUrl)
    const memberApi = createApiClient(baseUrl, member.token)
    const interest = await memberApi.projects.expressInterest({
      body: { projectId, interestType: 'want_to_contribute' },
    })
    expect(interest.status).toBe(200)

    const withInterest = await adminApi.projects.getById({ body: { id: projectId } })
    const interestId = (
      withInterest.body as { interests: { id: number; volunteerId: number }[] }
    ).interests.find((i) => i.volunteerId === member.id)!.id
    const accepted = await adminApi.projects.respondToInterest({
      body: { projectId, interestId, status: 'accepted' },
    })
    expect(accepted.status).toBe(200)

    const memberTask = await memberApi.projects.createTask({
      body: { projectId, title: 'Added by member' },
    })
    expect(memberTask.status).toBe(200)
  })

  test('A member can delete their own task but not another member’s', async ({ baseUrl }) => {
    const adminToken = readAdminToken(baseUrl)
    const adminApi = createApiClient(baseUrl, adminToken)

    const created = await adminApi.admin.projects.create({
      body: {
        title: fake.projectTitle(),
        description: 'Task deletion permission test',
        projectType: null,
        estimatedDuration: null,
        timeCommitmentHoursPerWeek: null,
        urgency: 'medium',
        collaborationLink: null,
        country: null,
        localGroup: null,
        isSeekingHelp: true,
        tasks: [{ title: 'Initial task' }],
      },
    })
    expect(created.status).toBe(200)
    const projectId = (created.body as { id: number }).id

    async function acceptAsMember(): Promise<{ id: number; token: string }> {
      const member = await createApprovedVolunteer(baseUrl)
      const memberApi = createApiClient(baseUrl, member.token)
      const interest = await memberApi.projects.expressInterest({
        body: { projectId, interestType: 'want_to_contribute' },
      })
      expect(interest.status).toBe(200)
      const withInterest = await adminApi.projects.getById({ body: { id: projectId } })
      const interestId = (
        withInterest.body as { interests: { id: number; volunteerId: number }[] }
      ).interests.find((i) => i.volunteerId === member.id)!.id
      const accepted = await adminApi.projects.respondToInterest({
        body: { projectId, interestId, status: 'accepted' },
      })
      expect(accepted.status).toBe(200)
      return member
    }

    const memberA = await acceptAsMember()
    const memberAApi = createApiClient(baseUrl, memberA.token)
    const memberB = await acceptAsMember()
    const memberBApi = createApiClient(baseUrl, memberB.token)

    const taskCreated = await memberAApi.projects.createTask({
      body: { projectId, title: 'Added by member A' },
    })
    expect(taskCreated.status).toBe(200)
    const taskId = (taskCreated.body as { id: number }).id

    // Another member, not the creator, cannot delete it.
    const rejected = await memberBApi.projects.deleteTask({ body: { projectId, taskId } })
    expect(rejected.status).toBe(403)

    // The creator can delete their own task.
    const deleted = await memberAApi.projects.deleteTask({ body: { projectId, taskId } })
    expect(deleted.status).toBe(200)
  })

  test('A member sees the accepted-helper roster, without pending applicants’ private messages', async ({
    baseUrl,
  }) => {
    const adminToken = readAdminToken(baseUrl)
    const adminApi = createApiClient(baseUrl, adminToken)

    const created = await adminApi.admin.projects.create({
      body: {
        title: fake.projectTitle(),
        description: 'Member helper-visibility test',
        projectType: null,
        estimatedDuration: null,
        timeCommitmentHoursPerWeek: null,
        urgency: 'medium',
        collaborationLink: null,
        country: null,
        localGroup: null,
        isSeekingHelp: true,
        tasks: [{ title: 'Initial task' }],
      },
    })
    expect(created.status).toBe(200)
    const projectId = (created.body as { id: number }).id

    async function expressAndAccept(message: string): Promise<{ id: number; token: string }> {
      const v = await createApprovedVolunteer(baseUrl)
      const vApi = createApiClient(baseUrl, v.token)
      const interest = await vApi.projects.expressInterest({
        body: { projectId, interestType: 'want_to_contribute', message },
      })
      expect(interest.status).toBe(200)
      const withInterest = await adminApi.projects.getById({ body: { id: projectId } })
      const interestId = (
        withInterest.body as { interests: { id: number; volunteerId: number }[] }
      ).interests.find((i) => i.volunteerId === v.id)!.id
      const accepted = await adminApi.projects.respondToInterest({
        body: { projectId, interestId, status: 'accepted' },
      })
      expect(accepted.status).toBe(200)
      return v
    }

    const memberA = await expressAndAccept('memberA private application message')
    const memberB = await expressAndAccept('memberB private application message')

    // A third, merely-pending applicant should not show up in the member-visible roster,
    // and their private message should never reach a plain member.
    const pending = await createApprovedVolunteer(baseUrl)
    const pendingApi = createApiClient(baseUrl, pending.token)
    const pendingInterest = await pendingApi.projects.expressInterest({
      body: { projectId, interestType: 'want_to_contribute', message: 'pending private message' },
    })
    expect(pendingInterest.status).toBe(200)

    const memberAApi = createApiClient(baseUrl, memberA.token)
    const view = await memberAApi.projects.getById({ body: { id: projectId } })
    expect(view.status).toBe(200)
    const body = view.body as {
      helpers: { volunteerId: number; volunteerName: string; message?: string }[]
      interests: unknown
    }

    const helperIds = body.helpers.map((h) => h.volunteerId)
    expect(helperIds).toContain(memberA.id)
    expect(helperIds).toContain(memberB.id)
    expect(helperIds).not.toContain(pending.id)
    expect(body.helpers.every((h) => h.message === undefined)).toBe(true)
    // Full applicant review data (with messages/bios) stays owner/admin-only.
    expect(body.interests).toBeUndefined()
  })

  test('A volunteer can claim an open task', async ({ adminPage, volunteer, baseUrl }) => {
    const projectId = await setupInProgressProject(baseUrl, adminPage, volunteer)

    await volunteer.page.goto(`${baseUrl}/projects/${projectId}#tasks`)
    await expect(volunteer.page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })

    // Not on the project yet: claiming asks to join and holds the task meanwhile.
    await volunteer.page.getByRole('button', { name: 'Ask to take this' }).click()
    await expect(getAlert(volunteer.page)).toContainText('Requested. The task is held for you', {
      timeout: 10_000,
    })
    await expect(volunteer.page.getByText('Held for you: waiting for the owner')).toBeVisible({
      timeout: 10_000,
    })

    // Accepting the request hands over the held task. The admin may already be on this
    // project, where a new hash alone would not refetch it.
    await adminPage.goto(`${baseUrl}/projects/${projectId}#people`)
    await adminPage.reload()
    const card = adminPage.locator('.interest-card').filter({ hasText: volunteer.name })
    await card.getByRole('button', { name: 'Accept' }).click()
    await expect(getAlert(adminPage)).toContainText('Accepted. They', { timeout: 10_000 })

    // Submit work appears only for the assignee — confirms task is now assigned to this volunteer
    await volunteer.page.reload()
    await expect(volunteer.page.getByRole('button', { name: 'Submit work' })).toBeVisible({
      timeout: 10_000,
    })
  })

  test('A volunteer submits their claimed task, which the project auto-accepts', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    const projectId = await setupInProgressProject(baseUrl, adminPage, volunteer)

    // An admin puts the volunteer on the project, so their claim is immediate.
    await adminPage.goto(`${baseUrl}/projects/${projectId}#people`)
    await selectFilterDropdown(adminPage, 'Volunteer to invite', volunteer.name)
    await adminPage.getByRole('button', { name: 'Add now', exact: true }).click()
    await expect(getAlert(adminPage)).toContainText('Added to the project.', { timeout: 10_000 })

    await volunteer.page.goto(`${baseUrl}/projects/${projectId}#tasks`)
    await expect(volunteer.page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })

    await volunteer.page.getByRole('button', { name: 'Claim task' }).click()
    await expect(getAlert(volunteer.page)).toContainText('Task claimed. Post an update', {
      timeout: 10_000,
    })

    await volunteer.page.getByRole('button', { name: 'Submit work' }).click()
    const dialog = volunteer.page.getByRole('dialog', { name: 'Submit your work' })
    await dialog.getByLabel('What did you do?').fill('Finished the first pass')
    await dialog.getByRole('button', { name: 'Submit work' }).click()
    await expect(getAlert(volunteer.page)).toContainText('Task done.', { timeout: 10_000 })

    await expect(volunteer.page.getByRole('button', { name: 'Submit work' })).not.toBeVisible({
      timeout: 10_000,
    })
    await expect(volunteer.page.getByText('done', { exact: true })).toBeVisible({ timeout: 10_000 })
  })

  // TODO: project task cards have no comment thread UI — convert this to a UI test once
  // a CommentThread is added to each task card on the project page (similar to how
  // quick tasks show comments on the dashboard and admin pages).
  test('Admin and task assignee exchange comments on a project task', async ({ baseUrl }) => {
    const adminToken = readAdminToken(baseUrl)
    expect(adminToken).toBeTruthy()
    const adminApi = createApiClient(baseUrl, adminToken)

    // Admin creates a project and a task
    const projectCreated = await adminApi.admin.projects.create({
      body: {
        title: fake.projectTitle(),
        description: 'Task comment back-and-forth test',
        projectType: null,
        estimatedDuration: null,
        timeCommitmentHoursPerWeek: null,
        urgency: 'medium',
        collaborationLink: null,
        country: null,
        localGroup: null,
        isSeekingHelp: false,
        tasks: [{ title: 'Setup task' }],
      },
    })
    expect(projectCreated.status).toBe(200)
    const projectId = (projectCreated.body as { id: number }).id

    const taskCreated = await adminApi.projects.createTask({
      body: { projectId, title: 'Back-and-forth comment task' },
    })
    expect(taskCreated.status).toBe(200)
    const taskId = (taskCreated.body as { id: number }).id

    // A fresh volunteer signs up, gets approved, and claims the task
    const person = fake.person()
    const api = createApiClient(baseUrl)
    const signup = await api.auth.signup({
      body: {
        name: person.name,
        email: person.email,
        password: 'testpassword1',
        bio: 'e2e test bio, at least twenty characters long',
        country: 'UK',
        availabilityHoursPerWeek: 5,
        applicationMessage: 'e2e test application message',
        consentMakeProfileVisibleInDirectory: true,
        consentContactableByProjectOwners: true,
      },
    })
    expect(signup.status).toBe(200)
    const {
      id: volId,
      token: volToken,
      emailVerificationToken,
    } = signup.body as { id: number; token: string; emailVerificationToken?: string }
    if (emailVerificationToken) await confirmVolunteerEmail(baseUrl, emailVerificationToken)
    await approveVolunteer(baseUrl, volId, volToken)
    const volApi = createApiClient(baseUrl, volToken)

    const claim = await adminApi.projects.assignTask({
      body: { projectId, taskId, assigneeId: volId },
    })
    expect(claim.status).toBe(200)

    // Admin posts the first comment on the task
    const adminComment = `admin feedback ${Date.now()}`
    const adminPost = await adminApi.workItemComments.add({
      body: { workItemId: taskId, content: adminComment },
    })
    expect(adminPost.status).toBe(200)

    // Volunteer reads the thread and sees admin's comment
    const volList = await volApi.workItemComments.list({ body: { workItemId: taskId } })
    expect(volList.status).toBe(200)
    expect(
      (volList.body as { comments: { content: string }[] }).comments.some(
        (c) => c.content === adminComment,
      ),
    ).toBe(true)

    // Volunteer replies
    const volunteerReply = `volunteer reply ${Date.now()}`
    const volPost = await volApi.workItemComments.add({
      body: { workItemId: taskId, content: volunteerReply },
    })
    expect(volPost.status).toBe(200)

    // Admin reads the thread and sees both messages
    const adminList = await adminApi.workItemComments.list({ body: { workItemId: taskId } })
    expect(adminList.status).toBe(200)
    const finalComments = (adminList.body as { comments: { content: string }[] }).comments
    expect(finalComments.some((c) => c.content === adminComment)).toBe(true)
    expect(finalComments.some((c) => c.content === volunteerReply)).toBe(true)
  })

  test('Admin deletes a task', async ({ adminPage, baseUrl }) => {
    test.setTimeout(60_000)
    const projectId = await adminCreateProjectViaApi(
      baseUrl,
      fake.projectTitle(),
      'Project for task deletion test',
    )
    await adminPage.goto(`${baseUrl}/projects/${projectId}#tasks`)
    await expect(adminPage.locator('#projectContent')).toBeVisible({ timeout: 10_000 })

    await adminPage.getByRole('button', { name: 'Add Task' }).click()
    await adminPage.getByLabel('Task title').fill('Task to delete')
    await adminPage.getByRole('button', { name: 'Create Task' }).click()
    await expect(getAlert(adminPage)).toContainText('Task added!', { timeout: 10_000 })

    await adminPage.getByRole('button', { name: 'Task actions for Task to delete' }).click()
    await adminPage.getByRole('menuitem', { name: 'Delete task' }).click()
    await adminPage.getByRole('dialog').getByRole('button', { name: 'Delete task' }).click()

    await expect(getAlert(adminPage)).toContainText('Task deleted!', { timeout: 10_000 })
    await expect(adminPage.getByText('Task to delete')).not.toBeVisible({ timeout: 10_000 })
  })
})
