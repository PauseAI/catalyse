import { readFileSync } from 'fs'
import {
  test,
  expect,
  getAlert,
  approveVolunteer,
  confirmVolunteerEmail,
  dismissCookieConsentScript,
} from '../fixtures'
import { fake } from '../fake'
import { createSkillViaApi } from '../actions/skills'
import {
  adminCreateProjectViaApi,
  transferProjectOwnership,
  askToTakeTask,
} from '../actions/projects'
import { createApiClient } from '../client'
import { connectVolunteers } from '../actions/contacts'

test.describe('GDPR & Privacy', () => {
  test('Volunteer exports their personal data', async ({
    adminPage,
    volunteer,
    browser,
    baseUrl,
  }) => {
    test.setTimeout(120_000)
    // Add a skill to the volunteer's profile
    const skill = await createSkillViaApi(baseUrl)
    await volunteer.page.goto(`${baseUrl}/profile`)
    await expect(
      volunteer.page.locator('.skill-option').filter({ hasText: skill.name }),
    ).toBeVisible({ timeout: 10_000 })
    await volunteer.page
      .locator('label.skill-option')
      .filter({ hasText: new RegExp(`^\\s*${skill.name}\\s*$`) })
      .click()
    await volunteer.page.getByRole('button', { name: 'Save changes' }).click()
    await expect(getAlert(volunteer.page)).toContainText('Profile updated!', { timeout: 10_000 })

    // Admin creates a project and transfers ownership to the volunteer so they have a project in the
    // export and a contactable owner page for the inbound message step
    const volunteerProjectId = await adminCreateProjectViaApi(
      baseUrl,
      fake.projectTitle(),
      'GDPR export test project',
    )
    await transferProjectOwnership(baseUrl, adminPage, volunteerProjectId, volunteer.name)
    // The admin's part is done; a project page left open through the rest of
    // this long test drifts, and its final frame should be somewhere still.
    await adminPage.goto(`${baseUrl}/dashboard`)

    // Admin creates a seeking-help project (no owner); volunteer asks to take its task
    const seekingProjectId = await adminCreateProjectViaApi(
      baseUrl,
      fake.projectTitle(),
      'GDPR test seeking-help project',
    )
    await volunteer.page.goto(`${baseUrl}/projects/${seekingProjectId}`)
    await askToTakeTask(volunteer.page)

    // Sign up a second volunteer (vol2) — used as owner for the contact project and as the inbound sender
    const vol2 = fake.person()
    const vol2SignupResult = await createApiClient(baseUrl).auth.signup({
      body: {
        name: vol2.name,
        email: vol2.email,
        password: 'testpassword1',
        bio: 'e2e test bio, at least twenty characters long',
        country: 'UK',
        availabilityHoursPerWeek: 5,
        applicationMessage: 'e2e test application message',
        consentMakeProfileVisibleInDirectory: true,
        consentContactableByProjectOwners: true,
      },
    })
    if (vol2SignupResult.status !== 200)
      throw new Error(`vol2 signup failed: ${JSON.stringify(vol2SignupResult.body)}`)
    const {
      id: vol2Id,
      token: vol2Token,
      emailVerificationToken: vol2EmailToken,
    } = vol2SignupResult.body
    // A project page is closed to an unconfirmed email.
    if (vol2EmailToken) await confirmVolunteerEmail(baseUrl, vol2EmailToken)
    await approveVolunteer(baseUrl, vol2Id, vol2Token)
    // Messaging needs a working relationship or an accepted contact request.
    const volunteerToken = await volunteer.page.evaluate(() => localStorage.getItem('authToken'))
    await connectVolunteers(baseUrl, vol2Token, volunteerToken!)

    // Admin creates a project and transfers ownership to vol2 so it has a contactable owner
    const contactProjectId = await adminCreateProjectViaApi(
      baseUrl,
      fake.projectTitle(),
      'GDPR test contact project',
    )
    await transferProjectOwnership(baseUrl, adminPage, contactProjectId, vol2.name)

    // Volunteer contacts vol2 on that project — creates a messagesSent record
    await volunteer.page.goto(`${baseUrl}/projects/${contactProjectId}`)
    await expect(volunteer.page.getByRole('button', { name: 'Message owner' })).toBeVisible({
      timeout: 10_000,
    })
    await volunteer.page.getByRole('button', { name: 'Message owner' }).click()
    const outboundDialog = volunteer.page.getByRole('dialog')
    await expect(outboundDialog.getByLabel('Subject')).toBeVisible({ timeout: 10_000 })
    await outboundDialog.getByLabel('Subject').fill(fake.messageSubject())
    await outboundDialog.getByLabel('Message').fill(fake.messageBody())
    await outboundDialog.getByRole('button', { name: 'Send message' }).click()
    await expect(getAlert(volunteer.page)).toContainText('Message sent', { timeout: 10_000 })

    // vol2 contacts the volunteer on their approved project — creates a messagesReceived record
    const vol2Ctx = await browser.newContext()
    await vol2Ctx.addInitScript((token: string) => {
      localStorage.setItem('authToken', token)
    }, vol2Token)
    const vol2Page = await vol2Ctx.newPage()
    try {
      await vol2Page.goto(`${baseUrl}/projects/${volunteerProjectId}`)
      await expect(vol2Page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })
      await vol2Page.getByRole('button', { name: 'Message owner' }).click()
      const inboundDialog = vol2Page.getByRole('dialog')
      await expect(inboundDialog.getByLabel('Subject')).toBeVisible({ timeout: 10_000 })
      await inboundDialog.getByLabel('Subject').fill(fake.messageSubject())
      await inboundDialog.getByLabel('Message').fill(fake.messageBody())
      await inboundDialog.getByRole('button', { name: 'Send message' }).click()
      await expect(getAlert(vol2Page)).toContainText('Message sent', { timeout: 10_000 })
    } finally {
      await vol2Ctx.close()
    }

    // Export and verify every section has at least one record
    await volunteer.page.goto(`${baseUrl}/privacy`)
    await expect(volunteer.page.getByRole('heading', { name: 'Export Your Data' })).toBeVisible({
      timeout: 10_000,
    })

    const [download] = await Promise.all([
      volunteer.page.waitForEvent('download'),
      volunteer.page.getByRole('button', { name: 'Download my data' }).click(),
    ])

    await expect(getAlert(volunteer.page)).toContainText('Data exported successfully!', {
      timeout: 10_000,
    })

    const filePath = await download.path()
    expect(filePath).not.toBeNull()

    const data = JSON.parse(readFileSync(filePath!, 'utf8'))
    expect(data).toHaveProperty('profile')
    expect(data.skills.length).toBeGreaterThan(0)
    expect(data.projects.length).toBeGreaterThan(0)
    expect(data.interests.length).toBeGreaterThan(0)
    expect(data.messagesSent.length).toBeGreaterThan(0)
    expect(data.messagesReceived.length).toBeGreaterThan(0)
  })

  test('Contact handles stay hidden from a stranger until they accept a contact request', async ({
    volunteer,
    browser,
    baseUrl,
  }) => {
    const vol2 = fake.person()
    const discordHandle = fake.username()
    const signalNumber = fake.phoneNumber()
    const whatsappNumber = fake.phoneNumber()

    const signupResult = await createApiClient(baseUrl).auth.signup({
      body: {
        name: vol2.name,
        email: vol2.email,
        password: 'testpassword1',
        bio: 'e2e test bio, at least twenty characters long',
        country: 'UK',
        availabilityHoursPerWeek: 5,
        applicationMessage: 'e2e test application message',
        consentMakeProfileVisibleInDirectory: true,
        consentContactableByProjectOwners: true,
      },
    })
    if (signupResult.status !== 200)
      throw new Error(`vol2 signup failed: ${JSON.stringify(signupResult.body)}`)
    const { id: vol2Id, token: vol2Token } = signupResult.body
    await approveVolunteer(baseUrl, vol2Id, vol2Token)
    const ctx2 = await browser.newContext()
    await ctx2.addInitScript((token: string) => {
      localStorage.setItem('authToken', token)
    }, vol2Token)
    await ctx2.addInitScript(dismissCookieConsentScript)
    const page2 = await ctx2.newPage()

    try {
      await page2.goto(`${baseUrl}/settings`)
      await expect(page2.getByLabel('Discord handle')).toBeVisible({ timeout: 10_000 })

      await page2.getByLabel('Discord handle').fill(discordHandle)
      await page2.getByLabel('Signal').fill(signalNumber)
      await page2.getByLabel('WhatsApp').fill(whatsappNumber)

      // Switch to Privacy & data tab to configure visibility and contact sharing
      await page2.getByRole('tab', { name: 'Privacy & data' }).click()

      // Listed in the directory, so others can find them and ask to connect.
      await page2.getByLabel('Show me in the volunteer directory').check()

      await page2.getByRole('button', { name: 'Save changes' }).click()
      await expect(getAlert(page2)).toContainText('Profile updated!', { timeout: 10_000 })

      // The results list keeps re-rendering (debounced search refetch) for a bit after
      // the link appears, and can occasionally swallow a click mid-render or land it on a
      // neighbouring row. Retry the whole visit, search, click and check as a unit rather than
      // assume a single click always opens the right profile.
      await expect(async () => {
        await volunteer.page.goto(`${baseUrl}/volunteers`)
        await volunteer.page.getByLabel('Search').fill(vol2.name)
        const link = volunteer.page.getByRole('link', { name: vol2.name })
        await expect(link).toBeVisible({ timeout: 10_000 })
        await link.click()
        await expect(volunteer.page).toHaveURL(/\/volunteers\/\d+$/, { timeout: 3_000 })
        await expect(
          volunteer.page.getByRole('heading', { name: vol2.name, level: 1 }),
        ).toBeVisible({ timeout: 5_000 })
      }).toPass({ timeout: 60_000 })

      await expect(volunteer.page.getByText(discordHandle)).not.toBeVisible()
      await expect(volunteer.page.getByText(signalNumber)).not.toBeVisible()
      await expect(volunteer.page.getByText(whatsappNumber)).not.toBeVisible()

      // The stranger asks to connect; vol2 accepts from their Inbox; the handles appear.
      await volunteer.page.getByRole('button', { name: 'Request contact' }).click()
      const ask = volunteer.page.getByRole('dialog', { name: `Connect with ${vol2.name}` })
      await ask
        .getByLabel('Why would you like to connect?')
        .fill('I run a stall nearby and would like to work together.')
      await ask.getByRole('button', { name: 'Send request' }).click()
      await expect(getAlert(volunteer.page)).toContainText('Request sent', { timeout: 10_000 })

      await page2.goto(`${baseUrl}/inbox`)
      const row = page2.getByRole('listitem').filter({ hasText: 'would like to connect' })
      await row.getByRole('button', { name: 'Accept' }).click()
      await expect(getAlert(page2)).toContainText('Answer sent', { timeout: 10_000 })

      await volunteer.page.reload()
      await expect(volunteer.page.getByText(discordHandle)).toBeVisible({ timeout: 10_000 })
      await expect(volunteer.page.getByRole('button', { name: 'Message' })).toBeVisible()
    } finally {
      await ctx2.close()
    }
  })
})
