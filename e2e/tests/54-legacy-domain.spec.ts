import { test, expect } from '../fixtures'

// The server is reached as localhost here, so the legacy host arrives as a Host header and
// is sent on to this worker's APP_URL.
const legacy = { host: 'catalyse.up.railway.app' }

test.describe('Legacy Railway domain', () => {
  test('a page on the legacy host redirects permanently to the same path and query on APP_URL', async ({
    request,
    baseUrl,
  }) => {
    const res = await request.get(`${baseUrl}/reset-password?token=abc&email=a%40b.c`, {
      headers: legacy,
      maxRedirects: 0,
    })
    expect(res.status()).toBe(308)
    // Next writes a Location on its own origin as a path; this worker's APP_URL is that origin.
    expect(new URL(res.headers()['location'], baseUrl).href).toBe(
      `${baseUrl}/reset-password?token=abc&email=a%40b.c`,
    )
  })

  test('API routes, build assets and the service worker are answered on the legacy host itself', async ({
    request,
    baseUrl,
  }) => {
    const html = await (await request.get(`${baseUrl}/login`)).text()
    const asset = html.match(/\/_next\/static\/[^"]+\.js/)?.[0]
    expect(asset).toBeTruthy()
    for (const path of ['/api/health', '/sw.js', '/api/project-import/schema', asset]) {
      const res = await request.get(`${baseUrl}${path}`, { headers: legacy, maxRedirects: 0 })
      expect(res.status(), path).toBe(200)
    }
    // The cron trigger POSTs with a bearer token, which a cross-origin redirect would drop.
    const cron = await request.post(`${baseUrl}/api/cron/daily`, {
      headers: legacy,
      maxRedirects: 0,
    })
    expect(cron.headers()['location']).toBeUndefined()
    expect(cron.status()).toBe(401)
  })
})
