'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import MemberPicker from '@/components/ui/MemberPicker'
import { ADD_HELPER, REMOVE_HELPER } from '@/lib/action-labels'
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
}

/**
 * Who helps the task's lead, and the owner's way to add one or take one off. Nothing shows for
 * a task that has no helpers and seeks none. The viewer's own way to join or stop helping sits
 * with the rest of the page's actions, top right — see TaskDetailPage.
 */
export default function TaskHelpers({
  projectId,
  taskId,
  state,
}: {
  projectId: number
  taskId: number
  state: TaskHelpersState
}) {
  const showToast = useToast()
  const queryClient = useQueryClient()
  const [removing, setRemoving] = useState<TaskHelpersState['helpers'][number] | null>(null)

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
  const add = useMutation({
    ...orpc.projects.addTaskHelper.mutationOptions(),
    ...options('Failed to add the helper'),
  })

  const summary = helperSummary(state.helpers.length, state.helpersWanted)
  if (summary === null) return null

  return (
    <section aria-labelledby="task-helpers" className="my-4">
      <h2 id="task-helpers" className="mb-1 text-base">
        Helpers
      </h2>
      <p className="text-text-light mt-0 mb-2 text-sm">{summary}</p>
      {state.helpers.length > 0 && (
        <ul className="m-0 mb-2 flex list-none flex-wrap gap-2 p-0">
          {state.helpers.map((h) => (
            <li
              key={h.interestId}
              className="flex items-center gap-1 rounded-full bg-accent py-1 pl-3 pr-1 text-sm text-secondary-dark dark:bg-gray-700 dark:text-gray-300"
            >
              <span>{h.name}</span>
              {state.canRemoveHelpers && (
                <button
                  type="button"
                  aria-label={`${REMOVE_HELPER} ${h.name}`}
                  onClick={() => setRemoving(h)}
                  className="flex h-5 w-5 items-center justify-center rounded-full leading-none hover:bg-secondary/20"
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {state.canAddHelpers && state.eligibleHelpers.length > 0 && (
        <div className="mt-2 max-w-56">
          <MemberPicker
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
    </section>
  )
}
