import { describe, it, expect, vi, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { checkCronAuth } from './cron-auth'
import { logger } from './logger'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

const req = (auth?: string) =>
  new NextRequest('http://localhost/api/cron/x', {
    headers: auth ? { authorization: auth } : {},
  })

describe('checkCronAuth', () => {
  it('is a 500 when the secret is not configured', async () => {
    vi.stubEnv('CRON_SECRET', '')
    const error = vi.spyOn(logger, 'error').mockImplementation(() => logger as never)
    const res = checkCronAuth(req('Bearer anything'))
    expect(res?.status).toBe(500)
    expect(error).toHaveBeenCalled()
  })

  it('rejects a missing, wrong-length or wrong-value bearer token', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')
    expect(checkCronAuth(req())?.status).toBe(401)
    expect(checkCronAuth(req('Bearer secret-but-longer'))?.status).toBe(401)
    expect(checkCronAuth(req('Bearer SECRET'))?.status).toBe(401)
  })

  it('passes a matching bearer token', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')
    expect(checkCronAuth(req('Bearer secret'))).toBeNull()
  })
})
