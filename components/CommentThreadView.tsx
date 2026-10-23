'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import CommentComposer from './CommentComposer'
import ConfirmDialog from './ui/ConfirmDialog'
import { formatDateTime } from '@/lib/format-date'
import { decodeMentions, splitMentions, type MentionMember } from '@/lib/mentions'
import { useToast } from '@/lib/toast'
import { P } from '@/components/Text'

export interface CommentItem {
  id: number
  content: string
  authorName: string | null
  createdAt: Date | null
  editedAt?: Date | null
  deleted?: boolean
  canEdit?: boolean
  canDelete?: boolean
  replies?: CommentItem[]
  /** Set only when this reply answers another reply, not the thread's own top-level comment. */
  repliedTo?: { id: number; authorName: string | null; content: string; deleted: boolean } | null
}

/** A recorded change, shown among the comments: no author line, no reply, edit or delete. */
export interface EventLineItem {
  type: 'event'
  id: number
  text: string
  createdAt: Date | null
}

export type FeedItem = (CommentItem & { type?: 'comment' }) | EventLineItem

interface CommentThreadViewProps {
  comments: FeedItem[]
  canPost: boolean
  isPending: boolean
  isSubmitting: boolean
  onSubmit: (content: string, parentId?: number) => Promise<boolean>
  onEdit?: (id: number, content: string) => Promise<boolean>
  onDelete?: (id: number) => Promise<boolean>
  /**
   * Offers Reply on every comment. The reply is posted through `onSubmit` with the id answered,
   * and shows under that comment's top-level thread.
   */
  canReply?: boolean
  mentionable?: MentionMember[]
  emptyText?: string
  placeholder?: string
}

/** Runs a mutation for a view callback: true when it succeeded (its own onError toasts). */
export async function succeeded(run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run()
    return true
  } catch {
    return false
  }
}

function CommentBody({ content }: { content: string }) {
  return (
    <P className="m-0 mb-1 whitespace-pre-wrap">
      {splitMentions(content).map((part, i) =>
        typeof part === 'string' ? (
          part
        ) : (
          <span key={i} className="font-semibold text-primary">
            @{part.name}
          </span>
        ),
      )}
    </P>
  )
}

function EventLine({ event }: { event: EventLineItem }) {
  return (
    <li
      id={`event-${event.id}`}
      className="py-2 border-b border-brand-border last:border-0 text-sm text-text-light"
    >
      {event.text}
      {event.createdAt && ` · ${formatDateTime(event.createdAt)}`}
    </li>
  )
}

const linkButton = 'text-text-light hover:text-text cursor-pointer text-xs'

/** A thread with more replies than this shows its first and last few, hiding the middle. */
const COLLAPSE_ABOVE = 4
const SHOWN_FIRST = 1
const SHOWN_LAST = 2

function subscribeToHash(onChange: () => void) {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

// Comments load after hydration, so the server's empty hash never meets a reply it would hide.
const currentHash = () => (typeof window === 'undefined' ? '' : window.location.hash)

/** Which comment a reply answers, and the thread it lands in. */
interface ReplyTarget {
  threadId: number
  targetId: number
  name: string
}

/**
 * Presentational discussion: a list of comments with one level of replies (long threads
 * collapsed), edit and delete, and a post form; a work item's list also holds its event lines, in the order
 * given. Shared by CommentThread (work items) and
 * BugReportCommentThread. Owns the #comment-{id} anchor/scroll behaviour so any
 * consumer gets permalinks for free.
 */
export default function CommentThreadView({
  comments,
  canPost,
  isPending,
  isSubmitting,
  onSubmit,
  onEdit,
  onDelete,
  canReply = false,
  mentionable,
  emptyText = 'No comments yet.',
  placeholder = 'Add a comment…',
}: CommentThreadViewProps) {
  const showToast = useToast()
  const [replying, setReplying] = useState<ReplyTarget | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set())
  const hash = useSyncExternalStore(subscribeToHash, currentHash, currentHash)

  /** Shows a thread's hidden replies and moves focus to the first of them. */
  function expand(thread: number, firstHidden: number) {
    flushSync(() => setExpanded((prev) => new Set(prev).add(thread)))
    document.getElementById(`comment-${firstHidden}`)?.focus()
  }

  async function copyCommentLink(id: number) {
    const url = `${window.location.origin}${window.location.pathname}#comment-${id}`
    try {
      await navigator.clipboard.writeText(url)
      showToast('Link copied!', 'success')
    } catch {
      showToast('Could not copy the link', 'error')
    }
  }

  const scrolledToHashRef = useRef(false)
  useEffect(() => {
    if (scrolledToHashRef.current || comments.length === 0) return
    const hash = window.location.hash
    if (!hash.startsWith('#comment-')) return
    const el = document.getElementById(hash.slice(1))
    if (!el) return
    scrolledToHashRef.current = true
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('ring-2', 'ring-primary')
    setTimeout(() => el.classList.remove('ring-2', 'ring-primary'), 2000)
  }, [comments])

  async function confirmDelete() {
    setRemoving(true)
    const ok = await (onDelete as (id: number) => Promise<boolean>)(deleting as number)
    setRemoving(false)
    if (ok) setDeleting(null)
  }

  /** `thread` is the top-level comment a reply sits under; null for a top-level comment. */
  function renderComment(c: CommentItem, thread: CommentItem | null) {
    const tabIndex = thread ? -1 : undefined
    if (c.deleted) {
      return (
        <li
          key={c.id}
          id={`comment-${c.id}`}
          tabIndex={tabIndex}
          className="py-3 border-b border-brand-border last:border-0 scroll-mt-20"
        >
          <P className="m-0 italic text-text-light">Comment removed</P>
          {renderReplies(c)}
        </li>
      )
    }
    const saved = editing === c.id ? decodeMentions(c.content) : null
    const author = c.authorName ?? 'Unknown'
    return (
      <li
        key={c.id}
        id={`comment-${c.id}`}
        tabIndex={tabIndex}
        className="py-3 border-b border-brand-border last:border-0 scroll-mt-20 rounded transition-shadow"
      >
        {c.repliedTo && (
          <P className="m-0 mb-1 pl-2 border-l-2 border-brand-border text-xs text-text-light italic">
            Replying to{' '}
            {c.repliedTo.deleted ? 'a removed comment' : (c.repliedTo.authorName ?? 'Unknown')}
            {!c.repliedTo.deleted && `: "${c.repliedTo.content}"`}
          </P>
        )}
        {saved ? (
          <CommentComposer
            label="Edit comment"
            submitLabel="Save"
            busyLabel="Saving…"
            isSubmitting={saving}
            initialText={saved.text}
            initialPicked={saved.picked}
            mentionable={mentionable}
            autoFocus
            onCancel={() => setEditing(null)}
            onSubmit={async (content) => {
              setSaving(true)
              const ok = await (onEdit as (id: number, content: string) => Promise<boolean>)(
                c.id,
                content,
              )
              setSaving(false)
              if (ok) setEditing(null)
              return ok
            }}
          />
        ) : (
          <CommentBody content={c.content} />
        )}
        <span className="text-xs text-text-light inline-flex flex-wrap items-center gap-1.5">
          {author} · {c.createdAt ? formatDateTime(c.createdAt) : ''}
          {c.editedAt && <span>(edited)</span>}
          <button
            type="button"
            onClick={() => void copyCommentLink(c.id)}
            aria-label="Copy link to this comment"
            title="Copy link to this comment"
            className="text-text-light hover:text-text cursor-pointer"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </button>
          {canReply && canPost && (
            <button
              type="button"
              className={linkButton}
              aria-label={`Reply to ${author}`}
              onClick={() =>
                setReplying({ threadId: (thread ?? c).id, targetId: c.id, name: author })
              }
            >
              Reply
            </button>
          )}
          {c.canEdit && onEdit && !saved && (
            <button type="button" className={linkButton} onClick={() => setEditing(c.id)}>
              Edit
            </button>
          )}
          {c.canDelete && onDelete && (
            <button type="button" className={linkButton} onClick={() => setDeleting(c.id)}>
              Delete
            </button>
          )}
        </span>
        {renderReplies(c)}
      </li>
    )
  }

  function renderReplies(c: CommentItem) {
    const replies = c.replies ?? []
    const target = replying?.threadId === c.id ? replying : null
    if (replies.length === 0 && !target) return null
    // A permalink to one of the replies opens the thread.
    const open = expanded.has(c.id) || replies.some((r) => hash === `#comment-${r.id}`)
    const hidden =
      replies.length > COLLAPSE_ABOVE && !open ? replies.length - SHOWN_FIRST - SHOWN_LAST : 0
    const shown = (list: CommentItem[]) => list.map((r) => renderComment(r, c))
    return (
      <div className="mt-2 ml-4 pl-3 border-l-2 border-brand-border">
        {replies.length > 0 && (
          <ul
            className="list-none p-0 m-0"
            aria-label={`Replies to ${c.deleted ? 'a removed comment' : (c.authorName ?? 'Unknown')}`}
          >
            {hidden > 0 ? (
              <>
                {shown(replies.slice(0, SHOWN_FIRST))}
                <li className="py-2 border-b border-brand-border">
                  <button
                    type="button"
                    className={`${linkButton} font-semibold`}
                    onClick={() => expand(c.id, replies[SHOWN_FIRST].id)}
                  >
                    Show {hidden} more replies
                  </button>
                </li>
                {shown(replies.slice(-SHOWN_LAST))}
              </>
            ) : (
              shown(replies)
            )}
          </ul>
        )}
        {target && (
          <div className="pt-2">
            <CommentComposer
              key={target.targetId}
              label={`Write a reply to ${target.name}`}
              submitLabel="Post reply"
              busyLabel="Posting…"
              isSubmitting={isSubmitting}
              mentionable={mentionable}
              rows={2}
              autoFocus
              onCancel={() => setReplying(null)}
              onSubmit={async (content) => {
                const ok = await onSubmit(content, target.targetId)
                if (ok) setReplying(null)
                return ok
              }}
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      {canPost && (
        <CommentComposer
          label="Add a comment"
          submitLabel="Post comment"
          busyLabel="Posting…"
          isSubmitting={isSubmitting}
          mentionable={mentionable}
          placeholder={placeholder}
          onSubmit={(content) => onSubmit(content)}
        />
      )}

      {isPending ? (
        <P className="text-text-light">Loading comments…</P>
      ) : comments.length === 0 ? (
        <P className="text-text-light">{emptyText}</P>
      ) : (
        <ul className="list-none p-0 m-0">
          {comments.map((c) =>
            c.type === 'event' ? (
              <EventLine key={`event-${c.id}`} event={c} />
            ) : (
              renderComment(c, null)
            ),
          )}
        </ul>
      )}

      <ConfirmDialog
        id="delete-comment-dialog"
        isOpen={deleting !== null}
        title="Delete this comment?"
        body="It will show as “Comment removed” to everyone in the discussion."
        confirmLabel="Delete"
        busyLabel="Deleting…"
        danger
        busy={removing}
        onConfirm={() => void confirmDelete()}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}
