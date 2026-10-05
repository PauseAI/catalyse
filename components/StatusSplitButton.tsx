'use client'

import { useEffect, useRef, useState } from 'react'
import { badgeClasses, badgeColorClasses } from './Badge'
import { projectStatusVariant } from './ProjectCard'
import { projectStatusLabel } from '@/lib/project-status'

/**
 * The project's status as a split button: the current status on the left, and a caret on
 * the right that opens the statuses the viewer may move it to.
 */
export default function StatusSplitButton({
  value,
  options,
  onSelect,
  disabled = false,
}: {
  value: string
  options: { value: string; label: string }[]
  onSelect: (value: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const colors = badgeColorClasses(projectStatusVariant(value))
  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        aria-label="project status"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-stretch rounded-full text-sm font-semibold cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${colors}`}
      >
        <span className="px-3 py-1.5">{projectStatusLabel(value)}</span>
        <span className="flex items-center px-2 border-l border-current/20" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </span>
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="Change status to"
          className="absolute left-0 top-full mt-1 z-20 min-w-48 list-none m-0 p-1 bg-surface border border-brand-border rounded-lg shadow-lg"
        >
          {options.map((o) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              tabIndex={0}
              className="px-2 py-1.5 rounded cursor-pointer hover:bg-accent focus:bg-accent"
              onClick={() => {
                setOpen(false)
                onSelect(o.value)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setOpen(false)
                  onSelect(o.value)
                }
              }}
            >
              <span className={badgeClasses(projectStatusVariant(o.value))}>{o.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
