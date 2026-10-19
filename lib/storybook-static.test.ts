import path from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { createSession } from '@/lib/auth'
import { createAdmin, createVolunteer } from '@/test/factories'
import { STORYBOOK_SESSION_COOKIE, serveStorybookFile } from '@/lib/storybook-static'

const FIXTURE_DIR = path.join(process.cwd(), 'test/fixtures/storybook-static')

const get = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers })

const serve = (url: string, segments: string[] | undefined, headers?: Record<string, string>) =>
  serveStorybookFile(FIXTURE_DIR, get(url, headers), segments)

describe('serveStorybookFile', () => {
  it('404s with no token, a non-admin token, or an unknown path', async () => {
    const vol = await createVolunteer()
    const token = await createSession(vol.id)

    expect((await serve('http://localhost/admin/storybook/view/', undefined)).status).toBe(404)
    expect(
      (await serve('http://localhost/admin/storybook/view/?token=' + token, undefined)).status,
    ).toBe(404)

    const admin = await createAdmin()
    const adminToken = await createSession(admin.id)
    expect(
      (
        await serve('http://localhost/admin/storybook/view/nope.html?token=' + adminToken, [
          'nope.html',
        ])
      ).status,
    ).toBe(404)
  })

  it('refuses a path that would escape the storybook directory', async () => {
    const admin = await createAdmin()
    const adminToken = await createSession(admin.id)
    const response = await serve(
      'http://localhost/admin/storybook/view/..%2F..%2Fpackage.json?token=' + adminToken,
      ['..', '..', 'package.json'],
    )
    expect(response.status).toBe(404)
  })

  it('serves a file for an admin token, and mints a cookie scoped to the path', async () => {
    const admin = await createAdmin()
    const adminToken = await createSession(admin.id)

    const response = await serve('http://localhost/admin/storybook/view/?token=' + adminToken, [])
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('fixture index')
    expect(html).toContain('<head><base href="/admin/storybook/view/">')
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')

    const cookie = response.headers.get('set-cookie')
    expect(cookie).toContain(`${STORYBOOK_SESSION_COOKIE}=${adminToken}`)
    expect(cookie).toContain('Path=/admin/storybook/view')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).not.toContain('Secure')
  })

  it('marks the cookie Secure in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const admin = await createAdmin()
    const adminToken = await createSession(admin.id)

    const response = await serve('http://localhost/admin/storybook/view/?token=' + adminToken, [])
    expect(response.headers.get('set-cookie')).toContain('Secure')
    vi.unstubAllEnvs()
  })

  it('trusts an existing cookie over a query token, and mints no cookie again', async () => {
    const admin = await createAdmin()
    const adminToken = await createSession(admin.id)

    const response = await serve(
      'http://localhost/admin/storybook/view/sub/asset.js',
      ['sub', 'asset.js'],
      { cookie: `${STORYBOOK_SESSION_COOKIE}=${adminToken}` },
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('fixture asset')
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('falls back to the query token when the Cookie header holds unrelated cookies', async () => {
    const admin = await createAdmin()
    const adminToken = await createSession(admin.id)

    const response = await serve('http://localhost/admin/storybook/view/?token=' + adminToken, [], {
      cookie: 'unrelated=1; other=2',
    })
    expect(response.status).toBe(200)
  })

  it('serves the default content type for an unlisted extension', async () => {
    const admin = await createAdmin()
    const adminToken = await createSession(admin.id)

    const response = await serve(
      'http://localhost/admin/storybook/view/sub/asset.bin?token=' + adminToken,
      ['sub', 'asset.bin'],
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
  })
})
