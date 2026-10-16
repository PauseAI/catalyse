import { test, expect, createApprovedVolunteer, signedInPage } from '../fixtures'
import { fake } from '../fake'
import { ensureChapter } from '../actions/chapters'
import { adminCreateProjectViaApi } from '../actions/projects'

// France and Spain are this spec's alone; a French member looks across at Spain.
const HOME = 'France'
const AWAY = 'Spain'

test.describe('Chapter scoping', () => {
  test("A member sees their own chapter's projects, and another chapter's is not there", async ({
    browser,
    baseUrl,
    snap,
  }) => {
    const home = await ensureChapter(baseUrl, HOME)
    const away = await ensureChapter(baseUrl, AWAY)
    const homeTitle = fake.projectTitle()
    const awayTitle = fake.projectTitle()
    await adminCreateProjectViaApi(baseUrl, homeTitle, 'e2e test project description', {
      chapterId: home,
    })
    const awayId = await adminCreateProjectViaApi(
      baseUrl,
      awayTitle,
      'e2e test project description',
      { chapterId: away },
    )
    const member = await createApprovedVolunteer(baseUrl, { country: HOME })

    const page = await signedInPage(browser, member.token)
    try {
      await page.goto(`${baseUrl}/projects`)
      await page.getByRole('searchbox', { name: 'Search' }).fill(homeTitle)
      await expect(page.getByRole('link', { name: homeTitle })).toBeVisible({ timeout: 10_000 })
      await snap(page, 'own chapter project')

      await page.getByRole('searchbox', { name: 'Search' }).fill(awayTitle)
      await expect(page.getByRole('link', { name: homeTitle })).toBeHidden({ timeout: 10_000 })
      await expect(page.getByRole('link', { name: awayTitle })).toHaveCount(0)

      await page.goto(`${baseUrl}/projects/${awayId}`)
      await page.waitForURL(`${baseUrl}/projects`, { timeout: 10_000 })
    } finally {
      await page.context().close()
    }
  })

  test("The directory lists a member's own chapter only", async ({ browser, baseUrl }) => {
    await ensureChapter(baseUrl, HOME)
    await ensureChapter(baseUrl, AWAY)
    const member = await createApprovedVolunteer(baseUrl, { country: HOME })
    const neighbour = await createApprovedVolunteer(baseUrl, { country: HOME })
    const stranger = await createApprovedVolunteer(baseUrl, { country: AWAY })

    const page = await signedInPage(browser, member.token)
    try {
      await page.goto(`${baseUrl}/volunteers`)
      const search = page.getByRole('searchbox', { name: 'Search' })
      await search.fill(neighbour.name)
      await expect(page.getByRole('link', { name: neighbour.name })).toBeVisible({
        timeout: 10_000,
      })
      await search.fill(stranger.name)
      await expect(page.getByRole('link', { name: neighbour.name })).toBeHidden({
        timeout: 10_000,
      })
      await expect(page.getByRole('link', { name: stranger.name })).toHaveCount(0)
    } finally {
      await page.context().close()
    }
  })
})
