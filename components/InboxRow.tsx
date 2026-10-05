'use client'

import Link from 'next/link'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Button from './Button'
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

/**
 * One notification: its text, a link that marks it read, read/unread, and, when the thing it
 * is about is still waiting on the viewer, Accept and Decline in place.
 */
export default function InboxRow({
  n,
  compact = false,
  extra,
}: {
  n: InboxNotification
  compact?: boolean
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
  const markRead = useMutation({
    ...orpc.notifications.markRead.mutationOptions(),
    onSuccess: refresh,
  })
  const markUnread = useMutation({
    ...orpc.notifications.markUnread.mutationOptions(),
    onSuccess: refresh,
  })
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
      className={`wrap-break-word ${compact ? 'py-3' : 'bg-surface rounded-xl shadow p-4 mb-3'} ${unread ? 'border-l-4 border-primary pl-3' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <strong className={unread ? 'text-brand-text' : 'text-text-light font-normal'}>
          {n.title}
        </strong>
        <span className="text-xs text-text-light whitespace-nowrap">
          {n.createdAt ? friendlyDate(n.createdAt) : ''}
        </span>
      </div>
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
              if (unread) markRead.mutate({ id: n.id })
            }}
          >
            Open
          </Link>
        )}
        {!compact && (
          <button
            type="button"
            className="text-sm underline text-text-light cursor-pointer bg-transparent border-0 p-0"
            onClick={() =>
              unread ? markRead.mutate({ id: n.id }) : markUnread.mutate({ id: n.id })
            }
          >
            {unread ? 'Mark as read' : 'Mark as unread'}
          </button>
        )}
        {extra}
      </div>
    </div>
  )
}
