'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'

export type ReopenTarget = {
  projectId: number
  taskId: number
  title: string
  assigneeName: string | null
}

/** Asks before taking a done task back, then reopens it and refreshes every view of it. */
export default function ReopenTaskDialog({
  target,
  onClose,
}: {
  target: ReopenTarget
  onClose: () => void
}) {
  const showToast = useToast()
  const queryClient = useQueryClient()
  const reopen = useMutation({
    ...orpc.projects.reopenTask.mutationOptions(),
    onSuccess: () => {
      showToast('Reopened. It can be edited again.', 'success')
      onClose()
      for (const key of [
        orpc.projects.getTask.key(),
        orpc.projects.getById.key(),
        orpc.projects.listTasks.key(),
        orpc.workItemComments.list.key(),
      ]) {
        void queryClient.invalidateQueries({ queryKey: key })
      }
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to reopen the task', 'error'),
  })

  return (
    <ConfirmDialog
      id="confirm-reopen-task"
      isOpen
      title={`Reopen '${target.title}'?`}
      body={
        target.assigneeName
          ? `It goes back to In progress for ${target.assigneeName} and can be edited again.`
          : 'It goes back to To do and can be edited again.'
      }
      confirmLabel="Reopen"
      busyLabel="Reopening…"
      busy={reopen.isPending}
      onConfirm={() => reopen.mutate({ projectId: target.projectId, taskId: target.taskId })}
      onClose={onClose}
    />
  )
}
