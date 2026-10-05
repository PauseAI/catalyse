'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth-context'
import { useLocationModal } from '@/lib/location-modal-context'
import Button from '@/components/Button'
import { orpc } from '@/lib/orpc'
import { ThemeToggle } from './ThemeToggle'
import BugReportDialog from './BugReportDialog'
import InboxPopover from './InboxPopover'

function MobileNavLink({
  href,
  children,
  active,
}: {
  href: string
  children: React.ReactNode
  active?: boolean
}) {
  return (
    <Link
      href={href}
      className={`block px-5 py-4 text-brand-text no-underline font-medium text-base border-b border-brand-border transition-colors hover:bg-brand-bg ${active ? 'text-primary bg-accent' : ''}`}
    >
      {children}
    </Link>
  )
}

function MobileNavSection({ children, admin }: { children: React.ReactNode; admin?: boolean }) {
  return (
    <div
      className={`px-5 py-2 text-[0.65rem] font-bold uppercase tracking-widest bg-brand-bg border-b border-brand-border ${admin ? 'text-primary' : 'text-text-light'}`}
    >
      {children}
    </div>
  )
}

/** `path` is `base` or a page below it. */
const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`)

type NavItem = { href: string; label: string; active: (path: string) => boolean }

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Home', active: (p) => p === '/dashboard' },
  {
    href: '/projects',
    label: 'Projects',
    active: (p) => under(p, '/projects') || under(p, '/templates') || under(p, '/suggest'),
  },
  { href: '/quick-tasks', label: 'Tasks', active: (p) => under(p, '/quick-tasks') },
  {
    href: '/volunteers',
    label: 'People',
    active: (p) => under(p, '/volunteers') || under(p, '/teams') || under(p, '/suggest-team'),
  },
  { href: '/inbox', label: 'Inbox', active: (p) => under(p, '/inbox') },
]

function WaitingBadge({ count }: { count: number }) {
  if (count === 0) return null
  return (
    <span className="bg-primary text-[#111827] text-xs px-2 py-0.5 rounded-full ml-1">
      <span className="sr-only">, waiting for you: </span>
      {count}
    </span>
  )
}

export default function Header() {
  const { user, loading, logout } = useAuth()
  const { show: showLocationModal } = useLocationModal()
  const pathname = usePathname()
  const queryClient = useQueryClient()
  const [mounted, setMounted] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [bugDialogOpen, setBugDialogOpen] = useState(false)

  useEffect(() => {
    // Standard hydration guard: reveals browser-only UI (user menu, nav) after
    // mount so it is hidden during SSR and appears in a single paint.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  const { data: counts } = useQuery({
    ...orpc.notifications.counts.queryOptions(),
    enabled: !!user,
  })
  // What is waiting on the viewer: things to act on and messages to read, not updates.
  const waiting = (counts?.needs_action ?? 0) + (counts?.message ?? 0)
  const [inboxOpen, setInboxOpen] = useState(false)
  const closeInbox = useCallback(() => setInboxOpen(false), [])

  // Acting on something (accepting work, answering an invite) can clear what the badge counts.
  useEffect(() => {
    if (!user) return
    return queryClient.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'success') {
        void queryClient.invalidateQueries({ queryKey: orpc.notifications.counts.key() })
      }
    })
  }, [user, queryClient])

  useEffect(() => {
    if (user) void queryClient.invalidateQueries({ queryKey: orpc.notifications.counts.key() })
    // Following a link out of the popover closes it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInboxOpen(false)
  }, [pathname, user, queryClient])

  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileMenuOpen])

  // Close mobile menu on navigation. Intentional derived-state reset pattern;
  // threading a callback through all MobileNavLink usages would be worse.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMobileMenuOpen(false)
  }, [pathname])

  // Signed-in volunteers expect the wordmark to take them Home; signed-out visitors
  // should land on the public explainer at /.
  const homeHref = user ? '/dashboard' : '/'

  return (
    <>
      <header className="bg-surface border-b border-brand-border py-4 sticky top-0 z-[100]">
        <div className="container flex justify-between items-center gap-2 flex-nowrap xl:gap-4">
          <Link
            href={homeHref}
            className="font-display text-2xl font-black text-primary no-underline flex items-center gap-2"
          >
            Catalyse
          </Link>

          <nav aria-label="Main" className="hidden xl:flex gap-2 flex-wrap">
            {mounted &&
              !loading &&
              user &&
              NAV_ITEMS.map(({ href, label, active }) =>
                href === '/inbox' ? (
                  <div key={href} className="relative">
                    <Button
                      variant={active(pathname) || inboxOpen ? 'primary' : 'ghost'}
                      aria-current={active(pathname) ? 'page' : undefined}
                      aria-expanded={inboxOpen}
                      aria-haspopup="dialog"
                      size="sm"
                      onClick={() => setInboxOpen((o) => !o)}
                    >
                      {label}
                      <WaitingBadge count={waiting} />
                    </Button>
                    {inboxOpen && <InboxPopover onClose={closeInbox} />}
                  </div>
                ) : (
                  <Button
                    key={href}
                    href={href}
                    variant={active(pathname) ? 'primary' : 'ghost'}
                    aria-current={active(pathname) ? 'page' : undefined}
                    size="sm"
                  >
                    {label}
                  </Button>
                ),
              )}
          </nav>

          <div className="hidden xl:flex gap-2 items-center">
            {mounted &&
              !loading &&
              (user ? (
                <div className="relative flex items-center gap-2">
                  {!user.locationConfirmedAt && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={showLocationModal}
                      className="animate-pulse"
                    >
                      Confirm your location
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="bg-accent border border-brand-border"
                    onClick={() => setUserMenuOpen((o) => !o)}
                  >
                    {user.name}
                  </Button>
                  {userMenuOpen && (
                    <div
                      className="absolute top-full right-0 mt-2 bg-surface rounded-lg border border-brand-border shadow-lg w-max z-[101]"
                      onClick={() => setUserMenuOpen(false)}
                    >
                      <Link
                        href={`/volunteers/${user.id}`}
                        className="block px-4 py-3 text-brand-text no-underline"
                      >
                        My profile
                      </Link>
                      <Link
                        href="/settings"
                        className="block px-4 py-3 text-brand-text no-underline"
                      >
                        Settings
                      </Link>
                      {user.isAdmin && (
                        <Link
                          href="/admin"
                          className="block px-4 py-3 text-brand-text no-underline border-t border-brand-border mt-1 font-semibold"
                        >
                          {user.isSuperAdmin ? 'Superadmin panel' : 'Admin panel'}
                        </Link>
                      )}
                      <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-text-light border-t border-brand-border mt-1">
                        Session
                      </div>
                      <Button
                        variant="ghost"
                        onClick={logout}
                        className="w-full justify-start px-4 py-3"
                      >
                        Sign Out
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <Button href="/login" variant="ghost" size="sm">
                    Login
                  </Button>
                  <Button href="/signup" size="sm">
                    Sign Up
                  </Button>
                </>
              ))}
          </div>

          {/* Mobile action buttons + hamburger — visible below xl breakpoint */}
          <div className="xl:hidden flex items-center gap-2 shrink-0">
            <ThemeToggle size="md" />
            {user && (
              <Button
                variant="ghost"
                size="md"
                icon
                className="border border-brand-border"
                aria-label="Report a bug or give feedback"
                onClick={() => setBugDialogOpen(true)}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                  <line x1="4" y1="22" x2="4" y2="15" />
                </svg>
              </Button>
            )}
            <Button
              variant="ghost"
              size="md"
              icon
              className="border border-brand-border relative"
              aria-label="Open menu"
              onClick={() => setMobileMenuOpen(true)}
            >
              {mounted && !loading && user && (!user.locationConfirmedAt || waiting > 0) && (
                <span
                  className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-primary"
                  aria-hidden="true"
                />
              )}
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </Button>
          </div>
        </div>
      </header>

      {/* Mobile nav panel — full-screen overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 bg-surface z-[1500] flex flex-col">
          {/* Panel header */}
          <div className="border-b border-brand-border bg-surface shrink-0">
            <div className="container flex items-center justify-between py-4">
              <Link
                href={homeHref}
                className="font-display text-2xl font-black text-primary no-underline"
              >
                Catalyse
              </Link>
              <Button
                variant="ghost"
                size="md"
                icon
                className="border border-brand-border"
                aria-label="Close menu"
                onClick={() => setMobileMenuOpen(false)}
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </Button>
            </div>
          </div>

          {/* Nav links */}
          <div className="flex-1 overflow-y-auto">
            {user &&
              NAV_ITEMS.map(({ href, label, active }) => (
                <MobileNavLink key={href} href={href} active={active(pathname)}>
                  {label}
                  {href === '/inbox' && <WaitingBadge count={waiting} />}
                </MobileNavLink>
              ))}

            {mounted &&
              !loading &&
              (user ? (
                <>
                  <MobileNavSection>Account</MobileNavSection>
                  {!user.locationConfirmedAt && (
                    <button
                      onClick={() => {
                        showLocationModal()
                        setMobileMenuOpen(false)
                      }}
                      className="block w-full text-left px-5 py-4 text-primary font-medium text-base border-b border-brand-border hover:bg-brand-bg cursor-pointer bg-transparent"
                    >
                      Confirm your location
                    </button>
                  )}
                  <MobileNavLink href={`/volunteers/${user.id}`}>My profile</MobileNavLink>
                  <MobileNavLink href="/settings">Settings</MobileNavLink>

                  {user.isAdmin && (
                    <>
                      <MobileNavSection admin>
                        {user.isSuperAdmin ? 'Super Admin' : 'Admin'}
                      </MobileNavSection>
                      <MobileNavLink href="/admin">
                        {user.isSuperAdmin ? 'Superadmin panel' : 'Admin panel'}
                      </MobileNavLink>
                    </>
                  )}

                  <MobileNavSection>Session</MobileNavSection>
                  <button
                    onClick={() => {
                      logout()
                      setMobileMenuOpen(false)
                    }}
                    className="block w-full text-left px-5 py-4 text-brand-text font-medium text-base border-b border-brand-border hover:bg-brand-bg cursor-pointer bg-transparent"
                  >
                    Sign Out
                  </button>
                </>
              ) : (
                <>
                  <MobileNavSection>Account</MobileNavSection>
                  <MobileNavLink href="/login">Login</MobileNavLink>
                  <MobileNavLink href="/signup">Sign Up</MobileNavLink>
                </>
              ))}
          </div>

          {/* Pinned bottom bar */}
          <div className="shrink-0 border-t border-brand-border bg-surface">
            <div className="flex items-center overflow-hidden w-full">
              <ThemeToggle
                icon={false}
                size="md"
                className="rounded-none flex-1 justify-center self-stretch"
              />
              {user && (
                <button
                  onClick={() => {
                    setBugDialogOpen(true)
                    setMobileMenuOpen(false)
                  }}
                  className="flex items-center justify-center gap-2 flex-1 px-4 py-2 text-brand-text font-medium text-base border-l border-brand-border hover:bg-brand-bg cursor-pointer bg-transparent whitespace-nowrap"
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                    <line x1="4" y1="22" x2="4" y2="15" />
                  </svg>
                  Report bug/feedback
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {user && <BugReportDialog isOpen={bugDialogOpen} onClose={() => setBugDialogOpen(false)} />}
    </>
  )
}
