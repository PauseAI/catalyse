'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRequireAuth } from '@/lib/hooks/auth'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'
import { friendlyDate } from '@/lib/format-date'
import Button from '@/components/Button'
import Checkbox from '@/components/Checkbox'
import Linkify from '@/components/Linkify'
import NotFoundCard from '@/components/NotFoundCard'
import PageLoading from '@/components/PageLoading'

export default function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = use(params)
  const id = parseInt(idStr, 10)
  const { user, loading } = useRequireAuth()
  const queryClient = useQueryClient()
  const showToast = useToast()
  const [body, setBody] = useState('')
  const [shareEmail, setShareEmail] = useState(false)

  const {
    data: thread,
    isPending,
    isError,
  } = useQuery({
    ...orpc.messages.thread.queryOptions({ input: { id } }),
    enabled: !!user && !isNaN(id),
    retry: false,
  })

  // Opening the conversation read it on the server; bring the counts and lists up to date.
  useEffect(() => {
    if (!thread) return
    void queryClient.invalidateQueries({ queryKey: orpc.notifications.key() })
    void queryClient.invalidateQueries({ queryKey: orpc.messages.threads.key() })
  }, [thread, queryClient])

  const reply = useMutation({
    ...orpc.messages.reply.mutationOptions(),
    onSuccess: () => {
      setBody('')
      showToast('Reply sent', 'success')
      void queryClient.invalidateQueries({ queryKey: orpc.messages.key() })
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to send reply', 'error'),
  })

  if (loading || !user || (isPending && !isError && !isNaN(id))) return <PageLoading />
  if (!thread) {
    return (
      <main className="container py-5 pb-15">
        <NotFoundCard
          title="Conversation not found"
          message="It may have been removed, or it is between other people."
        >
          <Button href="/inbox?filter=message" variant="outline">
            Back to messages
          </Button>
        </NotFoundCard>
      </main>
    )
  }

  return (
    <main className="container py-5 pb-15 max-w-3xl">
      <Link href="/inbox?filter=message" className="text-sm">
        ← Messages
      </Link>
      <h1 className="mt-2 mb-1">{thread.subject}</h1>
      <p className="text-text-light mt-0 mb-4">
        With <Link href={`/volunteers/${thread.with.id}`}>{thread.with.name}</Link>
        {thread.relatedProject && (
          <>
            {' · '}
            <Link
              href={`/projects/${thread.relatedProject.id}`}
              className="inline-block text-xs px-2 py-0.5 rounded-full bg-accent text-secondary-dark no-underline dark:bg-gray-700 dark:text-gray-300"
            >
              {thread.relatedProject.title}
            </Link>
          </>
        )}
      </p>

      <ol className="list-none p-0 m-0 flex flex-col gap-3 mb-6">
        {thread.messages.map((m) => (
          <li
            key={m.id}
            className={`rounded-xl p-4 max-w-[85%] wrap-break-word ${
              m.fromMe ? 'self-end bg-accent dark:bg-gray-700' : 'self-start bg-surface shadow'
            }`}
          >
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <strong className="text-sm">{m.fromMe ? 'You' : m.fromName}</strong>
              <span className="text-xs text-text-light whitespace-nowrap">
                {m.createdAt ? friendlyDate(m.createdAt) : ''}
              </span>
            </div>
            <p className="m-0 whitespace-pre-wrap">
              <Linkify text={m.body} />
            </p>
          </li>
        ))}
      </ol>

      {thread.canReply ? (
        <form
          className="bg-surface rounded-xl shadow p-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!body.trim()) return
            reply.mutate({ threadId: thread.id, message: body.trim(), shareEmail })
          }}
        >
          <textarea
            aria-label="Write a reply"
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={`Reply to ${thread.with.name}…`}
          />
          <div className="mb-3">
            <Checkbox checked={shareEmail} onChange={(e) => setShareEmail(e.target.checked)}>
              Let {thread.with.name} reply by email (shares my address)
            </Checkbox>
          </div>
          <p className="text-xs text-text-light mt-0 mb-3">
            {thread.with.name} sees this here and gets a copy by email.
            {shareEmail ? ' Your email address is included.' : ' Your email address stays private.'}
          </p>
          <Button type="submit" disabled={!body.trim() || reply.isPending}>
            {reply.isPending ? 'Sending…' : 'Send reply'}
          </Button>
        </form>
      ) : (
        <p className="text-text-light">
          {thread.with.name} has left Catalyse, so you can&apos;t reply.
        </p>
      )}
    </main>
  )
}
