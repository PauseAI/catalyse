'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Button from '@/components/Button'
import { orpc } from '@/lib/orpc'

const CHECK_EVERY_MS = 10 * 60 * 1000

/** The deployment this page was built from, which Next writes on `<html>` when `deploymentId` is set. */
function builtFrom(): string | null {
  return typeof document === 'undefined' ? null : (document.documentElement.dataset.dplId ?? null)
}

/**
 * Offers a reload once the server is running a newer deployment than this page. It checks when
 * the app comes back into view and every few minutes while it is open. Without a deployment id
 * (a local build) the page counts as built from the first version the server reports.
 */
export default function UpdatePrompt({ reload = () => window.location.reload() }) {
  const { data } = useQuery({
    ...orpc.version.get.queryOptions(),
    staleTime: 0,
    refetchInterval: CHECK_EVERY_MS,
  })
  const [loaded, setLoaded] = useState(builtFrom)
  const [dismissed, setDismissed] = useState<string | null>(null)
  if (data && loaded === null) setLoaded(data.sha)

  if (!data || loaded === null || data.sha === loaded || data.sha === dismissed) return null

  return (
    <div
      role="status"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9998] w-[360px] max-sm:w-[calc(100vw-24px)] max-sm:bottom-4 flex items-center gap-3 rounded-lg border border-brand-border bg-surface px-4 py-3 text-sm shadow-lg"
    >
      <span className="flex-1">A new version of Catalyse is available.</span>
      <Button variant="ghost" size="sm" onClick={() => setDismissed(data.sha)}>
        Later
      </Button>
      <Button size="sm" onClick={reload}>
        Refresh
      </Button>
    </div>
  )
}
