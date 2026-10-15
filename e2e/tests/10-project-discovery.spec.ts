import type { Browser } from '@playwright/test'
import { test, expect, createPendingVolunteer, dismissCookieConsentScript } from '../fixtures'
import { adminCreateProjectViaApi } from '../actions/projects'
import { fake } from '../fake'

// Both the project list and individual project pages redirect unauthenticated
// visitors to /login via `useRequireApproved`. There is no public / unauthenticated
// view of projects — the underlying oRPC procedures require an approved, logged-in
// volunteer too. `/` is the public landing page and deliberately shows no project data.
test.describe('Unauthenticated Project Access', () => {
  test('Visitor browses the project list unauthenticated', async ({ page, baseUrl }) => {
    await page.goto(`${baseUrl}/projects`)
    await page.waitForURL(`${baseUrl}/login**`, { timeout: 10_000 })
  })

  test('Visitor sees the public landing page and no project data', async ({ page, baseUrl }) => {
    const title = fake.projectTitle()
    await adminCreateProjectViaApi(baseUrl, title, 'A project that must not leak to visitors')

    await page.goto(`${baseUrl}/`)

    await expect(page.getByRole('heading', { name: 'Volunteer for PauseAI' })).toBeVisible({
      timeout: 10_000,
    })
    // The CTA appears in both the hero and the closing section
    await expect(page.getByRole('link', { name: 'Apply to join' }).first()).toBeVisible()
    await expect(page.getByText(title)).toHaveCount(0)
    // Still on the landing page — no redirect to /login
    await expect(page).toHaveURL(`${baseUrl}/`)
  })

  // `/` is statically prerendered, so anything on it that branches on
  // AuthProvider's `loading` hydrates differently to the server HTML — `loading`
  // is seeded from localStorage, making it false on the server and true on the
  // client whenever a token is present. Regression guard for that mismatch.
  test('Landing page hydrates cleanly with a token in localStorage', async ({
    browser,
    baseUrl,
  }) => {
    const context = await browser.newContext()
    await context.addInitScript(() => localStorage.setItem('authToken', 'not-a-real-token'))
    await context.addInitScript(dismissCookieConsentScript)
    const page = await context.newPage()
    const errors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })
    page.on('pageerror', (e) => errors.push(String(e)))

    try {
      await page.goto(`${baseUrl}/`)
      await expect(page.getByRole('heading', { name: 'Volunteer for PauseAI' })).toBeVisible({
        timeout: 10_000,
      })
      await page.waitForLoadState('networkidle')

      expect(errors.filter((e) => /hydrat/i.test(e))).toEqual([])
    } finally {
      await context.close()
    }
  })

  test('Visitor views a project detail page unauthenticated', async ({ page, baseUrl }) => {
    const projectId = await adminCreateProjectViaApi(
      baseUrl,
      fake.projectTitle(),
      'A project for the unauthenticated access test',
    )

    await page.goto(`${baseUrl}/projects/${projectId}`)
    await page.waitForURL(`${baseUrl}/login**`, { timeout: 10_000 })
  })
})

// Unapproved volunteers can log in and reach their dashboard, but browsing projects
// is gated behind approval — `useRequireApproved` bounces them back to /dashboard.
test.describe('Pending Volunteer Project Access', () => {
  async function pendingVolunteerPage(browser: Browser, baseUrl: string) {
    const pending = await createPendingVolunteer(baseUrl)
    const context = await browser.newContext()
    await context.addInitScript((token: string) => {
      localStorage.setItem('authToken', token)
    }, pending.token)
    await context.addInitScript(dismissCookieConsentScript)
    const page = await context.newPage()
    return { page, context }
  }

  test('Pending volunteer is redirected away from the project list', async ({
    browser,
    baseUrl,
  }) => {
    const { page, context } = await pendingVolunteerPage(browser, baseUrl)

    await page.goto(`${baseUrl}/projects`)
    await page.waitForURL(`${baseUrl}/dashboard**`, { timeout: 10_000 })

    await context.close()
  })

  test('Pending volunteer is redirected away from a project detail page', async ({
    browser,
    baseUrl,
  }) => {
    const projectId = await adminCreateProjectViaApi(
      baseUrl,
      fake.projectTitle(),
      'A project for the pending-volunteer access test',
    )
    const { page, context } = await pendingVolunteerPage(browser, baseUrl)

    await page.goto(`${baseUrl}/projects/${projectId}`)
    await page.waitForURL(`${baseUrl}/dashboard**`, { timeout: 10_000 })

    await context.close()
  })
})

test.describe('Project Discovery', () => {
  test('Volunteer searches projects by keyword', async ({ volunteer, baseUrl }) => {
    const title = fake.projectTitle()
    await adminCreateProjectViaApi(baseUrl, title, 'A searchable project for discovery tests')

    await volunteer.page.goto(`${baseUrl}/projects`)
    await expect(
      volunteer.page.getByRole('heading', { name: 'Projects', exact: true }),
    ).toBeVisible({ timeout: 10_000 })

    await volunteer.page.getByLabel('Search').fill(title)
    // Debounce is 300 ms; wait for the result to arrive
    await expect(volunteer.page.getByRole('link', { name: title })).toBeVisible({ timeout: 5_000 })
  })

  test('Volunteer filters projects by "Seeking help" status', async ({ volunteer, baseUrl }) => {
    const title = fake.projectTitle()
    // Admin-created projects have is_seeking_help = true by default
    await adminCreateProjectViaApi(baseUrl, title, 'Project for seeking-filter discovery test')

    await volunteer.page.goto(`${baseUrl}/projects`)
    await expect(
      volunteer.page.getByRole('heading', { name: 'Projects', exact: true }),
    ).toBeVisible({ timeout: 10_000 })

    await volunteer.page.getByRole('button', { name: 'Needs filter' }).click()
    await volunteer.page.getByRole('option', { name: 'Seeking help' }).click()

    await expect(volunteer.page.getByRole('link', { name: title })).toBeVisible({ timeout: 5_000 })
  })
})
