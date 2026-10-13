import React from 'react'

/**
 * The top of a work item's page: the title with the person who answers for it on the right,
 * then a bar holding the tabs on the left and the status and actions on the right. The bar
 * wraps under the tabs on narrow screens.
 */
export default function WorkItemHeader({
  title,
  titleId,
  subtitle,
  person,
  tabs,
  status,
  actions,
  children,
}: {
  title: React.ReactNode
  titleId?: string
  /** A quiet line under the title: where it happens, whose team. */
  subtitle?: React.ReactNode
  /** The owner of a project, the assignee of a task. */
  person?: React.ReactNode
  tabs?: React.ReactNode
  status?: React.ReactNode
  actions?: React.ReactNode
  /** Sits between the title row and the bar, e.g. the viewer's own standing on the item. */
  children?: React.ReactNode
}) {
  return (
    <header className="mb-4">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 mb-3">
        <div className="min-w-0">
          <h1 id={titleId} className="mb-0">
            {title}
          </h1>
          {subtitle && <p className="text-sm text-text-light mt-1 mb-0">{subtitle}</p>}
        </div>
        {person && <div className="min-w-0 sm:ml-auto">{person}</div>}
      </div>
      {children}
      <div className="flex flex-col lg:flex-row lg:items-stretch">
        <div className="min-w-0 lg:flex-1">{tabs}</div>
        <div
          aria-label="Status and actions"
          role="toolbar"
          className={`flex flex-wrap items-center gap-x-4 gap-y-2 ${tabs ? 'pt-3 lg:pt-0 lg:pl-4 lg:border-b lg:border-brand-border' : ''}`}
        >
          {/* Each group drops out when it renders nothing; a divider parts them when both show. */}
          <div
            role="group"
            aria-label="Status"
            className="flex flex-wrap items-center gap-2 empty:hidden"
          >
            {status}
          </div>
          <div
            role="group"
            aria-label="Actions"
            className="flex flex-wrap items-center gap-2 empty:hidden border-brand-border sm:[:not(:empty)+&]:border-l sm:[:not(:empty)+&]:pl-4"
          >
            {actions}
          </div>
        </div>
      </div>
    </header>
  )
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase()
}

/** Initials in a circle; the name beside it is what a screen reader reads. */
export function PersonInitials({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="w-7 h-7 rounded-full bg-secondary text-white text-xs font-semibold flex items-center justify-center shrink-0"
    >
      {initials(name)}
    </span>
  )
}

/**
 * The person block on the right of the title row: a small role label ("Owner", "Assigned
 * to"), then whatever names them, then an optional one-line summary of who else is on it.
 */
export function WorkItemPerson({
  label,
  children,
  summary,
  actions,
}: {
  label: string
  children: React.ReactNode
  summary?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span className="text-text-light">{label}</span>
      {children}
      {summary && <span className="text-text-light">· {summary}</span>}
      {actions}
    </div>
  )
}
