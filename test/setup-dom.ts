import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'

// Everything a component test fakes from the framework is listed here. vi.mock is hoisted
// and inert in the node environment — these modules are only ever imported by components,
// which only run under jsdom.
vi.mock('next/navigation', () => import('./next-navigation'))
vi.mock('next/script', async () => (await import('./next-stubs')).script)
vi.mock('next/font/google', async () => (await import('./next-stubs')).fontGoogle)

// Only `.test.tsx` files get jsdom (see vitest.config.mts); everything below needs a window.
if (typeof window !== 'undefined') {
  const { installRpcFetch, resetRpcFetch } = await import('./rpc-fetch')
  // Before anything loads lib/client.ts, whose link keeps the `fetch` it finds.
  installRpcFetch()
  const { cleanup, configure } = await import('@testing-library/react')
  const { queryClient } = await import('@/lib/query-client')
  const { navigation } = await import('./next-navigation')
  // `findBy*` waits for a real RPC round trip; Testing Library's default of one second is
  // far too tight on a busy CI runner, where a page's first load can take several seconds.
  configure({ asyncUtilTimeout: 15_000 })
  // The app's client retries failed queries with backoff; a test asserting on an error state
  // would otherwise wait several seconds for the retries to run out.
  queryClient.setDefaultOptions({ queries: { retry: false } })
  // jsdom has no layout, so it does not implement scrollIntoView.
  Element.prototype.scrollIntoView = () => {}

  afterEach(() => {
    cleanup()
    queryClient.clear()
    localStorage.clear()
    navigation.reset()
    resetRpcFetch()
  })
}
