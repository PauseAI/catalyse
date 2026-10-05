'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import Skeleton from './Skeleton'
import { friendlyDate } from '@/lib/format-date'
import { orpc } from '@/lib/orpc'

/** My message conversations, newest first; unread ones stand out. */
export default function ConversationList() {
  const { data: threads, isPending } = useQuery(orpc.messages.threads.queryOptions())

  if (isPending) return <Skeleton label="Loading messages…" />
  if (!threads || threads.length === 0) {
    return (
      <p className="text-text-light">
        No messages yet. You can message someone from their profile or a project page.
      </p>
    )
  }
  return (
    <ul className="list-none p-0 m-0 bg-surface rounded-xl shadow">
      {threads.map((t) => (
        <li key={t.id} className="border-b border-brand-border last:border-0">
          <Link
            href={`/inbox/messages/${t.id}`}
            className={`block p-4 no-underline text-brand-text hover:bg-brand-bg ${t.unread > 0 ? 'border-l-4 border-primary pl-3' : ''}`}
          >
            <div className="flex items-start justify-between gap-3">
              <span className={t.unread > 0 ? 'font-bold' : 'font-medium'}>
                {t.with.name}
                {t.unread > 0 && (
                  <span className="bg-primary text-[#111827] text-xs px-2 py-0.5 rounded-full ml-2">
                    <span className="sr-only">unread: </span>
                    {t.unread}
                  </span>
                )}
              </span>
              <span className="text-xs text-text-light whitespace-nowrap">
                {t.last.createdAt ? friendlyDate(t.last.createdAt) : ''}
              </span>
            </div>
            <div className="text-sm">{t.subject}</div>
            <p className="text-sm text-text-light m-0 line-clamp-1">
              {t.last.fromMe ? 'You: ' : ''}
              {t.last.body}
            </p>
            {t.relatedProject && (
              <span className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full bg-accent text-secondary-dark dark:bg-gray-700 dark:text-gray-300">
                {t.relatedProject.title}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  )
}
