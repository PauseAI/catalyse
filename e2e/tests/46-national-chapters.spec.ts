import { test, expect, getAlert, createApprovedVolunteer, signedInPage } from '../fixtures'
import { ensureChapter, makeChapterStaff } from '../actions/chapters'
import { selectFilterDropdown } from '../actions/ui'

// Germany's chapter is this spec's alone.
const COUNTRY = 'Germany'

test.describe('National chapters', () => {
  test('A global admin appoints a lead, and the lead appoints a deputy', async ({
    adminPage,
    browser,
    baseUrl,
    snap,
  }) => {
    await ensureChapter(baseUrl, COUNTRY)
    const lead = await createApprovedVolunteer(baseUrl, { country: COUNTRY })
    const deputy = await createApprovedVolunteer(baseUrl, { country: COUNTRY })

    await adminPage.goto(`${baseUrl}/admin/chapters`)
    await adminPage.getByRole('link', { name: 'Germany', exact: true }).click()
    await expect(adminPage.getByRole('heading', { name: 'Germany chapter' })).toBeVisible({
      timeout: 10_000,
    })
    await selectFilterDropdown(adminPage, 'Appoint a lead', lead.name)
    await expect(getAlert(adminPage)).toContainText(`${lead.name} now leads the chapter`, {
      timeout: 10_000,
    })

    const leadPage = await signedInPage(browser, lead.token)
    try {
      await leadPage.goto(`${baseUrl}/admin`)
      await leadPage.getByRole('link', { name: 'Germany chapter' }).click()
      await expect(leadPage.getByRole('heading', { name: 'Germany chapter' })).toBeVisible({
        timeout: 10_000,
      })
      await selectFilterDropdown(leadPage, 'Appoint a deputy', deputy.name)
      await expect(getAlert(leadPage)).toContainText(`${deputy.name} is now a deputy`, {
        timeout: 10_000,
      })
      await expect(
        leadPage.getByRole('button', { name: `Remove ${deputy.name} as deputy` }),
      ).toBeVisible()
      await snap(leadPage, 'lead sees their deputy')
    } finally {
      await leadPage.context().close()
    }

    await adminPage.reload()
    await expect(adminPage.getByText(`appointed a deputy: ${deputy.name}`)).toBeVisible({
      timeout: 10_000,
    })
    await snap(adminPage, 'chapter history')
  })

  test('A deputy runs the chapter but cannot appoint deputies', async ({ browser, baseUrl }) => {
    const chapterId = await ensureChapter(baseUrl, COUNTRY)
    const deputy = await createApprovedVolunteer(baseUrl, { country: COUNTRY })
    await makeChapterStaff(baseUrl, deputy.id, chapterId, 'DEPUTY')

    const page = await signedInPage(browser, deputy.token)
    try {
      await page.goto(`${baseUrl}/admin/chapters/${chapterId}`)
      await expect(page.getByRole('heading', { name: 'Germany chapter' })).toBeVisible({
        timeout: 10_000,
      })
      await expect(page.getByLabel('Appoint a deputy', { exact: true })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Send invite' })).toHaveCount(0)
    } finally {
      await page.context().close()
    }
  })

  test("A chapter lead is turned away from another chapter's page", async ({
    browser,
    baseUrl,
  }) => {
    const chapterId = await ensureChapter(baseUrl, COUNTRY)
    const lead = await createApprovedVolunteer(baseUrl, { country: COUNTRY })
    await makeChapterStaff(baseUrl, lead.id, chapterId, 'LEAD')
    const ukChapterId = await ensureChapter(baseUrl, 'UK')

    const page = await signedInPage(browser, lead.token)
    try {
      await page.goto(`${baseUrl}/admin/chapters/${ukChapterId}`)
      await expect(page.getByRole('heading', { name: 'Chapter not found' })).toBeVisible({
        timeout: 10_000,
      })
    } finally {
      await page.context().close()
    }
  })
})
