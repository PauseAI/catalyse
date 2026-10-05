'use client'

import { useId } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Button from './Button'
import Linkify from './Linkify'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'

/** An invite to the viewer to help on this project, with Accept and Decline. */
export default function ProjectInviteBanner({
  projectId,
  invitedByName,
  note,
}: {
  projectId: number
  invitedByName: string | null
  note: string | null
}) {
  const headingId = useId()
  const queryClient = useQueryClient()
  const showToast = useToast()
  const respond = useMutation({
    ...orpc.projects.respondToInvite.mutationOptions(),
    onSuccess: (_data, variables) => {
      showToast(
        variables.accept ? "You're on the project. Welcome!" : 'Invite declined.',
        'success',
      )
      void queryClient.invalidateQueries({ queryKey: orpc.projects.getById.key() })
      void queryClient.invalidateQueries({ queryKey: orpc.notifications.key() })
      void queryClient.invalidateQueries({ queryKey: orpc.dashboard.get.key() })
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to answer the invite', 'error'),
  })

  return (
    <section
      aria-labelledby={headingId}
      className="bg-surface rounded-xl shadow p-6 mb-4 border-l-4 border-primary"
    >
      <h2 id={headingId} className="text-lg m-0 mb-2">
        {invitedByName ?? 'The owner'} invited you to help on this project
      </h2>
      {note && (
        <p className="m-0 mb-3 whitespace-pre-wrap">
          <Linkify text={note} />
        </p>
      )}
      <p className="text-sm text-text-light m-0 mb-3">
        You join once you accept. Declining is fine; you can still apply later.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => respond.mutate({ projectId, accept: true })}
          disabled={respond.isPending}
        >
          Accept
        </Button>
        <Button
          variant="secondary"
          onClick={() => respond.mutate({ projectId, accept: false })}
          disabled={respond.isPending}
        >
          Decline
        </Button>
      </div>
    </section>
  )
}
