import { test, expect, getAlert, dismissCookieConsentScript, readAdminToken } from '../fixtures'
import { fake } from '../fake'
import { ADMIN_EMAIL } from '../config'
import { signup, login } from '../actions/auth'
import { ensureChapter } from '../actions/chapters'
import { Page } from '@playwright/test'
import { createApiClient } from '../client'

// Invites in this file are to the Netherlands chapter, which no other spec uses.
const COUNTRY = 'Netherlands'

async function createDeputyInvite(baseUrl: string, email: string): Promise<string> {
  const chapterId = await ensureChapter(baseUrl, COUNTRY)
  const api = createApiClient(baseUrl, readAdminToken(baseUrl))
  const result = await api.admin.chapters.invite({ body: { email, chapterId, role: 'DEPUTY' } })
  if (result.status !== 200) throw new Error(`Invite failed: ${JSON.stringify(result.body)}`)
  const url = result.body._dev_invite_url
  if (!url) throw new Error('No dev invite link in response')
  return new URL(url).searchParams.get('token') as string
}

async function getMe(page: Page, baseUrl: string) {
  const token = await page.evaluate(() => localStorage.getItem('authToken'))
  const result = await createApiClient(baseUrl, token).auth.me()
  return result.body
}

test.describe('Admin: global admins and chapter staff invites', () => {
  test('Admin views the list of global admins', async ({ adminPage, baseUrl }) => {
    await adminPage.goto(`${baseUrl}/admin/team`)
    const adminList = adminPage.locator('#adminList')
    await expect(adminList).toContainText(ADMIN_EMAIL, { timeout: 10_000 })
  })

  test('Admin invites a deputy from the chapter page, sees it pending, and cancels it', async ({
    adminPage,
    baseUrl,
    snap,
  }) => {
    const inviteEmail = fake.uniqueEmail()
    const chapterId = await ensureChapter(baseUrl, COUNTRY)

    await adminPage.goto(`${baseUrl}/admin/chapters/${chapterId}`)
    await expect(adminPage.getByRole('heading', { name: 'Netherlands chapter' })).toBeVisible({
      timeout: 10_000,
    })
    await adminPage.getByLabel('Email address').fill(inviteEmail)
    await adminPage.getByRole('button', { name: 'Send invite' }).click()
    await expect(getAlert(adminPage)).toContainText(`for ${inviteEmail}`, { timeout: 10_000 })

    const cancel = adminPage.getByRole('button', { name: `Cancel invite to ${inviteEmail}` })
    await expect(cancel).toBeVisible()
    await snap(adminPage, 'invite pending')
    await cancel.click()
    await expect(getAlert(adminPage)).toContainText('Invite revoked', { timeout: 10_000 })
    await expect(cancel).toBeHidden()
  })

  test('New user accepts a chapter invite link', async ({ browser, baseUrl }) => {
    const person = fake.person()
    const token = await createDeputyInvite(baseUrl, person.email)

    const ctx = await browser.newContext()
    await ctx.addInitScript(dismissCookieConsentScript)
    const page = await ctx.newPage()
    try {
      await page.goto(`${baseUrl}/accept-invite?token=${token}`)
      await expect(page.getByRole('heading', { name: 'Chapter staff invite' })).toBeVisible({
        timeout: 10_000,
      })

      // Clear the pending invite token stored by accept-invite so signup
      // redirects to dashboard instead of back to accept-invite
      await page.evaluate(() => localStorage.removeItem('pendingAdminInvite'))

      // Signing up proves nothing about the address, so the invite waits for the
      // confirmation link. Opened signed out, as from another device, the link proves the
      // mailbox only and the password chosen at signup is cleared.
      await signup(baseUrl, page, person.name, person.email, 'testpassword1')
      await expect(page.getByRole('heading', { name: /Thanks for applying/ })).toBeVisible({
        timeout: 15_000,
      })
      await page.evaluate(() => localStorage.removeItem('authToken'))

      const api = createApiClient(baseUrl)
      const resent = await api.auth.resendVerification({ body: { email: person.email } })
      const { emailVerificationToken } = resent.body as { emailVerificationToken?: string }
      await page.goto(`${baseUrl}/verify-email?token=${emailVerificationToken}`)
      await expect(page.getByRole('link', { name: 'Set a new password' })).toBeVisible({
        timeout: 10_000,
      })

      const forgot = await api.auth.forgotPassword({ body: { email: person.email } })
      const { _devResetToken } = forgot.body as { _devResetToken?: string }
      await api.auth.resetPassword({
        body: { token: _devResetToken!, newPassword: 'testpassword2' },
      })
      await login(baseUrl, page, person.email, 'testpassword2')

      const me = await getMe(page, baseUrl)
      expect(me.access.role).toBe('DEPUTY')
      expect(me.chapter?.country).toBe(COUNTRY)
    } finally {
      await ctx.close()
    }
  })

  test('Existing user accepts a chapter invite and moves into the chapter as a deputy', async ({
    volunteer,
    baseUrl,
  }) => {
    const token = await createDeputyInvite(baseUrl, volunteer.email)

    await volunteer.page.goto(`${baseUrl}/accept-invite?token=${token}`)
    await expect(volunteer.page.getByRole('heading', { name: 'Welcome to the team!' })).toBeVisible(
      { timeout: 10_000 },
    )

    const me = await getMe(volunteer.page, baseUrl)
    expect(me.access.role).toBe('DEPUTY')
    expect(me.chapter?.country).toBe(COUNTRY)
  })
})
