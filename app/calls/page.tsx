'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useRequireConfirmed } from '@/lib/hooks/auth'
import { anyOfSkills } from '@/lib/calls'
import { orpc } from '@/lib/orpc'
import { SECTION_CARD } from '@/lib/ui-classes'
import { Badge } from '@/components/Badge'
import Button from '@/components/Button'
import { type Call, CallAnswer, CallMeta, useDismissCall } from '@/components/CallAnswer'
import EmptyState from '@/components/EmptyState'
import Linkify from '@/components/Linkify'
import PageLoading from '@/components/PageLoading'
import { H1, H2, H3 } from '@/components/Heading'
import { P } from '@/components/Text'

function CallCard({ call }: { call: Call }) {
  const { dismiss, undismiss } = useDismissCall()
  // An answer is withdrawn rather than dismissed; answering a dismissed call restores it.
  const canSetAside = call.open && !call.myResponse
  return (
    <section
      aria-labelledby={`call-${call.id}-title`}
      className={`${SECTION_CARD} mb-4 overflow-hidden wrap-break-word`}
    >
      <div className="flex items-start justify-between gap-3">
        <H3 id={`call-${call.id}-title`} className="min-w-0">
          {call.title}
        </H3>
        {canSetAside &&
          (call.dismissed ? (
            <Button
              size="sm"
              variant="outline"
              aria-label={`Restore ${call.title}`}
              disabled={undismiss.isPending}
              onClick={() => undismiss.mutate({ callId: call.id })}
            >
              Restore
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Dismiss ${call.title}`}
              disabled={dismiss.isPending}
              onClick={() => dismiss.mutate({ callId: call.id })}
            >
              Dismiss
            </Button>
          ))}
      </div>
      {!call.matchesSkills && (
        <Badge className="mb-2">Asks for {anyOfSkills(call.skillNames)}</Badge>
      )}
      <P className="text-text-light text-sm">
        <CallMeta call={call} />
      </P>
      <P className="whitespace-pre-line">
        <Linkify text={call.body} />
      </P>
      <CallAnswer call={call} />
    </section>
  )
}

/**
 * The calls the signed-in volunteer may see, which they may answer, dismiss or leave: first those
 * that ask for no skill or one they have, then those asking for a skill they have not listed, then
 * those they dismissed, folded away.
 */
export default function CallsPage() {
  const { user, loading } = useRequireConfirmed()
  const [dismissedOpen, setDismissedOpen] = useState(false)
  const { data: calls, isLoading } = useQuery({
    ...orpc.calls.forMe.queryOptions(),
    enabled: !!user,
  })

  if (loading || !user || isLoading) return <PageLoading />
  const shown = calls?.filter((c) => !c.dismissed) ?? []
  const matching = shown.filter((c) => c.matchesSkills)
  const other = shown.filter((c) => !c.matchesSkills)
  const dismissed = calls?.filter((c) => c.dismissed) ?? []

  return (
    <main className="container py-5 pb-15">
      <H1>Calls for volunteers</H1>
      <P className="text-text-light">
        Coordinators ask for help here across every chapter, such as photos and video of your
        events. Answer the ones you can help with.
      </P>
      <section aria-labelledby="matching-calls" className="mt-6">
        <H2 id="matching-calls">Calls that match your skills</H2>
        {matching.length ? (
          matching.map((call) => <CallCard key={call.id} call={call} />)
        ) : (
          <EmptyState
            title="No calls match your skills right now"
            body={
              <>
                When a coordinator asks for help you can give, it shows here. Keep your{' '}
                <Link href="/settings" className="underline">
                  skills
                </Link>{' '}
                up to date so calls find you.
              </>
            }
          />
        )}
      </section>
      {other.length > 0 && (
        <section aria-labelledby="other-calls" className="mt-6">
          <H2 id="other-calls">Other calls</H2>
          <P className="text-text-light">
            These ask for skills that are not on your profile. You can still answer any you can help
            with.
          </P>
          {other.map((call) => (
            <CallCard key={call.id} call={call} />
          ))}
        </section>
      )}
      {dismissed.length > 0 && (
        <section aria-labelledby="dismissed-calls" className="mt-6">
          <H2 id="dismissed-calls">
            <button
              type="button"
              aria-expanded={dismissedOpen}
              aria-controls="dismissed-calls-body"
              onClick={() => setDismissedOpen(!dismissedOpen)}
              className="cursor-pointer bg-transparent border-0 p-0 text-inherit font-inherit"
            >
              <span aria-hidden="true" className="inline-block w-5">
                {dismissedOpen ? '▾' : '▸'}
              </span>
              Dismissed ({dismissed.length})
            </button>
          </H2>
          {dismissedOpen && (
            <div id="dismissed-calls-body">
              {dismissed.map((call) => (
                <CallCard key={call.id} call={call} />
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  )
}
