import { test, expect, getAlert, createApprovedVolunteer, signedInPage } from '../fixtures'
import { ensureChapter, makeChapterStaff } from '../actions/chapters'
import { selectFilterDropdown } from '../actions/ui'

// Sweden and Poland are this spec's alone: a Swedish member moves to Poland.
const FROM = 'Sweden'
const TO = 'Poland'

test.describe('Moving chapter', () => {
  test("A member asks to move country, and the destination chapter's lead approves", async ({
    browser,
    baseUrl,
    snap,
  }) => {
    await ensureChapter(baseUrl, FROM)
    const toChapter = await ensureChapter(baseUrl, TO)
    const lead = await createApprovedVolunteer(baseUrl, { country: TO })
    await makeChapterStaff(baseUrl, lead.id, toChapter, 'LEAD')
    const mover = await createApprovedVolunteer(baseUrl, { country: FROM })

    const page = await signedInPage(browser, mover.token)
    const leadPage = await signedInPage(browser, lead.token)
    try {
      await page.goto(`${baseUrl}/settings`)
      await expect(page.getByText('Sweden · Sweden chapter')).toBeVisible({ timeout: 10_000 })
      await page.getByRole('button', { name: 'Moving to another country?' }).click()
      await selectFilterDropdown(page, 'Country you are moving to', 'Poland')
      await page.getByLabel(/Anything they should know/).fill('Starting a job in Kraków')
      await snap(page, 'move dialog filled')
      await page.getByRole('button', { name: 'Ask to move' }).click()
      await expect(page.getByRole('status')).toContainText('You asked to move to Poland', {
        timeout: 10_000,
      })

      await leadPage.goto(`${baseUrl}/admin/transfers`)
      await expect(leadPage.getByText('Starting a job in Kraków')).toBeVisible({ timeout: 10_000 })
      await snap(leadPage, 'move waiting')
      await leadPage.getByRole('button', { name: `Approve move for ${mover.name}` }).click()
      await expect(getAlert(leadPage)).toContainText('Moved', { timeout: 10_000 })

      await page.reload()
      await expect(page.getByText('Poland · Poland chapter')).toBeVisible({ timeout: 10_000 })
    } finally {
      await page.context().close()
      await leadPage.context().close()
    }
  })
})
