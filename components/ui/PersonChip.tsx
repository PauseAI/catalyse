import Link from 'next/link'
import Avatar from '@/components/Avatar'
import { RoleBadge } from '@/components/PersonName'
import { usePerson } from '@/lib/hooks/usePerson'

const PILL = 'inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full p-0.5 text-sm'

/**
 * A person as their avatar and name in a pill, optionally with a `×` that removes them. As
 * with PersonName, the name links to their profile when the viewer can open it, and carries their
 * staff badge. Any project role label ("Owner", "Helper") is the caller's.
 */
export function PersonChip({
  id,
  name,
  isViewer,
  onRemove,
  removeLabel,
  removeDisabled,
}: {
  id: number | null | undefined
  name: string
  /** Marks the chip as the viewer's own with a muted "(you)" after the name. */
  isViewer?: boolean
  onRemove?: () => void
  /** The `×` button's accessible name, e.g. "Remove Ann Bee". */
  removeLabel?: string
  removeDisabled?: boolean
}) {
  const person = usePerson(id)
  return (
    <span className={`${PILL} bg-chip text-chip-text ${onRemove ? 'pr-1' : 'pr-3'}`}>
      <Avatar id={id} name={name} />
      {person?.canView ? (
        <Link href={`/volunteers/${person.id}`} className="min-w-0 truncate hover:underline">
          {name}
        </Link>
      ) : (
        <span className="min-w-0 truncate">{name}</span>
      )}
      <RoleBadge person={person} />
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
    <span className={PILL}>
      <span
        aria-hidden="true"
        className="h-7 w-7 shrink-0 rounded-full border border-dashed border-text-light dark:border-gray-400"
      />
      <span className="min-w-0 truncate text-text-light">{label}</span>
    </span>
  )
}
