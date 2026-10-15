import { test, expect } from '../fixtures'
import { adminCreateProjectViaApi } from '../actions/projects'
import { fake } from '../fake'

test.describe('Search and filter UX', () => {
  test('Clicking a volunteer search result right after typing is not cancelled by the debounced URL sync', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    await adminPage.goto(`${baseUrl}/volunteers`)
    await expect(
      adminPage.getByRole('heading', { name: 'Volunteer Directory', level: 1 }),
    ).toBeVisible({ timeout: 10_000 })
    await expect(adminPage.locator('#volunteersList .loading')).not.toBeVisible({
      timeout: 10_000,
    })

    // The debounced URL write fires ~300ms after the fill below; clicking straight away
    // (no artificial wait) is the regression window for the router.replace() race this
    // guards against — a cancelled click here means we're back to the old bug. The results
    // list itself can also still re-render (keepPreviousData swap) right as the click
    // lands and swallow it, so retry the whole search+click as a unit rather than assume
    // a single click always lands.
    await expect(async () => {
      await adminPage.getByLabel('Search').fill(volunteer.name)
      const card = adminPage.locator('.card').filter({ hasText: volunteer.name }).first()
      await expect(card).toBeVisible({ timeout: 10_000 })
      await card.getByRole('link', { name: 'View profile' }).click()
      await expect(adminPage).toHaveURL(/\/volunteers\/\d+$/, { timeout: 3_000 })
    }).toPass({ timeout: 30_000 })

    await expect(adminPage.getByRole('heading', { name: volunteer.name, level: 1 })).toBeVisible({
      timeout: 10_000,
    })
  })

  test('Clicking a project search result right after typing is not cancelled by the debounced URL sync', async ({
    volunteer,
    baseUrl,
  }) => {
    const title = fake.projectTitle()
    await adminCreateProjectViaApi(baseUrl, title, 'Search-click race regression test')

    await volunteer.page.goto(`${baseUrl}/projects`)
    await expect(
      volunteer.page.getByRole('heading', { name: 'Projects', exact: true }),
    ).toBeVisible({ timeout: 10_000 })

    // See the volunteer-search test above for why this is wrapped in a retry.
    await expect(async () => {
      await volunteer.page.getByLabel('Search').fill(title)
      const link = volunteer.page.getByRole('link', { name: title })
      await expect(link).toBeVisible({ timeout: 5_000 })
      await link.click()
      await expect(volunteer.page).toHaveURL(/\/projects\/\d+$/, { timeout: 3_000 })
    }).toPass({ timeout: 30_000 })

    await expect(volunteer.page.getByRole('heading', { name: title, level: 1 })).toBeVisible({
      timeout: 10_000,
    })
  })

  test('Changing a filter keeps the previous project results visible instead of flashing a full loading state', async ({
    adminPage,
    baseUrl,
  }) => {
    const title = fake.projectTitle()
    await adminCreateProjectViaApi(baseUrl, title, 'keepPreviousData regression test')

    await adminPage.goto(`${baseUrl}/projects`)
    await expect(adminPage.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible({
      timeout: 10_000,
    })
    await expect(adminPage.getByRole('link', { name: title })).toBeVisible({ timeout: 10_000 })

    // Slow the refetch down so a regression (isPending flipping true mid-transition) would
    // have a wide, easy-to-catch window — with keepPreviousData in place isPending never
    // flips true here regardless of how long the request takes.
    await adminPage.route('**/api/rpc/projects/list*', async (route) => {
      await new Promise((r) => setTimeout(r, 600))
      await route.continue()
    })

    await adminPage.getByRole('button', { name: 'Needs filter' }).click()
    await adminPage.getByRole('option', { name: 'Seeking help' }).click()

    // Checked immediately, and again partway through the artificial delay — the old
    // results (including our just-created project) must never disappear behind a spinner.
    await expect(adminPage.getByText('Loading projects…')).toHaveCount(0)
    await expect(adminPage.getByRole('link', { name: title })).toBeVisible()
    await adminPage.waitForTimeout(300)
    await expect(adminPage.getByText('Loading projects…')).toHaveCount(0)
  })
})
