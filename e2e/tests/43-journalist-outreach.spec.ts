import { test, expect } from '../fixtures'
import { fake } from '../fake'

const OUTREACH = '/people-for-a-pause-protest-journalist-outreach'
const ADMIN = `/admin${OUTREACH}`

const HEADER = 'First name,Last name,Email,Organisation,Leaning,Interests/areas of activity'

function journalist(): { firstName: string; lastName: string; email: string; org: string } {
  const person = fake.person()
  const [firstName, ...rest] = person.name.split(' ')
  return {
    firstName,
    lastName: rest.join(' '),
    email: person.email,
    org: `${fake.skillCategory()} Gazette`,
  }
}

async function importJournalists(
  adminPage: import('@playwright/test').Page,
  baseUrl: string,
  rows: ReturnType<typeof journalist>[],
): Promise<void> {
  await adminPage.goto(`${baseUrl}${ADMIN}`)
  await expect(adminPage.getByRole('heading', { name: 'Journalist Outreach' })).toBeVisible({
    timeout: 10_000,
  })
  const csv = [
    HEADER,
    ...rows.map((r) => `${r.firstName},${r.lastName},${r.email},${r.org},D,AI policy`),
  ].join('\n')
  await adminPage.locator('#journalist-csv').fill(csv)
  await adminPage.getByRole('button', { name: 'Preview' }).click()
  await expect(adminPage.getByRole('heading', { name: `${rows.length} new` })).toBeVisible({
    timeout: 10_000,
  })
  await adminPage.getByRole('button', { name: `Import ${rows.length}` }).click()
  await expect(adminPage.getByRole('heading', { name: `${rows.length} new` })).toBeHidden({
    timeout: 10_000,
  })
}

/** The address in the drafted email's "To" field: the journalist the page handed out. */
async function claimedTo(page: import('@playwright/test').Page): Promise<string> {
  const email = await page
    .getByText('To', { exact: true })
    .locator('xpath=../following-sibling::div[1]')
    .textContent({ timeout: 10_000 })
  expect(email ?? '').toContain('@')
  return (email ?? '').trim()
}

test.describe('Journalist outreach', () => {
  test('Admin previews a CSV, sees an invalid row called out, and imports the rest', async ({
    adminPage,
    baseUrl,
    snap,
  }) => {
    const good = journalist()
    await adminPage.goto(`${baseUrl}${ADMIN}`)
    await expect(adminPage.getByRole('heading', { name: 'Journalist Outreach' })).toBeVisible({
      timeout: 10_000,
    })
    await snap(adminPage, 'empty list')

    const csv = [
      HEADER,
      `${good.firstName},${good.lastName},${good.email},${good.org},D,AI policy`,
      `Nobody,Nowhere,not-an-email,${good.org},D,`,
    ].join('\n')
    await adminPage.locator('#journalist-csv').fill(csv)
    await adminPage.getByRole('button', { name: 'Preview' }).click()
    await expect(adminPage.getByRole('heading', { name: '1 new' })).toBeVisible({
      timeout: 10_000,
    })
    await expect(adminPage.getByRole('heading', { name: '1 invalid' })).toBeVisible()
    await snap(adminPage, 'preview with an invalid row')

    await adminPage.getByRole('button', { name: 'Import 1' }).click()
    const table = adminPage.locator('table')
    await expect(table).toContainText(good.email, { timeout: 10_000 })
    await expect(table).toContainText('available')
  })

  test('A CSV missing a required column imports nothing', async ({ adminPage, baseUrl }) => {
    await adminPage.goto(`${baseUrl}${ADMIN}`)
    await adminPage.locator('#journalist-csv').fill('First name,Email\nJane,jane@example.com')
    await adminPage.getByRole('button', { name: 'Preview' }).click()
    await expect(adminPage.getByRole('alert').filter({ hasText: /missing/i })).toBeVisible({
      timeout: 10_000,
    })
    await expect(adminPage.getByRole('button', { name: /^Import/ })).toBeDisabled()
  })

  test('A logged-in volunteer claims a journalist, sees the drafted email, and marks it sent', async ({
    adminPage,
    volunteer,
    baseUrl,
    snap,
  }) => {
    const target = journalist()
    await importJournalists(adminPage, baseUrl, [target])

    await volunteer.page.goto(`${baseUrl}${OUTREACH}`)
    await expect(
      volunteer.page.getByRole('heading', { name: 'People for a Pause: journalist outreach' }),
    ).toBeVisible({ timeout: 10_000 })
    await snap(volunteer.page, 'request a link')
    await volunteer.page.getByRole('button', { name: `Continue as ${volunteer.email}` }).click()
    await expect(volunteer.page.getByText(`Signed in as ${volunteer.email}`)).toBeVisible({
      timeout: 10_000,
    })

    const claim = volunteer.page.getByRole('button', { name: 'Get a journalist' })
    await expect(claim).toBeDisabled()
    await volunteer.page.getByLabel('Your name (signs the email)').fill(volunteer.name)
    await expect(claim).toBeEnabled()
    await claim.click()

    // The server hands out whichever journalist is first in line, which may be one an
    // earlier test imported, so the card names the one this test then follows.
    const card = volunteer.page.locator('h2').first()
    await expect(card).toBeVisible({ timeout: 10_000 })
    const claimedEmail = await claimedTo(volunteer.page)
    await volunteer.page
      .getByLabel('Your personal opening sentence')
      .fill('I read your piece on the AI summit last week.')
    await snap(volunteer.page, 'email drafted')

    await volunteer.page.getByRole('button', { name: 'I have sent it' }).click()
    await expect(volunteer.page.getByRole('dialog')).toContainText('Definitely sent?')
    await volunteer.page.getByRole('button', { name: "Yes, it's sent" }).click()
    await expect(volunteer.page.getByRole('heading', { name: 'Thank you!' })).toBeVisible({
      timeout: 10_000,
    })
    await expect(volunteer.page.getByText("you've contacted 1")).toBeVisible()

    // The admin's list records the send.
    await adminPage.reload()
    const row = adminPage.locator('tbody tr').filter({ hasText: claimedEmail })
    await expect(row).toContainText('contacted', { timeout: 10_000 })
  })

  test('Skipping a journalist releases them for someone else', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    const target = journalist()
    await importJournalists(adminPage, baseUrl, [target])

    await volunteer.page.goto(`${baseUrl}${OUTREACH}`)
    await volunteer.page.getByRole('button', { name: `Continue as ${volunteer.email}` }).click()
    await volunteer.page.getByLabel('Your name (signs the email)').fill(volunteer.name)
    await volunteer.page.getByRole('button', { name: 'Get a journalist' }).click()
    const card = volunteer.page.locator('h2').first()
    await expect(card).toBeVisible({ timeout: 10_000 })
    const claimedName = (await card.textContent()) ?? ''
    const claimedEmail = await claimedTo(volunteer.page)

    await adminPage.reload()
    const row = adminPage.locator('tbody tr').filter({ hasText: claimedEmail })
    await expect(row).toContainText('claimed', { timeout: 10_000 })

    await volunteer.page.getByRole('button', { name: 'Skip this journalist' }).click()
    await expect(volunteer.page.getByRole('heading', { name: claimedName })).toBeHidden({
      timeout: 10_000,
    })

    await adminPage.reload()
    await expect(row).toContainText('available', { timeout: 10_000 })
  })

  test('Pausing outreach turns volunteers away with a message', async ({
    adminPage,
    volunteer,
    baseUrl,
    snap,
  }) => {
    await adminPage.goto(`${baseUrl}${ADMIN}`)
    // The switch's input is visually hidden, so the label takes the click.
    const pause = adminPage.getByRole('checkbox', { name: /Pause outreach/ })
    const pauseLabel = adminPage.getByText(/Pause outreach/)
    await expect(pause).toBeEnabled({ timeout: 10_000 })
    await pauseLabel.click()
    await expect(pause).toBeChecked()

    await volunteer.page.goto(`${baseUrl}${OUTREACH}`)
    await expect(
      volunteer.page.getByText("We're adjusting our approach to contacting journalists"),
    ).toBeVisible({ timeout: 10_000 })
    await snap(volunteer.page, 'paused')

    await expect(pause).toBeEnabled()
    await pauseLabel.click()
    await expect(pause).not.toBeChecked()
    await volunteer.page.reload()
    await expect(volunteer.page.getByLabel('Your email')).toBeVisible({ timeout: 10_000 })
  })

  test('A visitor without a link is asked for their email', async ({ browser, baseUrl }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    try {
      await page.goto(`${baseUrl}${OUTREACH}`)
      await expect(page.getByLabel('Your email')).toBeVisible({ timeout: 10_000 })
      await expect(page.getByRole('button', { name: /Continue as/ })).toBeHidden()
      await page.getByLabel('Your email').fill(fake.uniqueEmail())
      await page.getByRole('button', { name: 'Send me a link' }).click()
      await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible({
        timeout: 10_000,
      })
    } finally {
      await context.close()
    }
  })
})
