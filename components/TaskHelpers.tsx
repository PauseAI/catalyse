'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '@/components/Button'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { PersonInitials } from '@/components/WorkItemHeader'
import { ADD_HELPER, JOIN_AS_HELPER, LEAVE_HELPING, REMOVE_HELPER } from '@/lib/action-labels'
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
 * Who helps the task's lead, and the viewer's way to join, leave or take a helper off. Nothing
 * shows for a task that has no helpers and seeks none.
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
  const [adding, setAdding] = useState('')

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
  const join = useMutation({
    ...orpc.projects.expressInterest.mutationOptions(),
    ...options('Failed to join'),
  })
  const leave = useMutation({
    ...orpc.projects.withdrawInterest.mutationOptions(),
    ...options('Failed to leave'),
  })
  const remove = useMutation({
    ...orpc.projects.respondToInterest.mutationOptions(),
    ...options('Failed to remove the helper', () => setRemoving(null)),
  })
  const add = useMutation({
    ...orpc.projects.addTaskHelper.mutationOptions(),
    ...options('Failed to add the helper', () => setAdding('')),
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
        <ul className="m-0 mb-2 list-none space-y-2 p-0">
          {state.helpers.map((h) => (
            <li key={h.interestId} className="flex items-center gap-2 text-sm">
              <PersonInitials name={h.name} />
              <span>{h.name}</span>
              {state.canRemoveHelpers && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`${REMOVE_HELPER} ${h.name}`}
                  onClick={() => setRemoving(h)}
                >
                  {REMOVE_HELPER}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {state.canJoinAsHelper && (
        <Button
          size="sm"
          variant="secondary"
          disabled={join.isPending}
          onClick={() =>
            join.mutate({ projectId, taskId, interestType: 'want_to_help_task', message: null })
          }
        >
          {JOIN_AS_HELPER}
        </Button>
      )}
      {state.canLeaveAsHelper && (
        <Button
          size="sm"
          variant="secondary"
          disabled={leave.isPending}
          onClick={() => leave.mutate({ projectId, taskId })}
        >
          {LEAVE_HELPING}
        </Button>
      )}
      {state.canAddHelpers && state.eligibleHelpers.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label htmlFor="task-add-helper" className="sr-only">
            Add a member as a helper
          </label>
          <select
            id="task-add-helper"
            className="max-w-56"
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
          >
            <option value="">— Select a member —</option>
            {state.eligibleHelpers.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="secondary"
            disabled={!adding || add.isPending}
            onClick={() => add.mutate({ projectId, taskId, volunteerId: Number(adding) })}
          >
            {ADD_HELPER}
          </Button>
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
