'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { H2 } from '@/components/Heading'
import { P } from '@/components/Text'
import LocalVolunteerSelect from '@/components/ui/LocalVolunteerSelect'
import { PersonChip } from '@/components/ui/PersonChip'
import { ADD_HELPER, LEAVE_HELPING, REMOVE_HELPER } from '@/lib/action-labels'
import { helperSummary } from '@/lib/helper-summary'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'

export type TaskHelpersState = {
  helpers: { interestId: number; volunteerId: number; name: string }[]
  helpersWanted: number | null
  canJoinAsHelper: boolean
  canLeaveAsHelper: boolean
  canRemoveHelpers: boolean
  canAddHelpers: boolean
  eligibleHelpers: { id: number; name: string }[]
  /** The task's lead. */
  assignedToId: number | null
  projectOwnerId: number | null
}

/** Who hears that the viewer stopped helping: the lead, else the project's owner. */
function withdrawBody(state: TaskHelpersState, viewerId: number): string {
  if (state.assignedToId !== null) return 'You stop helping on this task, and its lead is told.'
  if (state.projectOwnerId !== null && state.projectOwnerId !== viewerId) {
    return "You stop helping on this task, and the project's owner is told."
  }
  return 'You stop helping on this task.'
}

/**
 * Who helps the task's lead. Each chip's `×` takes that helper off: on the viewer's own chip it
 * withdraws them, on anyone else's it is a manager removing them. Nothing shows for a task that
 * has no helpers and seeks none.
 */
export default function TaskHelpers({
  projectId,
  taskId,
  viewerId,
  state,
}: {
  projectId: number
  taskId: number
  viewerId: number
  state: TaskHelpersState
}) {
  const showToast = useToast()
  const queryClient = useQueryClient()
  const [removing, setRemoving] = useState<TaskHelpersState['helpers'][number] | null>(null)
  const [withdrawing, setWithdrawing] = useState(false)

  const refresh = () => {
    for (const key of [
      orpc.projects.getTask.key(),
      orpc.projects.getById.key(),
      orpc.workItemComments.list.key(),
    ]) {
      void queryClient.invalidateQueries({ queryKey: key })
    }
  }
  const options = (fallback: string, done?: () => void) => ({
    onSuccess: (data: { message: string }) => {
      showToast(data.message, 'success')
      done?.()
      refresh()
    },
    onError: (err: unknown) => showToast(err instanceof Error ? err.message : fallback, 'error'),
  })
  const remove = useMutation({
    ...orpc.projects.respondToInterest.mutationOptions(),
    ...options('Failed to remove the helper', () => setRemoving(null)),
  })
  const withdraw = useMutation({
    ...orpc.projects.withdrawInterest.mutationOptions(),
    ...options('Failed to withdraw', () => setWithdrawing(false)),
  })
  const add = useMutation({
    ...orpc.projects.addTaskHelper.mutationOptions(),
    ...options('Failed to add the helper'),
  })

  const summary = helperSummary(state.helpers.length, state.helpersWanted)
  if (summary === null) return null

  return (
    <section aria-labelledby="task-helpers" className="my-4">
      <H2 id="task-helpers" className="mb-1 text-base">
        Helpers
      </H2>
      <P className="text-text-light mt-0 mb-2 text-sm">{summary}</P>
      {state.helpers.length > 0 && (
        <ul className="m-0 mb-2 flex list-none flex-wrap gap-2 p-0">
          {state.helpers.map((h) => (
            <li key={h.interestId} className="min-w-0 max-w-full">
              {h.volunteerId === viewerId ? (
                <PersonChip
                  name={h.name}
                  isViewer
                  onRemove={state.canLeaveAsHelper ? () => setWithdrawing(true) : undefined}
                  removeLabel={`${LEAVE_HELPING} from helping`}
                />
              ) : (
                <PersonChip
                  name={h.name}
                  onRemove={state.canRemoveHelpers ? () => setRemoving(h) : undefined}
                  removeLabel={`${REMOVE_HELPER} ${h.name}`}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {state.canAddHelpers && state.eligibleHelpers.length > 0 && (
        <div className="mt-2 max-w-56">
          <LocalVolunteerSelect
            id="task-add-helper"
            label="Add a member as a helper"
            ariaLabel="Add a member as a helper"
            candidates={state.eligibleHelpers}
            onAdd={(volunteerId) => add.mutate({ projectId, taskId, volunteerId })}
            placeholder={ADD_HELPER}
            hideLabel
          />
        </div>
      )}
      {removing && (
        <ConfirmDialog
          id="confirm-remove-helper"
          isOpen
          title={`Remove ${removing.name}?`}
          body="They stop helping on this task and are told so."
          confirmLabel={REMOVE_HELPER}
          busyLabel="Removing…"
          danger
          busy={remove.isPending}
          onConfirm={() =>
            remove.mutate({
              projectId,
              taskId,
              interestId: removing.interestId,
              status: 'declined',
            })
          }
          onClose={() => setRemoving(null)}
        />
      )}
      {withdrawing && (
        <ConfirmDialog
          id="confirm-withdraw-helper"
          isOpen
          title="Withdraw from this task?"
          body={withdrawBody(state, viewerId)}
          confirmLabel={LEAVE_HELPING}
          busyLabel="Withdrawing…"
          danger
          busy={withdraw.isPending}
          onConfirm={() => withdraw.mutate({ projectId, taskId })}
          onClose={() => setWithdrawing(false)}
        />
      )}
    </section>
  )
}
