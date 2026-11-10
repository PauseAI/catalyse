'use client'

import { useState } from 'react'
import type { InferRouterOutputs } from '@orpc/server'
import type { AppRouter } from '@/server/router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRequireConfirmed } from '@/lib/hooks/auth'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'
import { formatDate } from '@/lib/format-date'
import { SECTION_CARD } from '@/lib/ui-classes'
import Button from '@/components/Button'
import EmptyState from '@/components/EmptyState'
import FormLabel from '@/components/FormLabel'
import Linkify from '@/components/Linkify'
import PageLoading from '@/components/PageLoading'
import Textarea from '@/components/ui/Textarea'
import { H1, H2 } from '@/components/Heading'
import { P } from '@/components/Text'

type Call = InferRouterOutputs<AppRouter>['calls']['forMe'][number]

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong')

function Answer({ call }: { call: Call }) {
  const showToast = useToast()
  const queryClient = useQueryClient()
  const [message, setMessage] = useState(call.myResponse?.message ?? '')
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.calls.forMe.key() })
  const respond = useMutation({
    ...orpc.calls.respond.mutationOptions(),
    onSuccess: (data) => {
      showToast(data.message, 'success')
      void refresh()
    },
    onError: (err) => showToast(errorText(err), 'error'),
  })
  const withdraw = useMutation({
    ...orpc.calls.withdraw.mutationOptions(),
    onSuccess: (data) => {
      showToast(data.message, 'success')
      setMessage('')
      void refresh()
    },
    onError: (err) => showToast(errorText(err), 'error'),
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

/** The calls put out to the signed-in volunteer, which they may answer or leave. */
export default function CallsPage() {
  const { user, loading } = useRequireConfirmed()
  const { data: calls, isLoading } = useQuery({
    ...orpc.calls.forMe.queryOptions(),
    enabled: !!user,
  })

  if (loading || !user || isLoading) return <PageLoading />

  return (
    <main className="container py-5 pb-15">
      <H1>Calls for volunteers</H1>
      <P className="text-text-light">
        Coordinators ask for help here across every chapter, such as photos and video of your
        events. Answer the ones you can help with.
      </P>
      {!calls?.length ? (
        <EmptyState title="No open calls" body="When a coordinator asks for help, it shows here." />
      ) : (
        calls.map((call) => (
          <section
            key={call.id}
            aria-labelledby={`call-${call.id}-title`}
            className={`${SECTION_CARD} mb-4 overflow-hidden wrap-break-word`}
          >
            <H2 id={`call-${call.id}-title`}>{call.title}</H2>
            <P className="text-text-light text-sm">
              {call.senderName ?? 'A coordinator'}
              {call.senderRemit && ` · ${call.senderRemit} coordinator`} ·{' '}
              {formatDate(call.createdAt)}
              {call.skillName && ` · for ${call.skillName}`}
              {!call.open && ' · closed'}
            </P>
            <P className="whitespace-pre-line">
              <Linkify text={call.body} />
            </P>
            <Answer call={call} />
          </section>
        ))
      )}
    </main>
  )
}
