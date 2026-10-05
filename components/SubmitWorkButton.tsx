'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '@/components/Button'
import Modal from '@/components/ui/Modal'
import {
  QUICK_TASK_SUBMITTED_MESSAGE,
  TASK_DONE_MESSAGE,
  TASK_SUBMITTED_MESSAGE,
} from '@/lib/action-messages'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'
import { TaskStatus } from '@/generated/prisma/enums'

export type SubmitTarget =
  | { kind: 'quick'; taskId: number }
  | { kind: 'project'; projectId: number; taskId: number }

/**
 * Hands in the viewer's task with a note, a link, or both. `reviewer` names who looks at it
 * next; null when submitting finishes the task outright.
 */
export default function SubmitWorkButton({
  target,
  reviewer,
  size,
  variant,
}: {
  target: SubmitTarget
  reviewer: string | null
  size?: 'sm' | 'md' | 'lg'
  variant?: 'primary' | 'secondary'
}) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  const [note, setNote] = useState('')
  const [url, setUrl] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const showToast = useToast()
  const queryClient = useQueryClient()
  const id = `submit-work-${target.taskId}`

  function done(message: string) {
    showToast(message, 'success')
    close()
    for (const key of [
      orpc.quickTasks.get.key(),
      orpc.my.quickTasks.key(),
      orpc.projects.getTask.key(),
      orpc.projects.getById.key(),
      orpc.dashboard.get.key(),
    ]) {
      void queryClient.invalidateQueries({ queryKey: key })
    }
  }
  const failed = (err: unknown) =>
    showToast(err instanceof Error ? err.message : 'Failed to submit work', 'error')

  const submitQuick = useMutation({
    ...orpc.quickTasks.submit.mutationOptions(),
    onSuccess: () => done(QUICK_TASK_SUBMITTED_MESSAGE),
    onError: failed,
  })
  const submitProject = useMutation({
    ...orpc.projects.submitTask.mutationOptions(),
    onSuccess: (data) =>
      done(data.status === TaskStatus.completed ? TASK_DONE_MESSAGE : TASK_SUBMITTED_MESSAGE),
    onError: failed,
  })
  const busy = submitQuick.isPending || submitProject.isPending

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!note.trim() && !url.trim()) {
      setProblem('Say what you did or add a link to it.')
      return
    }
    if (url.trim() && !/^https?:\/\//i.test(url.trim())) {
      setProblem('A link starts with https:// or http://')
      return
    }
    const work = { note: note.trim() || null, url: url.trim() || null }
    if (target.kind === 'quick') submitQuick.mutate({ id: target.taskId, ...work })
    else submitProject.mutate({ projectId: target.projectId, taskId: target.taskId, ...work })
  }

  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)}>
        Submit work
      </Button>
      <Modal id={id} title="Submit your work" isOpen={open} onClose={close}>
        <p className="text-sm text-text-light mt-0 mb-4">
          {reviewer
            ? `${reviewer} will look at it, then accept it or ask for changes.`
            : 'This marks the task done. The project owner can see what you did.'}
        </p>
        <form onSubmit={handleSubmit} noValidate>
          <div className="mb-5">
            <label htmlFor={`${id}-note`}>What did you do?</label>
            <textarea
              id={`${id}-note`}
              rows={4}
              value={note}
              onChange={(e) => {
                setNote(e.target.value)
                setProblem(null)
              }}
            />
          </div>
          <div className="mb-5">
            <label htmlFor={`${id}-url`}>Link to your work (optional)</label>
            <input
              id={`${id}-url`}
              type="url"
              placeholder="https://"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                setProblem(null)
              }}
            />
          </div>
          {problem && (
            <p role="alert" className="text-sm text-error mt-0 mb-4">
              {problem}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Submitting…' : 'Submit work'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  )
}
