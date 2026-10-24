import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '@/test/render'
import Footer from './Footer'
import UpdatePrompt from './UpdatePrompt'

/** The footer prints the version the server last reported, so a test can wait for each check. */
const mount = (reload?: () => void) =>
  renderApp(
    <>
      <UpdatePrompt reload={reload} />
      <Footer />
    </>,
  )

/** What the browser fires when the app comes back into view, which makes the prompt check again. */
async function returnToApp() {
  await act(async () => {
    window.dispatchEvent(new Event('visibilitychange'))
  })
}

const prompt = () => screen.queryByText('A new version of Catalyse is available.')

describe('UpdatePrompt', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    delete document.documentElement.dataset.dplId
  })

  it('stays hidden while the server runs the version the page was built from', async () => {
    vi.stubEnv('RAILWAY_GIT_COMMIT_SHA', 'aaa1111')
    document.documentElement.dataset.dplId = 'aaa1111'
    await mount()
    await returnToApp()
    await screen.findByText('aaa1111')
    expect(prompt()).not.toBeInTheDocument()
  })

  it('offers a refresh as soon as the page is older than the server', async () => {
    vi.stubEnv('RAILWAY_GIT_COMMIT_SHA', 'bbb2222')
    document.documentElement.dataset.dplId = 'aaa1111'
    const reload = vi.fn()
    await mount(reload)
    await userEvent.click(await screen.findByRole('button', { name: 'Refresh' }))
    expect(reload).toHaveBeenCalled()
  })

  it('Refresh with no handler given calls window.location.reload, a no-op in jsdom', async () => {
    vi.stubEnv('RAILWAY_GIT_COMMIT_SHA', 'bbb2222')
    document.documentElement.dataset.dplId = 'aaa1111'
    await mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Refresh' }))
    expect(prompt()).toBeInTheDocument()
  })

  it('without a deployment id, compares against the first version it saw', async () => {
    vi.stubEnv('RAILWAY_GIT_COMMIT_SHA', 'aaa1111')
    await mount()
    await screen.findByText('aaa1111')
    expect(prompt()).not.toBeInTheDocument()

    vi.stubEnv('RAILWAY_GIT_COMMIT_SHA', 'bbb2222')
    await returnToApp()
    expect(await screen.findByText('A new version of Catalyse is available.')).toBeInTheDocument()
  })

  it('Later hides it until a newer deploy still', async () => {
    vi.stubEnv('RAILWAY_GIT_COMMIT_SHA', 'bbb2222')
    document.documentElement.dataset.dplId = 'aaa1111'
    await mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Later' }))
    expect(prompt()).not.toBeInTheDocument()

    await returnToApp()
    await screen.findByText('bbb2222')
    expect(prompt()).not.toBeInTheDocument()

    vi.stubEnv('RAILWAY_GIT_COMMIT_SHA', 'ccc3333')
    await returnToApp()
    await screen.findByText('ccc3333')
    expect(prompt()).toBeInTheDocument()
  })
})
