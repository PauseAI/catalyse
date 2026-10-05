'use client'

import { useId } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Button from './Button'
import { formatDateTime } from '@/lib/format-date'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'

export interface ReviewRequest {
  id: number
  message: string
  requestedByName: string | null
  createdAt: Date
  resolvedAt: Date | null
}

interface ChangesRequestedBannerProps {
  projectId: number
  /** Newest first, as `projects.getById` returns them. */
  requests: ReviewRequest[]
  /** Whether the viewer proposed or runs the project, and so may resubmit it. */
  canResubmit: boolean
  /** Shown beside Resubmit when the viewer edits on another page. */
  editHref?: string
}

/**
 * The open change request on a proposal, with Resubmit for the proposer and the earlier
 * rounds folded away. Renders nothing when no request is open.
 */
export default function ChangesRequestedBanner({
  projectId,
  requests,
  canResubmit,
  editHref,
}: ChangesRequestedBannerProps) {
  const headingId = useId()
  const queryClient = useQueryClient()
  const showToast = useToast()
  const resubmit = useMutation({
    ...orpc.projects.resubmit.mutationOptions(),
    onSuccess: () => {
      showToast('Project resubmitted for review.', 'success')
      void queryClient.invalidateQueries({ queryKey: orpc.projects.getById.key() })
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to resubmit', 'error'),
  })

  const [open, ...earlier] = requests
  if (!open || open.resolvedAt) return null

  return (
    <section
      aria-labelledby={headingId}
      className="bg-surface rounded-xl shadow p-6 mb-4 border-l-4 border-warning"
    >
      <h2 id={headingId} className="text-lg m-0 mb-2">
        Changes requested{open.requestedByName ? ` by ${open.requestedByName}` : ''}
      </h2>
      <p className="m-0 mb-1 whitespace-pre-wrap">{open.message}</p>
      <p className="text-xs text-text-light m-0 mb-4">{formatDateTime(open.createdAt)}</p>
      {canResubmit && (
        <>
          <p className="text-sm text-text-light m-0 mb-3">
            Make the changes, then resubmit. The team lead who asked is told straight away.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => resubmit.mutate({ id: projectId })}
              disabled={resubmit.isPending}
            >
              {resubmit.isPending ? 'Resubmitting…' : 'Resubmit for review'}
            </Button>
            {editHref && (
              <Button href={editHref} variant="secondary">
                Edit project
              </Button>
            )}
          </div>
        </>
      )}
      {earlier.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-text-light">
            Earlier requests ({earlier.length})
          </summary>
          <ul className="list-none p-0 m-0 mt-2">
            {earlier.map((r) => (
              <li key={r.id} className="py-2 border-b border-brand-border last:border-0 text-sm">
                <p className="m-0 whitespace-pre-wrap">{r.message}</p>
                <span className="text-xs text-text-light">
                  {r.requestedByName ?? 'A team lead'} · {formatDateTime(r.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
