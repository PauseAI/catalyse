import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { serveStorybookFile } from '@/lib/storybook-static'

const FIXTURE_DIR = path.join(process.cwd(), 'test/fixtures/storybook-static')

describe('serveStorybookFile', () => {
  it('404s on an unknown path', async () => {
    expect((await serveStorybookFile(FIXTURE_DIR, ['nope.html'])).status).toBe(404)
  })

  it('refuses a path that would escape the storybook directory', async () => {
    const response = await serveStorybookFile(FIXTURE_DIR, ['..', '..', 'package.json'])
    expect(response.status).toBe(404)
  })

  it('serves the index file for an empty path, with a base tag injected', async () => {
    const response = await serveStorybookFile(FIXTURE_DIR, [])
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('fixture index')
    expect(html).toContain('<head><base href="/admin/storybook/view/">')
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
  })

  it('serves a nested asset by its path', async () => {
    const response = await serveStorybookFile(FIXTURE_DIR, ['sub', 'asset.js'])
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('fixture asset')
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
  })

  it('serves the default content type for an unlisted extension', async () => {
    const response = await serveStorybookFile(FIXTURE_DIR, ['sub', 'asset.bin'])
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
  })
})
