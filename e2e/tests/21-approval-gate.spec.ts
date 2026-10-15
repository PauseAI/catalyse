import { test, expect } from '../fixtures'
import { createPendingVolunteer, dismissCookieConsentScript } from '../fixtures'

test.describe('Approval Gate', () => {
  test('A pending volunteer sent away from Projects is told why', async ({ browser, baseUrl }) => {
    const pending = await createPendingVolunteer(baseUrl)
    const ctx = await browser.newContext()
    await ctx.addInitScript((token: string) => {
      localStorage.setItem('authToken', token)
    }, pending.token)
    await ctx.addInitScript(dismissCookieConsentScript)
    try {
      const page = await ctx.newPage()
      await page.goto(`${baseUrl}/projects`)
      await page.waitForURL(/\/dashboard/, { timeout: 10_000 })
      await expect(
        page.getByText(
          "Your account is pending approval. You'll be able to browse and join projects",
        ),
      ).toBeVisible({ timeout: 10_000 })
    } finally {
      await ctx.close()
    }
  })
})
