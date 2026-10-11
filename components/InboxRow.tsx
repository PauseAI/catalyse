'use client'

import Link from 'next/link'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Button from './Button'
import WorkItemCard from './WorkItemCard'
import { friendlyDate } from '@/lib/format-date'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'
import type { AppRouter } from '@/server/router'
import type { InferRouterOutputs } from '@orpc/server'

export type InboxNotification =
  InferRouterOutputs<AppRouter>['notifications']['list']['notifications'][number]

/** Refetches everything that shows notifications or their counts. */
export function useRefreshInbox() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: orpc.notifications.key() })
    void queryClient.invalidateQueries({ queryKey: orpc.dashboard.get.key() })
  }
}

type ListPage = { notifications: InboxNotification[]; total: number }

/**
 * Marks one notification read or unread. Only that row changes in the lists on screen; a full
 * refetch would also drop the unread look the Inbox keeps on updates it read on arrival.
 */
function useSetRead(id: number) {
  const queryClient = useQueryClient()
  const settle = (readAt: Date | null) => {
    queryClient.setQueriesData<ListPage>({ queryKey: orpc.notifications.list.key() }, (page) =>
      page
        ? {
            ...page,
            notifications: page.notifications.map((n) => (n.id === id ? { ...n, readAt } : n)),
          }
        : page,
    )
    void queryClient.invalidateQueries({ queryKey: orpc.notifications.counts.key() })
    void queryClient.invalidateQueries({ queryKey: orpc.dashboard.get.key() })
  }
  const read = useMutation({
    ...orpc.notifications.markRead.mutationOptions(),
    onSuccess: () => settle(new Date()),
  })
  const unread = useMutation({
    ...orpc.notifications.markUnread.mutationOptions(),
    onSuccess: () => settle(null),
  })
  return {
    read: () => read.mutate({ id }),
    unread: () => unread.mutate({ id }),
  }
}

/**
 * One notification: its text, the task it is about as a card, a link that marks it read,
 * read/unread, and, when the thing it is about is still waiting on the viewer, Accept and
 * Decline in place.
 */
export default function InboxRow({
  n,
  extra,
}: {
  n: InboxNotification
  /** Shown after the date, such as a count of grouped earlier items. */
  extra?: React.ReactNode
}) {
  const refresh = useRefreshInbox()
  const showToast = useToast()
  const handlers = (done: string) => ({
    onSuccess: () => {
      showToast(done, 'success')
      refresh()
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Something went wrong', 'error'),
  })
  const mark = useSetRead(n.id)
  const respond = useMutation({
    ...orpc.projects.respondToInterest.mutationOptions(),
    ...handlers('Answer sent'),
  })
  const review = useMutation({
    ...orpc.teams.reviewJoinRequest.mutationOptions(),
    ...handlers('Answer sent'),
  })
  const invite = useMutation({
    ...orpc.projects.respondToInvite.mutationOptions(),
    ...handlers('Answer sent'),
  })
  const connect = useMutation({
    ...orpc.contacts.respond.mutationOptions(),
    ...handlers('Answer sent'),
  })
  const busy = respond.isPending || review.isPending || invite.isPending || connect.isPending

  function answer(accept: boolean) {
    const action = n.action as NonNullable<InboxNotification['action']>
    if (action.kind === 'interest') {
      respond.mutate({
        projectId: action.projectId,
        interestId: action.interestId,
        status: accept ? 'accepted' : 'declined',
      })
    } else if (action.kind === 'invite') {
      invite.mutate({ projectId: action.projectId, accept })
    } else if (action.kind === 'contact_request') {
      connect.mutate({ id: action.requestId, accept })
    } else {
      review.mutate({ id: action.requestId, action: accept ? 'accept' : 'decline' })
    }
  }

  const unread = !n.readAt
  return (
    <div
      className={`wrap-break-word bg-surface rounded-xl shadow p-4 mb-3 ${unread ? 'border-l-4 border-primary pl-3' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <strong className={unread ? 'text-brand-text' : 'text-text-light font-normal'}>
          {n.title}
        </strong>
        <span className="text-xs text-text-light whitespace-nowrap">
          {n.createdAt ? friendlyDate(n.createdAt) : ''}
        </span>
      </div>
      {n.workItem && (
        // Following the card's link reads the notification, as Open does.
        <div
          className="mt-1"
          onClick={(e) => {
            if (unread && (e.target as HTMLElement).closest('a')) mark.read()
          }}
        >
          <WorkItemCard item={n.workItem} variant="compact" />
        </div>
      )}
      {n.body && <p className="text-sm mt-1 mb-0 line-clamp-3">{n.body}</p>}
      <div className="flex flex-wrap items-center gap-3 mt-2">
        {n.action && (
          <>
            <Button size="sm" onClick={() => answer(true)} disabled={busy}>
              Accept
            </Button>
            <Button size="sm" variant="secondary" onClick={() => answer(false)} disabled={busy}>
              Decline
            </Button>
          </>
        )}
        {n.link && (
          <Link
            href={n.link}
            className="text-sm underline"
            onClick={() => {
              if (unread) mark.read()
            }}
          >
            Open
          </Link>
        )}
        <button
          type="button"
          className="text-sm underline text-text-light cursor-pointer bg-transparent border-0 p-0"
          onClick={unread ? mark.read : mark.unread}
        >
          {unread ? 'Mark as read' : 'Mark as unread'}
        </button>
        {extra}
      </div>
    </div>
  )
}
