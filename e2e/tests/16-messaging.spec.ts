import {
  test,
  expect,
  getAlert,
  approveVolunteer,
  confirmVolunteerEmail,
  dismissCookieConsentScript,
  createApprovedVolunteerNamed,
} from '../fixtures'
import { adminCreateProjectViaApi, transferProjectOwnership } from '../actions/projects'
import { fake } from '../fake'
import { createApiClient } from '../client'
import { goToInbox } from '../actions/dashboard'
import { connectVolunteers } from '../actions/contacts'

test.describe('Messaging', () => {
  test('Volunteer sends a contact message to another volunteer', async ({
    adminPage,
    volunteer,
    browser,
    baseUrl,
  }) => {
    const subject = fake.messageSubject()
    const body = fake.messageBody()

    const projectId = await adminCreateProjectViaApi(
      baseUrl,
      fake.projectTitle(),
      'Project for contact test',
    )
    await transferProjectOwnership(baseUrl, adminPage, projectId, volunteer.name)

    const sender = fake.person()
    const senderSignupResult = await createApiClient(baseUrl).auth.signup({
      body: {
        name: sender.name,
        email: sender.email,
        password: 'testpassword1',
        bio: 'e2e test bio, at least twenty characters long',
        country: 'UK',
        availabilityHoursPerWeek: 5,
        applicationMessage: 'e2e test application message',
        consentMakeProfileVisibleInDirectory: true,
        consentContactableByProjectOwners: true,
      },
    })
    if (senderSignupResult.status !== 200)
      throw new Error(`Sender signup failed: ${JSON.stringify(senderSignupResult.body)}`)
    const { id: senderId, token: senderToken, emailVerificationToken } = senderSignupResult.body
    // A project page is closed to an unconfirmed email.
    if (emailVerificationToken) await confirmVolunteerEmail(baseUrl, emailVerificationToken)
    await approveVolunteer(baseUrl, senderId, senderToken)
    // Messaging needs a working relationship or an accepted contact request.
    await volunteer.page.goto(`${baseUrl}/dashboard`)
    const ownerToken = await volunteer.page.evaluate(() => localStorage.getItem('authToken'))
    await connectVolunteers(baseUrl, senderToken, ownerToken!)
    const senderCtx = await browser.newContext()
    await senderCtx.addInitScript((token: string) => {
      localStorage.setItem('authToken', token)
    }, senderToken)
    await senderCtx.addInitScript(dismissCookieConsentScript)
    const senderPage = await senderCtx.newPage()

    try {
      await senderPage.goto(`${baseUrl}/projects/${projectId}`)
      await expect(senderPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })

      await senderPage.getByRole('button', { name: 'Message owner' }).click()

      // The recipient has consent_share_contact_info_with_project_owner = false (default), so the relay
      // form appears instead of direct contact details.
      const dialog = senderPage.getByRole('dialog')
      await expect(dialog.getByLabel('Subject')).toBeVisible({ timeout: 10_000 })

      await dialog.getByLabel('Subject').fill(subject)
      await dialog.getByLabel('Message').fill(body)
      await dialog.getByRole('button', { name: 'Send message' }).click()

      await expect(getAlert(senderPage)).toContainText('Message sent', { timeout: 10_000 })
    } finally {
      await senderCtx.close()
    }
  })

  test('Recipient sees a message notification', async ({
    adminPage,
    volunteer,
    browser,
    baseUrl,
  }) => {
    test.setTimeout(60_000)
    const subject = fake.messageSubject()

    const projectId = await adminCreateProjectViaApi(
      baseUrl,
      fake.projectTitle(),
      'Project for notification test',
    )
    await transferProjectOwnership(baseUrl, adminPage, projectId, volunteer.name)

    // Confirm the recipient starts with no unread messages.
    const messagesFilter = volunteer.page
      .getByRole('group', { name: 'Show' })
      .getByRole('button', { name: /^Messages/ })
    await goToInbox(baseUrl, volunteer.page)
    await expect(messagesFilter).toHaveText('Messages')

    // Sender sends the message.
    const sender = fake.person()
    const senderSignupResult = await createApiClient(baseUrl).auth.signup({
      body: {
        name: sender.name,
        email: sender.email,
        password: 'testpassword1',
        bio: 'e2e test bio, at least twenty characters long',
        country: 'UK',
        availabilityHoursPerWeek: 5,
        applicationMessage: 'e2e test application message',
        consentMakeProfileVisibleInDirectory: true,
        consentContactableByProjectOwners: true,
      },
    })
    if (senderSignupResult.status !== 200)
      throw new Error(`Sender signup failed: ${JSON.stringify(senderSignupResult.body)}`)
    const { id: senderId, token: senderToken, emailVerificationToken } = senderSignupResult.body
    // A project page is closed to an unconfirmed email.
    if (emailVerificationToken) await confirmVolunteerEmail(baseUrl, emailVerificationToken)
    await approveVolunteer(baseUrl, senderId, senderToken)
    // Messaging needs a working relationship or an accepted contact request.
    await volunteer.page.goto(`${baseUrl}/dashboard`)
    const ownerToken = await volunteer.page.evaluate(() => localStorage.getItem('authToken'))
    await connectVolunteers(baseUrl, senderToken, ownerToken!)
    const senderCtx = await browser.newContext()
    await senderCtx.addInitScript((token: string) => {
      localStorage.setItem('authToken', token)
    }, senderToken)
    await senderCtx.addInitScript(dismissCookieConsentScript)
    const senderPage = await senderCtx.newPage()

    try {
      await senderPage.goto(`${baseUrl}/projects/${projectId}`)
      await expect(senderPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })
      await senderPage.getByRole('button', { name: 'Message owner' }).click()
      const dialog = senderPage.getByRole('dialog')
      await expect(dialog.getByLabel('Subject')).toBeVisible({ timeout: 10_000 })
      await dialog.getByLabel('Subject').fill(subject)
      await dialog.getByLabel('Message').fill('Notification test body')
      await dialog.getByRole('button', { name: 'Send message' }).click()
      await expect(getAlert(senderPage)).toContainText('Message sent', { timeout: 10_000 })
    } finally {
      await senderCtx.close()
    }

    // Recipient opens the Inbox again: one unread message.
    await goToInbox(baseUrl, volunteer.page)
    await expect(messagesFilter).toHaveText('Messages1', { timeout: 10_000 })

    // The Messages tab lists the conversation; opening it shows the message and reads it.
    await messagesFilter.click()
    const conversation = volunteer.page.getByRole('link').filter({ hasText: subject })
    await expect(conversation).toContainText(sender.name, { timeout: 10_000 })
    await conversation.click()
    await expect(volunteer.page.getByRole('heading', { level: 1, name: subject })).toBeVisible({
      timeout: 10_000,
    })
    await expect(volunteer.page.getByText('Notification test body')).toBeVisible()
    await goToInbox(baseUrl, volunteer.page)
    await expect(messagesFilter).toHaveText('Messages', { timeout: 10_000 })
  })

  test('Both people see the conversation, and a reply reaches the other', async ({
    volunteer,
    baseUrl,
  }) => {
    const other = await createApprovedVolunteerNamed(baseUrl, fake.person().name)
    const subject = fake.messageSubject()
    await volunteer.page.goto(`${baseUrl}/dashboard`)
    const token = await volunteer.page.evaluate(() => localStorage.getItem('authToken'))
    const me = await createApiClient(baseUrl, token).auth.me()
    const volunteerId = (me.body as { id: number }).id
    await connectVolunteers(baseUrl, other.token, token!)
    const sent = await createApiClient(baseUrl, other.token).messages.send({
      body: { recipientId: volunteerId, subject, message: 'Are you coming on Saturday?' },
    })
    expect(sent.status).toBe(200)
    const { threadId } = sent.body as { threadId: number }

    const page = volunteer.page
    await page.goto(`${baseUrl}/inbox/messages/${threadId}`)
    await expect(page.getByText('Are you coming on Saturday?')).toBeVisible({ timeout: 10_000 })
    await page.getByLabel('Write a reply').fill('Yes, see you there')
    await page.getByRole('button', { name: 'Send reply' }).click()
    // The box empties only once the reply is saved; the text alone could still be the draft.
    await expect(page.getByLabel('Write a reply')).toHaveValue('', { timeout: 10_000 })
    await expect(page.getByText('Yes, see you there')).toBeVisible({ timeout: 10_000 })

    const theirs = await createApiClient(baseUrl, other.token).messages.thread({
      body: { id: threadId },
    })
    const bodies = (theirs.body as { messages: { body: string }[] }).messages.map((m) => m.body)
    expect(bodies).toEqual(['Are you coming on Saturday?', 'Yes, see you there'])
  })
})
