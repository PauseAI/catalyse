import { Suspense, type ReactNode } from 'react'
import { render, act, type RenderOptions, type RenderResult } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/lib/query-client'
import { AuthProvider } from '@/lib/auth-context'
import { ToastProvider } from '@/lib/toast'
import { createSession } from '@/lib/auth'
import type { Volunteer } from '@/generated/prisma/client'
import { navigation } from './next-navigation'

/**
 * The providers `app/layout.tsx` mounts around every page, plus the Suspense boundary the App
 * Router puts around each route segment — pages read `params` with `use()`, which suspends.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <Suspense fallback={null}>{children}</Suspense>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}

/**
 * Matches the innermost element whose whole text is `expected`, however it is split across
 * elements: a sentence naming a person holds the name in a PersonName of its own.
 */
export function fullText(expected: string | RegExp) {
  const matches = (text: string | null | undefined) =>
    typeof expected === 'string' ? text === expected : expected.test(text ?? '')
  return (_: string, el: Element | null) =>
    Boolean(el) &&
    matches(el?.textContent) &&
    ![...(el?.children ?? [])].some((child) => matches(child.textContent))
}

/**
 * Renders under the app's providers. `as` logs the volunteer in the way the browser would — a
 * real session row, its token in localStorage — so `AuthProvider` fetches `auth.me` for real
 * through the in-process RPC bridge. The returned `rerender` keeps the providers.
 */
export async function renderApp(
  ui: ReactNode,
  opts: {
    as?: Volunteer | null
    url?: string
    params?: Record<string, string>
  } & RenderOptions = {},
) {
  const { as = null, url, params, ...renderOptions } = opts
  if (url) window.history.replaceState(null, '', url)
  if (params) navigation.params = params
  if (as) localStorage.setItem('authToken', await createSession(as.id))
  // Rendered inside an awaited act: a page that suspends on `use(params)` is only resumed
  // once the act scope has settled, which the synchronous `render` never does.
  let result!: RenderResult
  await act(async () => {
    result = render(ui, { wrapper: AppProviders, ...renderOptions })
  })
  return result
}
