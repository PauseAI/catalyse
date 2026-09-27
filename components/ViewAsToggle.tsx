'use client'

import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import Button from '@/components/Button'
import { useAuth } from '@/lib/auth-context'
import { setViewingAsVolunteer } from '@/lib/view-as'

/** Lets an admin switch between the admin view of the site and a volunteer's. */
export function ViewAsToggle({ className }: { className?: string }) {
  const { user, refreshUser } = useAuth()
  const queryClient = useQueryClient()
  const pathname = usePathname()
  const router = useRouter()
  const [switching, setSwitching] = useState(false)

  if (!user || !(user.isAdmin || user.viewingAsVolunteer)) return null
  const asVolunteer = user.viewingAsVolunteer

  async function toggle() {
    setSwitching(true)
    setViewingAsVolunteer(!asVolunteer)
    // Admin pages render nothing for a volunteer, so leave them for somewhere that does.
    if (!asVolunteer && pathname.startsWith('/admin')) router.push('/dashboard')
    await refreshUser()
    await queryClient.resetQueries()
    setSwitching(false)
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className={className}
      onClick={toggle}
      disabled={switching}
      active={asVolunteer}
      aria-pressed={asVolunteer}
      title={asVolunteer ? 'Switch back to the admin view' : 'See the site as a volunteer sees it'}
    >
      {asVolunteer ? 'Viewing as volunteer' : 'Viewing as admin'}
    </Button>
  )
}
