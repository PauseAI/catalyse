'use client'

import { useEffect } from 'react'

/**
 * Registers `public/sw.js`, which shows an offline page when a navigation cannot reach the
 * network. Production only, so the dev server never runs behind a worker.
 */
export default function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch((error: unknown) => console.warn('Service worker registration failed', error))
  }, [])
  return null
}
