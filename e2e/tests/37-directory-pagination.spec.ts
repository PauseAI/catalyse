import { test, expect } from '../fixtures'
import { adminCreateProjectViaApi } from '../actions/projects'
import { fake } from '../fake'
import { DIRECTORY_PAGE_SIZE } from '../../lib/pagination'

// Prev/Next on the directory pages runs through the shared useUrlParam / useSetParam
// hook in lib/hooks/url-filters.ts. It used to write with router.replace() on a
// query-only relative URL, which never synced useSearchParams() in this Next build,
// so the page param never actually changed and you could not leave page 1. This
// proves Next advances and Previous comes back. The volunteers directory is driven
// by the very same hook.
test.describe('Directory pagination', () => {
  test('Projects directory Next and Previous move between pages', async ({
    volunteer,
    baseUrl,
  }) => {
    test.slow()

    // One more than a page → exactly two pages, with a single row on page 2.
    const TOTAL = DIRECTORY_PAGE_SIZE + 1
    const marker = `PGN${fake.skillName().replace(/\s+/g, '')}`
    // Serial, not parallel: each create is a multi-row write and the worker DB is SQLite,
    // which throws on concurrent writers.
    for (let n = 0; n < TOTAL; n++) {
      await adminCreateProjectViaApi(
        baseUrl,
        `${marker} ${String(n).padStart(3, '0')} ${fake.projectTitle()}`,
        'Directory pagination fixture project',
      )
    }

    const page = volunteer.page
    // A status filter switches the list into its flat, paginated view; q narrows it to
    // exactly the projects created above.
    await page.goto(`${baseUrl}/projects?status=ready&q=${marker}`)
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible({
      timeout: 10_000,
    })

    const markerLinks = page.getByRole('link').filter({ hasText: marker })

    await expect(page.getByText('Page 1 of 2')).toBeVisible({ timeout: 15_000 })
    await expect(markerLinks).toHaveCount(DIRECTORY_PAGE_SIZE)

    await page.getByRole('button', { name: 'Next' }).click()

    await expect(page).toHaveURL(/[?&]page=2(&|$)/, { timeout: 10_000 })
    await expect(page.getByText('Page 2 of 2')).toBeVisible({ timeout: 10_000 })
    await expect(markerLinks).toHaveCount(1)

    await page.getByRole('button', { name: 'Previous' }).click()

    await expect(page.getByText('Page 1 of 2')).toBeVisible({ timeout: 10_000 })
    await expect(page).not.toHaveURL(/[?&]page=/, { timeout: 10_000 })
    await expect(markerLinks).toHaveCount(DIRECTORY_PAGE_SIZE)
  })
})
