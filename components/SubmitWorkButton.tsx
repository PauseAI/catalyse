'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '@/components/Button'
import FormLabel from '@/components/FormLabel'
import { H2 } from '@/components/Heading'
import Modal from '@/components/ui/Modal'
import { P } from '@/components/Text'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import { DEFAULT_SUBMISSION_PROMPT, type SubmissionAsk } from '@/components/SubmissionAskFields'
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

const emptyReason = (asksLink: boolean) =>
  asksLink ? 'Say what you did or add a link to it.' : 'Say what you did.'

type Draft = { note: string; url: string }
const EMPTY_DRAFT: Draft = { note: '', url: '' }

/** "The project owner will look at it…", or that submitting finishes the task outright. */
function reviewText(reviewer: string | null): string {
  return reviewer
    ? `${reviewer} will look at it, then accept it or ask for changes.`
    : 'This marks the task done. The project owner can see what you did.'
}

/**
 * The note, and the link when the task asks for one, that hand in the viewer's task, and the
 * button that sends them. Submit stays disabled, saying why, until one of them has something in
 * it.
 */
function SubmitWorkFields({
  target,
  ask,
  idPrefix,
  submitLabel,
  draft,
  onDraft,
  onDone,
  onCancel,
}: {
  target: SubmitTarget
  ask: SubmissionAsk
  idPrefix: string
  submitLabel: string
  /** Held by the caller, so a dialog closed by mistake keeps what was typed. */
  draft: Draft
  onDraft: (draft: Draft) => void
  onDone?: () => void
  onCancel?: () => void
}) {
  const asksLink = ask.submissionAsksLink
  const note = draft.note
  const url = asksLink ? draft.url : ''
  const [problem, setProblem] = useState<string | null>(null)
  const showToast = useToast()
  const queryClient = useQueryClient()
  const empty = !note.trim() && !url.trim()
  const reason = emptyReason(asksLink)

  function done(message: string) {
    showToast(message, 'success')
    onDone?.()
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
    // Enter in the link field submits the form even while the button is disabled.
    if (empty) {
      setProblem(reason)
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
    <form onSubmit={handleSubmit} noValidate>
      <div className="mb-5">
        <FormLabel htmlFor={`${idPrefix}-note`}>
          {ask.submissionPrompt ?? DEFAULT_SUBMISSION_PROMPT}
        </FormLabel>
        <Textarea
          id={`${idPrefix}-note`}
          rows={4}
          value={note}
          onChange={(e) => {
            onDraft({ ...draft, note: e.target.value })
            setProblem(null)
          }}
        />
      </div>
      {asksLink && (
        <div className="mb-5">
          <FormLabel htmlFor={`${idPrefix}-url`}>Link to your work (optional)</FormLabel>
          <Input
            id={`${idPrefix}-url`}
            type="url"
            placeholder="https://"
            value={url}
            onChange={(e) => {
              onDraft({ ...draft, url: e.target.value })
              setProblem(null)
            }}
          />
        </div>
      )}
      {problem && (
        <P role="alert" className="text-sm text-error mt-0 mb-4">
          {problem}
        </P>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {empty && !problem && (
          <P id={`${idPrefix}-why`} className="text-sm text-text-light m-0 mr-auto">
            {reason}
          </P>
        )}
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          disabled={busy || empty}
          aria-describedby={empty && !problem ? `${idPrefix}-why` : undefined}
        >
          {busy ? 'Submitting…' : submitLabel}
        </Button>
      </div>
    </form>
  )
}

/**
 * The submit box laid out on the page, for the assignee of a task they are working on: no
 * button to press before the text box shows.
 */
export function SubmitWorkForm({
  target,
  ask,
  reviewer,
}: {
  target: SubmitTarget
  ask: SubmissionAsk
  reviewer: string | null
}) {
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  return (
    <section
      aria-labelledby={`submit-work-${target.taskId}-title`}
      className="mt-5 pt-5 border-t border-brand-border max-w-xl"
    >
      <H2 id={`submit-work-${target.taskId}-title`} className="text-base mb-1">
        Submit your work
      </H2>
      <P className="text-sm text-text-light mt-0 mb-4">{reviewText(reviewer)}</P>
      <SubmitWorkFields
        target={target}
        ask={ask}
        idPrefix={`submit-work-${target.taskId}`}
        submitLabel={reviewer ? 'Submit for review' : 'Submit and mark done'}
        draft={draft}
        onDraft={setDraft}
      />
    </section>
  )
}

/**
 * Hands in the viewer's task from a dialog, where a list has no room for the box. `reviewer`
 * names who looks at it next; null when submitting finishes the task outright.
 */
export default function SubmitWorkButton({
  target,
  ask,
  reviewer,
  size,
  variant,
}: {
  target: SubmitTarget
  ask: SubmissionAsk
  reviewer: string | null
  size?: 'sm' | 'md' | 'lg'
  variant?: 'primary' | 'secondary'
}) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const id = `submit-work-${target.taskId}`

  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)}>
        Submit work
      </Button>
      <Modal id={id} title="Submit your work" isOpen={open} onClose={close}>
        <P className="text-sm text-text-light mt-0 mb-4">{reviewText(reviewer)}</P>
        <SubmitWorkFields
          target={target}
          ask={ask}
          idPrefix={id}
          submitLabel="Submit work"
          draft={draft}
          onDraft={setDraft}
          onDone={close}
          onCancel={close}
        />
      </Modal>
    </>
  )
}
