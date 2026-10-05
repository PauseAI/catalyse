'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import InboxList from './InboxList'
import { orpc } from '@/lib/orpc'

const SHOWN = 5

/** The newest few notifications under the nav's Inbox item, with a way into the full Inbox. */
export default function InboxPopover({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const { data, isPending } = useQuery({
    ...orpc.notifications.list.queryOptions({ input: { limit: SHOWN } }),
  })

  useEffect(() => {
    function onPointer(e: MouseEvent) {
      const target = e.target as Node
      // The trigger toggles itself; any other click outside closes.
      if (ref.current?.contains(target) || ref.current?.parentElement?.contains(target)) return
      onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const items = data?.notifications ?? []
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Recent notifications"
      className="absolute top-full right-0 mt-2 w-[26rem] max-w-[90vw] bg-surface rounded-lg border border-brand-border shadow-lg z-[101] px-4 py-2 text-left"
    >
      {isPending ? (
        <p className="text-sm text-text-light py-3 m-0">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-text-light py-3 m-0">Nothing new.</p>
      ) : (
        <InboxList items={items} compact />
      )}
      <div className="border-t border-brand-border pt-2 mt-1 text-right">
        <Link href="/inbox" className="text-sm font-semibold" onClick={onClose}>
          Open inbox →
        </Link>
      </div>
    </div>
  )
}
