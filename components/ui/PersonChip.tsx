import Link from 'next/link'
import { PersonInitials } from '@/components/WorkItemHeader'

const PILL =
  'inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full bg-accent p-0.5 text-sm text-secondary-dark dark:bg-gray-700 dark:text-gray-300'

/**
 * A person as an initials circle and name in a pill, optionally a link and optionally with a `×`
 * that removes them. Any role label ("Owner", "Helper") is the caller's, rendered before the chip.
 */
export function PersonChip({
  name,
  href,
  onRemove,
  removeLabel,
  removeDisabled,
}: {
  name: string
  href?: string
  onRemove?: () => void
  /** The `×` button's accessible name, e.g. "Remove Ann Bee". */
  removeLabel?: string
  removeDisabled?: boolean
}) {
  return (
    <span className={`${PILL} ${onRemove ? 'pr-1' : 'pr-3'}`}>
      <PersonInitials name={name} />
      {href ? (
        <Link href={href} className="min-w-0 truncate hover:underline">
          {name}
        </Link>
      ) : (
        <span className="min-w-0 truncate">{name}</span>
      )}
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

/** The chip's shape with nobody in it: a dashed circle and muted text such as "Unclaimed". */
export function EmptyPersonChip({ label }: { label: string }) {
  return (
    <span className={`${PILL} pr-3`}>
      <span
        aria-hidden="true"
        className="h-7 w-7 shrink-0 rounded-full border border-dashed border-text-light"
      />
      <span className="min-w-0 truncate text-text-light">{label}</span>
    </span>
  )
}
