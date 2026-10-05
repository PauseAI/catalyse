'use client'

import { useEffect, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRequireAuth } from '@/lib/hooks/auth'
import { orpc } from '@/lib/orpc'
import Button from '@/components/Button'
import InboxList from '@/components/InboxList'
import ConversationList from '@/components/ConversationList'
import { useRefreshInbox, type InboxNotification } from '@/components/InboxRow'
import PageLoading from '@/components/PageLoading'
import Skeleton from '@/components/Skeleton'
import {
  CATEGORY_LABELS,
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
} from '@/lib/notification-categories'

const PAGE_SIZE = 20
type Filter = NotificationCategory | 'all'

const EMPTY: Record<Exclude<Filter, 'message'>, string> = {
  needs_action: 'Nothing is waiting on you.',
  update: 'No updates.',
  all: 'Your inbox is empty.',
}

export default function InboxPage() {
  const { user, loading } = useRequireAuth()
  const queryClient = useQueryClient()
  const refresh = useRefreshInbox()
  const [chosen, setChosen] = useState<Filter | null>(null)
  const [page, setPage] = useState(1)

  const { data: counts } = useQuery({
    ...orpc.notifications.counts.queryOptions(),
    enabled: !!user,
  })
  // Opens on what needs action while anything does, and stays put as items are dealt with.
  // A link can ask for a filter (`?filter=message`, from a conversation's back link).
  useEffect(() => {
    if (chosen !== null || !counts) return
    const asked = new URLSearchParams(window.location.search).get('filter')
    const valid = [...NOTIFICATION_CATEGORIES, 'all'].find((f) => f === asked) as Filter | undefined
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChosen(valid ?? (counts.needs_action > 0 ? 'needs_action' : 'all'))
  }, [chosen, counts])
  const filter: Filter = chosen ?? 'all'

  const { data, isPending, isPlaceholderData } = useQuery({
    ...orpc.notifications.list.queryOptions({
      input: {
        category: filter === 'all' ? undefined : filter,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      },
    }),
    // Messages are shown as conversations instead.
    enabled: !!user && chosen !== null && chosen !== 'message',
    placeholderData: keepPreviousData,
  })
  const notifications = data?.notifications ?? []
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE))

  const readAll = useMutation({
    ...orpc.notifications.readAll.mutationOptions(),
    onSuccess: refresh,
  })

  // Updates are informational: seeing them is reading them. They stay bold for this visit;
  // only the counts refresh. Wait for this filter's own list, so the write cannot race the
  // read that is still fetching it.
  const { mutate: readUpdates } = useMutation({
    ...orpc.notifications.readAll.mutationOptions(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orpc.notifications.counts.key() })
    },
  })
  const showsUpdates = filter === 'all' || filter === 'update'
  const unreadUpdates = counts?.update ?? 0
  useEffect(() => {
    if (!data || isPlaceholderData || !showsUpdates || unreadUpdates === 0) return
    readUpdates({ category: 'update' })
  }, [data, isPlaceholderData, showsUpdates, unreadUpdates, readUpdates])

  if (loading || !user) return <PageLoading />

  function choose(next: Filter) {
    setChosen(next)
    setPage(1)
  }

  const unreadInView =
    filter === 'all'
      ? (counts?.needs_action ?? 0) + (counts?.update ?? 0) + (counts?.message ?? 0)
      : (counts?.[filter] ?? 0)

  const sections: { key: NotificationCategory | 'all'; items: InboxNotification[] }[] =
    filter === 'all'
      ? NOTIFICATION_CATEGORIES.map((c) => ({
          key: c,
          items: notifications.filter((n) => n.category === c),
        })).filter((s) => s.items.length > 0)
      : [{ key: filter, items: notifications }]

  return (
    <main className="container py-5 pb-15 max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="m-0">Inbox</h1>
        {unreadInView > 0 && filter !== 'message' && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => readAll.mutate(filter === 'all' ? {} : { category: filter })}
          >
            Mark all read
          </Button>
        )}
      </div>

      <div role="group" aria-label="Show" className="flex flex-wrap gap-2 mb-6">
        {[...NOTIFICATION_CATEGORIES, 'all' as const].map((f) => {
          const n = f === 'all' ? 0 : (counts?.[f] ?? 0)
          return (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? 'primary' : 'outline'}
              aria-pressed={filter === f}
              onClick={() => choose(f)}
            >
              {f === 'all' ? 'All' : CATEGORY_LABELS[f]}
              {n > 0 && <span className="ml-1">{n}</span>}
            </Button>
          )
        })}
      </div>

      {filter === 'message' ? (
        <ConversationList />
      ) : isPending ? (
        <Skeleton label="Loading your inbox…" />
      ) : notifications.length === 0 ? (
        <p className="text-text-light">{EMPTY[filter]}</p>
      ) : (
        sections.map((s) => (
          <section key={s.key} aria-label={s.key === 'all' ? undefined : CATEGORY_LABELS[s.key]}>
            {filter === 'all' && s.key !== 'all' && (
              <h2 className="text-sm uppercase tracking-wide text-text-light mt-6 mb-2">
                {CATEGORY_LABELS[s.key]}
              </h2>
            )}
            <InboxList items={s.items} />
          </section>
        ))
      )}

      {totalPages > 1 && filter !== 'message' && (
        <div className="flex items-center justify-center gap-4 mt-6">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <span className="text-sm text-text-light">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </main>
  )
}
