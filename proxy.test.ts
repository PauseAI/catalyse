import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from './proxy'

afterEach(() => {
  vi.unstubAllEnvs()
})

const NEW = 'https://action.pauseai.info'

function request(url: string, host = new URL(url).host) {
  return new NextRequest(url, { headers: { host } })
}

describe('proxy', () => {
  it('permanently redirects the legacy host to the same path and query on APP_URL', () => {
    vi.stubEnv('APP_URL', NEW)
    const res = proxy(
      request('https://catalyse.up.railway.app/reset-password?token=abc&next=%2Fdashboard'),
    )
    expect(res.status).toBe(308)
    expect(res.headers.get('location')).toBe(`${NEW}/reset-password?token=abc&next=%2Fdashboard`)
  })

  it('redirects the legacy home page and ignores a path on APP_URL', () => {
    vi.stubEnv('APP_URL', `${NEW}/`)
    const res = proxy(request('https://catalyse.up.railway.app/', 'Catalyse.up.railway.app'))
    expect(res.headers.get('location')).toBe(`${NEW}/`)
  })

  it('serves every other host as it is', () => {
    vi.stubEnv('APP_URL', NEW)
    expect(proxy(request(`${NEW}/dashboard`)).headers.get('location')).toBeNull()
    expect(proxy(request('http://localhost:3000/dashboard')).headers.get('location')).toBeNull()
    expect(
      proxy(new NextRequest('https://catalyse.up.railway.app/dashboard')).headers.get('location'),
    ).toBeNull()
  })

  it.each([
    ['still the legacy URL', 'https://catalyse.up.railway.app'],
    ['unset', ''],
    ['not a URL', 'action.pauseai.info'],
  ])('serves the legacy host as it is while APP_URL is %s', (_, appUrl) => {
    vi.stubEnv('APP_URL', appUrl)
    const res = proxy(request('https://catalyse.up.railway.app/dashboard'))
    expect(res.headers.get('location')).toBeNull()
  })
})
