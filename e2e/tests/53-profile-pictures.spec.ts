import sharp from 'sharp'
import { test, expect } from '../fixtures'
import { createApiClient } from '../client'

test.describe('Profile pictures', () => {
  test('A volunteer uploads a picture, shown beside their name, and an admin takes it down', async ({
    volunteer,
    adminPage,
    baseUrl,
    snap,
  }) => {
    const page = volunteer.page
    await page.goto(`${baseUrl}/settings`)
    const card = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Profile picture' }) })
    await expect(card.getByRole('button', { name: 'Upload picture' })).toBeVisible()
    const png = await sharp({
      create: { width: 400, height: 300, channels: 3, background: '#2a7' },
    })
      .png()
      .toBuffer()
    await page
      .getByLabel('Profile picture file')
      .setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: png })
    await expect(page.getByText('Picture updated')).toBeVisible()
    await expect(card.getByRole('button', { name: 'Change picture' })).toBeVisible()
    await expect(card.locator('img')).toBeVisible()
    await snap(page, 'picture uploaded')

    const token = await page.evaluate(() => localStorage.getItem('authToken'))
    const me = await createApiClient(baseUrl, token).auth.me()
    const { id } = me.body as { id: number }

    await adminPage.goto(`${baseUrl}/volunteers/${id}`)
    await expect(adminPage.getByRole('heading', { name: volunteer.name })).toBeVisible()
    await adminPage.getByRole('button', { name: 'Remove picture' }).click()
    await adminPage
      .getByRole('dialog', { name: 'Remove profile picture?' })
      .getByRole('button', { name: 'Remove picture' })
      .click()
    await expect(adminPage.getByText('Picture removed')).toBeVisible()
    await expect(adminPage.getByRole('button', { name: 'Remove picture' })).toHaveCount(0)

    await page.reload()
    await expect(card.getByRole('button', { name: 'Upload picture' })).toBeVisible()
  })
})
