import Link from 'next/link'

/**
 * Tabs that are pages: each view has its own address, so a view can be linked to and the
 * back button works. Styled to match `Tabs`.
 */
export default function ViewSwitch({
  label,
  views,
  current,
  className = 'mb-6',
}: {
  label: string
  views: { href: string; label: string }[]
  current: string
  className?: string
}) {
  return (
    <nav
      aria-label={label}
      className={`flex overflow-x-auto border-b border-brand-border ${className}`}
    >
      {views.map((v) => (
        <Link
          key={v.href}
          href={v.href}
          aria-current={v.href === current ? 'page' : undefined}
          className={`shrink-0 whitespace-nowrap px-5 py-3 font-medium border-b-2 -mb-px no-underline transition-colors ${
            v.href === current
              ? 'text-primary border-primary'
              : 'text-text-light border-transparent hover:text-brand-text'
          }`}
        >
          {v.label}
        </Link>
      ))}
    </nav>
  )
}

export const PROJECT_VIEWS = [
  { href: '/projects', label: 'List' },
  { href: '/projects/gantt', label: 'Timeline' },
]

export const PEOPLE_VIEWS = [
  { href: '/volunteers', label: 'Volunteers' },
  { href: '/teams', label: 'Teams' },
]
