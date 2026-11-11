'use client'

import { useState } from 'react'
import type { InferRouterOutputs } from '@orpc/server'
import type { AppRouter } from '@/server/router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { anyOfSkills } from '@/lib/calls'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'
import { formatDate } from '@/lib/format-date'
import Button from '@/components/Button'
import FormLabel from '@/components/FormLabel'
import Textarea from '@/components/ui/Textarea'
import { P } from '@/components/Text'

export type Call = InferRouterOutputs<AppRouter>['calls']['forMe'][number]

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong')

/** Refreshes every view of the signed-in volunteer's calls, the home page's included. */
function useRefreshCalls() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: orpc.calls.forMe.key() })
}

/** Who sent a call, when, and the skills it asks for when they match the reader's. */
export function CallMeta({ call }: { call: Call }) {
  return (
    <>
      {call.senderName ?? 'A coordinator'}
      {call.senderRemit && ` · ${call.senderRemit} coordinator`} · {formatDate(call.createdAt)}
      {call.matchesSkills && call.skillNames.length > 0 && ` · for ${anyOfSkills(call.skillNames)}`}
      {!call.open && ' · closed'}
    </>
  )
}

/** Setting a call aside, and bringing it back, with a toast for each. */
export function useDismissCall() {
  const showToast = useToast()
  const refresh = useRefreshCalls()
  const options = {
    onSuccess: (data: { message: string }) => {
      showToast(data.message, 'success')
      void refresh()
    },
    onError: (err: unknown) => {
      showToast(errorText(err), 'error')
      void refresh()
    },
  }
  return {
    dismiss: useMutation({ ...orpc.calls.dismiss.mutationOptions(), ...options }),
    undismiss: useMutation({ ...orpc.calls.undismiss.mutationOptions(), ...options }),
  }
}

export function DismissCallButton({ call }: { call: Call }) {
  const { dismiss } = useDismissCall()
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label={`Dismiss ${call.title}`}
      disabled={dismiss.isPending}
      onClick={() => dismiss.mutate({ callId: call.id })}
    >
      Dismiss
    </Button>
  )
}

/** The form that answers a call, changes the answer or withdraws it. */
export function CallAnswer({ call, onAnswered }: { call: Call; onAnswered?: () => void }) {
  const showToast = useToast()
  const refresh = useRefreshCalls()
  const [message, setMessage] = useState(call.myResponse?.message ?? '')
  const respond = useMutation({
    ...orpc.calls.respond.mutationOptions(),
    onSuccess: (data) => {
      showToast(data.message, 'success')
      void refresh()
      onAnswered?.()
    },
    onError: (err) => {
      showToast(errorText(err), 'error')
      void refresh()
    },
  })
  const withdraw = useMutation({
    ...orpc.calls.withdraw.mutationOptions(),
    onSuccess: (data) => {
      showToast(data.message, 'success')
      setMessage('')
      void refresh()
    },
    onError: (err) => {
      showToast(errorText(err), 'error')
      void refresh()
    },
  })
  const sender = call.senderName ?? 'the coordinator'
  const fieldId = `call-${call.id}-answer`

  return (
    <form
      className="mt-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (message.trim()) respond.mutate({ callId: call.id, message })
      }}
    >
      {call.open && (
        <>
          <FormLabel htmlFor={fieldId}>
            {call.myResponse ? 'Your answer' : 'Answer this call'}
          </FormLabel>
          <Textarea
            id={fieldId}
            rows={3}
            value={message}
            maxLength={2000}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="What you can do, and where"
          />
          <P className="text-text-light text-sm mt-2">
            Answering shares your name, email address and this message with {sender}. Until you
            answer, they cannot see that this call reached you.
          </P>
        </>
      )}
      {!call.open && call.myResponse && (
        <P className="text-sm">
          You answered on {formatDate(call.myResponse.createdAt)}: {call.myResponse.message}
        </P>
      )}
      <div className="flex gap-2 mt-3">
        {call.open && (
          <Button type="submit" size="sm" disabled={!message.trim() || respond.isPending}>
            {call.myResponse ? 'Update answer' : 'Send answer'}
          </Button>
        )}
        {call.myResponse && (
          <Button
            type="button"
            size="sm"
            variant="warning"
            disabled={withdraw.isPending}
            onClick={() => withdraw.mutate({ callId: call.id })}
          >
            Withdraw answer
          </Button>
        )}
      </div>
    </form>
  )
}
