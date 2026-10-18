'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import Modal from '@/components/ui/Modal'
import Button from '@/components/Button'
import Radio from '@/components/Radio'
import { P } from '@/components/Text'
import {
  CONSENT_FIELDS,
  MERGE_FIELD_LABELS,
  type MergeField,
  type MergeValue,
} from '@/lib/account-merge-fields'
import { useAuth } from '@/lib/auth-context'
import { orpc } from '@/lib/orpc'
import { useRequiredActions } from '@/lib/required-actions-context'
import { useToast } from '@/lib/toast'
import type { RequiredActionDialogProps } from './registry'

type Choice = 'kept' | 'merged'

const shown = (v: MergeValue) => (typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v))

/** One step per field the merged accounts disagreed on; the last saves every pick. */
export default function ReconcileProfileDialog({
  action,
  onClose,
}: RequiredActionDialogProps<'reconcile_profile'>) {
  const { conflicts, mergeId } = action
  const { refreshUser } = useAuth()
  const { refresh } = useRequiredActions()
  const showToast = useToast()
  const [step, setStep] = useState(0)
  // A consent was withheld by the merge, so the person must pick; anything else starts as it is.
  const [choices, setChoices] = useState<Partial<Record<MergeField, Choice>>>(() =>
    Object.fromEntries(
      conflicts.filter((c) => !CONSENT_FIELDS.includes(c.field)).map((c) => [c.field, 'kept']),
    ),
  )
  const save = useMutation({
    ...orpc.accountMerges.resolveConflicts.mutationOptions(),
    onSuccess: async ({ message }) => {
      showToast(message, 'success')
      onClose()
      await refreshUser()
      await refresh()
    },
    onError: (err) =>
      showToast(err instanceof Error ? err.message : 'Something went wrong', 'error'),
  })

  const conflict = conflicts[step]
  const last = step === conflicts.length - 1
  const name = `merge-${conflict.field}`

  return (
    <Modal id="reconcile-profile" title="Finish merging your profile" isOpen onClose={onClose}>
      <P className="text-text-light text-sm mb-3">
        {conflicts.length > 1 ? `${step + 1} of ${conflicts.length}: ` : ''}
        Your two accounts had different answers here.
      </P>
      <fieldset className="mb-5">
        <legend className="font-semibold mb-3">{MERGE_FIELD_LABELS[conflict.field]}</legend>
        <div className="flex flex-col gap-3">
          {(['kept', 'merged'] as const).map((choice) => (
            <Radio
              key={choice}
              name={name}
              checked={choices[conflict.field] === choice}
              onChange={() => setChoices((c) => ({ ...c, [conflict.field]: choice }))}
            >
              <span className="block whitespace-pre-line">{shown(conflict[choice])}</span>
              <span className="block text-text-light text-sm">
                {choice === 'kept' ? 'From this account' : 'From your other account'}
              </span>
            </Radio>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        {step > 0 && (
          <Button variant="secondary" onClick={() => setStep(step - 1)}>
            Back
          </Button>
        )}
        {last ? (
          <Button
            onClick={() => save.mutate({ mergeId, choices })}
            disabled={!choices[conflict.field] || save.isPending}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        ) : (
          <Button onClick={() => setStep(step + 1)} disabled={!choices[conflict.field]}>
            Next
          </Button>
        )}
        <Button variant="ghost" onClick={onClose}>
          Ask me later
        </Button>
      </div>
    </Modal>
  )
}
