'use client'

import { useMutation } from '@tanstack/react-query'
import Modal from '@/components/ui/Modal'
import Button from '@/components/Button'
import { P } from '@/components/Text'
import { formatDate } from '@/lib/format-date'
import { orpc } from '@/lib/orpc'
import { useRequiredActions } from '@/lib/required-actions-context'
import { useToast } from '@/lib/toast'
import type { RequiredActionDialogProps } from './registry'

export default function MergeAccountDialog({
  action,
  onClose,
}: RequiredActionDialogProps<'merge_account'>) {
  const { other, requestedAt } = action
  const { refresh } = useRequiredActions()
  const showToast = useToast()
  const onError = (err: unknown) =>
    showToast(err instanceof Error ? err.message : 'Something went wrong', 'error')

  const request = useMutation({
    ...orpc.accountMerges.request.mutationOptions(),
    onSuccess: async ({ message }) => {
      showToast(message, 'success')
      await refresh()
    },
    onError,
  })
  const notMe = useMutation({
    ...orpc.accountMerges.notSamePerson.mutationOptions(),
    onSuccess: async ({ message }) => {
      showToast(message, 'success')
      onClose()
      await refresh()
    },
    onError,
  })
  const busy = request.isPending || notMe.isPending

  return (
    <Modal id="merge-account" title="Merge your accounts" isOpen onClose={onClose}>
      <P className="mb-3">We think this account is also yours:</P>
      <div className="rounded-lg border border-brand-border p-3 mb-4">
        <P className="font-semibold">{other.name}</P>
        {other.email && <P className="text-text-light text-sm">{other.email}</P>}
        {other.createdAt && (
          <P className="text-text-light text-sm">Joined {formatDate(other.createdAt)}</P>
        )}
      </div>
      <P className="text-text-light mb-3">
        Merging moves its projects, tasks, teams and messages into one account, and you choose which
        of the two addresses to sign in with.
      </P>
      {requestedAt ? (
        <P className="mb-4" role="status">
          We sent a link to {other.email}. Open it to finish merging.
        </P>
      ) : (
        <P className="text-text-light mb-4">
          To check it is yours, we will email a link to {other.email ?? 'that account'}.
        </P>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => request.mutate({ otherId: other.id })} disabled={busy}>
          {requestedAt ? 'Send the link again' : 'Send the link'}
        </Button>
        <Button
          variant="secondary"
          onClick={() => notMe.mutate({ otherId: other.id })}
          disabled={busy}
        >
          That account isn&#39;t mine
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Ask me later
        </Button>
      </div>
    </Modal>
  )
}
