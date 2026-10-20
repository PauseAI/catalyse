'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { H1 } from '@/components/Heading'
import { P } from '@/components/Text'
import { orpc } from '@/lib/orpc'
import { useAuth } from '@/lib/auth-context'
import { MAINTENANCE_MESSAGE } from '@/lib/maintenance-message'

/**
 * Replaces the whole app with a "down for maintenance" page while maintenance mode is on,
 * except for super admins (who get a banner instead) and the login page they need to reach.
 * The server refuses every other RPC for everyone else regardless, so this is the friendly
 * face, not the lock.
 *
 * Children render until the status is known, so switching maintenance on costs admins
 * nothing and everyone else sees at most a flash of the page before this takes over.
 */
export default function MaintenanceGate({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth()
  const pathname = usePathname()
  const { data } = useQuery({ ...orpc.maintenance.status.queryOptions(), staleTime: Infinity })
  const [switchedOn, setSwitchedOn] = useState(false)

  useEffect(() => {
    const handler = () => setSwitchedOn(true)
    window.addEventListener('maintenance:on', handler)
    return () => window.removeEventListener('maintenance:on', handler)
  }, [])

  const active = switchedOn || data?.active === true
  if (active && user?.isSuperAdmin) {
    return (
      <>
        <div
          role="status"
          className="bg-warning text-black text-center text-sm font-semibold py-2 px-4"
        >
          Maintenance mode is on — only super admins can use the site.{' '}
          <Link href="/admin/platform-settings" className="underline">
            Turn it off
          </Link>
        </div>
        {children}
      </>
    )
  }
  if (!active || loading || pathname === '/login') return children

  return (
    <main id="main-content" className="container py-5 pb-15">
      <div className="max-w-[400px] my-15 mx-auto text-center">
        <H1>Down for maintenance</H1>
        <P className="text-text-light mb-8">{MAINTENANCE_MESSAGE}</P>
        {user ? (
          <button type="button" onClick={logout} className="text-sm underline cursor-pointer">
            Sign out
          </button>
        ) : (
          <Link href="/login" className="text-sm">
            Admin login
          </Link>
        )}
      </div>
    </main>
  )
}
