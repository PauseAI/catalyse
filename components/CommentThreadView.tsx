'use client'

import { useEffect, useRef, useState } from 'react'
import CommentComposer from './CommentComposer'
import ConfirmDialog from './ui/ConfirmDialog'
import { formatDateTime } from '@/lib/format-date'
import { decodeMentions, splitMentions, type MentionMember } from '@/lib/mentions'
import { useToast } from '@/lib/toast'

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
}

interface CommentThreadViewProps {
  comments: CommentItem[]
  canPost: boolean
  isPending: boolean
  isSubmitting: boolean
  onSubmit: (content: string, parentId?: number) => Promise<boolean>
  onEdit?: (id: number, content: string) => Promise<boolean>
  onDelete?: (id: number) => Promise<boolean>
  /** Offers Reply on top-level comments; the reply is posted through `onSubmit`. */
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
    <p className="m-0 mb-1 whitespace-pre-wrap">
      {splitMentions(content).map((part, i) =>
        typeof part === 'string' ? (
          part
        ) : (
          <span key={i} className="font-semibold text-primary">
            @{part.name}
          </span>
        ),
      )}
    </p>
  )
}

const linkButton = 'text-text-light hover:text-text cursor-pointer text-xs'

/**
 * Presentational discussion: a list of comments with one level of replies, edit and
 * delete, and a post form. Shared by CommentThread (work items) and
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
  const [replyingTo, setReplyingTo] = useState<number | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)

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

  function renderComment(c: CommentItem, isReply: boolean) {
    if (c.deleted) {
      return (
        <li
          key={c.id}
          id={`comment-${c.id}`}
          className="py-3 border-b border-brand-border last:border-0 scroll-mt-20"
        >
          <p className="m-0 italic text-text-light">Comment removed</p>
          {renderReplies(c)}
        </li>
      )
    }
    const saved = editing === c.id ? decodeMentions(c.content) : null
    return (
      <li
        key={c.id}
        id={`comment-${c.id}`}
        className="py-3 border-b border-brand-border last:border-0 scroll-mt-20 rounded transition-shadow"
      >
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
          {c.authorName ?? 'Unknown'} · {c.createdAt ? formatDateTime(c.createdAt) : ''}
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
          {canReply && canPost && !isReply && (
            <button type="button" className={linkButton} onClick={() => setReplyingTo(c.id)}>
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
    if (replies.length === 0 && replyingTo !== c.id) return null
    return (
      <div className="mt-2 ml-4 pl-3 border-l-2 border-brand-border">
        {replies.length > 0 && (
          <ul className="list-none p-0 m-0">{replies.map((r) => renderComment(r, true))}</ul>
        )}
        {replyingTo === c.id && (
          <div className="pt-2">
            <CommentComposer
              label="Write a reply"
              submitLabel="Reply"
              busyLabel="Posting…"
              isSubmitting={isSubmitting}
              mentionable={mentionable}
              rows={2}
              autoFocus
              onCancel={() => setReplyingTo(null)}
              onSubmit={async (content) => {
                const ok = await onSubmit(content, c.id)
                if (ok) setReplyingTo(null)
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
          submitLabel="Post Comment"
          busyLabel="Posting…"
          isSubmitting={isSubmitting}
          mentionable={mentionable}
          placeholder={placeholder}
          onSubmit={(content) => onSubmit(content)}
        />
      )}

      {isPending ? (
        <p className="text-text-light">Loading comments…</p>
      ) : comments.length === 0 ? (
        <p className="text-text-light">{emptyText}</p>
      ) : (
        <ul className="list-none p-0 m-0">{comments.map((c) => renderComment(c, false))}</ul>
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
