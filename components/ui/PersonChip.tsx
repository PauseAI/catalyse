import Link from 'next/link'
import { PersonInitials } from '@/components/WorkItemHeader'

const PILL = 'inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full p-0.5 text-sm'

/**
 * A person as an initials circle and name in a pill, optionally a link and optionally with a `×`
 * that removes them. Any role label ("Owner", "Helper") is the caller's, rendered before the chip.
 */
export function PersonChip({
  name,
  href,
  isViewer,
  onRemove,
  removeLabel,
  removeDisabled,
}: {
  name: string
  href?: string
  /** Marks the chip as the viewer's own with a muted "(you)" after the name. */
  isViewer?: boolean
  onRemove?: () => void
  /** The `×` button's accessible name, e.g. "Remove Ann Bee". */
  removeLabel?: string
  removeDisabled?: boolean
}) {
  return (
    <span
      className={`${PILL} bg-accent text-secondary-dark dark:bg-gray-700 dark:text-gray-300 ${onRemove ? 'pr-1' : 'pr-3'}`}
    >
      <PersonInitials name={name} />
      {href ? (
        <Link href={href} className="min-w-0 truncate hover:underline">
          {name}
        </Link>
      ) : (
        <span className="min-w-0 truncate">{name}</span>
      )}
      {isViewer && <span className="shrink-0 text-text-light">(you)</span>}
      {onRemove && (
        <button
          type="button"
          aria-label={removeLabel}
          onClick={onRemove}
          disabled={removeDisabled}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full leading-none hover:bg-secondary/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          ×
        </button>
      )}
    </span>
  )
}

/**
 * The chip's shape with nobody in it: a dashed circle and muted text such as "Unclaimed", with no
 * fill so it doesn't read as a badge.
 */
export function EmptyPersonChip({ label }: { label: string }) {
  return (
    <span className={`${PILL} pr-3`}>
      <span
        aria-hidden="true"
        className="h-7 w-7 shrink-0 rounded-full border border-dashed border-text-light dark:border-gray-400"
      />
      <span className="min-w-0 truncate text-text-light">{label}</span>
    </span>
  )
}
