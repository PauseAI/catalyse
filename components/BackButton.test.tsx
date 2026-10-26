import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '@/test/render'
import { parentPage } from '@/lib/parent-page'
import BackButton from './BackButton'

/** `(display-mode: standalone)` matches when `installed`; `install()` flips it as Chrome would. */
function displayMode(installed: boolean) {
  const listeners = new Set<() => void>()
  const mq = {
    matches: installed,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  }
  window.matchMedia = vi.fn(() => mq) as never
  return {
    install() {
      mq.matches = true
      listeners.forEach((l) => l())
    },
  }
}

/** A Navigation API whose current entry sits at `index` in the session. */
function sessionAt(index: number | null) {
  const nav = Object.assign(new EventTarget(), {
    currentEntry: index === null ? null : { index },
  })
  Object.defineProperty(window, 'navigation', { value: nav, configurable: true })
  return {
    moveTo(next: number) {
      nav.currentEntry = { index: next }
      nav.dispatchEvent(new Event('currententrychange'))
    },
  }
}

const back = () => screen.queryByRole('button', { name: 'Back' })
const backLink = () => screen.queryByRole('link', { name: 'Back' })

describe('BackButton', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'navigation')
    Reflect.deleteProperty(navigator, 'standalone')
    vi.restoreAllMocks()
  })

  it('stays out of a browser tab, which has a back button of its own', async () => {
    displayMode(false)
    sessionAt(3)
    await renderApp(<BackButton />, { url: '/projects/1' })
    expect(back()).toBeNull()
    expect(backLink()).toBeNull()
  })

  it('goes back through the session once installed, and appears when the app is installed', async () => {
    const mode = displayMode(false)
    sessionAt(1)
    const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    await renderApp(<BackButton />, { url: '/dashboard' })
    expect(back()).toBeNull()
    act(() => mode.install())
    await userEvent.click(back()!)
    expect(historyBack).toHaveBeenCalled()
  })

  it("on the first page of the session, goes up to the page's parent on iOS", async () => {
    displayMode(false)
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true })
    const session = sessionAt(0)
    await renderApp(<BackButton />, { url: '/projects/7/tasks/9' })
    expect(backLink()).toHaveAttribute('href', '/projects/7')
    act(() => session.moveTo(1))
    expect(back()).toBeInTheDocument()
    expect(backLink()).toBeNull()
  })

  it('shows nothing on the first page of the session when the page has no parent', async () => {
    displayMode(true)
    sessionAt(null)
    await renderApp(<BackButton />, { url: '/dashboard' })
    expect(back()).toBeNull()
    expect(backLink()).toBeNull()
  })

  it('without the Navigation API, judges by the length of the history', async () => {
    displayMode(true)
    const length = vi.spyOn(window.history, 'length', 'get').mockReturnValue(1)
    await renderApp(<BackButton />, { url: '/volunteers/4' })
    expect(backLink()).toHaveAttribute('href', '/volunteers')
    length.mockReturnValue(2)
    act(() => window.dispatchEvent(new PopStateEvent('popstate')))
    expect(back()).toBeInTheDocument()
  })
})

describe('parentPage', () => {
  it.each([
    ['/projects/7/tasks/9', '/projects/7'],
    ['/projects/7/edit', '/projects/7'],
    ['/projects/7/import', '/projects/7'],
    ['/projects/7', '/projects'],
    ['/projects/gantt', '/projects'],
    ['/quick-tasks/3', '/quick-tasks'],
    ['/volunteers/4', '/volunteers'],
    ['/teams/2', '/teams'],
    ['/inbox/messages/5', '/inbox'],
    ['/templates/new', '/templates'],
    ['/suggest/new', '/suggest'],
    ['/admin/applications/6', '/admin/applications'],
    ['/admin/chapters/1', '/admin/chapters'],
    ['/admin/projects/new', '/admin/projects'],
    ['/admin/teams/8', '/admin/teams'],
    ['/admin/volunteers/4', '/admin'],
    ['/admin/skills', '/admin'],
  ])('%s goes up to %s', (path, parent) => {
    expect(parentPage(path)).toBe(parent)
  })

  it.each(['/dashboard', '/projects', '/inbox', '/admin', '/bugs/3', '/'])(
    '%s has no parent',
    (path) => {
      expect(parentPage(path)).toBeNull()
    },
  )
})
