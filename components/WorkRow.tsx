import type React from 'react'
import Tooltip from '@/components/Tooltip'
import { initials } from '@/components/WorkItemHeader'

/** Whoever holds a row's work, as initials, or a dashed circle while nobody does. */
export function PersonAvatar({
  name,
  label = 'Assigned to',
  emptyLabel = 'Unassigned',
}: {
  name: string | null
  /** Read before the name: "Assigned to Sam". */
  label?: string
  emptyLabel?: string
}) {
  if (!name) {
    return (
      <span
        aria-label={emptyLabel}
        title={emptyLabel}
        className="w-6 h-6 rounded-full border border-dashed border-brand-border shrink-0"
      />
    )
  }

  return (
    <Tooltip content={name}>
      <span
        aria-label={`${label} ${name}`}
        className="w-6 h-6 rounded-full bg-secondary text-white text-xs font-semibold flex items-center justify-center shrink-0"
      >
        {initials(name)}
      </span>
    </Tooltip>
  )
}

/**
 * Overlays a row's title link across the whole row, so the row is one tab stop named by its
 * title and a click anywhere on it follows the link. The row must be `relative`; anything else
 * in it that takes a click needs `relative z-10`.
 */
export const STRETCHED_LINK = 'after:absolute after:inset-0 after:content-[""]'

export type WorkRowParts = {
  /** Left of the title. */
  status: React.ReactNode
  title: React.ReactNode
  /** Under the title, muted: what a task waits for, its project, a role or a date. */
  below: React.ReactNode
  chips?: React.ReactNode
  /** Right-aligned, usually a `PersonAvatar`. */
  person: React.ReactNode
  primaryAction?: React.ReactNode
  menu?: React.ReactNode
}

/** A row of work: `[status] Title … chips person`. */
export default function WorkRow({
  handle,
  rowRef,
  style,
  className = 'py-2',
  status,
  title,
  below,
  chips,
  person,
  primaryAction,
  menu,
}: WorkRowParts & {
  handle?: React.ReactNode
  rowRef?: (node: HTMLElement | null) => void
  style?: React.CSSProperties
  className?: string
}) {
  return (
    <li
      ref={rowRef}
      className={`group relative flex flex-wrap items-start gap-2 border-b border-brand-border last:border-0 ${className}`}
      style={style}
    >
      {handle}
      {status && <div className="shrink-0">{status}</div>}
      {/* The title keeps a readable width; when the right-hand group can't fit beside it, that
          group wraps onto its own line, flush right. */}
      <div className="flex-1 min-w-48 break-words">
        {title}
        {below}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 ml-auto mt-1">
        {chips}
        {/* The action, person and menu stay together when the chips wrap. */}
        <div className="flex items-center gap-2">
          {primaryAction}
          {person}
          {menu && (
            <div className="opacity-60 group-hover:opacity-100 focus-within:opacity-100 has-aria-expanded:opacity-100 transition-opacity">
              {menu}
            </div>
          )}
        </div>
      </div>
    </li>
  )
}
