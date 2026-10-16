'use client'

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

/** Members asking to move into the viewer's chapter, or for a global admin, any chapter. */
export default function AdminTransfersPage() {
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
      <h1>Chapter moves</h1>
      <p className="text-text-light">
        Members moving country ask to join the chapter they are moving to. Moving takes them out of
        their old chapter&apos;s local group and staff, but not off the projects and teams they are
        on.
      </p>
      {user.isAdmin && (
        <div className="mb-5">
          <ChapterFilter value={chapterParam} onChange={setChapterParam} />
        </div>
      )}
      {isLoading ? (
        <p className="text-text-light">Loading…</p>
      ) : requests.length === 0 ? (
        <p className="text-text-light">Nobody is waiting to move.</p>
      ) : (
        <ul className="list-none p-0 m-0 grid gap-3">
          {requests.map((r) => (
            <li key={r.id} className={`card ${SECTION_CARD} overflow-hidden wrap-break-word`}>
              <p className="m-0">
                <Link href={`/volunteers/${r.volunteer.id}`}>{r.volunteer.name}</Link> is moving
                from {r.fromChapterName ?? 'the holding pool'} to {countryLabel(r.toCountry)}
                {r.toChapterName ? '' : ' (no chapter yet)'}
              </p>
              <p className="text-text-light text-sm m-0">Asked {formatDate(r.createdAt)}</p>
              {r.reason && <p className="mt-2 mb-0">{r.reason}</p>}
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
