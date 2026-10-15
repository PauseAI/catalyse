'use client'

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Space between the trigger and the tip, and between the tip and the edge it is kept inside. */
const GAP = 6

type Box = { left: number; top: number; right: number; bottom: number }
type Anchor = { rect: Box; bounds: Box }

/**
 * Where the tip goes: above the trigger and centred, or to its right (to its left when the right
 * has no room), then clamped so it stays inside `bounds`.
 */
export function placeTip(
  side: 'top' | 'right',
  { rect, bounds }: Anchor,
  size: { width: number; height: number },
): { left: number; top: number } {
  let left: number
  let top: number
  if (side === 'right') {
    left = rect.right + GAP
    if (left + size.width > bounds.right - GAP) left = rect.left - GAP - size.width
    top = (rect.top + rect.bottom) / 2 - size.height / 2
  } else {
    left = (rect.left + rect.right) / 2 - size.width / 2
    top = rect.top - GAP - size.height
  }
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max))
  return {
    left: clamp(left, bounds.left + GAP, bounds.right - GAP - size.width),
    top: clamp(top, bounds.top + GAP, bounds.bottom - GAP - size.height),
  }
}

/**
 * A tip shown at once, on hover or keyboard focus of its trigger, and hidden on leave, blur or
 * Escape. Nothing shows while `content` is empty.
 */
export default function Tooltip({
  content,
  children,
  side = 'top',
  within,
}: {
  content: ReactNode
  children: ReactNode
  side?: 'top' | 'right'
  /** Selector for an ancestor the tip stays inside, such as a chart; the window otherwise. */
  within?: string
}) {
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const tip = useRef<HTMLSpanElement>(null)

  function show(e: React.SyntheticEvent<HTMLSpanElement>) {
    // The trigger is the wrapped element; this span is only a listener and may have no box.
    const trigger = e.currentTarget.firstElementChild ?? e.currentTarget
    const container = within ? e.currentTarget.closest(within)?.getBoundingClientRect() : undefined
    const bounds = {
      left: Math.max(container?.left ?? 0, 0),
      top: Math.max(container?.top ?? 0, 0),
      right: Math.min(container?.right ?? Infinity, window.innerWidth),
      bottom: Math.min(container?.bottom ?? Infinity, window.innerHeight),
    }
    setAnchor({ rect: trigger.getBoundingClientRect(), bounds })
  }

  // Placed before paint, once the tip's own size is known.
  useLayoutEffect(() => {
    const el = tip.current
    if (!anchor || !el) return
    const { left, top } = placeTip(side, anchor, el.getBoundingClientRect())
    el.style.left = `${left}px`
    el.style.top = `${top}px`
  }, [anchor, side, content])

  const hide = () => setAnchor(null)

  return (
    <span
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={(e) => {
        if (e.key === 'Escape') hide()
      }}
    >
      {children}
      {anchor &&
        content &&
        createPortal(
          <span
            ref={tip}
            role="tooltip"
            className="pointer-events-none fixed top-0 left-0 z-50 max-w-xs rounded bg-gray-900 px-2 py-1 text-center text-xs text-white"
          >
            {content}
          </span>,
          document.body,
        )}
    </span>
  )
}
