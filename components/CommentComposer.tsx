'use client'

import { useId, useLayoutEffect, useRef, useState } from 'react'
import Button from './Button'
import { encodeMentions, tokenName, type MentionMember } from '@/lib/mentions'

interface CommentComposerProps {
  label: string
  submitLabel: string
  busyLabel: string
  isSubmitting: boolean
  onSubmit: (content: string) => Promise<boolean>
  onCancel?: () => void
  mentionable?: MentionMember[]
  placeholder?: string
  initialText?: string
  initialPicked?: MentionMember[]
  rows?: number
  autoFocus?: boolean
}

const MAX_SUGGESTIONS = 5

/** The `@query` being typed immediately before the caret, if any. */
function activeQuery(text: string, caret: number): { start: number; query: string } | null {
  const match = /(^|\s)@([^\s@]*)$/.exec(text.slice(0, caret))
  if (!match) return null
  return { start: caret - match[2].length - 1, query: match[2] }
}

/**
 * Textarea that suggests project members after `@` and submits their mentions as tokens
 * (`lib/mentions.ts`). Clears itself when `onSubmit` resolves true.
 */
export default function CommentComposer({
  label,
  submitLabel,
  busyLabel,
  isSubmitting,
  onSubmit,
  onCancel,
  mentionable = [],
  placeholder,
  initialText = '',
  initialPicked = [],
  rows = 3,
  autoFocus,
}: CommentComposerProps) {
  const [text, setText] = useState(initialText)
  const [picked, setPicked] = useState<MentionMember[]>(initialPicked)
  const [query, setQuery] = useState<{ start: number; query: string } | null>(null)
  const [highlight, setHighlight] = useState(0)
  const boxRef = useRef<HTMLTextAreaElement>(null)
  const caretRef = useRef<number | null>(null)
  const listId = useId()

  const q = query?.query.toLowerCase()
  const suggestions =
    q === undefined
      ? []
      : mentionable.filter((m) => m.name.toLowerCase().includes(q)).slice(0, MAX_SUGGESTIONS)
  const open = suggestions.length > 0

  function track(value: string, caret: number) {
    setText(value)
    setQuery(activeQuery(value, caret))
    setHighlight(0)
  }

  function choose(member: MentionMember) {
    const at = query as { start: number; query: string }
    const insert = `@${tokenName(member.name)} `
    const next = text.slice(0, at.start) + insert + text.slice(at.start + 1 + at.query.length)
    setText(next)
    setPicked((p) => (p.some((m) => m.id === member.id) ? p : [...p, member]))
    setQuery(null)
    caretRef.current = at.start + insert.length
  }

  // After a pick re-renders the text, put the caret just past the inserted name.
  useLayoutEffect(() => {
    if (caretRef.current === null) return
    boxRef.current?.setSelectionRange(caretRef.current, caretRef.current)
    caretRef.current = null
  }, [text])

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!open) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setHighlight((h) => (h + step + suggestions.length) % suggestions.length)
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      choose(suggestions[highlight])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setQuery(null)
    }
  }

  return (
    <form
      className="mb-4 relative"
      onSubmit={(e) => {
        e.preventDefault()
        const trimmed = text.trim()
        if (!trimmed) return
        void onSubmit(encodeMentions(trimmed, picked)).then((ok) => {
          if (ok) {
            setText('')
            setPicked([])
          }
        })
      }}
    >
      <textarea
        ref={boxRef}
        aria-label={label}
        rows={rows}
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => track(e.target.value, e.target.selectionStart)}
        onKeyDown={onKeyDown}
        onBlur={() => setQuery(null)}
        placeholder={placeholder}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${highlight}` : undefined}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Mention someone"
          className="absolute z-10 left-0 -mt-2 min-w-48 list-none py-1 m-0 bg-surface border border-brand-border rounded-lg shadow-lg"
        >
          {suggestions.map((m, i) => (
            <li
              key={m.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === highlight}
              onMouseDown={(e) => {
                e.preventDefault()
                choose(m)
              }}
              className={`px-3 py-2 cursor-pointer rounded-md hover:bg-accent text-sm ${i === highlight ? 'bg-accent' : ''}`}
            >
              {m.name}
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!text.trim() || isSubmitting}>
          {isSubmitting ? busyLabel : submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}
