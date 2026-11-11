'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { anyOfSkills } from '@/lib/calls'
import { orpc } from '@/lib/orpc'
import { BLEED } from '@/lib/ui-classes'
import { Badge } from '@/components/Badge'
import Button from '@/components/Button'
import { type Call, CallAnswer, CallMeta, DismissCallButton } from '@/components/CallAnswer'
import Count from '@/components/Count'
import Linkify from '@/components/Linkify'
import Modal from '@/components/ui/Modal'
import { H2 } from '@/components/Heading'
import { P } from '@/components/Text'

/** How many calls the home page lists before pointing to /calls for the rest. */
const SHOWN = 3

function CallRow({ call, onAnswer }: { call: Call; onAnswer: () => void }) {
  return (
    <li className="p-4 border-b border-brand-border last:border-0 wrap-break-word">
      <strong className="font-semibold">{call.title}</strong>
      <P className="text-sm text-text-light m-0 mt-1">
        <CallMeta call={call} />
      </P>
      {!call.matchesSkills && (
        <Badge className="mt-2">Asks for {anyOfSkills(call.skillNames)}</Badge>
      )}
      <P className="text-sm m-0 mt-2 line-clamp-2">{call.body}</P>
      <div className="flex flex-wrap gap-2 mt-3">
        <Button
          size="sm"
          variant="secondary"
          aria-label={`Answer ${call.title}`}
          onClick={onAnswer}
        >
          Answer
        </Button>
        <DismissCallButton call={call} />
      </div>
    </li>
  )
}

/**
 * The open calls the volunteer has neither answered nor dismissed, those matching their skills
 * first; left out when there are none.
 */
export default function DashboardCalls() {
  const { data: calls } = useQuery(orpc.calls.forMe.queryOptions())
  const [opened, setOpened] = useState<Call | null>(null)

  const waiting = (calls ?? []).filter((c) => c.open && !c.myResponse && !c.dismissed)
  const ordered = [
    ...waiting.filter((c) => c.matchesSkills),
    ...waiting.filter((c) => !c.matchesSkills),
  ]
  // Kept as opened when a refresh drops the call, say on its closing, so a draft is not lost.
  const answering = opened && (calls?.find((c) => c.id === opened.id) ?? opened)
  if (ordered.length === 0 && !answering) return null
  const rest = ordered.length - SHOWN

  return (
    <section id="calls" aria-labelledby="calls-heading" className="mb-8 scroll-mt-20">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <H2 id="calls-heading">
          Calls for volunteers
          <Count n={ordered.length} />
        </H2>
        <Link href="/calls" className="text-sm">
          See all calls{rest > 0 && ` (${rest} more)`} →
        </Link>
      </div>
      {ordered.length > 0 && (
        <ul className={`list-none p-0 my-0 bg-surface shadow ${BLEED}`}>
          {ordered.slice(0, SHOWN).map((call) => (
            <CallRow key={call.id} call={call} onAnswer={() => setOpened(call)} />
          ))}
        </ul>
      )}
      {answering && (
        <Modal
          id="answer-call"
          title={answering.title}
          isOpen
          size="wide"
          onClose={() => setOpened(null)}
        >
          <P className="text-sm text-text-light">
            <CallMeta call={answering} />
          </P>
          <P className="whitespace-pre-line">
            <Linkify text={answering.body} />
          </P>
          <CallAnswer call={answering} onAnswered={() => setOpened(null)} />
        </Modal>
      )}
    </section>
  )
}
