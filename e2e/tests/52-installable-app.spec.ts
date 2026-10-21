import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures'

/** Resolves once the service worker is active and in charge of this page. */
async function serviceWorkerControls(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (navigator.serviceWorker.controller) return
    await new Promise((resolve) =>
      navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }),
    )
  })
}

test.describe('Installable app', () => {
  test('the home page links a manifest whose icons are served', async ({ page, baseUrl }) => {
    await page.goto(`${baseUrl}/`)
    const href = await page.locator('link[rel="manifest"]').getAttribute('href')
    expect(href).toBe('/manifest.webmanifest')
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1)
    await expect(page.locator('meta[name="theme-color"]')).toHaveCount(2)

    const response = await page.request.get(`${baseUrl}${href}`)
    expect(response.ok()).toBe(true)
    const manifest = (await response.json()) as {
      display: string
      start_url: string
      icons: { src: string; sizes: string; purpose: string }[]
    }
    expect(manifest).toMatchObject({ display: 'standalone', start_url: '/dashboard' })
    // Chrome's install prompt needs a 192px and a 512px icon.
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(
      expect.arrayContaining(['192x192', '512x512']),
    )
    for (const icon of manifest.icons) {
      const image = await page.request.get(`${baseUrl}${icon.src}`)
      expect(image.headers()['content-type'], icon.src).toBe('image/png')
    }
  })

  test('a page that cannot reach the network shows the offline page, and the app returns with the connection', async ({
    volunteer,
    baseUrl,
    snap,
  }) => {
    test.skip(process.env.E2E_DEV === '1', 'the service worker registers in production builds only')
    const { page } = volunteer
    await page.goto(`${baseUrl}/dashboard`)
    await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible({ timeout: 10_000 })
    await serviceWorkerControls(page)

    await page.context().setOffline(true)
    await page.goto(`${baseUrl}/projects`)
    await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible()
    await snap(page, 'offline page')

    await page.context().setOffline(false)
    await page.getByRole('link', { name: 'Try again' }).click()
    // Projects is for approved volunteers only, so seeing it means the sign-in held.
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible({
      timeout: 10_000,
    })

    // Only the offline page is ever stored: no API response, app code or signed-in page.
    const cached = await page.evaluate(async () => {
      const urls: string[] = []
      for (const name of await caches.keys()) {
        for (const request of await (await caches.open(name)).keys()) {
          urls.push(new URL(request.url).pathname)
        }
      }
      return urls
    })
    expect(cached).toEqual(['/offline.html'])
  })
})
