import React from 'react'

/**
 * Five colours, one meaning each: grey is not active, blue is under way or waiting, orange
 * needs attention soon, red is late, green is done. Each has a filled form (it is the viewer's
 * move) and an outline form (the viewer is waiting on someone else). Both carry a two-pixel
 * border so switching between them never changes a badge's size.
 */
const BADGE_VARIANTS = {
  neutral: {
    filled:
      'bg-gray-100 text-gray-700 border-gray-100 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-700',
    outline: 'bg-transparent text-gray-600 border-gray-400 dark:text-gray-300 dark:border-gray-500',
  },
  info: {
    filled:
      'bg-blue-100 text-blue-800 border-blue-100 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-950',
    outline: 'bg-transparent text-blue-700 border-blue-400 dark:text-blue-300 dark:border-blue-500',
  },
  attention: {
    filled:
      'bg-orange-100 text-orange-800 border-orange-100 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-950',
    outline:
      'bg-transparent text-orange-700 border-orange-400 dark:text-orange-300 dark:border-orange-500',
  },
  danger: {
    filled:
      'bg-red-100 text-red-800 border-red-100 dark:bg-red-900 dark:text-red-300 dark:border-red-900',
    outline: 'bg-transparent text-red-700 border-red-400 dark:text-red-300 dark:border-red-500',
  },
  success: {
    filled:
      'bg-emerald-100 text-emerald-800 border-emerald-100 dark:bg-emerald-900 dark:text-emerald-300 dark:border-emerald-900',
    outline:
      'bg-transparent text-emerald-700 border-emerald-400 dark:text-emerald-300 dark:border-emerald-600',
  },
} as const

export type BadgeVariant = keyof typeof BADGE_VARIANTS

export function badgeClasses(variant: BadgeVariant, className = '', outline = false) {
  // `status-badge` is a documented e2e test selector — keep it.
  return `status-badge inline-flex items-center px-2.5 py-0.5 border-2 rounded-full text-xs font-semibold uppercase tracking-wide ${badgeColorClasses(variant, outline)} ${className}`.trim()
}

// Just the color classes, with none of badgeClasses' layout utilities — for
// callers building their own pill-shaped control (e.g. a colored select trigger).
export function badgeColorClasses(variant: BadgeVariant, outline = false) {
  return BADGE_VARIANTS[variant][outline ? 'outline' : 'filled']
}

export function Badge({
  variant = 'neutral',
  outline = false,
  className = '',
  role,
  'aria-label': ariaLabel,
  children,
}: {
  variant?: BadgeVariant
  /** The viewer is waiting on someone else, rather than it being their move. */
  outline?: boolean
  className?: string
  role?: string
  'aria-label'?: string
  children: React.ReactNode
}) {
  return (
    <span
      role={role}
      aria-label={ariaLabel}
      data-emphasis={outline ? 'outline' : 'filled'}
      className={badgeClasses(variant, className, outline)}
    >
      {children}
    </span>
  )
}

/** A fact beside a status that is not a status itself: "• Seeking help", "• Blocked by 'X'". */
export function StatusFlag({ children }: { children: React.ReactNode }) {
  return <span className="text-xs text-text-light">• {children}</span>
}
