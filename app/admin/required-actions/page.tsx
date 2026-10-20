'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useRequireAdmin } from '@/lib/hooks/auth'
import { orpc } from '@/lib/orpc'
import type { RequiredActionKind } from '@/lib/required-actions'
import { SECTION_CARD } from '@/lib/ui-classes'
import { H1, H2 } from '@/components/Heading'
import { P } from '@/components/Text'

const SECTIONS: Record<RequiredActionKind, { title: string; about: string }> = {
  merge_account: {
    title: 'Accounts to merge',
    about: 'Marked as a duplicate, and not yet merged by the person or said to be someone else.',
  },
  reconcile_profile: {
    title: 'Profiles to finish merging',
    about: 'Merged, with details that differed between the two accounts still to choose.',
  },
  confirm_location: {
    title: 'Location not confirmed',
    about: 'Has not confirmed their country, local group and city.',
  },
  choose_chapter: {
    title: 'No national chapter',
    about: 'Approved, in the holding pool, and not yet joined a chapter of their choosing.',
  },
}

/** Who still has each kind of required action waiting, for a global admin to follow up. */
export default function AdminRequiredActionsPage() {
  const { user, loading } = useRequireAdmin()
  const { data: kinds } = useQuery({
    ...orpc.admin.requiredActions.outstanding.queryOptions(),
    enabled: !!user?.isAdmin,
  })
  if (loading || !user?.isAdmin) return null

  return (
    <main className="container py-5 pb-15">
      <H1>Outstanding actions</H1>
      <P className="text-text-light">
        What people are asked to settle when they sign in, and who has yet to.
      </P>
      {kinds?.map(({ kind, people }) => (
        <section key={kind} className={SECTION_CARD} aria-labelledby={`outstanding-${kind}`}>
          <H2 id={`outstanding-${kind}`}>
            {SECTIONS[kind].title} ({people.length})
          </H2>
          <P className="text-text-light text-sm">{SECTIONS[kind].about}</P>
          {people.length === 0 ? (
            <P className="text-text-light">Nobody.</P>
          ) : (
            <ul className="list-none p-0 m-0 grid gap-1">
              {people.map(({ volunteer, detail }) => (
                <li key={`${volunteer.id}:${detail}`}>
                  <Link
                    className="text-primary-text underline"
                    href={`/admin/volunteers/${volunteer.id}`}
                  >
                    {volunteer.name}
                  </Link>
                  <span className="text-text-light text-sm">
                    {[volunteer.email, detail]
                      .filter(Boolean)
                      .map((part) => ` · ${part}`)
                      .join('')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </main>
  )
}
