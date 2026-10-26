'use client'

import Link from 'next/link'
import { twMerge } from 'tailwind-merge'
import { usePerson } from '@/lib/hooks/usePerson'
import type { PersonInfo, StaffRole } from '@/lib/people'

const ROLE_LABEL: Record<StaffRole, string> = { admin: 'Admin', lead: 'Lead', deputy: 'Deputy' }

/** The role badge after a name, with the chapter a lead or deputy runs in its tooltip. */
export function RoleBadge({ person }: { person: PersonInfo | undefined }) {
  if (!person?.role) return null
  const title =
    person.role === 'admin'
      ? 'Global admin'
      : `${person.chapter} chapter ${person.role === 'lead' ? 'lead' : 'deputy'}`
  return (
    <span
      title={title}
      className="inline-block shrink-0 rounded border border-primary-text px-1 align-middle text-[0.65rem] font-semibold leading-4 text-primary-text"
    >
      {ROLE_LABEL[person.role]}
    </span>
  )
}

/**
 * A person's name wherever it is shown: a link to their profile when the viewer can open it, and
 * a badge when they run the platform or a chapter. `id` is null for someone with no account,
 * such as a deleted author, and then the name is plain text.
 */
export default function PersonName({
  id,
  name,
  className,
}: {
  id: number | null | undefined
  name: string
  className?: string
}) {
  const person = usePerson(id)
  return (
    <span className="inline-flex min-w-0 max-w-full items-baseline gap-1.5">
      {person?.canView ? (
        <Link
          href={`/volunteers/${person.id}`}
          className={twMerge('min-w-0 truncate text-primary-text underline', className)}
        >
          {name}
        </Link>
      ) : (
        <span className={twMerge('min-w-0 truncate', className)}>{name}</span>
      )}
      <RoleBadge person={person} />
    </span>
  )
}
