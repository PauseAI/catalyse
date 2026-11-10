import { test, expect } from '../fixtures'
import { createApprovedVolunteerNamed, readAdminToken, signedInPage } from '../fixtures'
import { createApiClient } from '../client'
import { fake } from '../fake'

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
    const received = answering.locator('section').filter({ hasText: title })
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
})
