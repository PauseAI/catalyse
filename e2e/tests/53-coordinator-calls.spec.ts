import { test, expect, getAlert } from '../fixtures'
import { createApprovedVolunteerNamed, readAdminToken, signedInPage } from '../fixtures'
import { createApiClient } from '../client'
import { fake } from '../fake'
import { createSkillViaApi } from '../actions/skills'

// A coordinator puts out a call to every chapter; a volunteer hidden from the directory gets it
// and, by answering, is the first the coordinator learns of them.
test.describe('Coordinator calls', () => {
  test('A coordinator puts out a call and reads a hidden volunteer’s answer', async ({
    browser,
    baseUrl,
    snap,
  }) => {
    const adminApi = createApiClient(baseUrl, readAdminToken(baseUrl))
    const coordinator = await createApprovedVolunteerNamed(baseUrl, fake.personName())
    const appointed = await adminApi.admin.coordinators.appoint({
      body: { volunteerId: coordinator.id, remit: 'Media' },
    })
    expect(appointed.status).toBe(200)
    const hidden = await createApprovedVolunteerNamed(baseUrl, fake.personName(), { hidden: true })
    const title = fake.projectTitle()

    const coordinating = await signedInPage(browser, coordinator.token)
    await coordinating.goto(`${baseUrl}/coordinate`)
    await coordinating.getByLabel('Title').fill(title)
    await coordinating.getByLabel('What you are asking for').fill('Photos of your next event')
    await coordinating.getByRole('button', { name: 'Send call' }).click()
    await expect(coordinating.getByText('Your call is on its way to volunteers')).toBeVisible()
    const sent = coordinating.locator('section').filter({ hasText: title })
    await expect(sent.getByRole('button', { name: 'Answers (0)' })).toBeVisible()
    await snap(coordinating, 'call sent')

    const answering = await signedInPage(browser, hidden.token)
    await answering.goto(`${baseUrl}/calls`)
    const received = answering.getByRole('region', { name: title })
    await expect(received.getByText(`${coordinator.name} · Media coordinator`)).toBeVisible()
    await received.getByLabel('Answer this call').fill('I photograph every event in my city')
    await snap(answering, 'answer drafted')
    await received.getByRole('button', { name: 'Send answer' }).click()
    await expect(answering.getByText(/the coordinator can now see your answer/)).toBeVisible()

    await coordinating.reload()
    await sent.getByRole('button', { name: 'Answers (1)' }).click()
    await expect(sent.getByText(hidden.name)).toBeVisible()
    await expect(sent.getByRole('link', { name: hidden.email })).toBeVisible()
    await expect(sent.getByText('I photograph every event in my city')).toBeVisible()

    await answering.reload()
    await received.getByRole('button', { name: 'Withdraw answer' }).click()
    await expect(answering.getByText('Your answer is withdrawn')).toBeVisible()
    await coordinating.reload()
    await expect(sent.getByRole('button', { name: 'Answers (0)' })).toBeVisible()
  })

  test('A volunteer answers a call that asks for skills they have not listed', async ({
    browser,
    baseUrl,
    snap,
  }) => {
    const adminApi = createApiClient(baseUrl, readAdminToken(baseUrl))
    const coordinator = await createApprovedVolunteerNamed(baseUrl, fake.personName())
    await adminApi.admin.coordinators.appoint({
      body: { volunteerId: coordinator.id, remit: 'Media' },
    })
    const skills = [await createSkillViaApi(baseUrl), await createSkillViaApi(baseUrl)]
    const volunteer = await createApprovedVolunteerNamed(baseUrl, fake.personName())
    const title = fake.projectTitle()

    const coordinating = await signedInPage(browser, coordinator.token)
    await coordinating.goto(`${baseUrl}/coordinate`)
    await coordinating.getByLabel('Title').fill(title)
    await coordinating.getByLabel('What you are asking for').fill('Drone footage of the march')
    for (const skill of skills) {
      await coordinating.getByRole('button', { name: 'Skills it asks for' }).click()
      await coordinating.getByRole('searchbox', { name: 'Skills it asks for' }).fill(skill.name)
      await coordinating.getByRole('option', { name: skill.name, exact: true }).click()
    }
    const chosen = coordinating.getByRole('list', { name: 'Skills it asks for: chosen' })
    await expect(chosen.getByRole('listitem')).toHaveCount(2)
    await snap(coordinating, 'call asking for two skills')
    await coordinating.getByRole('button', { name: 'Send call' }).click()
    await expect(coordinating.getByText('Your call is on its way to volunteers')).toBeVisible()

    const answering = await signedInPage(browser, volunteer.token)
    await answering.goto(`${baseUrl}/calls`)
    const other = answering.getByRole('region', { name: 'Other calls' })
    const received = other.getByRole('region', { name: title })
    const names = skills.map((k) => k.name).sort((a, b) => a.localeCompare(b))
    await expect(received.getByText(`Asks for ${names[0]} or ${names[1]}`)).toBeVisible()
    await snap(answering, 'call outside my skills')
    await received.getByLabel('Answer this call').fill('I can borrow a drone')
    await received.getByRole('button', { name: 'Send answer' }).click()
    await expect(answering.getByText(/the coordinator can now see your answer/)).toBeVisible()

    await coordinating.reload()
    const sent = coordinating.locator('section').filter({ hasText: title })
    await sent.getByRole('button', { name: 'Answers (1)' }).click()
    await expect(sent.getByText(volunteer.name)).toBeVisible()
  })

  test('A coordinator finds a hidden volunteer in the directory and messages them', async ({
    browser,
    baseUrl,
    snap,
  }) => {
    const adminApi = createApiClient(baseUrl, readAdminToken(baseUrl))
    const coordinator = await createApprovedVolunteerNamed(baseUrl, fake.personName())
    await adminApi.admin.coordinators.appoint({
      body: { volunteerId: coordinator.id, remit: null },
    })
    const hidden = await createApprovedVolunteerNamed(baseUrl, fake.personName(), { hidden: true })
    const subject = fake.messageSubject()

    const page = await signedInPage(browser, coordinator.token)
    await page.goto(`${baseUrl}/volunteers`)
    await page.getByLabel('Search').fill(hidden.name)
    await page.getByRole('link', { name: hidden.name }).click()
    await expect(page.getByRole('heading', { level: 1, name: hidden.name })).toBeVisible()
    await page.getByRole('button', { name: 'Message', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Subject').fill(subject)
    await dialog.getByLabel('Message').fill('Could we use your photos from the march?')
    await snap(page, 'message to hidden volunteer')
    await dialog.getByRole('button', { name: 'Send message' }).click()
    await expect(getAlert(page)).toContainText('Message sent')

    const inbox = await signedInPage(browser, hidden.token)
    await inbox.goto(`${baseUrl}/inbox`)
    await expect(inbox.getByText(subject)).toBeVisible()
  })
})
