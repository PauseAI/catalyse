'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { InferRouterOutputs } from '@orpc/server'
import type { AppRouter } from '@/server/router'
import { useAuth } from '@/lib/auth-context'
import { NO_ACCESS_NOTICE_URL } from '@/lib/hooks/auth'
import { canSendCalls } from '@/lib/permissions'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'
import { formatDate } from '@/lib/format-date'
import { SECTION_CARD } from '@/lib/ui-classes'
import Button from '@/components/Button'
import EmptyState from '@/components/EmptyState'
import FormLabel from '@/components/FormLabel'
import PageLoading from '@/components/PageLoading'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import { H1, H2, H3 } from '@/components/Heading'
import { P } from '@/components/Text'

type SentCall = InferRouterOutputs<AppRouter>['calls']['sent'][number]

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong')

function NewCall() {
  const showToast = useToast()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [chapterIds, setChapterIds] = useState<number[]>([])
  const [skillId, setSkillId] = useState('')
  const { data: chapters = [] } = useQuery(orpc.chapters.list.queryOptions())
  const { data: categories = [] } = useQuery(orpc.skills.list.queryOptions())
  const send = useMutation({
    ...orpc.calls.send.mutationOptions(),
    onSuccess: () => {
      showToast('Your call is on its way to volunteers', 'success')
      setTitle('')
      setBody('')
      setChapterIds([])
      setSkillId('')
      void queryClient.invalidateQueries({ queryKey: orpc.calls.sent.key() })
    },
    onError: (err) => showToast(errorText(err), 'error'),
  })
  const toggle = (id: number, on: boolean) =>
    setChapterIds((ids) => (on ? [...ids, id] : ids.filter((x) => x !== id)))

  return (
    <form
      aria-labelledby="new-call-heading"
      className={`${SECTION_CARD} mb-6`}
      onSubmit={(e) => {
        e.preventDefault()
        send.mutate({ title, body, chapterIds, skillId: skillId ? Number(skillId) : null })
      }}
    >
      <H2 id="new-call-heading">Put out a call</H2>
      <FormLabel htmlFor="call-title">Title</FormLabel>
      <Input
        id="call-title"
        value={title}
        maxLength={200}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Photos and video of your next event"
      />
      <FormLabel htmlFor="call-body" className="mt-3">
        What you are asking for
      </FormLabel>
      <Textarea
        id="call-body"
        rows={5}
        value={body}
        maxLength={2000}
        onChange={(e) => setBody(e.target.value)}
      />
      <fieldset className="mt-3">
        <legend className="font-semibold">Chapters</legend>
        <P className="text-text-light text-sm m-0">
          Leave all unticked to ask every chapter and the holding pool.
        </P>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
          {chapters.map((c) => (
            <FormLabel key={c.id} className="flex items-center gap-2 font-normal">
              <input
                type="checkbox"
                checked={chapterIds.includes(c.id)}
                onChange={(e) => toggle(c.id, e.target.checked)}
              />
              {c.name}
            </FormLabel>
          ))}
        </div>
      </fieldset>
      <FormLabel htmlFor="call-skill" className="mt-3">
        Only volunteers with this skill
      </FormLabel>
      <select
        id="call-skill"
        className="block w-full rounded-lg border border-brand-border bg-surface p-2"
        value={skillId}
        onChange={(e) => setSkillId(e.target.value)}
      >
        <option value="">Anyone</option>
        {categories.map((cat) => (
          <optgroup key={cat.id} label={cat.name}>
            {cat.skills.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <P className="text-text-light text-sm mt-3">
        The platform delivers the call to everyone it is addressed to, in their Inbox and by email.
        You see only the volunteers who answer, with what they choose to send; not who else it
        reached.
      </P>
      <Button type="submit" disabled={!title.trim() || !body.trim() || send.isPending}>
        Send call
      </Button>
    </form>
  )
}

function Responses({ callId }: { callId: number }) {
  const { data: responses, isLoading } = useQuery(
    orpc.calls.responses.queryOptions({ input: { callId } }),
  )
  if (isLoading) return <P className="text-text-light">Loading answers…</P>
  if (!responses?.length) return <P className="text-text-light">No answers yet.</P>
  return (
    <ul className="list-none p-0 m-0">
      {responses.map((r) => (
        <li key={r.id} className="border-t border-brand-border py-3">
          <strong>{r.name}</strong>
          {r.chapterName && <span className="text-text-light"> · {r.chapterName}</span>}
          {r.email && (
            <>
              {' · '}
              <a className="text-primary-text underline" href={`mailto:${r.email}`}>
                {r.email}
              </a>
            </>
          )}
          <P className="whitespace-pre-line m-0 mt-1">{r.message}</P>
        </li>
      ))}
    </ul>
  )
}

function SentCallCard({ call, showSender }: { call: SentCall; showSender: boolean }) {
  const showToast = useToast()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const close = useMutation({
    ...orpc.calls.close.mutationOptions(),
    onSuccess: (data) => {
      showToast(data.message, 'success')
      void queryClient.invalidateQueries({ queryKey: orpc.calls.sent.key() })
    },
    onError: (err) => showToast(errorText(err), 'error'),
  })
  const reach = call.chapters.length ? call.chapters.join(', ') : 'Every chapter'

  return (
    <section
      aria-labelledby={`sent-${call.id}-title`}
      className={`${SECTION_CARD} mb-4 overflow-hidden wrap-break-word`}
    >
      <H3 id={`sent-${call.id}-title`}>{call.title}</H3>
      <P className="text-text-light text-sm">
        {formatDate(call.createdAt)} · {reach}
        {call.skillName && ` · ${call.skillName}`}
        {showSender && call.senderName && ` · from ${call.senderName}`}
        {call.closedAt ? ' · closed' : ' · open'}
      </P>
      <P className="whitespace-pre-line">{call.body}</P>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide answers' : `Answers (${call.responseCount})`}
        </Button>
        {!call.closedAt && (
          <Button
            size="sm"
            variant="outline"
            disabled={close.isPending}
            onClick={() => close.mutate({ callId: call.id })}
          >
            Close call
          </Button>
        )}
      </div>
      {open && (
        <div className="mt-3">
          <Responses callId={call.id} />
        </div>
      )}
    </section>
  )
}

/** Where a coordinator, or a global admin, puts out calls and reads the answers. */
export default function CoordinatePage() {
  const router = useRouter()
  const { user, loading } = useAuth()
  const allowed = Boolean(user && canSendCalls(user))
  useEffect(() => {
    if (!loading && !user) router.replace('/login')
    else if (!loading && !allowed) router.replace(NO_ACCESS_NOTICE_URL)
  }, [loading, user, allowed, router])
  const { data: calls, isLoading } = useQuery({
    ...orpc.calls.sent.queryOptions(),
    enabled: allowed,
  })

  if (loading || !user || !allowed || isLoading) return <PageLoading />

  return (
    <main className="container py-5 pb-15">
      <H1>Coordinate</H1>
      <P className="text-text-light">
        Ask volunteers in every chapter for help. Those who answer share their name, email and
        message with you; everyone else stays private.
      </P>
      <NewCall />
      <H2>{user.access.globalAdmin ? 'All calls' : 'Your calls'}</H2>
      {!calls?.length ? (
        <EmptyState title="No calls yet" />
      ) : (
        calls.map((c) => <SentCallCard key={c.id} call={c} showSender={user.access.globalAdmin} />)
      )}
    </main>
  )
}
