'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '@/components/Button'
import FormLabel from '@/components/FormLabel'
import { H3 } from '@/components/Heading'
import Modal from '@/components/ui/Modal'
import { P } from '@/components/Text'
import Textarea from '@/components/ui/Textarea'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'

const RATINGS = [
  { value: 'excellent', label: 'Excellent', hint: 'Exceeded expectations' },
  { value: 'good', label: 'Good', hint: 'Met expectations' },
  { value: 'needs_improvement', label: 'Needs improvement', hint: 'Not quite there yet' },
] as const

type Rating = (typeof RATINGS)[number]['value']

/**
 * An admin accepts a submitted Quick Task with a rating, which feeds the volunteer's skill
 * endorsements. Render it only while open.
 */
export default function QuickTaskReviewDialog({
  task,
  onClose,
}: {
  task: { id: number; title: string; assignedToName: string | null }
  onClose: () => void
}) {
  const [rating, setRating] = useState<Rating>('good')
  const [notes, setNotes] = useState('')
  const [feedback, setFeedback] = useState('')
  const showToast = useToast()
  const queryClient = useQueryClient()

  const review = useMutation({
    ...orpc.quickTasks.review.mutationOptions(),
    onSuccess: () => {
      showToast('Accepted. The task is done.', 'success')
      onClose()
      void queryClient.invalidateQueries({ queryKey: orpc.quickTasks.list.key() })
      void queryClient.invalidateQueries({ queryKey: orpc.quickTasks.get.key() })
      void queryClient.invalidateQueries({ queryKey: orpc.dashboard.get.key() })
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to review', 'error'),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    review.mutate({
      id: task.id,
      reviewRating: rating,
      comment: feedback || null,
      reviewNotes: notes || null,
    })
  }

  return (
    <Modal id={`review-task-${task.id}`} title="Review task" isOpen onClose={onClose}>
      <H3 className="mb-1">{task.title}</H3>
      {task.assignedToName && (
        <P className="text-text-light mb-4">Submitted by: {task.assignedToName}</P>
      )}
      <form onSubmit={handleSubmit}>
        <fieldset className="mb-5">
          <legend>Rating</legend>
          <div className="flex flex-col gap-2 mt-2">
            {RATINGS.map((r) => (
              <FormLabel key={r.value} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name={`rating-${task.id}`}
                  value={r.value}
                  checked={rating === r.value}
                  onChange={() => setRating(r.value)}
                />
                <span>
                  <strong>{r.label}</strong>: {r.hint}
                </span>
              </FormLabel>
            ))}
          </div>
        </fieldset>
        <div className="mb-5">
          <FormLabel htmlFor={`rv-notes-${task.id}`}>Internal notes (admin only)</FormLabel>
          <Textarea
            id={`rv-notes-${task.id}`}
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Your assessment…"
          />
        </div>
        <div className="mb-5">
          <FormLabel htmlFor={`rv-feedback-${task.id}`}>
            {"Feedback to volunteer (they'll see this)"}
          </FormLabel>
          <Textarea
            id={`rv-feedback-${task.id}`}
            rows={3}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Constructive feedback…"
          />
        </div>
        <div className="flex gap-3 justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={review.isPending}>
            Accept
          </Button>
        </div>
      </form>
    </Modal>
  )
}
