import fs from 'fs'
import path from 'path'
import {
  test,
  expect,
  getAlert,
  confirmVolunteerEmail,
  approveVolunteer,
  readAdminToken,
} from '../fixtures'
import { createApiClient } from '../client'
import { fake } from '../fake'
import { selectFilterDropdown } from '../actions/ui'
import { openNewProjectForm } from '../actions/projects'
import { IS_LOCAL } from '../config'

const STUB_EMAIL_DIR = '/tmp/catalyse-emails'

// Every fragment must appear in the email body for it to count.
function countStubEmails(sinceMs: number, contentIncludes: string[]): number {
  if (!fs.existsSync(STUB_EMAIL_DIR)) return 0
  let count = 0
  for (const file of fs.readdirSync(STUB_EMAIL_DIR)) {
    const full = path.join(STUB_EMAIL_DIR, file)
    let mtimeMs: number
    try {
      mtimeMs = fs.statSync(full).mtimeMs
    } catch {
      continue // file removed by a concurrent worker between readdir and stat
    }
    if (mtimeMs < sinceMs) continue
    const html = fs.readFileSync(full, 'utf-8')
    if (contentIncludes.every((fragment) => html.includes(fragment))) count++
  }
  return count
}

// The greeting line as it is rendered in the email body (names such as O'Brien are escaped).
function greeting(name: string): string {
  return `Hi ${name.replace(/&/g, '&amp;').replace(/'/g, '&#39;')},`
}

// Polls until at least one matching stub email appears (or the timeout elapses), then
// returns however many matched. A project's immediate match-alert fan-out fires all
// recipients' sends together, so once the first lands the rest have had their chance too.
async function waitForStubEmailCount(
  sinceMs: number,
  contentIncludes: string[],
  timeoutMs: number,
): Promise<number> {
  const deadline = Date.now() + timeoutMs
  let count = 0
  while (Date.now() < deadline) {
    count = countStubEmails(sinceMs, contentIncludes)
    if (count > 0) break
    await new Promise((r) => setTimeout(r, 300))
  }
  return count
}

async function createMatchingVolunteer(
  baseUrl: string,
  country: string,
  notifyRemoteProjects: boolean,
  skillIds: number[],
): Promise<{ id: number; name: string }> {
  const person = fake.person()
  const api = createApiClient(baseUrl)
  const signup = await api.auth.signup({
    body: {
      name: person.name,
      email: person.email,
      password: 'testpassword1',
      bio: 'e2e test bio, at least twenty characters long',
      country,
      availabilityHoursPerWeek: 5,
      applicationMessage: 'e2e test application message',
      consentMakeProfileVisibleInDirectory: true,
      consentContactableByProjectOwners: true,
    },
  })
  if (signup.status !== 200) throw new Error(`Signup failed: ${JSON.stringify(signup.body)}`)
  const { id, token, emailVerificationToken } = signup.body as {
    id: number
    token: string
    emailVerificationToken?: string
  }
  if (emailVerificationToken) await confirmVolunteerEmail(baseUrl, emailVerificationToken)
  await approveVolunteer(baseUrl, id, token)

  const selfApi = createApiClient(baseUrl, token)
  const update = await selfApi.volunteers.updateMe({
    body: { emailDigest: 'match', notifyRemoteProjects, skillIds },
  })
  if (update.status !== 200) throw new Error(`updateMe failed: ${JSON.stringify(update.body)}`)

  return { id, name: person.name }
}

async function adminCreateRemoteProject(
  baseUrl: string,
  title: string,
  remoteEligibility: 'NONE' | 'COUNTRY' | 'GLOBAL',
  skillIds: number[],
): Promise<void> {
  const adminApi = createApiClient(baseUrl, readAdminToken(baseUrl))
  const created = await adminApi.admin.projects.create({
    body: {
      title,
      description: 'e2e test project description, remote eligibility',
      projectType: null,
      estimatedDuration: null,
      timeCommitmentHoursPerWeek: null,
      urgency: 'medium',
      collaborationLink: null,
      country: 'Australia',
      localGroup: null,
      remoteEligibility,
      isSeekingHelp: true,
      skillIds,
      skillRequiredMap: Object.fromEntries(skillIds.map((id) => [id, true])),
      tasks: [{ title: 'Initial task' }],
    },
  })
  if (created.status !== 200)
    throw new Error(`Project creation failed: ${JSON.stringify(created.body)}`)
}

async function getSeededSkillIds(baseUrl: string): Promise<number[]> {
  const api = createApiClient(baseUrl)
  const result = await api.skills.list()
  if (result.status !== 200) throw new Error(`skills.list failed: ${JSON.stringify(result.body)}`)
  const categories = result.body as Array<{ skills: Array<{ id: number; name: string }> }>
  const allSkills = categories.flatMap((c) => c.skills)
  const skillA = allSkills.find((s) => s.name === 'Web Development')
  const skillB = allSkills.find((s) => s.name === 'Software Engineering')
  if (!skillA || !skillB)
    throw new Error('Expected seeded skills "Web Development" / "Software Engineering" not found')
  return [skillA.id, skillB.id]
}

test.describe('Project form & settings: remote eligibility', () => {
  test('Admin can mark a project remote-eligible and it persists', async ({
    adminPage,
    baseUrl,
  }) => {
    const title = fake.projectTitle()

    await adminPage.goto(`${baseUrl}/admin/projects/new`)
    await openNewProjectForm(adminPage)

    await adminPage.getByLabel('Project title').fill(title)
    await adminPage.getByLabel('Description').fill('e2e test project description')
    await selectFilterDropdown(
      adminPage,
      'Select remote eligibility',
      'Yes - remote OK, from any country',
    )
    await adminPage.locator('#new-task-title').fill('Initial task')
    await adminPage.getByRole('button', { name: 'Add task' }).click()
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
    await volunteer.page.getByRole('button', { name: 'Save changes' }).click()
    await expect(getAlert(volunteer.page)).toBeVisible({ timeout: 10_000 })

    await volunteer.page.reload()
    await expect(
      volunteer.page.getByLabel(/Also alert me about remote-friendly projects/),
    ).toBeChecked({ timeout: 10_000 })
  })
})

test.describe('Match alerts respect remote eligibility & country opt-in', () => {
  test('GLOBAL remote project alerts an opted-in out-of-country volunteer, not an opted-out one', async ({
    baseUrl,
  }) => {
    test.skip(!IS_LOCAL, 'reads the stub email directory on the app server host')

    const skillIds = await getSeededSkillIds(baseUrl)
    // Two UK volunteers matching on skills; only one has opted in to cross-country alerts.
    const optedIn = await createMatchingVolunteer(baseUrl, 'UK', true, skillIds)
    const optedOut = await createMatchingVolunteer(baseUrl, 'UK', false, skillIds)

    const sinceMs = Date.now()
    const title = fake.projectTitle()
    await adminCreateRemoteProject(baseUrl, title, 'GLOBAL', skillIds)

    // Counted per recipient: other tests sharing this worker's database leave opted-in
    // volunteers of their own behind, who are alerted about this project too.
    const count = await waitForStubEmailCount(sinceMs, [title, greeting(optedIn.name)], 15_000)
    expect(count).toBe(1)
    expect(countStubEmails(sinceMs, [title, greeting(optedOut.name)])).toBe(0)
  })

  test('NONE-eligibility project does not alert an out-of-country volunteer even if opted in', async ({
    baseUrl,
  }) => {
    test.skip(!IS_LOCAL, 'reads the stub email directory on the app server host')

    const skillIds = await getSeededSkillIds(baseUrl)
    await createMatchingVolunteer(baseUrl, 'UK', true, skillIds)

    const sinceMs = Date.now()
    const title = fake.projectTitle()
    await adminCreateRemoteProject(baseUrl, title, 'NONE', skillIds)

    const count = await waitForStubEmailCount(sinceMs, [title], 5_000)
    expect(count).toBe(0)
  })
})
