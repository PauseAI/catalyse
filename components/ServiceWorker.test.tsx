import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import ServiceWorker from './ServiceWorker'

function giveBrowserServiceWorkers(register: () => Promise<unknown>) {
  Object.defineProperty(navigator, 'serviceWorker', { value: { register }, configurable: true })
}

describe('ServiceWorker', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'serviceWorker')
    vi.unstubAllEnvs()
  })

  it('registers /sw.js for the whole site in production, bypassing the HTTP cache', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const register = vi.fn(() => Promise.resolve({}))
    giveBrowserServiceWorkers(register)
    render(<ServiceWorker />)
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' })
  })

  it('registers nothing outside production', () => {
    vi.stubEnv('NODE_ENV', 'development')
    const register = vi.fn(() => Promise.resolve({}))
    giveBrowserServiceWorkers(register)
    render(<ServiceWorker />)
    expect(register).not.toHaveBeenCalled()
  })

  it('does nothing in a browser without service workers', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect('serviceWorker' in navigator).toBe(false)
    expect(() => render(<ServiceWorker />)).not.toThrow()
  })

  it('warns, without breaking the page, when registration fails', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    giveBrowserServiceWorkers(() => Promise.reject(new Error('blocked')))
    render(<ServiceWorker />)
    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith('Service worker registration failed', expect.any(Error)),
    )
    warn.mockRestore()
  })
})
