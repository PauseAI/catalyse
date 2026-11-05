import { describe, it, expect, vi } from 'vitest'
import { prisma } from '@/lib/prisma'

import { rateLimit } from '@/test/fakes/rate-limit'

const post = (body: string | null, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/csp-report', {
    method: 'POST',
    headers: { 'content-type': 'application/csp-report', ...headers },
    body,
  })

const count = async () =>
  (await prisma.platformSettings.findUniqueOrThrow({ where: { id: 1 } })).cspViolationCount

describe('POST /api/csp-report', () => {
  it('counts each report whatever its shape, and logs the violation', async () => {
    const { POST } = await import('./route')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const before = await count()

    const legacy = await POST(post(JSON.stringify({ 'csp-report': { 'blocked-uri': 'evil' } })))
    expect(legacy.status).toBe(204)
    expect(error).toHaveBeenLastCalledWith('[CSP VIOLATION]', '{"blocked-uri":"evil"}')

    await POST(post(JSON.stringify([{ body: { blockedURL: 'evil2' } }])))
    expect(error).toHaveBeenLastCalledWith('[CSP VIOLATION]', '{"blockedURL":"evil2"}')

    await POST(post(JSON.stringify({ loose: true })))
    expect(error).toHaveBeenLastCalledWith('[CSP VIOLATION]', '{"loose":true}')

    await POST(post('not json'))
    expect(error).toHaveBeenLastCalledWith('[CSP VIOLATION]', '{}')

    expect(await count()).toBe(before + 4)
    error.mockRestore()
  })

  it('logs URL fields as origin and path only, and drops script samples', async () => {
    const { POST } = await import('./route')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logged = () => JSON.parse(error.mock.lastCall![1] as string)
    const ga =
      'https://www.google-analytics.com/g/collect?v=2&tid=G-X&cid=123.456&sid=789&dl=https%3A%2F%2Fexample.org'

    await POST(
      post(
        JSON.stringify({
          'csp-report': {
            'blocked-uri': ga,
            'document-uri': 'https://catalyse.example/reset-password?token=secret#top',
            referrer: 'https://catalyse.example/verify-email?token=secret',
            'source-file': 'https://catalyse.example/_next/app.js?v=1',
            'violated-directive': 'connect-src',
            disposition: 'enforce',
            'line-number': 12,
            'column-number': 3,
            'status-code': 200,
            'script-sample': 'resetToken = "secret"',
          },
        }),
      ),
    )
    expect(logged()).toEqual({
      'blocked-uri': 'https://www.google-analytics.com/g/collect',
      'document-uri': 'https://catalyse.example/reset-password',
      referrer: 'https://catalyse.example/verify-email',
      'source-file': 'https://catalyse.example/_next/app.js',
      'violated-directive': 'connect-src',
      disposition: 'enforce',
      'line-number': 12,
      'column-number': 3,
      'status-code': 200,
    })

    await POST(
      post(
        JSON.stringify([
          {
            type: 'csp-violation',
            body: {
              blockedURL: ga,
              documentURL: 'https://catalyse.example/reset-password?token=secret',
              referrer: 'https://catalyse.example/verify-email?token=secret',
              sourceFile: 'https://catalyse.example/_next/app.js?v=1',
              effectiveDirective: 'connect-src',
              lineNumber: 12,
              sample: 'resetToken = "secret"',
            },
          },
        ]),
      ),
    )
    expect(logged()).toEqual({
      blockedURL: 'https://www.google-analytics.com/g/collect',
      documentURL: 'https://catalyse.example/reset-password',
      referrer: 'https://catalyse.example/verify-email',
      sourceFile: 'https://catalyse.example/_next/app.js',
      effectiveDirective: 'connect-src',
      lineNumber: 12,
    })

    error.mockRestore()
  })

  it('passes keywords, empty and missing values through, and survives unparseable URLs', async () => {
    const { POST } = await import('./route')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logged = () => JSON.parse(error.mock.lastCall![1] as string)

    for (const keyword of ['inline', 'eval', 'self', 'data', 'blob', '']) {
      await POST(post(JSON.stringify({ 'csp-report': { 'blocked-uri': keyword } })))
      expect(logged()).toEqual({ 'blocked-uri': keyword })
    }

    await POST(post(JSON.stringify([{ body: { blockedURL: 'inline', referrer: null } }])))
    expect(logged()).toEqual({ blockedURL: 'inline', referrer: null })

    await POST(post(JSON.stringify({ 'csp-report': { 'violated-directive': 'img-src' } })))
    expect(logged()).toEqual({ 'violated-directive': 'img-src' })

    await POST(
      post(
        JSON.stringify({
          'csp-report': {
            'blocked-uri': 'http://exa mple.com/x?token=secret',
            'document-uri': 'data:text/html,hi?token=secret#frag',
          },
        }),
      ),
    )
    expect(logged()).toEqual({
      'blocked-uri': 'http://exa mple.com/x',
      'document-uri': 'data:text/html,hi',
    })

    await POST(post(JSON.stringify('just a string')))
    expect(logged()).toBe('just a string')

    error.mockRestore()
  })

  it('rejects oversized bodies and rate-limited callers, and survives a failed count', async () => {
    const { POST } = await import('./route')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const before = await count()

    expect((await POST(post('{}', { 'content-length': '9000' }))).status).toBe(413)

    rateLimit.denyNext(1500)
    const limited = await POST(post('{}'))
    expect(limited.status).toBe(429)

    vi.spyOn(prisma.platformSettings, 'update').mockRejectedValueOnce(new Error('db down'))
    expect((await POST(post('{}'))).status).toBe(204)
    expect(error).toHaveBeenLastCalledWith(
      '[CSP VIOLATION] Failed to record count:',
      expect.any(Error),
    )

    expect(await count()).toBe(before)
    error.mockRestore()
  })
})
