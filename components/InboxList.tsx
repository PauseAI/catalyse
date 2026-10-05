'use client'

import { useState } from 'react'
import InboxRow, { type InboxNotification } from './InboxRow'

/**
 * Notifications about the same thing (same type, and the same entity or link) collapse into
 * the newest, with the rest behind "n earlier". Order is otherwise kept.
 */
export function groupNotifications(items: InboxNotification[]): InboxNotification[][] {
  const groups = new Map<string, InboxNotification[]>()
  for (const n of items) {
    const about = n.entityId ?? n.link
    const key = about === null ? `single-${n.id}` : `${n.type}:${about}`
    groups.set(key, [...(groups.get(key) ?? []), n])
  }
  return [...groups.values()]
}

export default function InboxList({
  items,
  compact = false,
}: {
  items: InboxNotification[]
  compact?: boolean
}) {
  const [open, setOpen] = useState<Set<number>>(new Set())
  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <ul className={`list-none p-0 m-0 ${compact ? 'divide-y divide-brand-border' : ''}`}>
      {groupNotifications(items).map(([first, ...rest]) => (
        <li key={first.id}>
          <InboxRow
            n={first}
            compact={compact}
            extra={
              rest.length > 0 && (
                <button
                  type="button"
                  aria-expanded={open.has(first.id)}
                  className="text-sm underline text-text-light cursor-pointer bg-transparent border-0 p-0"
                  onClick={() => toggle(first.id)}
                >
                  {open.has(first.id) ? 'Hide earlier' : `${rest.length} earlier`}
                </button>
              )
            }
          />
          {open.has(first.id) && (
            <div className="ml-6">
              {rest.map((n) => (
                <InboxRow key={n.id} n={n} compact={compact} />
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
