import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import { createVolunteer } from '@/test/factories'
import { renderApp } from '@/test/render'
import { navigation } from '@/test/next-navigation'
import { failNextFetch } from '@/test/rpc-fetch'
import { AuthProvider, useAuth } from './auth-context'
import { render } from '@testing-library/react'

function Probe() {
  const { user, token, loading, setToken, logout, refreshUser } = useAuth()
  return (
    <div>
      <span data-testid="state">
        {loading ? 'loading' : user ? `user:${user.name}` : 'anon'}|{token ? 'token' : 'no-token'}
      </span>
      <button onClick={() => setToken(localStorage.getItem('nextToken')!)}>login</button>
      <button onClick={() => logout()}>logout</button>
      <button onClick={() => refreshUser()}>refresh</button>
    </div>
  )
}

describe('AuthProvider', () => {
  it('starts anonymous with no stored token', async () => {
    await renderApp(<Probe />)
    expect(screen.getByTestId('state')).toHaveTextContent('anon|no-token')
  })

  it('loads the user from a stored session, and drops a token the server rejects', async () => {
    const vol = await createVolunteer({ name: 'Ann' })
    await renderApp(<Probe />, { as: vol })
    expect(screen.getByTestId('state')).toHaveTextContent('loading')
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('user:Ann|token'))

    localStorage.setItem('authToken', 'stale')
    await renderApp(<Probe />)
    await waitFor(() =>
      expect(screen.getAllByTestId('state')[1]).toHaveTextContent('anon|no-token'),
    )
    expect(localStorage.getItem('authToken')).toBeNull()
  })

  it('setToken logs in and syncs a pre-login cookie choice; logout clears and redirects', async () => {
    const vol = await createVolunteer({ name: 'Bob', cookieConsentAnalytics: null })
    const { createSession } = await import('@/lib/auth')
    localStorage.setItem('nextToken', await createSession(vol.id))
    localStorage.setItem('cookieConsent', 'true')
    await renderApp(<Probe />)
    const user = userEvent.setup()
    await user.click(screen.getByText('login'))
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('user:Bob|token'))
    await waitFor(async () =>
      expect(
        (await prisma.volunteer.findUniqueOrThrow({ where: { id: vol.id } }))
          .cookieConsentAnalytics,
      ).toBe(true),
    )

    await user.click(screen.getByText('refresh'))
    await user.click(screen.getByText('logout'))
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('anon|no-token'))
    expect(navigation.push).toHaveBeenCalledWith('/login')
    expect(await prisma.session.count({ where: { volunteerId: vol.id } })).toBe(0)
  })

  it('does not sync cookie consent when none was stored, and refresh without a token is a no-op', async () => {
    const vol = await createVolunteer({ cookieConsentAnalytics: null })
    const { createSession } = await import('@/lib/auth')
    localStorage.setItem('nextToken', await createSession(vol.id))
    await renderApp(<Probe />)
    const user = userEvent.setup()
    await user.click(screen.getByText('refresh'))
    await user.click(screen.getByText('login'))
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('token'))
    expect(
      (await prisma.volunteer.findUniqueOrThrow({ where: { id: vol.id } })).cookieConsentAnalytics,
    ).toBeNull()
  })

  it('keeps the session when loading the user fails for a reason other than the token', async () => {
    const vol = await createVolunteer({ name: 'Cal' })
    failNextFetch()
    await renderApp(<Probe />, { as: vol })
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('anon|token'))
    expect(localStorage.getItem('authToken')).not.toBeNull()

    const user = userEvent.setup()
    await user.click(screen.getByText('refresh'))
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('user:Cal|token'))
  })

  it('clears the session when the API reports it expired', async () => {
    const vol = await createVolunteer()
    await renderApp(<Probe />, { as: vol })
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('user:'))
    act(() => window.dispatchEvent(new Event('auth:expired')))
    expect(screen.getByTestId('state')).toHaveTextContent('anon|no-token')
  })

  it('useAuth throws outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow('useAuth must be used within AuthProvider')
    void AuthProvider
  })
})
