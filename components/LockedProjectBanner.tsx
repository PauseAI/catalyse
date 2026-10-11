'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '@/components/Button'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { ProjectStatus } from '@/generated/prisma/enums'
import { formatDate } from '@/lib/format-date'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'

/** Takes a completed or archived project back to In progress, after asking. Owner or admin. */
export function ReopenProjectButton({ projectId, title }: { projectId: number; title: string }) {
  const [asking, setAsking] = useState(false)
  const showToast = useToast()
  const queryClient = useQueryClient()
  const reopen = useMutation({
    ...orpc.projects.update.mutationOptions(),
    onSuccess: () => {
      showToast('Reopened. The project can be changed again.', 'success')
      setAsking(false)
      for (const key of [
        orpc.projects.getById.key(),
        orpc.projects.getTask.key(),
        orpc.projects.listTasks.key(),
        orpc.workItemComments.list.key(),
      ]) {
        void queryClient.invalidateQueries({ queryKey: key })
      }
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to reopen the project', 'error'),
  })

  return (
    <>
      <Button size="sm" onClick={() => setAsking(true)}>
        Reopen project
      </Button>
      <ConfirmDialog
        id="confirm-reopen-project"
        isOpen={asking}
        title={`Reopen '${title}'?`}
        body="It goes back to In progress, and everyone on it can change it again."
        confirmLabel="Reopen"
        busyLabel="Reopening…"
        busy={reopen.isPending}
        onConfirm={() => reopen.mutate({ id: projectId, status: ProjectStatus.in_progress })}
        onClose={() => setAsking(false)}
      />
    </>
  )
}

/** Says a locked project is read-only, with Reopen when `reopen` is given. */
export default function LockedProjectBanner({
  status,
  completedAt,
  reopen,
}: {
  status: string
  completedAt: Date | string | null
  reopen?: { projectId: number; title: string }
}) {
  const finished =
    status === ProjectStatus.archived
      ? 'Archived'
      : completedAt
        ? `Completed on ${formatDate(completedAt)}`
        : 'Completed'
  return (
    <div
      role="status"
      className="bg-surface rounded-xl shadow p-4 mb-4 border-l-4 border-brand-border flex flex-wrap items-center gap-3"
    >
      <span className="flex-1">{finished}. Read-only.</span>
      {reopen && <ReopenProjectButton projectId={reopen.projectId} title={reopen.title} />}
    </div>
  )
}
