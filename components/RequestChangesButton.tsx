'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '@/components/Button'
import Modal from '@/components/ui/Modal'
import type { SubmitTarget } from '@/components/SubmitWorkButton'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'

/** Sends submitted work back to the assignee as In progress, with the reviewer's message. */
export default function RequestChangesButton({
  target,
  assigneeName,
  size,
}: {
  target: SubmitTarget
  assigneeName: string | null
  size?: 'sm' | 'md' | 'lg'
}) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  const [message, setMessage] = useState('')
  const showToast = useToast()
  const queryClient = useQueryClient()
  const id = `request-changes-${target.taskId}`

  const options = {
    onSuccess: () => {
      showToast(`Sent back to ${assigneeName ?? 'the assignee'} with your message.`, 'success')
      close()
      for (const key of [
        orpc.quickTasks.get.key(),
        orpc.quickTasks.list.key(),
        orpc.projects.getTask.key(),
        orpc.dashboard.get.key(),
      ]) {
        void queryClient.invalidateQueries({ queryKey: key })
      }
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to ask for changes', 'error'),
  }
  const quick = useMutation({ ...orpc.quickTasks.requestChanges.mutationOptions(), ...options })
  const project = useMutation({ ...orpc.projects.requestTaskChanges.mutationOptions(), ...options })
  const busy = quick.isPending || project.isPending

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const text = message.trim()
    if (!text) return
    if (target.kind === 'quick') quick.mutate({ id: target.taskId, message: text })
    else project.mutate({ projectId: target.projectId, taskId: target.taskId, message: text })
  }

  return (
    <>
      <Button variant="secondary" size={size} onClick={() => setOpen(true)}>
        Ask for changes
      </Button>
      <Modal id={id} title="Ask for changes" isOpen={open} onClose={close}>
        <form onSubmit={handleSubmit}>
          <div className="mb-5">
            <label htmlFor={`${id}-message`}>What needs changing?</label>
            <textarea
              id={`${id}-message`}
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              required
            />
            <p className="text-sm text-text-light mt-1 mb-0">
              The task goes back to {assigneeName ?? 'the assignee'} as In progress, with this
              message.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !message.trim()}>
              {busy ? 'Sending…' : 'Send back'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  )
}
