'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '@/components/Button'
import ChapterFilter, { chapterSelection } from '@/components/ChapterFilter'
import { useRequireStaff } from '@/lib/hooks/auth'
import { useUrlParam } from '@/lib/hooks/url-filters'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'
import { formatDate } from '@/lib/format-date'
import { countryLabel } from '@/lib/filter-options'
import { SECTION_CARD } from '@/lib/ui-classes'
import { H1 } from '@/components/Heading'
import { P } from '@/components/Text'

/** Members asking to move into the viewer's chapter, or for a global admin, any chapter. */
function AdminTransfersPageContent() {
  const { user, loading } = useRequireStaff()
  const showToast = useToast()
  const queryClient = useQueryClient()
  const [chapterParam, setChapterParam] = useUrlParam('chapter')

  const { data: requests = [], isLoading } = useQuery({
    ...orpc.chapterTransfers.list.queryOptions({
      input: { chapter: chapterSelection(chapterParam) },
    }),
    enabled: !!user,
  })
  const decide = useMutation({
    ...orpc.chapterTransfers.decide.mutationOptions(),
    onSuccess: (r) => {
      showToast(r.message, 'success')
      void queryClient.invalidateQueries({ queryKey: orpc.chapterTransfers.list.key() })
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Something went wrong', 'error'),
  })

  if (loading || !user) return null

  return (
    <main className="container py-5 pb-15">
      <H1>Chapter moves</H1>
      <P className="text-text-light">
        Members moving country ask to join the chapter they are moving to. Moving takes them out of
        their old chapter&apos;s local group and staff, but not off the projects and teams they are
        on.
      </P>
      {user.isAdmin && (
        <div className="mb-5">
          <ChapterFilter value={chapterParam} onChange={setChapterParam} />
        </div>
      )}
      {isLoading ? (
        <P className="text-text-light">Loading…</P>
      ) : requests.length === 0 ? (
        <P className="text-text-light">Nobody is waiting to move.</P>
      ) : (
        <ul className="list-none p-0 m-0 grid gap-3">
          {requests.map((r) => (
            <li key={r.id} className={`card ${SECTION_CARD} overflow-hidden wrap-break-word`}>
              <P className="m-0">
                <Link
                  className="text-primary-text underline"
                  href={`/volunteers/${r.volunteer.id}`}
                >
                  {r.volunteer.name}
                </Link>{' '}
                is moving from {r.fromChapterName ?? 'the holding pool'} to{' '}
                {countryLabel(r.toCountry)}
                {r.toChapterName ? '' : ' (no chapter yet)'}
              </P>
              <P className="text-text-light text-sm m-0">Asked {formatDate(r.createdAt)}</P>
              {r.reason && <P className="mt-2 mb-0">{r.reason}</P>}
              <div className="flex gap-3 mt-3">
                <Button
                  size="sm"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ id: r.id, approve: true })}
                >
                  Approve move for {r.volunteer.name}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ id: r.id, approve: false })}
                >
                  Decline
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

// The chapter filter lives in the URL, which needs a Suspense boundary to read.
export default function AdminTransfersPage() {
  return (
    <Suspense>
      <AdminTransfersPageContent />
    </Suspense>
  )
}
