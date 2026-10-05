import { describe, it, expect, vi } from 'vitest'
import { createElement, type ComponentType } from 'react'
import { renderToString } from 'react-dom/server'

/**
 * Server render — no `window`, no storage — of client pages that branch on
 * `typeof window`. Next prerenders these on the server first, so the guards are real code
 * paths; a page that throws here would break the production build.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {}, replace() {}, back() {} }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}))
vi.mock('next/script', async () => (await import('@/test/next-stubs')).script)
vi.mock('next/font/google', async () => (await import('@/test/next-stubs')).fontGoogle)

async function ssr(page: ComponentType) {
  const [{ AppProviders }, { ThemeProvider }, { LocationModalProvider }] = await Promise.all([
    import('@/test/render'),
    import('@/components/ThemeProvider'),
    import('@/lib/location-modal-context'),
  ])
  return renderToString(
    createElement(
      AppProviders,
      null,
      createElement(
        ThemeProvider,
        null,
        createElement(LocationModalProvider, null, createElement(page)),
      ),
    ),
  )
}

describe('server rendering of client pages', () => {
  it('renders the dashboard shell without a window', async () => {
    const { default: DashboardPage } = await import('./dashboard/page')
    // Signed out on the server: the page renders nothing but the toast container.
    expect(await ssr(DashboardPage)).not.toContain('Needs your attention')
  })

  it('renders the root layout shell around its children', async () => {
    const { default: RootLayout, metadata } = await import('./layout')
    expect(metadata.title).toEqual({
      template: 'Catalyse | %s',
      default: 'Catalyse | PauseAI Volunteer Platform',
    })
    const html = renderToString(
      createElement(RootLayout, null, createElement('p', null, 'page body')),
    )
    expect(html).toContain(
      '<html lang="en" class="--font-montserrat --font-roboto-slab --font-saira"',
    )
    expect(html).toContain('Skip to content')
    expect(html).toContain('<main id="main-content"><p>page body</p></main>')
  })

  it('renders the header without a window', async () => {
    const { default: Header } = await import('@/components/Header')
    expect(await ssr(Header)).toContain('Catalyse')
  })
})
