'use client'

import { useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import Button from '@/components/Button'
import { parentPage } from '@/lib/parent-page'

const STANDALONE = '(display-mode: standalone)'

function subscribeStandalone(onChange: () => void) {
  const mq = window.matchMedia(STANDALONE)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

/** Installed and opened from the home screen; iOS Safari reports it on `navigator` instead. */
function isStandalone() {
  return (
    window.matchMedia(STANDALONE).matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

/** The parts of the Navigation API used here; TypeScript's DOM types do not include it yet. */
type NavigationApi = EventTarget & { currentEntry: { index: number } | null }

const navigationApi = () => (window as Window & { navigation?: NavigationApi }).navigation

function subscribeHistory(onChange: () => void) {
  const target: EventTarget = navigationApi() ?? window
  const event = navigationApi() ? 'currententrychange' : 'popstate'
  target.addEventListener(event, onChange)
  return () => target.removeEventListener(event, onChange)
}

/** Whether this session has an earlier page of ours; without the Navigation API, a guess. */
function canGoBack() {
  const nav = navigationApi()
  return nav ? (nav.currentEntry?.index ?? 0) > 0 : window.history.length > 1
}

const never = () => false

/**
 * An installed app has no browser chrome, so no back button of its own. Goes back through
 * the session's history, or, on the first page of it, up to the page's parent.
 */
export default function BackButton() {
  const pathname = usePathname()
  const standalone = useSyncExternalStore(subscribeStandalone, isStandalone, never)
  const hasHistory = useSyncExternalStore(subscribeHistory, canGoBack, never)

  if (!standalone) return null
  const parent = hasHistory ? null : parentPage(pathname)
  if (!hasHistory && !parent) return null

  const props = {
    variant: 'ghost',
    size: 'md',
    icon: true,
    className: 'border border-brand-border shrink-0',
    'aria-label': 'Back',
    children: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="15 18 9 12 15 6" />
      </svg>
    ),
  } as const

  return parent ? (
    <Button href={parent} {...props} />
  ) : (
    <Button onClick={() => window.history.back()} {...props} />
  )
}
