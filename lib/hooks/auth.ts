'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { ApprovalStatus } from '@/generated/prisma/enums'

export function useRequireAuth() {
  const router = useRouter()
  const auth = useAuth()
  useEffect(() => {
    if (!auth.loading && !auth.user) router.replace('/login')
  }, [auth.user, auth.loading, router])
  return auth
}

/** Where a volunteer lands when a page needs approval they don't have yet. */
export const PENDING_URL = '/dashboard'

/** Where someone lands from an admin page they may not open; see the projects page. */
export const NO_ACCESS_NOTICE_URL = '/projects?notice=no-access'

/** The same, from a page only global admins may open. */
export const GLOBAL_ADMIN_NOTICE_URL = '/projects?notice=global-admin-only'

/**
 * For pages only approved volunteers (and admins) may use. `user` stays null until the
 * volunteer is known to be approved, so the page shows its loading state rather than
 * flashing content before the redirect.
 */
export function useRequireApproved() {
  const router = useRouter()
  const auth = useAuth()
  const isApproved = Boolean(
    auth.user && (auth.user.approvalStatus === ApprovalStatus.approved || auth.user.isAdmin),
  )
  useEffect(() => {
    if (auth.loading) return
    if (!auth.user) router.replace('/login')
    else if (!isApproved) router.replace(PENDING_URL)
  }, [auth.user, auth.loading, isApproved, router])
  return { ...auth, user: isApproved ? auth.user : null }
}

/** Where an approved volunteer with an unconfirmed email is sent from a project page. */
export const VERIFY_EMAIL_URL = '/verify-email'

/**
 * For project pages: approved, and the email proven. An unconfirmed volunteer is sent to the
 * page that asks them to confirm, so a direct link to a project is no way round the gate.
 */
export function useRequireConfirmed() {
  const router = useRouter()
  const auth = useRequireApproved()
  const needsConfirmation = Boolean(auth.user && !auth.user.emailConfirmed && !auth.user.isAdmin)
  useEffect(() => {
    if (needsConfirmation) router.replace(VERIFY_EMAIL_URL)
  }, [needsConfirmation, router])
  return { ...auth, user: needsConfirmation ? null : auth.user }
}

/** For pages only a global admin may use. */
export function useRequireAdmin() {
  const router = useRouter()
  const auth = useAuth()
  useEffect(() => {
    if (!auth.loading && !auth.user) router.replace('/login')
    if (!auth.loading && auth.user && !auth.user.isAdmin) router.replace(GLOBAL_ADMIN_NOTICE_URL)
  }, [auth.user, auth.loading, router])
  return auth
}

/** For pages a chapter's lead or deputies may use as well as a global admin. */
export function useRequireStaff() {
  const router = useRouter()
  const auth = useAuth()
  const isStaff = Boolean(auth.user && (auth.user.access.globalAdmin || auth.user.access.role))
  useEffect(() => {
    if (!auth.loading && !auth.user) router.replace('/login')
    if (!auth.loading && auth.user && !isStaff) router.replace(NO_ACCESS_NOTICE_URL)
  }, [auth.user, auth.loading, isStaff, router])
  return { ...auth, user: isStaff ? auth.user : null }
}
