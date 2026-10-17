'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from './auth-context'
import { orpc } from './orpc'
import type { RequiredAction } from './required-actions'

interface RequiredActionsValue {
  actions: RequiredAction[]
  /** The action whose dialog is showing, if any. */
  openAction: RequiredAction | null
  show: (id: string) => void
  /** Closes the dialog; the action stays in the banner until it is settled. */
  hide: () => void
  /** Fetches the list again, after something may have settled an action. */
  refresh: () => Promise<void>
}

const RequiredActionsContext = createContext<RequiredActionsValue | null>(null)

/** Pages an emailed link or sign-in lands on, where a dialog would cover what they are for. */
const QUIET_PATHS = [
  '/merge-accounts',
  '/verify-email',
  '/reset-password',
  '/accept-invite',
  '/login',
  '/signup',
]

/**
 * The signed-in person's required actions (lib/required-actions.ts). The first one's dialog
 * opens by itself once per page load, except on a QUIET_PATHS page; after that each opens from
 * the banner.
 */
export function RequiredActionsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const pathname = usePathname()
  const quiet = QUIET_PATHS.some((p) => pathname.startsWith(p))
  const queryClient = useQueryClient()
  const options = orpc.requiredActions.list.queryOptions()
  // Keyed by person too, so whoever signs in next in this tab never sees the last one's.
  const { data } = useQuery({
    ...options,
    queryKey: [...options.queryKey, user?.id],
    enabled: !!user,
  })
  const actions = user ? (data ?? []) : []
  // undefined until the person opens or closes one, so the first action opens by itself.
  const [chosen, setChosen] = useState<string | null | undefined>(undefined)
  const openId = chosen === undefined ? (quiet ? null : actions[0]?.id) : chosen
  const openAction = actions.find((a) => a.id === openId) ?? null

  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.requiredActions.list.key() })

  return (
    <RequiredActionsContext.Provider
      value={{ actions, openAction, show: setChosen, hide: () => setChosen(null), refresh }}
    >
      {children}
    </RequiredActionsContext.Provider>
  )
}

export function useRequiredActions() {
  const ctx = useContext(RequiredActionsContext)
  if (!ctx) throw new Error('useRequiredActions must be used within RequiredActionsProvider')
  return ctx
}
