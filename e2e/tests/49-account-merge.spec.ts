import {
  test,
  expect,
  getAlert,
  createApprovedVolunteerNamed,
  readAdminToken,
  signedInPage,
} from '../fixtures'
import { createApiClient } from '../client'
import { fake } from '../fake'

/** Two accounts with one name, the second marked by a global admin as a duplicate of the first. */
async function markedPair(baseUrl: string) {
  const name = fake.personName()
  const kept = await createApprovedVolunteerNamed(baseUrl, name)
  const second = await createApprovedVolunteerNamed(baseUrl, name)
  const admin = createApiClient(baseUrl, readAdminToken(baseUrl))
  const marked = await admin.admin.volunteers.markDuplicate({
    body: { id: second.id, duplicateOfId: kept.id },
  })
  expect(marked.status).toBe(200)
  return { kept, second }
}

test.describe('Account merging', () => {
  test('A person merges a duplicate account into the kept one, then settles their profile', async ({
    browser,
    baseUrl,
    snap,
  }) => {
    const { kept, second } = await markedPair(baseUrl)
    await createApiClient(baseUrl, second.token).volunteers.updateMe({
      body: { bio: 'The bio on my second account, long enough to keep' },
    })

    const page = await signedInPage(browser, second.token)
    try {
      await page.goto(`${baseUrl}/dashboard`)
      const dialog = page.getByRole('dialog', { name: 'Merge your accounts' })
      await expect(dialog).toBeVisible({ timeout: 10_000 })
      await expect(dialog).toContainText(kept.name)
      await snap(page, 'asked to merge')

      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes('/api/rpc/accountMerges/request')),
        dialog.getByRole('button', { name: 'Send the link' }).click(),
      ])
      const { json } = await response.json()
      await expect(dialog.getByRole('status')).toContainText('Open it to finish merging')
      await snap(page, 'link sent')

      await page.goto(`${baseUrl}${json._devMergeUrl as string}`)
      await expect(page.getByText(/will be merged into/)).toBeVisible({ timeout: 10_000 })
      await snap(page, 'merge to confirm')
      await page.getByRole('button', { name: 'Merge accounts' }).click()
      await expect(page.getByRole('heading', { name: 'Accounts merged' })).toBeVisible({
        timeout: 10_000,
      })
      await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible()
    } finally {
      await page.context().close()
    }

    const keptPage = await signedInPage(browser, kept.token)
    try {
      await keptPage.goto(`${baseUrl}/dashboard`)
      const dialog = keptPage.getByRole('dialog', { name: 'Finish merging your profile' })
      await expect(dialog).toBeVisible({ timeout: 10_000 })
      await dialog.getByText('The bio on my second account, long enough to keep').click()
      await expect(
        dialog.getByRole('radio', { name: /The bio on my second account/ }),
      ).toBeChecked()
      await snap(keptPage, 'choosing which bio to keep')
      await dialog.getByRole('button', { name: 'Save' }).click()
      await expect(getAlert(keptPage)).toContainText('Profile updated', { timeout: 10_000 })
      await keptPage.goto(`${baseUrl}/volunteers/${kept.id}`)
      await expect(keptPage.getByText('The bio on my second account')).toBeVisible({
        timeout: 10_000,
      })
    } finally {
      await keptPage.context().close()
    }
  })

  test('A person says a marked account is not theirs, and is not asked again', async ({
    browser,
    baseUrl,
  }) => {
    const { second } = await markedPair(baseUrl)
    const page = await signedInPage(browser, second.token)
    try {
      await page.goto(`${baseUrl}/dashboard`)
      const dialog = page.getByRole('dialog', { name: 'Merge your accounts' })
      await expect(dialog).toBeVisible({ timeout: 10_000 })
      await dialog.getByRole('button', { name: "That account isn't mine" }).click()
      await expect(getAlert(page)).toContainText('we will treat them as two people', {
        timeout: 10_000,
      })
      await page.reload()
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })
      await expect(page.getByRole('dialog', { name: 'Merge your accounts' })).toHaveCount(0)
    } finally {
      await page.context().close()
    }
  })

  test('A spent merge link is turned away', async ({ page, baseUrl }) => {
    await page.goto(`${baseUrl}/merge-accounts?token=not-a-real-token`)
    await expect(page.getByRole('heading', { name: "This link doesn't work" })).toBeVisible({
      timeout: 10_000,
    })
  })
})
